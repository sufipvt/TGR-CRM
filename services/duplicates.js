// Duplicate-lead detection by phone number. Phones are free text ("+91 98765 43210",
// "098765-43210"), so two numbers match when their last 10 digits do. Shorter
// numbers (landlines) must match digit for digit.
const { Lead } = require('../models');

const KEY_DIGITS = 10;

// The digits that identify a phone: its last 10, or all of them if fewer.
// '' for anything too short to compare safely.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return digits.slice(-KEY_DIGITS);
}

// A regex for stored phones whose key equals this one, ignoring spaces and dashes.
function phoneRegex(key) {
  const body = key.split('').join('\\D*') + '\\D*$';
  // A full 10-digit key may follow a country code or trunk 0; a shorter one may not.
  return new RegExp((key.length === KEY_DIGITS ? '' : '^\\D*') + body);
}

// The oldest other lead with the same phone, or null.
async function findDuplicateLead(phone, excludeId) {
  const key = phoneKey(phone);
  if (!key) return null;
  const query = { phone: phoneRegex(key) };
  if (excludeId) query._id = { $ne: excludeId };
  return Lead.findOne(query).sort('created_at')
    .select('name phone status assigned_caller_id assigned_closer_id')
    .populate('assigned_caller_id', 'full_name').lean();
}

module.exports = { phoneKey, phoneRegex, findDuplicateLead };
