// Strips MongoDB operator keys from request input before any route sees it.
// Express parses `?id[$exists]=true` into { id: { $exists: 'true' } }, which
// Mongoose would happily run as a query operator. Our forms never send keys
// starting with '$' or containing '.', so dropping them is always safe.
function stripOperators(value) {
  if (Array.isArray(value)) return value.map(stripOperators);
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) delete value[key];
      else value[key] = stripOperators(value[key]);
    }
  }
  return value;
}

function sanitizeInput(req, res, next) {
  stripOperators(req.body);
  stripOperators(req.query);
  next();
}

module.exports = { sanitizeInput, stripOperators };
