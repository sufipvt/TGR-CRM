// Business timezone. Set before anything creates a Date: "today", overdue checks,
// typed-in follow-up times and every displayed date use it. Render runs on UTC.
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';

// Environment loading + validation. Required first by server.js so the
// process exits early (same messages as before) if config is missing.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.development.local' });
}

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('ERROR: MONGODB_URI and JWT_SECRET must be set in Render.com environment variables.');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (!process.env.SENDGRID_API_KEY) {
  console.warn('WARN: SENDGRID_API_KEY not set — email digest will not send.');
}

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

module.exports = { PORT, IS_PROD };
