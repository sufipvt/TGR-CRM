// Request-input helpers: trimming, ObjectId parsing, regex escaping.
const { Types } = require('mongoose');

function clean(v) { return typeof v === 'string' ? v.trim() : v; }
function cleanBody(body) {
  const out = {};
  for (const k of Object.keys(body)) out[k] = clean(body[k]);
  return out;
}
function objIdOrNull(v) {
  return v && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null;
}
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { clean, cleanBody, objIdOrNull, escapeRegex };
