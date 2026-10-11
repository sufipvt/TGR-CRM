// Per-account brute-force lockout (guide block 30). The IP rate limiter alone
// can't stop a bot that rotates IPs while guessing one account's password.
// In memory: fine for one Render instance; counters reset on deploy.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const attempts = new Map(); // email -> { failures, firstAt, lockedUntil }

function prune(now) {
  if (attempts.size < 1000) return;
  for (const [k, v] of attempts) {
    if ((v.lockedUntil || 0) < now && now - v.firstAt > WINDOW_MS) attempts.delete(k);
  }
}

function isLocked(email, now = Date.now()) {
  const a = attempts.get(email);
  return !!(a && a.lockedUntil && a.lockedUntil > now);
}

function recordFailure(email, now = Date.now()) {
  prune(now);
  let a = attempts.get(email);
  if (!a || now - a.firstAt > WINDOW_MS || (a.lockedUntil && a.lockedUntil <= now)) {
    a = { failures: 0, firstAt: now, lockedUntil: 0 };
  }
  a.failures += 1;
  if (a.failures >= MAX_FAILURES) a.lockedUntil = now + LOCK_MS;
  attempts.set(email, a);
}

function recordSuccess(email) { attempts.delete(email); }

module.exports = { isLocked, recordFailure, recordSuccess, MAX_FAILURES };
