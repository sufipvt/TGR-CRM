const { AuditLog } = require('../models');

async function audit(userEmail, action, entity, entityId, details) {
  try {
    await AuditLog.create({ user_email: userEmail, action, entity, entity_id: entityId ? String(entityId) : '', details: details || {} });
  } catch (e) { console.error('Audit log failed:', e.message); }
}

module.exports = { audit };
