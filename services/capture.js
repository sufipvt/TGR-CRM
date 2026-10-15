// Leads that arrive on their own: the public enquiry form and the webhook.
// Both are off until an admin turns them on in Settings. A phone already in the
// CRM never makes a second lead: the enquiry is noted on the existing one.
const crypto = require('crypto');
const { Types } = require('mongoose');
const { Lead, LeadSource, Project, Setting } = require('../models');
const { escapeRegex } = require('../utils/request');
const { audit } = require('./audit');
const { getNextCaller } = require('./assignment');
const { phoneKey, findDuplicateLead } = require('./duplicates');
const { getSettings, clearSettingsCache } = require('./settings');

const FORM_SOURCE = 'Website Enquiry';
const WEBHOOK_SOURCE = 'Webhook';

const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

async function captureSettings() {
  const s = await getSettings();
  return {
    formEnabled: s.capture_form_enabled === '1',
    formSourceId: s.capture_source_id || '',
    webhookEnabled: s.capture_webhook_enabled === '1',
    webhookKey: s.capture_webhook_key || ''
  };
}

async function setSetting(key, value) {
  await Setting.findOneAndUpdate({ key }, { key, value }, { upsert: true });
  clearSettingsCache();
}

function newWebhookKey() { return crypto.randomBytes(24).toString('hex'); }

// Constant-time check of a key a caller sent against the stored one.
function keyMatches(sent, stored) {
  if (!sent || !stored) return false;
  const a = crypto.createHash('sha256').update(String(sent)).digest();
  const b = crypto.createHash('sha256').update(String(stored)).digest();
  return crypto.timingSafeEqual(a, b);
}

async function findSource(sourceId, sourceName, fallbackName) {
  if (sourceId && Types.ObjectId.isValid(sourceId)) {
    const s = await LeadSource.findById(sourceId);
    if (s) return s;
  }
  const name = text(sourceName, 60) || fallbackName;
  const existing = await LeadSource.findOne({ name: new RegExp('^' + escapeRegex(name) + '$', 'i') });
  return existing || LeadSource.create({ name, channel: 'Online', active: true, notes: 'Created by lead capture' });
}

async function findProject(projectId, projectName) {
  if (projectId && Types.ObjectId.isValid(projectId)) return Project.findById(projectId).select('_id name');
  const name = text(projectName, 100);
  return name ? Project.findOne({ name: new RegExp('^' + escapeRegex(name) + '$', 'i') }).select('_id name') : null;
}

// Saves one captured lead. `via` names the channel in notes and the audit log.
// Throws { status: 400 } for missing name or phone.
async function captureLead(input, via, defaults = {}) {
  const name = text(input.name, 100);
  const phone = text(input.phone, 30);
  if (!name || !phoneKey(phone)) throw Object.assign(new Error('Please give a name and a valid phone number.'), { status: 400 });
  const message = text(input.notes, 1000);
  const project = await findProject(input.project_id, input.project);

  const dup = await findDuplicateLead(phone);
  if (dup) {
    const when = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const line = `[${when}] Enquired again via ${via}` + (project ? ` about ${project.name}` : '') + (message ? `: ${message}` : '');
    const current = await Lead.findById(dup._id).select('notes').lean();
    await Lead.updateOne({ _id: dup._id }, { notes: [current && current.notes, line].filter(Boolean).join('\n') });
    await audit(via, 'update', 'Lead', dup._id, { repeat_enquiry: true });
    return { lead: dup, duplicate: true };
  }

  const source = await findSource(input.source_id || defaults.sourceId, input.source, defaults.sourceName || FORM_SOURCE);
  const caller = await getNextCaller({ project_id: project ? project._id : null, source_id: source._id });
  const lead = await Lead.create({
    name, phone,
    email: text(input.email, 120),
    city: text(input.city, 60),
    budget_range: text(input.budget, 60),
    source_id: source._id,
    project_id: project ? project._id : null,
    assigned_caller_id: caller,
    status: 'New',
    notes: [`Captured via ${via}`, message].filter(Boolean).join(': '),
    created_at: new Date()
  });
  await audit(via, 'create', 'Lead', lead._id, { name, via });
  return { lead, duplicate: false };
}

// Google Ads lead form webhooks send fields as user_column_data; map them to ours.
function fromGoogleAds(body) {
  const cols = {};
  for (const c of Array.isArray(body.user_column_data) ? body.user_column_data : []) {
    if (c && typeof c.column_id === 'string') cols[c.column_id] = c.string_value;
  }
  const name = cols.FULL_NAME || [cols.FIRST_NAME, cols.LAST_NAME].filter(Boolean).join(' ');
  return { name, phone: cols.PHONE_NUMBER, email: cols.EMAIL, city: cols.CITY, source: 'Google Ads' };
}

module.exports = {
  FORM_SOURCE, WEBHOOK_SOURCE, captureSettings, setSetting, newWebhookKey, keyMatches, captureLead, fromGoogleAds
};
