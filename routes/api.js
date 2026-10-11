// JSON API routes: lead status, units, lead timeline
const express = require('express');
const { LEAD_STATUSES } = require('../config/constants');
const { Unit, Lead, FollowUp, Booking, AuditLog } = require('../models');
const { formatMoney } = require('../utils/format');
const { isManager } = require('../utils/roles');
const { audit } = require('../services/audit');
const { canEditLead } = require('../services/access');
const { requireAuth, refreshUserContext } = require('../middleware/auth');
const { appActionLimiter } = require('../middleware/rateLimits');

const router = express.Router();

router.patch('/api/lead/:id/status', requireAuth, appActionLimiter, refreshUserContext, async (req, res) => {
  try {
    const { status } = req.body;
    if (!LEAD_STATUSES.includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    if (!(await canEditLead(req.user, req.params.id)))
      return res.status(403).json({ error: 'Forbidden' });
    const update = { status };
    const existing = await Lead.findById(req.params.id).select('qualified_at booked_at');
    if (status === 'Qualified' && !existing?.qualified_at) update.qualified_at = new Date();
    if (status === 'Booked'    && !existing?.booked_at)    update.booked_at    = new Date();
    await Lead.findByIdAndUpdate(req.params.id, update);
    await audit(req.user.email, 'update', 'Lead', req.params.id, { status });
    res.json({ ok: true });
  } catch (e) {
    console.error('Status update error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------------
router.get('/api/units/:projectId', requireAuth, appActionLimiter, refreshUserContext, async (req, res) => {
  try {
    const units = await Unit.find({ project_id: req.params.projectId, status: 'Available' }).sort('unit_number');
    res.json(units);
  } catch (e) { res.status(500).json({ error: 'Failed to load units' }); }
});

router.get('/api/lead-timeline/:leadId', requireAuth, appActionLimiter, refreshUserContext, async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await Lead.findById(leadId).populate('source_id project_id assigned_caller_id assigned_closer_id');
    if (!lead) return res.status(404).json({ error: 'Not found' });

    // RBAC: non-managers can only view their own leads
    if (!isManager(req.user.role)) {
      const uid = String(req.user.userId);
      const owns = String(lead.assigned_caller_id?._id || '') === uid || String(lead.assigned_closer_id?._id || '') === uid;
      if (!owns) return res.status(403).json({ error: 'Forbidden' });
    }

    const events = [];
    events.push({ type: 'created', date: lead.created_at, label: 'Lead created', detail: 'Source: ' + (lead.source_id?.name || '\u2014') });
    if (lead.qualified_at) events.push({ type: 'qualified', date: lead.qualified_at, label: 'Qualified', detail: 'Closer: ' + (lead.assigned_closer_id?.full_name || '\u2014') });
    if (lead.booked_at) events.push({ type: 'booked', date: lead.booked_at, label: 'Booked', detail: '' });

    const followups = await FollowUp.find({ lead_id: leadId }).populate('assigned_to_id').sort('scheduled_date');
    followups.forEach(f => events.push({
      type: f.status === 'Completed' ? 'followup_done' : 'followup',
      date: f.scheduled_date,
      label: f.type + ' \u2014 ' + f.status,
      detail: f.outcome || f.notes || ''
    }));

    const booking = await Booking.findOne({ lead_id: leadId }).populate('unit_id project_id closer_id');
    if (booking) events.push({
      type: 'booking', date: booking.booking_date, label: 'Booking created',
      detail: 'Unit: ' + (booking.unit_id?.unit_number || '\u2014') + ', Value: ' + formatMoney(booking.sale_value)
    });

    const auditEvents = await AuditLog.find({ entity_id: String(leadId) }).sort('created_at').limit(20);
    auditEvents.forEach(a => {
      let label = a.action.charAt(0).toUpperCase() + a.action.slice(1);
      let detail = a.user_email;
      const d = a.details || {};

      if (d.quick_disposition) {
        label = 'Marked ' + d.quick_disposition;
        detail = a.user_email + (d.reason ? ' — Reason: ' + d.reason : '');
      } else if (d.contact_outcome) {
        label = 'Call outcome: ' + d.contact_outcome;
        detail = a.user_email;
      } else if (d.qualified) {
        label = 'Marked Qualified';
        detail = a.user_email;
      } else if (a.action === 'create' && a.entity === 'Lead') {
        return; // already shown as "Lead created" event above, skip duplicate
      } else if (a.action === 'update' && a.entity === 'Lead') {
        label = 'Lead details updated';
        detail = a.user_email + (d.name ? ' — ' + d.name : '');
      } else if (a.action === 'csv_import') {
        label = 'Imported via CSV';
        detail = a.user_email;
      }

      events.push({ type: 'audit', date: a.created_at, label, detail });
    });

    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(events);
  } catch (e) {
    console.error('Timeline error:', e);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

module.exports = router;
