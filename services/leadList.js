// Leads page: search, filters and paging from the query string, done in the database
// so the page stays fast however many leads a firm has.
const { LEAD_STATUSES, LEAD_TEMPERATURES } = require('../config/constants');
const { objIdOrNull, escapeRegex } = require('../utils/request');

const LEADS_PER_PAGE = 50;

const str = v => (typeof v === 'string' ? v.trim() : '');

// Returns the extra conditions to AND with the caller's visibleLeadFilter,
// plus the cleaned values to show back in the filter bar.
function leadListQuery(query) {
  const q = str(query.q).slice(0, 100);
  const status = LEAD_STATUSES.includes(query.status) ? query.status : '';
  const temperature = LEAD_TEMPERATURES.includes(query.temperature) ? query.temperature : '';
  const source = objIdOrNull(str(query.source));
  const project = objIdOrNull(str(query.project));
  const page = Math.max(1, parseInt(str(query.p), 10) || 1);

  const conds = [];
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    conds.push({ $or: [{ name: re }, { phone: re }, { email: re }] });
  }
  if (status) conds.push({ status });
  if (temperature) conds.push({ temperature });
  if (source) conds.push({ source_id: source });
  if (project) conds.push({ project_id: project });

  return {
    conds,
    page,
    values: { q, status, temperature, source: source ? String(source) : '', project: project ? String(project) : '' }
  };
}

// Loads one page of leads the user may see, matching the filters.
async function loadLeadPage(Lead, visibleFilter, query) {
  const { conds, page, values } = leadListQuery(query);
  const where = conds.length ? { $and: [visibleFilter, ...conds] } : visibleFilter;
  const total = await Lead.countDocuments(where);
  const pages = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
  const current = Math.min(page, pages);
  const leads = await Lead.find(where)
    .populate('project_id source_id assigned_caller_id assigned_closer_id')
    .sort({ listed_at: -1, created_at: -1 })
    .skip((current - 1) * LEADS_PER_PAGE)
    .limit(LEADS_PER_PAGE);
  return { leads, list: { ...values, page: current, pages, total, per: LEADS_PER_PAGE } };
}

// '&q=..&status=..&p=..' for the current list, so an action or delete
// returns the user to the same filtered page instead of page 1.
function keepListQs(query) {
  const { values, page } = leadListQuery(query);
  const kept = Object.entries(values).filter(([, v]) => v);
  if (page > 1) kept.push(['p', String(page)]);
  return kept.map(([k, v]) => '&' + k + '=' + encodeURIComponent(v)).join('');
}

module.exports = { LEADS_PER_PAGE, leadListQuery, loadLeadPage, keepListQs };
