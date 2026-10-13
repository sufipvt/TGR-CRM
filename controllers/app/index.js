// /app page handler: runs POST actions / deletes, then loads data for the requested page
const { Types } = require('mongoose');
const { BAD_CONTACT_OUTCOMES } = require('../../config/constants');
const {
  User, Project, Unit, LeadSource, Lead, FollowUp, Booking, Payment, Team, AuditLog
} = require('../../models');
const { sendErrorPage } = require('../../utils/errorPage');
const { logError } = require('../../middleware/requestLog');
const { isSuperAdmin, isAdminRole, isTeamLeader, isManager } = require('../../utils/roles');
const { getSettings } = require('../../services/settings');
const {
  visibleLeadFilter, visibleFollowUpFilter, visibleBookingFilter
} = require('../../services/access');
const {
  reportRange, buildPerformanceReport, memberMatchFilter, resolveReportScope
} = require('../../services/reports');
const { countUnfixedFollowUps } = require('../../services/istFollowupFix');
const { loadLeadPage, keepListQs } = require('../../services/leadList');
const { handlePostAction } = require('./actions');
const { handleDelete } = require('./deletes');

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
        const msg = req.body.action === 'delete'
          ? (await handleDelete(req), 'Deleted successfully.')
          : await handlePostAction(req);
        return res.redirect('/app?page=' + encodeURIComponent(page) + keepListQs(req.query) + '&msg=' + encodeURIComponent(msg));
      } catch (e) {
        if (e.status) return res.redirect('/app?page=' + encodeURIComponent(page) + keepListQs(req.query) + '&msg=' + encodeURIComponent('Error: ' + e.message));
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
    // Team Leaders only pick assignees from their own team
    const teamScope = isTeamLeader(user.role) ? { team_id: user.team_id } : {};

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
      const { leads, list } = await loadLeadPage(Lead, leadFilter, req.query);
      data.leads = leads;
      data.lead_list = list;
      data.users = isTeamLeader(user.role)
        ? await User.find({ status: 'Active', team_id: user.team_id }).select('full_name role')
        : await User.find({ status: 'Active' }).select('full_name role');
    } else if (page === 'followups') {
      data.followups = await FollowUp.find(fuFilter).populate({ path: 'lead_id', select: 'name phone' }).populate('assigned_to_id').sort('scheduled_date');
      data.leads_for_fu = await Lead.find(leadFilter).select('name phone').sort('name');
      data.users = await User.find({ status: 'Active', ...teamScope }).select('full_name role');
    } else if (page === 'bookings') {
      data.bookings = await Booking.find(bookingFilter)
        .populate('lead_id project_id unit_id closer_id')
        .sort('-booking_date');
      data.payments = await Payment.find({ booking_id: { $in: data.bookings.map(b => b._id) } });
      data.closers = await User.find({ role: { $in: ['Team Leader', 'Sub Team Leader'] }, status: 'Active', ...teamScope }).select('full_name');
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
      data.unfixed_followups = isSuperAdmin(user.role) ? await countUnfixedFollowUps() : 0;
    } else if (page === 'reports') {
      const { from, to, fromStr, toStr } = reportRange(req.query);
      data.report_from = fromStr;
      data.report_to = toStr;

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
    logError(req, 'appHandler', e);
    sendErrorPage(res, 500, 'We hit an unexpected error loading this page. Please try again, and contact support if it continues.');
  }
}

module.exports = { appHandler };
