// /app deletes (?delete=1&table=...&id=...)
const {
  User, Project, Unit, LeadSource, Lead, FollowUp, Booking, Payment, Team
} = require('../../models');
const { isSuperAdmin, isManager } = require('../../utils/roles');
const { isValidObjectId } = require('mongoose');
const { audit } = require('../../services/audit');
const { userContextCache } = require('../../middleware/auth');

async function handleDelete(req) {
  const { table, id } = req.query;
  // Every delete is by a single document id; anything else is refused before any write.
  if (typeof id !== 'string' || !isValidObjectId(id)) throw Object.assign(new Error('Invalid id'), { status: 400 });
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

module.exports = { handleDelete };
