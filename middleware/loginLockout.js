// Brute-force lockout for sign-in. Two counters:
// - per account and address: 5 wrong passwords lock that account from that address,
//   which stops someone guessing from one place;
// - per account from anywhere: 50 wrong passwords lock it everywhere, which stops a
//   bot rotating addresses.
// So a stranger who knows the owner's email can't lock the owner out with 5 tries.
// In memory: fine for one Render instance; counters reset on deploy.
const MAX_FAILURES = 5;
const MAX_FAILURES_ANY_ADDRESS = 50;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const attempts = new Map(); // key -> { failures, firstAt, lockedUntil }
const keys = (email, ip) => [[email + '|' + (ip || ''), MAX_FAILURES], [email, MAX_FAILURES_ANY_ADDRESS]];

function prune(now) {
  if (attempts.size < 1000) return;
  for (const [k, v] of attempts) {
    if ((v.lockedUntil || 0) < now && now - v.firstAt > WINDOW_MS) attempts.delete(k);
  }
}

function isLocked(email, ip, now = Date.now()) {
  return keys(email, ip).some(([k]) => {
    const a = attempts.get(k);
    return !!(a && a.lockedUntil && a.lockedUntil > now);
  });
}

function recordFailure(email, ip, now = Date.now()) {
  prune(now);
  for (const [k, max] of keys(email, ip)) {
    let a = attempts.get(k);
    if (!a || now - a.firstAt > WINDOW_MS || (a.lockedUntil && a.lockedUntil <= now)) {
      a = { failures: 0, firstAt: now, lockedUntil: 0 };
    }
    a.failures += 1;
    if (a.failures >= max) a.lockedUntil = now + LOCK_MS;
    attempts.set(k, a);
  }
}

// A correct password clears this address's counter; the any-address one keeps counting.
function recordSuccess(email, ip) { attempts.delete(email + '|' + (ip || '')); }

module.exports = { isLocked, recordFailure, recordSuccess, MAX_FAILURES, MAX_FAILURES_ANY_ADDRESS };
