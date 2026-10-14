// Lead capture from outside the CRM: a public enquiry form (GET/POST /enquire)
// and a webhook (POST /api/leads/capture). Each is off until turned on in
// Settings; while off, both answer 404 as if they didn't exist.
const express = require('express');
const { Project } = require('../models');
const { enquiryLimiter, webhookLimiter } = require('../middleware/rateLimits');
const { logError } = require('../middleware/requestLog');
const { sendErrorPage } = require('../utils/errorPage');
const { captureSettings, captureLead, keyMatches, fromGoogleAds, WEBHOOK_SOURCE } = require('../services/capture');

const router = express.Router();

// Express 4 doesn't catch rejected promises; hand them to the global error page.
const safe = fn => (req, res, next) => fn(req, res, next).catch(next);

const openProjects = () => Project.find({ status: { $ne: 'Sold Out' } }).sort('name').select('name').lean();

router.get('/enquire', safe(async (req, res) => {
  const cfg = await captureSettings();
  if (!cfg.formEnabled) return sendErrorPage(res, 404, 'The page you’re looking for doesn’t exist.');
  res.render('enquire', { projects: await openProjects(), values: {}, error: null, done: false });
}));

router.post('/enquire', enquiryLimiter, safe(async (req, res) => {
  const cfg = await captureSettings();
  if (!cfg.formEnabled) return sendErrorPage(res, 404, 'The page you’re looking for doesn’t exist.');
  const body = req.body || {};
  // Hidden field people never see; bots that fill every box get a fake "thanks".
  if (body.website) return res.render('enquire', { projects: [], values: {}, error: null, done: true });
  try {
    await captureLead(
      { name: body.name, phone: body.phone, email: body.email, project_id: body.project_id, notes: body.message },
      'enquiry form', { sourceId: cfg.formSourceId }
    );
    res.render('enquire', { projects: [], values: {}, error: null, done: true });
  } catch (e) {
    if (!e.status) logError(req, 'enquire', e);
    res.status(e.status || 500).render('enquire', {
      projects: await openProjects(), values: body, done: false,
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

module.exports = router;
