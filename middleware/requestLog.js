// One JSON line per request, so Render's log search can find a request by id,
// user, path or status. Every response carries X-Request-Id, and error pages
// show the same id as a "Reference" the user can send to support.
//
// Logged: method, path (no query string, so searches and names stay out of logs),
// ?page= for /app, status, duration, user id. Never bodies, cookies or headers.
const crypto = require('crypto');

const QUIET = /^\/(favicon\.ico|app\.(js|css)|health)$|\.(png|jpe?g|svg|ico|woff2?)$/;

function log(level, fields) {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, ...fields });
  (level === 'error' ? console.error : console.log)(line);
}

function requestLog(req, res, next) {
  const id = crypto.randomBytes(6).toString('hex');
  req.id = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (QUIET.test(req.path) && res.statusCode < 400) return;
    log(res.statusCode >= 500 ? 'error' : 'info', {
      id,
      method: req.method,
      path: req.path,
      page: req.path === '/app' && typeof req.query.page === 'string' ? req.query.page.slice(0, 30) : undefined,
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1000000n),
      user: req.user ? String(req.user.userId) : undefined
    });
  });
  next();
}

// For caught errors: the stack goes to the log under the request's id.
function logError(req, where, err) {
  log('error', { id: req && req.id, where, error: err && err.message, stack: err && err.stack });
}

module.exports = { requestLog, logError };
