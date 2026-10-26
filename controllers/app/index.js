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
  reportRange, buildPerformanceReport, memberMatchFilter, resolveReportScope, siteVisitReport
} = require('../../services/reports');
const { countUnfixedFollowUps } = require('../../services/istFollowupFix');
const { loadLeadPage, keepListQs } = require('../../services/leadList');
const { unitCountsByProject, unitCountsFor } = require('../../services/inventory');
const { captureSettings } = require('../../services/capture');
const { listTiles } = require('../../services/integrations');
const { stackingFor } = require('../../services/stacking');
const { objIdOrNull } = require('../../utils/request');
const { notificationSummary } = require('../../services/notify');
const { loadToday } = require('../../services/dashboard');
const { handlePostAction } = require('./actions');
const { handleDelete } = require('./deletes');
const { handleIntegrationAction } = require('./integrations');
const { handleInventoryAction } = require('./inventory');

// The stacking view comes back to the tower you were looking at.
const towerQs = (page, query) => (page === 'inventory' && typeof query.tower === 'string'
  ? '&tower=' + encodeURIComponent(query.tower.slice(0, 30)) : '');

const ADMIN_PAGES = ['settings', 'integrations', 'audit'];
const SUPERADMIN_PAGES = ['users', 'teams'];
const MANAGER_PAGES = ['sources', 'inventory'];

// A form with a missing required field or a malformed id is the user's mistake, not
// a crash: show it as a message on the page instead of the "Something went wrong" screen.
const FOLLOWUP_HISTORY_DAYS = 30;
const FOLLOWUP_PAGE_LIMIT = 1000;
const LEAD_PICKER_LIMIT = 1000;

function formError(e) {
  if (e.status) return;
  if (e.name === 'ValidationError') {
    const fields = Object.keys(e.errors || {}).map(k => k.replace(/_id$/, '').replace(/_/g, ' '));
    Object.assign(e, { status: 400, message: 'Please fill in: ' + (fields.join(', ') || 'the required fields') + '.' });
  } else if (e.name === 'CastError') {
    Object.assign(e, { status: 400, message: 'That record was not found, or a value is in the wrong format.' });
  }
}

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
          : (await handleIntegrationAction(req)) ?? (await handleInventoryAction(req)) ?? await handlePostAction(req);
        return res.redirect('/app?page=' + encodeURIComponent(page) + keepListQs(req.query) + towerQs(page, req.query) + '&msg=' + encodeURIComponent(msg));
      } catch (e) {
        formError(e);
        if (e.status) return res.redirect('/app?page=' + encodeURIComponent(page) + keepListQs(req.query) + towerQs(page, req.query) + '&msg=' + encodeURIComponent('Error: ' + e.message));
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
    data.notif = await notificationSummary(userId);
    data.projects = await Project.find().sort('name');
    data.sources = await LeadSource.find().sort('name');

  if (page === 'dashboard') {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const bookingMatch = isAdminRole(user.role) ? [] : [{ $match: bookingFilter }];
      // All independent, so they run together instead of one after another.
      const [totalLeads, totalBookings, totalProjects, pending, overdue, rev, newToday, today, recent, trend, byStatus, closerPerf] = await Promise.all([
        Lead.countDocuments(leadFilter),
        Booking.countDocuments(bookingFilter),
        Project.countDocuments(),
        FollowUp.countDocuments({ ...fuFilter, status: 'Pending' }),
        FollowUp.countDocuments({ ...fuFilter, status: 'Pending', scheduled_date: { $lt: new Date() } }),
        Booking.aggregate([...bookingMatch, { $group: { _id: null, total: { $sum: '$sale_value' } } }]),
        Lead.countDocuments({ ...leadFilter, created_at: { $gte: startOfToday } }),
        loadToday({ leadFilter, fuFilter }),
        Lead.find(leadFilter).sort({ listed_at: -1, created_at: -1 }).limit(8)
          .populate('project_id source_id').populate({ path: 'assigned_caller_id', select: 'full_name' }),
        Booking.aggregate([
          ...bookingMatch,
          { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$booking_date' } }, revenue: { $sum: '$sale_value' } } },
          { $sort: { _id: 1 } }, { $limit: 12 }
        ]),
        Lead.aggregate([
          ...(Object.keys(leadFilter).length ? [{ $match: leadFilter }] : []),
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        isManager(user.role) ? Booking.aggregate([
          ...bookingMatch,
          { $group: { _id: '$closer_id', count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', pipeline: [{ $project: { full_name: 1 } }], as: 'closer' } },
          { $sort: { revenue: -1 } }
        ]) : []
      ]);
      Object.assign(data, {
        total_leads: totalLeads, total_bookings: totalBookings, total_projects: totalProjects,
        pending_followups: pending, overdue_followups: overdue, total_revenue: rev.length ? rev[0].total : 0,
        new_today: newToday, today, recent_leads: recent, booking_trend: trend, by_status: byStatus, closer_perf: closerPerf
      });
    } else if (page === 'leads') {
      const { leads, list } = await loadLeadPage(Lead, leadFilter, req.query);
      data.leads = leads;
      data.lead_list = list;
      data.users = isTeamLeader(user.role)
        ? await User.find({ status: 'Active', team_id: user.team_id }).select('full_name role')
        : await User.find({ status: 'Active' }).select('full_name role');
    } else if (page === 'followups') {
      // Every pending follow-up, but only the last 30 days of finished ones: the page
      // used to load every follow-up ever made, which grows without end.
      const since = new Date(); since.setDate(since.getDate() - FOLLOWUP_HISTORY_DAYS);
      data.followups = await FollowUp.find({ $and: [fuFilter, { $or: [{ status: 'Pending' }, { scheduled_date: { $gte: since } }, { completed_date: { $gte: since } }] }] })
        .populate({ path: 'lead_id', select: 'name phone' }).populate({ path: 'assigned_to_id', select: 'full_name' })
        .sort('scheduled_date').limit(FOLLOWUP_PAGE_LIMIT).lean();
      data.followup_history_days = FOLLOWUP_HISTORY_DAYS;
      // The lead picker lists the most recently active leads, not every lead ever.
      data.leads_for_fu = (await Lead.find(leadFilter).select('name phone').sort({ listed_at: -1, created_at: -1 }).limit(LEAD_PICKER_LIMIT).lean())
        .sort((a, b) => a.name.localeCompare(b.name));
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
      const counts = await unitCountsByProject();
      data.projects_detail = data.projects.map(p => ({ ...p.toObject(), ...unitCountsFor(p, counts) }));
      data.units = await Unit.find().sort('unit_number');
      data.teams = await Team.find().sort('name').select('name').lean();
    } else if (page === 'inventory') {
      const wanted = objIdOrNull(req.query.project);
      data.inv_project = data.projects.find(p => wanted && String(p._id) === String(wanted)) || data.projects[0] || null;
      data.stacking = data.inv_project
        ? await stackingFor(data.inv_project._id, typeof req.query.tower === 'string' ? req.query.tower : undefined)
        : null;
    } else if (page === 'sources') {
      data.teams = await Team.find().sort('name').select('name').lean();
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
    } else if (page === 'integrations') {
      data.capture = await captureSettings();
      data.tiles = await listTiles();
      data.base_url = (process.env.APP_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
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

      data.site_visit_report = await siteVisitReport(fuScopeFilter, from, to);

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
