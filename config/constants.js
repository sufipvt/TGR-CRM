// Shared enum lists used by the Mongoose schemas, route handlers and reports.

const USER_ROLES = ['Super Admin', 'Admin', 'Team Leader', 'Sub Team Leader'];

const LEAD_STATUSES = ['New', 'Working', 'Qualified', 'Site Visit Scheduled', 'Negotiation', 'Booked', 'Lost', 'Not Interested'];
const LEAD_TEMPERATURES = ['Hot', 'Warm', 'Cold'];

// Result of the LAST call attempt — independent of pipeline status
const CONTACT_OUTCOMES = [
  'Interested', 'Not Interested', 'Requested Callback',
  'Not Reachable', 'Switched Off', 'Call Rejected', 'Invalid Number'
];
const BAD_CONTACT_OUTCOMES = ['Not Reachable', 'Switched Off', 'Call Rejected', 'Invalid Number'];

// WHY a lead rejected the property — only relevant once status is Not Interested or Lost
const NOT_INTERESTED_REASONS = [
  'Budget Mismatch', 'Location Mismatch', 'Timeline Mismatch (not buying soon)',
  'Property Type Mismatch', 'Already Purchased Elsewhere', 'Other'
];
const LOST_REASONS = [
  'Chose a Competitor Project', 'Price Negotiation Failed',
  'Financing / Loan Rejected', 'Changed Mind', 'Other'
];
const DISPOSITION_REASONS = [...new Set([...NOT_INTERESTED_REASONS, ...LOST_REASONS])];

module.exports = {
  USER_ROLES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  CONTACT_OUTCOMES,
  BAD_CONTACT_OUTCOMES,
  NOT_INTERESTED_REASONS,
  LOST_REASONS,
  DISPOSITION_REASONS
};
