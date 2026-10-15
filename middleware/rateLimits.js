// Rate limiters. Each is created once here so every route shares the same counters.
const rateLimit = require('express-rate-limit');

// Signed-in limits count per person, not per address: a whole office usually
// shares one internet address, and ten people must not share one allowance.
// These limiters are mounted after requireAuth, so req.user is set.
const perUser = req => (req.user && req.user.userId ? 'user:' + req.user.userId : req.ip);

// Per address, so a shared office address needs room for everyone signing in.
// Password guessing on one account is stopped separately by middleware/loginLockout.js.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

// Chatbot — cost-sensitive (calls Groq API), stricter window
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: perUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: { reply: "You're sending messages a bit fast \u2014 please wait a moment and try again." }
});

// Heavy operations — PDF generation, CSV import (multiple DB aggregations / file parsing)
const expensiveOpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: perUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests for this action. Please wait a few minutes and try again.'
});

// General authenticated app traffic — generous ceiling, well above normal multi-page navigation
const appActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keyGenerator: perUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down and try again shortly.'
});

// Public enquiry form: real visitors send one or two, so a low ceiling per IP stops spam
const enquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many enquiries from this connection. Please try again later.'
});

// Lead webhook: servers (Google Ads, Zapier) can post bursts, so a higher ceiling
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests' }
});

module.exports = { loginLimiter, chatLimiter, expensiveOpLimiter, appActionLimiter, enquiryLimiter, webhookLimiter };
