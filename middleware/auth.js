// Authentication + authorization middleware, and the short-lived user context cache.
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { isSuperAdmin, isAdminRole } = require('../utils/roles');

function requireAuth(req, res, next) {
  const token = req.cookies.tg_token;
  if (!token) return res.redirect('/login');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    res.clearCookie('tg_token');
    res.redirect('/login?error=' + encodeURIComponent('Session expired, please sign in again'));
  }
}
function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user.role)) return res.status(403).send('Forbidden');
  next();
}
function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user.role)) return res.status(403).send('Forbidden');
  next();
}

// Short-lived cache so we don't hit the DB on every request, while still
// catching deactivation/role changes within seconds instead of up to 8 hours.
const userContextCache = new Map();
const USER_CACHE_TTL = 30 * 1000;

async function refreshUserContext(req, res, next) {
  try {
    const uid = req.user.userId;
    const cached = userContextCache.get(uid);
    const now = Date.now();

    if (cached && cached.expires > now) {
      if (cached.data === null) {
        res.clearCookie('tg_token');
        return res.redirect('/login?error=' + encodeURIComponent('Your session has ended. Please sign in again.'));
      }
      Object.assign(req.user, cached.data);
      return next();
    }

    const dbUser = await User.findById(uid).select('role team_id status full_name');
    if (!dbUser || dbUser.status !== 'Active') {
      userContextCache.set(uid, { data: null, expires: now + USER_CACHE_TTL });
      res.clearCookie('tg_token');
      return res.redirect('/login?error=' + encodeURIComponent('Your session has ended. Please sign in again.'));
    }

    const fresh = { role: dbUser.role, team_id: dbUser.team_id, name: dbUser.full_name };
    userContextCache.set(uid, { data: fresh, expires: now + USER_CACHE_TTL });
    Object.assign(req.user, fresh);
    next();
  } catch (e) {
    // Fail OPEN on a transient DB hiccup — the signed JWT is still valid,
    // and locking everyone out due to a momentary blip would hurt availability more than it helps security.
    console.error('refreshUserContext error (failing open):', e.message);
    next();
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  refreshUserContext,
  // Shared with the user update/delete actions so changes take effect immediately.
  userContextCache
};
