// /app POST form actions (action=...)
const bcrypt = require('bcryptjs');
const { Types } = require('mongoose');
const {
  LEAD_STATUSES, LEAD_TEMPERATURES, CONTACT_OUTCOMES, NOT_INTERESTED_REASONS, LOST_REASONS
} = require('../../config/constants');
const {
  User, Project, Unit, LeadSource, Lead, FollowUp, Booking, Payment, Team, Setting
} = require('../../models');
const { formatMoney } = require('../../utils/format');
const { cleanBody, objIdOrNull } = require('../../utils/request');
const { isSuperAdmin, isAdminRole, isTeamLeader, isManager } = require('../../utils/roles');
const { audit } = require('../../services/audit');
const { getNextCaller } = require('../../services/assignment');
const { canEditLead, canActForUser, canAssignTo } = require('../../services/access');
const { userContextCache } = require('../../middleware/auth');

function forbidden(msg) { return Object.assign(new Error(msg || 'Forbidden'), { status: 403 }); }

// Every id the user picks for someone to own the record must be inside their reach.
async function assertAssignable(user, ...ids) {
  for (const id of ids) {
    if (!(await canAssignTo(user, id))) throw forbidden('You can only assign work to your own team');
  }
}

async function handlePostAction(req) {
  const body = cleanBody(req.body);
  const action = body.action;
  const user = req.user;
  const manager = isManager(user.role);

  switch (action) {
    case 'add_lead': {
      await assertAssignable(user, objIdOrNull(body.assigned_caller_id), objIdOrNull(body.assigned_closer_id));
      const caller = objIdOrNull(body.assigned_caller_id) || await getNextCaller();
      const lead = await Lead.create({
        name: body.name, phone: body.phone, email: body.email || '', city: body.city || '',
        source_id: objIdOrNull(body.source_id),
        project_id: objIdOrNull(body.project_id),
        budget_range: body.budget_range || '',
        status: 'New',
        temperature: LEAD_TEMPERATURES.includes(body.temperature) ? body.temperature : undefined,
        assigned_caller_id: caller,
        assigned_closer_id: objIdOrNull(body.assigned_closer_id),
        notes: body.notes || '',
        created_at: new Date()
      });
      await audit(user.email, 'create', 'Lead', lead._id, { name: body.name });
      return 'Lead added.';
    }
    case 'update_lead': {
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = {
        name: body.name, phone: body.phone, email: body.email || '', city: body.city || '',
        budget_range: body.budget_range || '', notes: body.notes || ''
      };
      if (body.source_id) update.source_id = objIdOrNull(body.source_id);
      update.project_id = objIdOrNull(body.project_id);
      if (manager) {
        update.assigned_caller_id = objIdOrNull(body.assigned_caller_id);
        update.assigned_closer_id = objIdOrNull(body.assigned_closer_id);
        // Only check people who are being newly assigned, so editing a lead that was
        // handed to someone outside the team doesn't block unrelated changes.
        const current = await Lead.findById(body.lead_id).select('assigned_caller_id assigned_closer_id');
        const changed = ['assigned_caller_id', 'assigned_closer_id']
          .filter(k => String(update[k] || '') !== String((current && current[k]) || ''))
          .map(k => update[k]);
        await assertAssignable(user, ...changed);
      }
      if (LEAD_TEMPERATURES.includes(body.temperature)) {
        update.temperature = body.temperature;
      } else if (body.temperature === '') {
        update.temperature = null;
      }
      if (body.status && LEAD_STATUSES.includes(body.status)) {
        update.status = body.status;
        const existing = await Lead.findById(body.lead_id).select('qualified_at booked_at');
        if (body.status === 'Qualified' && !existing.qualified_at) update.qualified_at = new Date();
        if (body.status === 'Booked' && !existing.booked_at) update.booked_at = new Date();
        if (body.status === 'Not Interested' && NOT_INTERESTED_REASONS.includes(body.disposition_reason)) {
          update.disposition_reason = body.disposition_reason;
        } else if (body.status === 'Lost' && LOST_REASONS.includes(body.disposition_reason)) {
          update.disposition_reason = body.disposition_reason;
        }
      }
      await Lead.findByIdAndUpdate(body.lead_id, update);
      await audit(user.email, 'update', 'Lead', body.lead_id, { name: body.name });
      return 'Lead updated.';
    }
    case 'quick_disposition': {
      if (!['Not Interested', 'Working', 'Qualified'].includes(body.status)) {
        throw Object.assign(new Error('Invalid status'), { status: 400 });
      }
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = { status: body.status };
      const existing = await Lead.findById(body.lead_id).select('qualified_at');
      if (body.status === 'Qualified' && !existing?.qualified_at) {
        update.qualified_at = new Date();
      }
      if (body.status === 'Qualified') update.contact_outcome = 'Interested';
      if (body.status === 'Working') update.contact_outcome = 'Requested Callback';
      if (body.status === 'Not Interested') {
        update.contact_outcome = 'Not Interested';
        if (NOT_INTERESTED_REASONS.includes(body.disposition_reason)) {
          update.disposition_reason = body.disposition_reason;
        }
      }

      await Lead.findByIdAndUpdate(body.lead_id, update);
      await audit(user.email, 'update', 'Lead', body.lead_id, { quick_disposition: body.status, reason: body.disposition_reason || undefined });
      return 'Lead marked ' + body.status + '.';
    }
    case 'quick_contact_outcome': {
      if (!CONTACT_OUTCOMES.includes(body.contact_outcome)) throw Object.assign(new Error('Invalid outcome'), { status: 400 });
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Lead.findByIdAndUpdate(body.lead_id, { contact_outcome: body.contact_outcome });
      await audit(user.email, 'update', 'Lead', body.lead_id, { contact_outcome: body.contact_outcome });
      return 'Logged: ' + body.contact_outcome + '.';
    }
    case 'qualify_lead': {
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await assertAssignable(user, objIdOrNull(body.assigned_closer_id));
      await Lead.findByIdAndUpdate(body.lead_id, {
        status: 'Qualified',
        assigned_closer_id: objIdOrNull(body.assigned_closer_id),
        qualified_at: new Date()
      });
      await audit(user.email, 'update', 'Lead', body.lead_id, { qualified: true });
      return 'Lead qualified.';
    }
    case 'add_project': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const p = await Project.create({
        name: body.name, developer: body.developer, location: body.location, city: body.city,
        state: body.state, project_type: body.project_type || 'Other', status: body.status || 'Upcoming',
        total_units: Number(body.total_units || 0), available_units: Number(body.available_units || 0),
        price_range: body.price_range, notes: body.notes
      });
      await audit(user.email, 'create', 'Project', p._id, { name: body.name });
      return 'Project added.';
    }
    case 'update_project': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Project.findByIdAndUpdate(body.project_id, {
        name: body.name, developer: body.developer, location: body.location, city: body.city,
        state: body.state, project_type: body.project_type, status: body.status,
        total_units: Number(body.total_units || 0), available_units: Number(body.available_units || 0),
        price_range: body.price_range, notes: body.notes
      });
      await audit(user.email, 'update', 'Project', body.project_id, { name: body.name });
      return 'Project updated.';
    }
    case 'add_unit': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const u = await Unit.create({
        project_id: objIdOrNull(body.project_id), unit_number: body.unit_number, type: body.type,
        bhk: body.bhk, area_sqft: Number(body.area_sqft || 0), base_price: Number(body.base_price || 0),
        status: body.status || 'Available', notes: body.notes
      });
      await audit(user.email, 'create', 'Unit', u._id, { unit_number: body.unit_number });
      return 'Unit added.';
    }
    case 'update_unit': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Unit.findByIdAndUpdate(body.unit_id, {
        unit_number: body.unit_number, type: body.type, bhk: body.bhk,
        area_sqft: Number(body.area_sqft || 0), base_price: Number(body.base_price || 0),
        status: body.status, notes: body.notes
      });
      await audit(user.email, 'update', 'Unit', body.unit_id, { unit_number: body.unit_number });
      return 'Unit updated.';
    }
    case 'add_source': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const s = await LeadSource.create({ name: body.name, channel: body.channel, active: body.active === 'true' || body.active === 'on', notes: body.notes });
      await audit(user.email, 'create', 'LeadSource', s._id, { name: body.name });
      return 'Source added.';
    }
    case 'update_source': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await LeadSource.findByIdAndUpdate(body.source_id, { name: body.name, channel: body.channel, active: body.active === 'true' || body.active === 'on', notes: body.notes });
      await audit(user.email, 'update', 'LeadSource', body.source_id, { name: body.name });
      return 'Source updated.';
    }
    case 'add_user': {
      if (!isSuperAdmin(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (!body.password || body.password.length < 6) throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
      const hashed = await bcrypt.hash(body.password, 12);
      const nu = await User.create({
        full_name: body.full_name, email: (body.email || '').toLowerCase(), password: hashed,
        role: body.role, phone: body.phone, status: body.status || 'Active',
        team_id: objIdOrNull(body.team_id)
      });
      await audit(user.email, 'create', 'User', nu._id, { email: body.email, role: body.role });
      return 'User added.';
    }
    case 'update_user': {
      if (!isSuperAdmin(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = {
        full_name: body.full_name, email: (body.email || '').toLowerCase(),
        role: body.role, phone: body.phone, status: body.status,
        team_id: objIdOrNull(body.team_id)
      };
      if (body.password) update.password = await bcrypt.hash(body.password, 12);
      await User.findByIdAndUpdate(body.user_id, update);
      userContextCache.delete(String(body.user_id));
      await audit(user.email, 'update', 'User', body.user_id, { email: body.email });
      return 'User updated.';
    }
    case 'add_followup': {
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const assignee = manager ? (objIdOrNull(body.assigned_to_id) || new Types.ObjectId(user.userId)) : new Types.ObjectId(user.userId);
      await assertAssignable(user, assignee);
      const f = await FollowUp.create({
        lead_id: objIdOrNull(body.lead_id), assigned_to_id: assignee,
        scheduled_date: new Date(body.scheduled_date), type: body.type || 'Call',
        status: 'Pending', notes: body.notes
      });
      await audit(user.email, 'create', 'FollowUp', f._id, { lead_id: body.lead_id, type: body.type });
      return 'Follow-up scheduled.';
    }
    case 'update_followup': {
      const f = await FollowUp.findById(body.followup_id);
      if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
      if (!(await canActForUser(user, f.assigned_to_id))) throw forbidden();
      const update = { scheduled_date: new Date(body.scheduled_date), type: body.type, notes: body.notes, status: body.status || f.status, outcome: body.outcome };
      if (manager && body.assigned_to_id) {
        update.assigned_to_id = objIdOrNull(body.assigned_to_id);
        if (String(update.assigned_to_id || '') !== String(f.assigned_to_id || '')) await assertAssignable(user, update.assigned_to_id);
      }
      await FollowUp.findByIdAndUpdate(body.followup_id, update);
      await audit(user.email, 'update', 'FollowUp', body.followup_id, {});
      return 'Follow-up updated.';
    }
    case 'complete_followup': {
      const f = await FollowUp.findById(body.followup_id);
      if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
      if (!(await canActForUser(user, f.assigned_to_id))) throw forbidden();
      await FollowUp.findByIdAndUpdate(body.followup_id, { status: 'Completed', completed_date: new Date(), outcome: body.outcome || '' });
      await audit(user.email, 'update', 'FollowUp', body.followup_id, { completed: true });
      return 'Follow-up completed.';
    }
    case 'add_booking': {
      const leadId = objIdOrNull(body.lead_id);
      const lead = await Lead.findById(leadId);
      if (!lead) throw Object.assign(new Error('Lead not found'), { status: 404 });
      const closerId = manager ? (objIdOrNull(body.closer_id) || new Types.ObjectId(user.userId)) : new Types.ObjectId(user.userId);
      if (!manager && String(lead.assigned_closer_id || '') !== String(user.userId)) {
        throw Object.assign(new Error('You can only book your own leads'), { status: 403 });
      }
      if (!(await canEditLead(user, leadId))) throw forbidden('You can only book your own team\'s leads');
      await assertAssignable(user, closerId);
      const b = await Booking.create({
        lead_id: leadId, project_id: objIdOrNull(body.project_id), unit_id: objIdOrNull(body.unit_id),
        closer_id: closerId, booking_date: body.booking_date ? new Date(body.booking_date) : new Date(),
        sale_value: Number(body.sale_value || 0), booking_amount: Number(body.booking_amount || 0),
        status: body.status || 'Tentative', notes: body.notes
      });
      await Unit.findByIdAndUpdate(body.unit_id, { status: 'Booked' });
      await Lead.findByIdAndUpdate(leadId, { status: 'Booked', booked_at: new Date() });
      await audit(user.email, 'create', 'Booking', b._id, { lead: lead.name, sale_value: body.sale_value });
      return 'Booking created.';
    }
    case 'update_booking': {
      const b = await Booking.findById(body.booking_id);
      if (!b) throw Object.assign(new Error('Not found'), { status: 404 });
      if (!(await canActForUser(user, b.closer_id))) throw forbidden();
      await Booking.findByIdAndUpdate(body.booking_id, {
        sale_value: Number(body.sale_value || 0), booking_amount: Number(body.booking_amount || 0),
        booking_date: body.booking_date ? new Date(body.booking_date) : b.booking_date,
        status: body.status, notes: body.notes
      });
      await audit(user.email, 'update', 'Booking', body.booking_id, {});
      return 'Booking updated.';
    }
    case 'add_payment': {
      const b = await Booking.findById(body.booking_id);
      if (!b) throw Object.assign(new Error('Booking not found'), { status: 404 });
      if (!(await canActForUser(user, b.closer_id))) throw forbidden();
      const payments = await Payment.find({ booking_id: b._id });
      const paid = payments.reduce((s, p) => s + p.amount, 0);
      const amt = Number(body.amount || 0);
      if (amt <= 0) throw Object.assign(new Error('Amount must be positive'), { status: 400 });
      if (paid + amt > b.sale_value) throw Object.assign(new Error('Payment exceeds sale value. Paid: ' + formatMoney(paid) + ' of ' + formatMoney(b.sale_value)), { status: 400 });
      const p = await Payment.create({
        booking_id: b._id, amount: amt,
        payment_date: body.payment_date ? new Date(body.payment_date) : new Date(),
        method: body.method || 'Other', reference: body.reference, notes: body.notes
      });
      await audit(user.email, 'create', 'Payment', p._id, { booking_id: String(b._id), amount: amt });
      return 'Payment recorded.';
    }

    case 'add_team': {
      if (!isSuperAdmin(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const t = await Team.create({
        name: body.name,
        team_leader_id: objIdOrNull(body.team_leader_id)
      });
      // If a Team Leader is assigned, update their role + team_id
      if (body.team_leader_id) {
        await User.findByIdAndUpdate(body.team_leader_id, { role: 'Team Leader', team_id: t._id });
      }
      await audit(user.email, 'create', 'Team', t._id, { name: body.name });
      return 'Team created.';
    }
    case 'update_team': {
      if (!isSuperAdmin(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const oldTeam = await Team.findById(body.team_id);
      const newLeaderId = objIdOrNull(body.team_leader_id);

      // Demote old leader to Sub Team Leader if changed
      if (oldTeam?.team_leader_id && String(oldTeam.team_leader_id) !== String(newLeaderId)) {
        await User.findByIdAndUpdate(oldTeam.team_leader_id, { role: 'Sub Team Leader' });
      }
      // Promote new leader
      if (newLeaderId) {
        await User.findByIdAndUpdate(newLeaderId, { role: 'Team Leader', team_id: body.team_id });
      }

      await Team.findByIdAndUpdate(body.team_id, { name: body.name, team_leader_id: newLeaderId });
      await audit(user.email, 'update', 'Team', body.team_id, { name: body.name });
      return 'Team updated.';
    }
    case 'assign_team_member': {
      if (!isSuperAdmin(user.role) && !isTeamLeader(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (isTeamLeader(user.role)) {
        // A Team Leader may only add unassigned agents to their own team, or
        // release their own members. They can't pull people from other teams.
        const target = await User.findById(objIdOrNull(body.user_id)).select('team_id role');
        if (!target || isAdminRole(target.role)) throw forbidden();
        const ownTeam = String(user.team_id || '');
        const newTeam = String(objIdOrNull(body.team_id) || '');
        const currentTeam = String(target.team_id || '');
        if (!ownTeam || (newTeam && newTeam !== ownTeam) || (currentTeam && currentTeam !== ownTeam)) {
          throw forbidden('You can only manage members of your own team');
        }
      }
      await User.findByIdAndUpdate(body.user_id, { team_id: objIdOrNull(body.team_id) });
      await audit(user.email, 'update', 'User', body.user_id, { team_assigned: body.team_id });
      return 'Team member assigned.';
    }

    case 'save_settings': {

    
      if (!isAdminRole(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const keys = ['company_name', 'currency', 'currency_symbol', 'tax_rate', 'booking_prefix', 'lead_prefix', 'default_commission'];
      for (const key of keys) {
        if (body[key] !== undefined) {
          await Setting.findOneAndUpdate({ key }, { key, value: body[key] }, { upsert: true });
        }
      }
      await audit(user.email, 'update', 'Settings', '', {});
      return 'Settings saved.';
    }
    default:
      throw Object.assign(new Error('Unknown action'), { status: 400 });
  }
}

module.exports = { handlePostAction };
