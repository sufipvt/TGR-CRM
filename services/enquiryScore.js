// The buying questions on the enquiry form, and how the answers become a
// Hot / Warm / Cold lead with a first call due soon enough to match.
// Pure functions: no database, so they're easy to test and reuse in the webhook.

const TIMELINES = ['Immediately', 'Within 3 months', '3 to 6 months', 'Just exploring'];
const BUDGETS = ['Under 50 lakh', '50 lakh to 1 crore', '1 to 2 crore', 'Above 2 crore'];
const PROPERTY_TYPES = ['1 BHK', '2 BHK', '3 BHK', '4 BHK or more', 'Villa / Plot', 'Commercial'];
const SITE_VISITS = ['This week', 'Next week', 'Not yet'];

const TIMELINE_POINTS = { 'Immediately': 4, 'Within 3 months': 2, '3 to 6 months': 1, 'Just exploring': 0 };
const VISIT_POINTS = { 'This week': 2, 'Next week': 1, 'Not yet': 0 };

const pick = (v, list) => (typeof v === 'string' && list.includes(v.trim()) ? v.trim() : '');
const utm = v => (typeof v === 'string' ? v.trim().replace(/[^\w .\-+]/g, '').slice(0, 60) : '');

// Only answers from the fixed lists are kept; anything else is dropped.
function readAnswers(input = {}) {
  return {
    timeline: pick(input.timeline, TIMELINES),
    budget: pick(input.budget, BUDGETS),
    property_type: pick(input.property_type, PROPERTY_TYPES),
    site_visit: pick(input.site_visit, SITE_VISITS),
    utm_source: utm(input.utm_source),
    utm_medium: utm(input.utm_medium),
    utm_campaign: utm(input.utm_campaign)
  };
}

// Buying now, or soon with a visit lined up = Hot. Some intent = Warm. Browsing = Cold.
// No timeline and no visit answer (most webhooks) = not scored.
function scoreAnswers(a) {
  if (!a.timeline && !a.site_visit) return null;
  const points = (TIMELINE_POINTS[a.timeline] || 0) + (VISIT_POINTS[a.site_visit] || 0);
  if (points >= 4) return 'Hot';
  if (points >= 2) return 'Warm';
  return 'Cold';
}

const RANK = { Cold: 1, Warm: 2, Hot: 3 };
function hotter(a, b) { return (RANK[a] || 0) >= (RANK[b] || 0) ? a : b; }

// When the first call is due: Hot within 15 minutes, Warm within 2 hours,
// unscored within the hour, Cold the next morning at 11.
function firstCallDue(temperature, now = new Date()) {
  const at = new Date(now);
  if (temperature === 'Hot') return new Date(at.getTime() + 15 * 60 * 1000);
  if (temperature === 'Warm') return new Date(at.getTime() + 2 * 60 * 60 * 1000);
  if (temperature === 'Cold') { at.setDate(at.getDate() + 1); at.setHours(11, 0, 0, 0); return at; }
  return new Date(at.getTime() + 60 * 60 * 1000);
}

const DUE_WORDS = { Hot: 'within 15 minutes', Warm: 'within 2 hours', Cold: 'tomorrow morning' };

// One readable line for the lead's notes.
function answersLine(a) {
  const parts = [];
  if (a.timeline) parts.push('Buying: ' + a.timeline);
  if (a.budget) parts.push('Budget: ' + a.budget);
  if (a.property_type) parts.push('Looking for: ' + a.property_type);
  if (a.site_visit) parts.push('Site visit: ' + a.site_visit);
  const ad = [a.utm_source, a.utm_medium, a.utm_campaign].filter(Boolean).join(' / ');
  if (ad) parts.push('Ad: ' + ad);
  return parts.join(' · ');
}

module.exports = {
  TIMELINES, BUDGETS, PROPERTY_TYPES, SITE_VISITS, DUE_WORDS,
  readAnswers, scoreAnswers, hotter, firstCallDue, answersLine
};
