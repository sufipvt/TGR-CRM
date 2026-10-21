// Leads export: a CSV of the leads matching the Leads page filters, for admins.
// Streams from the database, so a firm with many thousands of leads doesn't load
// them all into memory.
const express = require('express');
const { Lead } = require('../models');
const { audit } = require('../services/audit');
const { leadListQuery } = require('../services/leadList');
const { visibleLeadFilter } = require('../services/access');
const { requireAuth, requireAdmin, refreshUserContext } = require('../middleware/auth');
const { expensiveOpLimiter } = require('../middleware/rateLimits');
const { logError } = require('../middleware/requestLog');

const router = express.Router();

const COLUMNS = [
  ['Name', l => l.name],
  ['Phone', l => l.phone],
  ['Email', l => l.email],
  ['City', l => l.city],
  ['Source', l => l.source_id && l.source_id.name],
  ['Project', l => l.project_id && l.project_id.name],
  ['Budget', l => l.budget_range],
  ['Status', l => l.status],
  ['Temperature', l => l.temperature],
  ['Last call outcome', l => l.contact_outcome],
  ['Reason', l => l.disposition_reason],
  ['Caller', l => l.assigned_caller_id && l.assigned_caller_id.full_name],
  ['Closer', l => l.assigned_closer_id && l.assigned_closer_id.full_name],
  ['Created', l => day(l.created_at)],
  ['Last enquiry', l => day(l.last_enquiry_at)],
  ['Enquiries', l => l.enquiry_count || ''],
  ['Ad source', l => l.enquiry && l.enquiry.utm_source],
  ['Ad campaign', l => l.enquiry && l.enquiry.utm_campaign],
  ['Notes', l => l.notes]
];

// Business-time date as YYYY-MM-DD, which spreadsheets sort and filter correctly.
const day = d => (d ? new Date(d).toLocaleDateString('en-CA') : '');

// One CSV cell. A value a spreadsheet would run as a formula (=, +, -, @ at the start)
// gets a leading apostrophe, so a lead named "=HYPERLINK(...)" stays plain text.
// Phone numbers like +91 98765 43210 are left alone.
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const row = values => values.map(cell).join(',') + '\r\n';

router.get('/app/export-leads', requireAuth, expensiveOpLimiter, refreshUserContext, requireAdmin, async (req, res) => {
  try {
    const { conds } = leadListQuery(req.query);
    const visible = await visibleLeadFilter(req.user);
    const where = conds.length ? { $and: [visible, ...conds] } : visible;
    const filename = 'leads-' + new Date().toLocaleDateString('en-CA') + '.csv';
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    res.write('﻿' + row(COLUMNS.map(c => c[0]))); // byte-order mark so Excel reads ₹ and names correctly
    let count = 0;
    const cursor = Lead.find(where)
      .sort({ listed_at: -1, created_at: -1 })
      .populate({ path: 'source_id', select: 'name' })
      .populate({ path: 'project_id', select: 'name' })
      .populate({ path: 'assigned_caller_id', select: 'full_name' })
      .populate({ path: 'assigned_closer_id', select: 'full_name' })
      .lean()
      .cursor({ batchSize: 500 });
    for await (const lead of cursor) {
      if (!res.write(row(COLUMNS.map(c => c[1](lead))))) await new Promise(r => res.once('drain', r));
      count++;
    }
    await audit(req.user.email, 'export', 'Lead', '', { count, filters: Object.fromEntries(Object.entries(req.query).filter(([k]) => ['q', 'status', 'temperature', 'source', 'project'].includes(k))) });
    res.end();
  } catch (e) {
    logError(req, 'export leads', e);
    if (!res.headersSent) return res.redirect('/app?page=leads&msg=' + encodeURIComponent('Error: The export failed. Please try again.'));
    res.destroy(e);
  }
});

module.exports = router;
