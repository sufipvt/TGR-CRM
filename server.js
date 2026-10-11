// TrueGrowth CRM — server.js
// Node.js + Express + MongoDB (Mongoose) + EJS + SendGrid + node-cron
//-------------------------------------------------------------------------
//require('dotenv').config();
//require('dotenv').config({ path: '.env.development.local' });
//-------------------------------------------------------------------------
const { PORT } = require('./config/env');

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const helmet = require('helmet');
const path = require('path');
const compression = require('compression');

// If something truly unexpected slips through every try/catch, log it clearly and
// exit deliberately rather than keep running in a possibly-corrupted state.
// Render's platform automatically restarts the service within seconds.
process.on('uncaughtException', (err) => {
  console.error('FATAL \u2014 Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('FATAL \u2014 Unhandled Promise Rejection:', reason);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// MODELS
// ---------------------------------------------------------------------------
const { Types } = mongoose;
const {
  LEAD_STATUSES, LEAD_TEMPERATURES, CONTACT_OUTCOMES, BAD_CONTACT_OUTCOMES,
  NOT_INTERESTED_REASONS, LOST_REASONS
} = require('./config/constants');
const {
  User, Project, Unit, LeadSource, Lead, FollowUp,
  Booking, Payment, Team, AuditLog, Setting
} = require('./models');
const { formatMoney, formatDate, formatDateTime } = require('./utils/format');
const { sendErrorPage } = require('./utils/errorPage');
const { cleanBody, objIdOrNull } = require('./utils/request');
const { isSuperAdmin, isAdminRole, isTeamLeader, isManager } = require('./utils/roles');
const { audit } = require('./services/audit');
const { getSettings } = require('./services/settings');
const { getNextCaller } = require('./services/assignment');
const {
  getTeamMemberIds, visibleLeadFilter, visibleFollowUpFilter, visibleBookingFilter, canEditLead
} = require('./services/access');
const {
  requireAuth, requireSuperAdmin, refreshUserContext, userContextCache
} = require('./middleware/auth');
const { appActionLimiter } = require('./middleware/rateLimits');


const { sendDailyDigest } = require('./services/digest');
const { buildPerformanceReport, memberMatchFilter, resolveReportScope } = require('./services/reports');

// ---------------------------------------------------------------------------
// APP SETUP
// ---------------------------------------------------------------------------
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

app.locals.formatMoney = formatMoney;
app.locals.formatDate = formatDate;
app.locals.formatDateTime = formatDateTime;

// ---------------------------------------------------------------------------
// ROUTES: public, API, receipt, CSV import (see routes/)
// ---------------------------------------------------------------------------
app.use(require('./routes/auth'));
app.use(require('./routes/api'));
app.use(require('./routes/receipt'));
app.use(require('./routes/import'));

// ---------------------------------------------------------------------------
// APP HANDLER (GET + POST)
// ---------------------------------------------------------------------------
async function handlePostAction(req) {
  const body = cleanBody(req.body);
  const action = body.action;
  const user = req.user;
  const manager = isManager(user.role);

  switch (action) {
    case 'add_lead': {
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
      if (!manager && String(f.assigned_to_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = { scheduled_date: new Date(body.scheduled_date), type: body.type, notes: body.notes, status: body.status || f.status, outcome: body.outcome };
      if (manager && body.assigned_to_id) update.assigned_to_id = objIdOrNull(body.assigned_to_id);
      await FollowUp.findByIdAndUpdate(body.followup_id, update);
      await audit(user.email, 'update', 'FollowUp', body.followup_id, {});
      return 'Follow-up updated.';
    }
    case 'complete_followup': {
      const f = await FollowUp.findById(body.followup_id);
      if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
      if (!manager && String(f.assigned_to_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
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
      if (!manager && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
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
      if (!manager && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
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
      await User.findByIdAndUpdate(body.user_id, { team_id: objIdOrNull(body.team_id) });
      await audit(user.email, 'update', 'User', body.user_id, { team_assigned: body.team_id });
      return 'Team member assigned.';
    }

    case 'save_settings': {

    
      if (user.role !== 'Admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
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

async function handleDelete(req) {
  const { table, id } = req.query;
  const user = req.user;
  const manager = isManager(user.role);

  switch (table) {
    case 'leads': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await FollowUp.deleteMany({ lead_id: id });
      await Lead.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Lead', id, {});
      break;
    }
    case 'projects': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const leadCount = await Lead.countDocuments({ project_id: id });
      const unitCount = await Unit.countDocuments({ project_id: id });
      if (leadCount > 0 || unitCount > 0) throw Object.assign(new Error('Cannot delete: project has leads or units'), { status: 400 });
      await Project.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Project', id, {});
      break;
    }
    case 'units': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Unit.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Unit', id, {});
      break;
    }
    case 'sources': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const leadCount = await Lead.countDocuments({ source_id: id });
      if (leadCount > 0) throw Object.assign(new Error('Cannot delete: source has leads'), { status: 400 });
      await LeadSource.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'LeadSource', id, {});
      break;
    }
    case 'users': {
      if (!isSuperAdmin(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (String(id) === String(user.userId)) throw Object.assign(new Error('Cannot delete yourself'), { status: 400 });
      await User.findByIdAndDelete(id);
      userContextCache.delete(String(id));
      await audit(user.email, 'delete', 'User', id, {});
      break;
    }
    case 'teams': {
      if (!isSuperAdmin(user.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const memberCount = await User.countDocuments({ team_id: id });
      if (memberCount > 0) throw Object.assign(new Error('Cannot delete: team has members. Reassign them first.'), { status: 400 });
      await Team.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Team', id, {});
      break;
    }
    case 'followups': {
      const f = await FollowUp.findById(id);
      if (!f) break;
      if (!manager && String(f.assigned_to_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await FollowUp.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'FollowUp', id, {});
      break;
    }
    case 'bookings': {
      const b = await Booking.findById(id);
      if (!b) break;
      if (!manager && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Payment.deleteMany({ booking_id: id });
      await Unit.findByIdAndUpdate(b.unit_id, { status: 'Available' });
      //await Lead.findByIdAndUpdate(b.lead_id, { status: 'Negotiation', booked_at: null });
      const lead = await Lead.findById(b.lead_id).select('assigned_closer_id');
      const restoreStatus = lead?.assigned_closer_id ? 'Negotiation' : 'Qualified';
      await Lead.findByIdAndUpdate(b.lead_id, { status: restoreStatus, booked_at: null });
      //------------------------------------------------------------------------------
      await Booking.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Booking', id, {});
      break;
    }
    case 'payments': {
      const p = await Payment.findById(id);
      if (!p) break;
      const b = await Booking.findById(p.booking_id);
      if (!manager && b && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Payment.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Payment', id, {});
      break;
    }
    default:
      throw Object.assign(new Error('Unknown table'), { status: 400 });
  }
}

const ADMIN_PAGES = ['settings', 'audit'];
const SUPERADMIN_PAGES = ['users', 'teams'];
const MANAGER_PAGES = ['sources'];

async function appHandler(req, res) {
  try {
    const user = req.user;
    let page = String(req.query.page || 'dashboard');
    let success_msg = req.query.msg || null;

    // POST actions
    if (req.method === 'POST' && req.body && req.body.action) {
      try {
        const msg = await handlePostAction(req);
        return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent(msg));
      } catch (e) {
        if (e.status) return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent('Error: ' + e.message));
        throw e;
      }
    }

    // DELETE via GET query
    if (req.query.delete && req.query.table && req.query.id) {
      try {
        await handleDelete(req);
        return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent('Deleted successfully.'));
      } catch (e) {
        if (e.status) return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent('Error: ' + e.message));
        throw e;
      }
    }

    // Page-level RBAC
    if (SUPERADMIN_PAGES.includes(page) && !isSuperAdmin(user.role)) page = 'dashboard';
    if (ADMIN_PAGES.includes(page) && !isAdminRole(user.role)) page = 'dashboard';
    if (MANAGER_PAGES.includes(page) && !isManager(user.role)) page = 'dashboard';

    const leadFilter = await visibleLeadFilter(user);
    const fuFilter = await visibleFollowUpFilter(user);
    const bookingFilter = await visibleBookingFilter(user);
    const userId = new Types.ObjectId(user.userId);

    const data = {};
    data.projects = await Project.find().sort('name');
    data.sources = await LeadSource.find().sort('name');

  if (page === 'dashboard') {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      data.total_leads = await Lead.countDocuments(leadFilter);
      data.total_bookings = await Booking.countDocuments(bookingFilter);
      data.total_projects = await Project.countDocuments();
      data.pending_followups = await FollowUp.countDocuments({ ...fuFilter, status: 'Pending' });
      data.overdue_followups = await FollowUp.countDocuments({ ...fuFilter, status: 'Pending', scheduled_date: { $lt: new Date() } });
      const rev = await Booking.aggregate([
        ...(isAdminRole(user.role) ? [] : [{ $match: bookingFilter }]),
        { $group: { _id: null, total: { $sum: '$sale_value' } } }
      ]);
      data.total_revenue = rev.length ? rev[0].total : 0;
      data.new_today = await Lead.countDocuments({ ...leadFilter, created_at: { $gte: startOfToday } });
      data.recent_leads = await Lead.find(leadFilter).sort('-created_at').limit(8).populate('project_id source_id assigned_caller_id');
      data.booking_trend = await Booking.aggregate([
        ...(isAdminRole(user.role) ? [] : [{ $match: bookingFilter }]),
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$booking_date' } }, revenue: { $sum: '$sale_value' } } },
        { $sort: { _id: 1 } }, { $limit: 12 }
      ]);
      data.by_status = await Lead.aggregate([
        ...(Object.keys(leadFilter).length ? [{ $match: leadFilter }] : []),
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      data.closer_perf = isManager(user.role) ? await Booking.aggregate([
        ...(isAdminRole(user.role) ? [] : [{ $match: bookingFilter }]),
        { $group: { _id: '$closer_id', count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'closer' } },
        { $sort: { revenue: -1 } }
      ]) : [];
    } else if (page === 'leads') {
      data.leads = await Lead.find(leadFilter)
        .populate('project_id source_id assigned_caller_id assigned_closer_id')
        .sort('-created_at');
      data.users = isTeamLeader(user.role)
        ? await User.find({ status: 'Active', team_id: user.team_id }).select('full_name role')
        : await User.find({ status: 'Active' }).select('full_name role');
    } else if (page === 'followups') {
      data.followups = await FollowUp.find(fuFilter).populate({ path: 'lead_id', select: 'name phone' }).populate('assigned_to_id').sort('scheduled_date');
      data.leads_for_fu = await Lead.find(leadFilter).select('name phone').sort('name');
      data.users = await User.find({ status: 'Active' }).select('full_name role');
    } else if (page === 'bookings') {
      data.bookings = await Booking.find(bookingFilter)
        .populate('lead_id project_id unit_id closer_id')
        .sort('-booking_date');
      data.payments = await Payment.find({ booking_id: { $in: data.bookings.map(b => b._id) } });
      data.closers = await User.find({ role: { $in: ['Team Leader', 'Sub Team Leader'] }, status: 'Active' }).select('full_name');
      data.qualified_leads = await Lead.find({ ...leadFilter, status: { $in: ['Qualified', 'Site Visit Scheduled', 'Negotiation'] } }).select('name phone project_id');
    } else if (page === 'projects') {
      if (!isManager(user.role)) return res.redirect('/app?page=dashboard');
      data.projects_detail = data.projects;
      data.units = await Unit.find().sort('unit_number');
    } else if (page === 'users') {
      data.users = await User.find().sort('full_name').select('-password').populate('team_id');
      data.teams = await Team.find().sort('name');
    } else if (page === 'teams') {
      data.teams = await Team.find().populate('team_leader_id').sort('name');
      const allUsers = await User.find({ status: 'Active' }).select('full_name role team_id');
      data.teams_detail = await Promise.all(data.teams.map(async t => ({
        ...t.toObject(),
        members: allUsers.filter(u => String(u.team_id || '') === String(t._id))
      })));
      data.unassigned_users = allUsers.filter(u => !u.team_id && u.role !== 'Super Admin' && u.role !== 'Admin');
      data.all_agents = allUsers.filter(u => ['Team Leader', 'Sub Team Leader'].includes(u.role));
    } else if (page === 'settings') {
      data.settings = await getSettings();
    } else if (page === 'reports') {
      const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const to = req.query.to ? new Date(req.query.to + 'T23:59:59') : new Date();
      data.report_from = from.toISOString().slice(0, 10);
      data.report_to = to.toISOString().slice(0, 10);

      const scopeParam = req.query.scope || '';
      const scope = await resolveReportScope(user, scopeParam);
      data.report_scope_label = scope.label;
      data.report_scope_value = scopeParam || (isAdminRole(user.role) ? 'company' : (isTeamLeader(user.role) ? 'team' : 'self'));

      if (isAdminRole(user.role)) {
        data.report_teams = await Team.find().sort('name').lean();
        const allActiveUsers = await User.find({ status: 'Active' }).select('full_name role team_id').lean();
        data.report_teams.forEach(t => {
          t.members = allActiveUsers.filter(u => String(u.team_id || '') === String(t._id));
        });
      } else if (isTeamLeader(user.role)) {
        data.report_team_members = await User.find({ status: 'Active', team_id: user.team_id }).select('full_name role').lean();
      }

      const memberFilter = memberMatchFilter(scope.memberIds);
      const rangeFilter = { created_at: { $gte: from, $lte: to }, ...memberFilter };
      const bookingRangeFilter = { booking_date: { $gte: from, $lte: to } };
      const bookingScopeFilter = scope.memberIds ? { closer_id: { $in: scope.memberIds } } : {};

      const totalLeads = await Lead.countDocuments(rangeFilter);
      const qualified = await Lead.countDocuments({ ...rangeFilter, qualified_at: { $ne: null } });
      const booked = await Lead.countDocuments({ ...rangeFilter, status: 'Booked' });
      const funnel = await Lead.aggregate([{ $match: rangeFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
      data.conversion_report = {
        total: totalLeads, qualified, booked,
        qual_rate: totalLeads ? Math.round(qualified / totalLeads * 100) : 0,
        book_rate: totalLeads ? Math.round(booked / totalLeads * 100) : 0,
        funnel
      };

      const fuScopeFilter = scope.memberIds ? { assigned_to_id: { $in: scope.memberIds } } : {};
      data.followup_report = {
        pending: await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Pending' }),
        overdue: await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Pending', scheduled_date: { $lt: new Date() } }),
        completed: await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Completed', completed_date: { $gte: from, $lte: to } }),
        missed: await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Missed' })
      };

      data.source_performance = await Lead.aggregate([
        { $match: rangeFilter },
        { $group: {
            _id: '$source_id', total: { $sum: 1 },
            qualified: { $sum: { $cond: [{ $ne: ['$qualified_at', null] }, 1, 0] } },
            booked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
            badContact: { $sum: { $cond: [{ $in: ['$contact_outcome', BAD_CONTACT_OUTCOMES] }, 1, 0] } }
        }},
        { $lookup: { from: 'leadsources', localField: '_id', foreignField: '_id', as: 'source' } },
        { $sort: { total: -1 } }
      ]);

      data.loss_analysis = await Lead.aggregate([
        { $match: { ...rangeFilter, status: { $in: ['Not Interested', 'Lost'] }, disposition_reason: { $ne: null } } },
        { $group: { _id: { status: '$status', reason: '$disposition_reason' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);

      const perfUsers = scope.memberIds
        ? await User.find({ _id: { $in: scope.memberIds }, status: 'Active' }).select('full_name role')
        : await User.find({ status: 'Active' }).select('full_name role');
      data.performance_report = await buildPerformanceReport(perfUsers, bookingRangeFilter);

      const bookingAgg = await Booking.aggregate([
        { $match: { ...bookingRangeFilter, ...bookingScopeFilter } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } }
      ]);
      data.booking_summary = {
        count: bookingAgg.length ? bookingAgg[0].count : 0,
        revenue: bookingAgg.length ? bookingAgg[0].revenue : 0,
        avg: bookingAgg.length && bookingAgg[0].count ? Math.round(bookingAgg[0].revenue / bookingAgg[0].count) : 0
      };
    } else if (page === 'audit') {
      data.audit_logs = await AuditLog.find().sort('-created_at').limit(150);
    }

    res.render('app', { page, user, data, success_msg });
  } catch (e) {
    console.error('appHandler error:', e);
    sendErrorPage(res, 500, 'We hit an unexpected error loading this page. Please try again, and contact support if it continues.');
  }
}

app.get('/app', requireAuth, appActionLimiter, refreshUserContext, appHandler);
app.post('/app', requireAuth, appActionLimiter, refreshUserContext, appHandler);

app.use(require('./routes/reportPdf'));
app.use(require('./routes/chat'));

// 404 catch-all
app.use((req, res) => {
  console.log('404:', req.method, req.url);
  sendErrorPage(res, 404, 'The page you\u2019re looking for doesn\u2019t exist.');
});

// Global error handler \u2014 catches anything that slips past every route's own try/catch
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) return next(err);
  sendErrorPage(res, 500, 'Something went wrong on our end. Please try again.');
});

// ---------------------------------------------------------------------------
// SEED + START
// ---------------------------------------------------------------------------
async function initAdmin() {
  try {
    const exists = await User.findOne({ $or: [{ role: 'Admin' }, { email: 'admin@truegrowth.com' }] });
    if (exists) return;
    const hashed = await bcrypt.hash('Admin@123', 12);
    await User.create({
      full_name: 'Administrator',
      email: 'admin@truegrowth.com',
      password: hashed,
      role: 'Admin',
      status: 'Active'
    });
    console.log('Admin user seeded: admin@truegrowth.com / Admin@123');
  } catch (e) {
    if (e.code === 11000) return; // already seeded by a concurrent restart
    throw e;
  }
}

module.exports = app;

// Only connect, schedule and listen when run directly (`node server.js`).
// When required (e.g. by tests), the app is exported without side effects.
if (require.main === module) {
  cron.schedule('30 2 * * *', sendDailyDigest, { timezone: 'Asia/Kolkata' }); // 02:30 UTC = 08:00 IST

  mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
      console.log('MongoDB connected');
      await initAdmin();
      app.listen(PORT, () => console.log('TrueGrowth CRM running on port ' + PORT));
    })
    .catch(err => {
      console.error('MongoDB connection failed:', err.message);
      process.exit(1);
    });
}
