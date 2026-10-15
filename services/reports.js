// Shared by the Reports page and the Reports PDF export.
const { Types } = require('mongoose');
const { User, Lead, FollowUp, Booking, Team } = require('../models');
const { isAdminRole, isTeamLeader } = require('../utils/roles');
const { getTeamMemberIds } = require('./access');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// ?from=YYYY-MM-DD&to=YYYY-MM-DD as whole days in the business timezone. Default: the last 30 days.
function reportRange(query) {
  const from = DAY_RE.test(query.from || '') ? new Date(query.from + 'T00:00:00') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = DAY_RE.test(query.to || '') ? new Date(query.to + 'T23:59:59.999') : new Date();
  return { from, to, fromStr: ymd(from), toStr: ymd(to) };
}

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

// Site visits scheduled in the range: how many happened, no-shows, how they went,
// and how many of the visited leads have since booked. Per agent and in total.
async function siteVisitReport(fuScopeFilter, from, to) {
  const rows = await FollowUp.aggregate([
    { $match: { ...fuScopeFilter, type: 'Site Visit', scheduled_date: { $gte: from, $lte: to } } },
    { $lookup: { from: 'leads', localField: 'lead_id', foreignField: '_id', as: 'lead' } },
    { $addFields: { lead_status: { $arrayElemAt: ['$lead.status', 0] } } },
    { $group: {
        _id: '$assigned_to_id',
        scheduled: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
        no_show: { $sum: { $cond: [{ $eq: ['$status', 'Missed'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
        interested: { $sum: { $cond: [{ $eq: ['$visit_outcome', 'Interested'] }, 1, 0] } },
        visited: { $addToSet: { $cond: [{ $eq: ['$status', 'Completed'] }, '$lead_id', null] } },
        booked: { $addToSet: { $cond: [{ $and: [{ $eq: ['$status', 'Completed'] }, { $eq: ['$lead_status', 'Booked'] }] }, '$lead_id', null] } },
        outcomes: { $push: '$visit_outcome' }
    }},
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $sort: { scheduled: -1 } }
  ]);

  const total = { scheduled: 0, done: 0, no_show: 0, pending: 0, interested: 0, visited: 0, booked: 0 };
  const outcomes = {};
  const agents = rows.map(r => {
    const row = {
      name: r.user[0] ? r.user[0].full_name : 'Unknown',
      scheduled: r.scheduled, done: r.done, no_show: r.no_show, pending: r.pending,
      interested: r.interested, visited: r.visited.filter(Boolean).length, booked: r.booked.filter(Boolean).length
    };
    for (const k of Object.keys(total)) total[k] += row[k];
    r.outcomes.filter(Boolean).forEach(o => { outcomes[o] = (outcomes[o] || 0) + 1; });
    return row;
  });
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  total.show_rate = pct(total.done, total.done + total.no_show);
  total.booking_rate = pct(total.booked, total.visited);
  return { total, agents, outcomes };
}

module.exports = { reportRange, buildPerformanceReport, memberMatchFilter, resolveReportScope, siteVisitReport };
