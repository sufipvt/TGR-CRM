// Shared by the Reports page and the Reports PDF export.
const { Types } = require('mongoose');
const { User, Lead, FollowUp, Booking, Team } = require('../models');
const { isAdminRole, isTeamLeader } = require('../utils/roles');
const { getTeamMemberIds } = require('./access');

// Replaces an N-users x 4-queries loop with 3 fixed queries total, regardless of team size.
async function buildPerformanceReport(perfUsers, bookingRangeFilter) {
  const userIds = perfUsers.map(u => u._id);

  const relevantLeads = await Lead.find({
    $or: [{ assigned_caller_id: { $in: userIds } }, { assigned_closer_id: { $in: userIds } }]
  }).select('assigned_caller_id assigned_closer_id qualified_at').lean();

  const bookingAgg = await Booking.aggregate([
    { $match: { ...bookingRangeFilter, closer_id: { $in: userIds } } },
    { $group: { _id: '$closer_id', count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } }
  ]);
  const bookingMap = {};
  bookingAgg.forEach(b => { bookingMap[String(b._id)] = b; });

  const fuAgg = await FollowUp.aggregate([
    { $match: { assigned_to_id: { $in: userIds } } },
    { $group: { _id: '$assigned_to_id', count: { $sum: 1 } } }
  ]);
  const fuMap = {};
  fuAgg.forEach(f => { fuMap[String(f._id)] = f.count; });

  return perfUsers.map(u => {
    const uid = String(u._id);
    let leads = 0, qualified = 0;
    relevantLeads.forEach(l => {
      const isCaller = String(l.assigned_caller_id || '') === uid;
      const isCloser = String(l.assigned_closer_id || '') === uid;
      if (isCaller || isCloser) {
        leads++;
        if (isCaller && l.qualified_at) qualified++;
      }
    });
    const b = bookingMap[uid];
    return {
      name: u.full_name, role: u.role, leads, qualified,
      bookings: b ? b.count : 0,
      revenue: b ? b.revenue : 0,
      followups: fuMap[uid] || 0
    };
  });
}

function memberMatchFilter(memberIds) {
  if (!memberIds) return {};
  return { $or: [{ assigned_caller_id: { $in: memberIds } }, { assigned_closer_id: { $in: memberIds } }] };
}

async function resolveReportScope(user, scopeParam) {
  if (isAdminRole(user.role)) {
    if (!scopeParam || scopeParam === 'company') return { label: 'Company-Wide', memberIds: null };
    if (scopeParam.startsWith('team:')) {
      const teamId = scopeParam.slice(5);
      const team = await Team.findById(teamId);
      const members = await User.find({ team_id: teamId }).select('_id');
      return { label: team ? team.name : 'Team', memberIds: members.map(m => m._id) };
    }
    if (scopeParam.startsWith('user:')) {
      const uid = scopeParam.slice(5);
      const u = await User.findById(uid).select('full_name');
      return { label: u ? u.full_name : 'User', memberIds: [new Types.ObjectId(uid)] };
    }
    return { label: 'Company-Wide', memberIds: null };
  }
  if (isTeamLeader(user.role)) {
    const teamMemberIds = await getTeamMemberIds(user);
    if (scopeParam && scopeParam.startsWith('user:')) {
      const uid = scopeParam.slice(5);
      if (teamMemberIds.map(String).includes(uid)) {
        const u = await User.findById(uid).select('full_name');
        return { label: u ? u.full_name : 'Member', memberIds: [new Types.ObjectId(uid)] };
      }
    }
    return { label: 'My Team', memberIds: teamMemberIds };
  }
  return { label: user.name, memberIds: [new Types.ObjectId(user.userId)] };
}

module.exports = { buildPerformanceReport, memberMatchFilter, resolveReportScope };
