// Lead capture from outside the CRM: a public enquiry form (GET/POST /enquire),
// the general webhook (POST /api/leads/capture) and one URL per Integrations tile
// (POST /api/leads/in/<tile>). Each is off until turned on on the Integrations page;
// while off, it answers 404 as if it didn't exist.
const express = require('express');
const { Project } = require('../models');
const { enquiryLimiter, webhookLimiter } = require('../middleware/rateLimits');
const { logError } = require('../middleware/requestLog');
const { sendErrorPage } = require('../utils/errorPage');
const { captureSettings, captureLead, keyMatches, fromGoogleAds, WEBHOOK_SOURCE } = require('../services/capture');
const { receive } = require('../services/integrations');
const { TIMELINES, BUDGETS, PROPERTY_TYPES, SITE_VISITS } = require('../services/enquiryScore');

const router = express.Router();

// Express 4 doesn't catch rejected promises; hand them to the global error page.
const safe = fn => (req, res, next) => fn(req, res, next).catch(next);

const openProjects = () => Project.find({ status: { $ne: 'Sold Out' } }).sort('name').select('name').lean();
const options = { timelines: TIMELINES, budgets: BUDGETS, propertyTypes: PROPERTY_TYPES, siteVisits: SITE_VISITS };
const FORM_FIELDS = ['timeline', 'budget', 'property_type', 'site_visit', 'utm_source', 'utm_medium', 'utm_campaign'];
const str = v => (typeof v === 'string' ? v : '');

// ?project=<id> preselects a project (one link per project page or ad);
// ?utm_source=&utm_medium=&utm_campaign= record which ad or post sent the visitor.
function linkValues(query) {
  const values = { project_id: str(query.project) };
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) values[k] = str(query[k]).slice(0, 60);
  return values;
}

const render = (res, extra) => res.render('enquire', { projects: [], values: {}, error: null, done: false, options, ...extra });

router.get('/enquire', safe(async (req, res) => {
  const cfg = await captureSettings();
  if (!cfg.formEnabled) return sendErrorPage(res, 404, 'The page you’re looking for doesn’t exist.');
  render(res, { projects: await openProjects(), values: linkValues(req.query) });
}));

router.post('/enquire', enquiryLimiter, safe(async (req, res) => {
  const cfg = await captureSettings();
  if (!cfg.formEnabled) return sendErrorPage(res, 404, 'The page you’re looking for doesn’t exist.');
  const body = req.body || {};
  // Hidden field people never see; bots that fill every box get a fake "thanks".
  if (body.website) return render(res, { done: true });
  const input = { name: body.name, phone: body.phone, email: body.email, project_id: body.project_id, notes: body.message };
  for (const k of FORM_FIELDS) input[k] = body[k];
  try {
    await captureLead(input, 'enquiry form', { sourceId: cfg.formSourceId });
    render(res, { done: true });
  } catch (e) {
    if (!e.status) logError(req, 'enquire', e);
    res.status(e.status || 500);
    render(res, {
      projects: await openProjects(), values: body,
      error: e.status ? e.message : 'Something went wrong. Please try again.'
    });
  }
}));

// JSON or form body. The key comes in the X-Api-Key header (Zapier, Pabbly, Make)
// or as google_key in a Google Ads lead form webhook; never in the URL, which is logged.
router.post('/api/leads/capture', webhookLimiter, safe(async (req, res) => {
  const cfg = await captureSettings();
  if (!cfg.webhookEnabled) return res.status(404).json({ ok: false, error: 'Not found' });
  const body = req.body || {};
  const isGoogle = Array.isArray(body.user_column_data);
  if (!keyMatches(req.get('x-api-key') || body.google_key, cfg.webhookKey)) {
    return res.status(401).json({ ok: false, error: 'Invalid key' });
  }
  try {
    const input = isGoogle ? fromGoogleAds(body) : body;
    const { lead, duplicate } = await captureLead(input, isGoogle ? 'Google Ads' : 'webhook', { sourceName: WEBHOOK_SOURCE });
    res.status(duplicate ? 200 : 201).json({ ok: true, id: String(lead._id), duplicate });
  } catch (e) {
    if (!e.status) logError(req, 'lead webhook', e);
    res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'Could not save the lead' });
  }
}));

// One tile's URL. The key comes in the X-Api-Key header, or as google_key from Google Ads.
router.post('/api/leads/in/:tile', webhookLimiter, safe(async (req, res) => {
  try {
    const { status, body } = await receive(String(req.params.tile), req.body || {}, req.get('x-api-key'));
    res.status(status).json(body);
  } catch (e) {
    logError(req, 'integration ' + req.params.tile, e);
    res.status(500).json({ ok: false, error: 'Could not save the lead' });
  }
}));

module.exports = router;
