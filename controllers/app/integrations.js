// /app?page=integrations form actions: switch a tile on or off, pick its source and
// project, and make a new key. Admins only, like the rest of Settings.
const { Integration, LeadSource, Project } = require('../../models');
const { byKey } = require('../../config/integrations');
const { cleanBody, objIdOrNull } = require('../../utils/request');
const { isAdminRole } = require('../../utils/roles');
const { audit } = require('../../services/audit');
const { ensureIntegration } = require('../../services/integrations');
const { newWebhookKey } = require('../../services/capture');

const fail = (msg, status) => Object.assign(new Error(msg), { status });

async function tileFor(user, body) {
  if (!isAdminRole(user.role)) throw fail('Forbidden', 403);
  const tile = byKey(typeof body.tile === 'string' ? body.tile : '');
  if (!tile) throw fail('Unknown integration', 400);
  return { tile, row: await ensureIntegration(tile.key) };
}

const ACTIONS = {
  async save_integration(user, body) {
    const { tile, row } = await tileFor(user, body);
    const sourceId = objIdOrNull(body.source_id);
    const projectId = objIdOrNull(body.project_id);
    if (sourceId && !(await LeadSource.exists({ _id: sourceId }))) throw fail('Pick a lead source from the list', 400);
    if (projectId && !(await Project.exists({ _id: projectId }))) throw fail('Pick a project from the list', 400);
    const enabled = body.enabled === '1';
    await Integration.updateOne({ _id: row._id }, { enabled, source_id: sourceId || row.source_id, project_id: projectId });
    await audit(user.email, 'update', 'Integration', tile.key, { enabled, source_id: String(sourceId || row.source_id), project_id: projectId ? String(projectId) : '' });
    return `${tile.name} ${enabled ? 'is on' : 'is off'}.`;
  },
  async new_integration_key(user, body) {
    const { tile, row } = await tileFor(user, body);
    await Integration.updateOne({ _id: row._id }, { api_key: newWebhookKey() });
    await audit(user.email, 'update', 'Integration', tile.key, { api_key: 'regenerated' });
    return `New key for ${tile.name}. Update it wherever the old one was used.`;
  }
};

// Returns the flash message, or null when the action isn't one of these.
async function handleIntegrationAction(req) {
  const body = cleanBody(req.body);
  const fn = Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  return fn ? fn(req.user, body) : null;
}

module.exports = { handleIntegrationAction };
