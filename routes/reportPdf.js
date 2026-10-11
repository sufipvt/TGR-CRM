// Reports PDF export
const express = require('express');
const PDFDocument = require('pdfkit');
const { BAD_CONTACT_OUTCOMES } = require('../config/constants');
const { User, Lead, FollowUp, Booking } = require('../models');
const { formatMoneyPdf } = require('../utils/format');
const { getSettings } = require('../services/settings');
const { requireAuth, refreshUserContext } = require('../middleware/auth');
const { expensiveOpLimiter } = require('../middleware/rateLimits');
const {
  PDF_COLORS, STATUS_COLORS_PDF, pdfHeader, pdfSectionHeader, pdfKpiCards, pdfTable, pdfFooter
} = require('../services/pdf');
const {
  reportRange, buildPerformanceReport, memberMatchFilter, resolveReportScope
} = require('../services/reports');

const router = express.Router();

router.get('/app/report-pdf', requireAuth, expensiveOpLimiter, refreshUserContext, async (req, res) => {
  try {
    const user = req.user;
    const { from, to } = reportRange(req.query);
    const scopeParam = req.query.scope || '';
    const scope = await resolveReportScope(user, scopeParam);
    const memberFilter = memberMatchFilter(scope.memberIds);
    const rangeFilter = { created_at: { $gte: from, $lte: to }, ...memberFilter };
    const bookingRangeFilter = { booking_date: { $gte: from, $lte: to } };
    const bookingScopeFilter = scope.memberIds ? { closer_id: { $in: scope.memberIds } } : {};

    const totalLeads = await Lead.countDocuments(rangeFilter);
    const qualified = await Lead.countDocuments({ ...rangeFilter, qualified_at: { $ne: null } });
    const booked = await Lead.countDocuments({ ...rangeFilter, status: 'Booked' });
    const funnel = await Lead.aggregate([{ $match: rangeFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);

    const fuScopeFilter = scope.memberIds ? { assigned_to_id: { $in: scope.memberIds } } : {};
    const fuPending = await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Pending' });
    const fuOverdue = await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Pending', scheduled_date: { $lt: new Date() } });
    const fuCompleted = await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Completed', completed_date: { $gte: from, $lte: to } });
    const fuMissed = await FollowUp.countDocuments({ ...fuScopeFilter, status: 'Missed' });

    const sourcePerf = await Lead.aggregate([
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

    const lossAnalysis = await Lead.aggregate([
      { $match: { ...rangeFilter, status: { $in: ['Not Interested', 'Lost'] }, disposition_reason: { $ne: null } } },
      { $group: { _id: { status: '$status', reason: '$disposition_reason' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const perfUsers = scope.memberIds
      ? await User.find({ _id: { $in: scope.memberIds }, status: 'Active' }).select('full_name role')
      : await User.find({ status: 'Active' }).select('full_name role');
    const performance = await buildPerformanceReport(perfUsers, bookingRangeFilter);

    const bookingAgg = await Booking.aggregate([
      { $match: { ...bookingRangeFilter, ...bookingScopeFilter } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } }
    ]);
    const bookingSummary = {
      count: bookingAgg.length ? bookingAgg[0].count : 0,
      revenue: bookingAgg.length ? bookingAgg[0].revenue : 0
    };

   const settings = await getSettings();
    const companyName = settings.company_name;
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + (companyName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'CRM') + '-Report-' + Date.now() + '.pdf"');
    doc.pipe(res);

    pdfHeader(doc, companyName, scope.label, from, to);

    pdfSectionHeader(doc, 'Summary');
    pdfKpiCards(doc, [
      { label: 'Total Leads', value: totalLeads, color: PDF_COLORS.brand },
      { label: 'Qualified (' + (totalLeads ? Math.round(qualified/totalLeads*100) : 0) + '%)', value: qualified, color: '#0d9488' },
      { label: 'Booked (' + (totalLeads ? Math.round(booked/totalLeads*100) : 0) + '%)', value: booked, color: PDF_COLORS.green },
      { label: 'Revenue', value: formatMoneyPdf(bookingSummary.revenue), color: '#d97706' }
    ]);

    pdfSectionHeader(doc, 'Lead Funnel');
    pdfTable(doc, ['Status', 'Count'], funnel.map(f => [f._id, f.count]), [340, 140],
      { badgeColumn: 0, badgeColors: STATUS_COLORS_PDF });

    pdfSectionHeader(doc, 'Source Performance');
    pdfTable(doc,
      ['Source', 'Leads', 'Qualified', 'Booked', 'Bad Contact %'],
      sourcePerf.map(s => [
        s.source[0]?.name || 'Unknown', s.total, s.qualified, s.booked,
        (s.total ? Math.round(s.badContact / s.total * 100) : 0) + '%'
      ]),
      [170, 75, 75, 75, 90],
      { colorRules: [{ col: 4, test: cell => parseInt(cell) >= 30, color: PDF_COLORS.red }] }
    );

    pdfSectionHeader(doc, 'Loss / Not Interested Reasons');
    if (!lossAnalysis.length) {
      doc.fontSize(9).fillColor(PDF_COLORS.gray).text('No losses recorded in this period.');
      doc.moveDown(1);
    } else {
      pdfTable(doc, ['Status', 'Reason', 'Count'],
        lossAnalysis.map(l => [l._id.status, l._id.reason, l.count]),
        [110, 280, 90],
        { badgeColumn: 0, badgeColors: STATUS_COLORS_PDF });
    }

    pdfSectionHeader(doc, 'Follow-Up Compliance');
    pdfKpiCards(doc, [
      { label: 'Pending', value: fuPending, color: PDF_COLORS.brand },
      { label: 'Overdue', value: fuOverdue, color: PDF_COLORS.red },
      { label: 'Completed', value: fuCompleted, color: PDF_COLORS.green },
      { label: 'Missed', value: fuMissed, color: '#6b7280' }
    ]);

    pdfSectionHeader(doc, 'Team Performance');
    pdfTable(doc,
      ['Name', 'Role', 'Leads', 'Qualified', 'Bookings', 'Revenue'],
      performance.map(p => [p.name, p.role, p.leads, p.qualified, p.bookings, formatMoneyPdf(p.revenue)]),
      [110, 95, 55, 65, 65, 105]
    );

    pdfSectionHeader(doc, 'Booking & Revenue');
    pdfKpiCards(doc, [
      { label: 'Bookings', value: bookingSummary.count, color: PDF_COLORS.brand },
      { label: 'Total Revenue', value: formatMoneyPdf(bookingSummary.revenue), color: PDF_COLORS.green },
      { label: 'Avg Deal Size', value: formatMoneyPdf(bookingSummary.count ? Math.round(bookingSummary.revenue / bookingSummary.count) : 0), color: '#d97706' }
    ]);

    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      pdfFooter(doc, i + 1, pageRange.count, companyName);
    }

    doc.end();
  } catch (e) {
    console.error('PDF report error:', e);
    res.status(500).send('Failed to generate report PDF.');
  }
});

module.exports = router;
