// Leads that arrive on their own: the public enquiry form and the webhook.
// Both are off until an admin turns them on in Settings. A phone already in the
// CRM never makes a second lead: the enquiry is noted on the existing one.
const crypto = require('crypto');
const { Types } = require('mongoose');
const { Lead, LeadSource, Project, Setting, FollowUp } = require('../models');
const { escapeRegex } = require('../utils/request');
const { audit } = require('./audit');
const { getNextCaller } = require('./assignment');
const { phoneKey, findDuplicateLead } = require('./duplicates');
const { getSettings, clearSettingsCache } = require('./settings');
const { withLock } = require('./lock');
const { notifyLeadCaptured } = require('./notify');
const { readAnswers, scoreAnswers, hotter, firstCallDue, answersLine, DUE_WORDS } = require('./enquiryScore');

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
// Buying answers (timeline, budget, property_type, site_visit, utm_*) are optional;
// they set Hot / Warm / Cold and how soon the first call is due.
// Throws { status: 400 } for missing name or phone.
// One capture at a time, so the same buyer tapping Send twice makes one lead and
// simultaneous enquiries are spread across agents instead of all going to one.
function captureLead(input, via, defaults = {}) {
  return withLock('new-lead', () => saveCapturedLead(input, via, defaults));
}

async function saveCapturedLead(input, via, defaults) {
  const name = text(input.name, 100);
  const phone = text(input.phone, 30);
  if (!name || !phoneKey(phone)) throw Object.assign(new Error('Please give a name and a valid phone number.'), { status: 400 });
  const message = text(input.notes, 1000);
  const project = await findProject(input.project_id, input.project);
  const answers = readAnswers(input);
  const temperature = scoreAnswers(answers);
  const summary = answersLine(answers);

  const dup = await findDuplicateLead(phone);
  if (dup) {
    const when = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const line = `[${when}] Enquired again via ${via}` + (project ? ` about ${project.name}` : '') +
      (summary ? ` (${summary})` : '') + (message ? `: ${message}` : '');
    const current = await Lead.findById(dup._id).select('temperature').lean();
    const now = new Date();
    const set = {
      // Appended in the database, so a note written by someone else meanwhile is kept.
      notes: { $concat: [{ $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$notes', ''] } }, 0] }, { $concat: ['$notes', '\n'] }, ''] }, line] },
      // Back to the top of the list, marked as re-enquired, so it isn't missed.
      listed_at: now, last_enquiry_at: now, updated_at: now,
      enquiry_count: { $add: [{ $ifNull: ['$enquiry_count', 0] }, 1] }
    };
    // A warmer answer this time warms the lead up; it never cools it down.
    const was = current && current.temperature;
    if (temperature && temperature !== was && hotter(temperature, was) === temperature) set.temperature = temperature;
    await Lead.updateOne({ _id: dup._id }, [{ $set: set }]);
    await audit(via, 'update', 'Lead', dup._id, { repeat_enquiry: true, ...(set.temperature ? { temperature } : {}) });
    const fresh = await Lead.findById(dup._id).select('name phone temperature assigned_caller_id assigned_closer_id').lean();
    await scheduleFirstCall(fresh, fresh.temperature, via, true);
    await alert(fresh, true, via);
    return { lead: dup, duplicate: true };
  }

  const source = await findSource(input.source_id || defaults.sourceId, input.source, defaults.sourceName || FORM_SOURCE);
  const caller = await getNextCaller({ project_id: project ? project._id : null, source_id: source._id });
  const lead = await Lead.create({
    name, phone,
    email: text(input.email, 120),
    city: text(input.city, 60),
    budget_range: answers.budget || text(input.budget, 60),
    source_id: source._id,
    project_id: project ? project._id : null,
    assigned_caller_id: caller,
    status: 'New',
    temperature: temperature || undefined,
    enquiry: Object.fromEntries(Object.entries(answers).filter(([, v]) => v)),
    notes: [`Captured via ${via}`, summary, message].filter(Boolean).join(': '),
    created_at: new Date()
  });
  await audit(via, 'create', 'Lead', lead._id, { name, via, ...(temperature ? { temperature } : {}) });
  await scheduleFirstCall(lead, temperature, via, false);
  await alert(lead, false, via);
  return { lead, duplicate: false };
}

// Puts the first call on the assigned agent's follow-up list, due by how hot the lead is.
// A repeat enquiry only adds one if nothing is already pending for that lead.
async function scheduleFirstCall(lead, temperature, via, repeat) {
  if (!lead.assigned_caller_id) return null;
  if (repeat && await FollowUp.exists({ lead_id: lead._id, status: 'Pending' })) return null;
  const label = temperature ? `${temperature} lead` : 'New lead';
  const fu = await FollowUp.create({
    lead_id: lead._id,
    assigned_to_id: lead.assigned_caller_id,
    scheduled_date: firstCallDue(temperature),
    type: 'Call',
    status: 'Pending',
    notes: `${label} from ${via}${repeat ? ' (enquired again)' : ''}: call ${DUE_WORDS[temperature] || 'within the hour'}.`
  });
  await audit(via, 'create', 'FollowUp', fu._id, { lead_id: String(lead._id), first_call: true });
  return fu;
}

// The lead is already saved; a failed alert must not turn the enquiry into an error.
async function alert(lead, duplicate, via) {
  try {
    await notifyLeadCaptured(lead, { duplicate, via });
  } catch (e) {
    console.error('Lead alert failed:', e.message);
  }
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
