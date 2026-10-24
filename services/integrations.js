// Lead sources a client connects on its own from the Integrations page. Every tile
// posts to /api/leads/in/<tile> with its own key, and the lead goes through the same
// capture as the enquiry form: duplicate check, Hot/Warm/Cold, assignment, alerts.
const { Integration, IntegrationLog, LeadSource } = require('../models');
const { INTEGRATIONS, byKey } = require('../config/integrations');
const { captureLead, keyMatches, newWebhookKey, fromGoogleAds } = require('./capture');

const LOG_SIZE = 20;
const QUIET_DAYS = 7;

async function log(key, result, extra = {}) {
  try {
    await IntegrationLog.create({ key, result, ...extra });
  } catch (e) {
    console.error('Integration log failed:', e.message);
  }
}

// The tile's row, created on first use with a fresh key and a source named after it.
async function ensureIntegration(key) {
  const tile = byKey(key);
  if (!tile) return null;
  const existing = await Integration.findOne({ key });
  if (existing) return existing;
  let source = await LeadSource.findOne({ name: tile.source });
  if (!source) source = await LeadSource.create({ name: tile.source, channel: 'Online', active: true, notes: 'Created by the ' + tile.name + ' integration' });
  try {
    return await Integration.create({ key, api_key: newWebhookKey(), source_id: source._id });
  } catch (e) {
    if (e.code === 11000) return Integration.findOne({ key }); // two admins at once
    throw e;
  }
}

// Every tile with its state, for the Integrations page.
async function listTiles() {
  const [rows, logs, recent] = await Promise.all([
    Integration.find().lean(),
    IntegrationLog.aggregate([
      { $sort: { at: -1 } },
      { $group: { _id: '$key', items: { $push: '$$ROOT' } } },
      { $project: { items: { $slice: ['$items', LOG_SIZE] } } }
    ]),
    IntegrationLog.aggregate([
      { $match: { at: { $gte: new Date(Date.now() - QUIET_DAYS * 864e5) }, result: { $in: ['new', 'repeat'] } } },
      { $group: { _id: '$key', count: { $sum: 1 } } }
    ])
  ]);
  return INTEGRATIONS.map(tile => {
    const row = rows.find(r => r.key === tile.key) || null;
    const items = (logs.find(l => l._id === tile.key) || {}).items || [];
    const leads7d = (recent.find(r => r._id === tile.key) || {}).count || 0;
    let status = 'off';
    if (row && row.enabled) {
      // A stray bad request isn't a problem; three failures in a row are.
      const failing = items.length >= 3 && items.slice(0, 3).every(i => ['refused', 'error'].includes(i.result));
      const quiet = !leads7d && (Date.now() - new Date(row.updated_at).getTime()) > QUIET_DAYS * 864e5;
      status = failing || quiet ? 'attention' : 'on';
    }
    return { ...tile, row, log: items, leads7d, status };
  });
}

// A lead posted to a tile's URL. Returns { status, body } for the JSON reply.
async function receive(key, body, sentKey) {
  const tile = byKey(key);
  if (!tile) return { status: 404, body: { ok: false, error: 'Not found' } };
  const row = await Integration.findOne({ key }).lean();
  if (!row || !row.enabled) {
    if (row) await log(key, 'refused', { detail: 'Received while switched off' });
    return { status: 404, body: { ok: false, error: 'Not found' } };
  }
  const isGoogle = Array.isArray(body.user_column_data);
  if (!keyMatches(sentKey || body.google_key, row.api_key)) {
    await log(key, 'refused', { detail: 'Wrong or missing key' });
    return { status: 401, body: { ok: false, error: 'Invalid key' } };
  }
  const input = isGoogle ? fromGoogleAds(body) : body;
  if (isGoogle && body.is_test === true) {
    await log(key, 'test', { name: String(input.name || '').slice(0, 100), detail: 'Google Ads test data, no lead made' });
    return { status: 200, body: { ok: true, test: true } };
  }
  try {
    // The tile decides the source; the project comes from the lead if it names one.
    const { lead, duplicate } = await captureLead(
      { ...input, source: undefined, source_id: undefined, project_id: input.project ? undefined : row.project_id },
      tile.name, { sourceId: row.source_id, sourceName: tile.source }
    );
    await log(key, duplicate ? 'repeat' : 'new', { lead_id: lead._id, name: String(input.name || '').slice(0, 100) });
    return { status: duplicate ? 200 : 201, body: { ok: true, id: String(lead._id), duplicate } };
  } catch (e) {
    await log(key, e.status ? 'refused' : 'error', { name: String(input.name || '').slice(0, 100), detail: e.status ? e.message : 'Could not save the lead' });
    if (!e.status) throw e;
    return { status: e.status, body: { ok: false, error: e.message } };
  }
}

module.exports = { ensureIntegration, listTiles, receive, LOG_SIZE };
