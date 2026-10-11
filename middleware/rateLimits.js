// Rate limiters. Each is created once here so every route shares the same counters.
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

// Chatbot — cost-sensitive (calls Groq API), stricter window
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { reply: "You're sending messages a bit fast \u2014 please wait a moment and try again." }
});

// Heavy operations — PDF generation, CSV import (multiple DB aggregations / file parsing)
const expensiveOpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests for this action. Please wait a few minutes and try again.'
});

// General authenticated app traffic — generous ceiling, well above normal multi-page navigation
const appActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down and try again shortly.'
});

module.exports = { loginLimiter, chatLimiter, expensiveOpLimiter, appActionLimiter };
