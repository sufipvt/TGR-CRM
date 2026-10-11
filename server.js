// TrueGrowth CRM — server.js
// Node.js + Express + MongoDB (Mongoose) + EJS + SendGrid + node-cron
//-------------------------------------------------------------------------
//require('dotenv').config();
//require('dotenv').config({ path: '.env.development.local' });
//-------------------------------------------------------------------------
const { PORT } = require('./config/env');

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const helmet = require('helmet');
const path = require('path');
const compression = require('compression');

// If something truly unexpected slips through every try/catch, log it clearly and
// exit deliberately rather than keep running in a possibly-corrupted state.
// Render's platform automatically restarts the service within seconds.
process.on('uncaughtException', (err) => {
  console.error('FATAL \u2014 Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('FATAL \u2014 Unhandled Promise Rejection:', reason);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// MODELS + HELPERS USED HERE
// ---------------------------------------------------------------------------
const { User } = require('./models');
const { formatMoney, formatDate, formatDateTime } = require('./utils/format');
const { sendErrorPage } = require('./utils/errorPage');
const { sendDailyDigest } = require('./services/digest');

// ---------------------------------------------------------------------------
// APP SETUP
// ---------------------------------------------------------------------------
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

app.locals.formatMoney = formatMoney;
app.locals.formatDate = formatDate;
app.locals.formatDateTime = formatDateTime;

// ---------------------------------------------------------------------------
// ROUTES: public, API, receipt, CSV import (see routes/)
// ---------------------------------------------------------------------------
app.use(require('./routes/auth'));
app.use(require('./routes/api'));
app.use(require('./routes/receipt'));
app.use(require('./routes/import'));

// ---------------------------------------------------------------------------
// APP PAGE: GET/POST /app (see routes/app.js, controllers/app/)
// ---------------------------------------------------------------------------
app.use(require('./routes/app'));

app.use(require('./routes/reportPdf'));
app.use(require('./routes/chat'));

// 404 catch-all
app.use((req, res) => {
  console.log('404:', req.method, req.url);
  sendErrorPage(res, 404, 'The page you\u2019re looking for doesn\u2019t exist.');
});

// Global error handler \u2014 catches anything that slips past every route's own try/catch
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) return next(err);
  sendErrorPage(res, 500, 'Something went wrong on our end. Please try again.');
});

// ---------------------------------------------------------------------------
// SEED + START
// ---------------------------------------------------------------------------
async function initAdmin() {
  try {
    const exists = await User.findOne({ $or: [{ role: 'Admin' }, { email: 'admin@truegrowth.com' }] });
    if (exists) return;
    const hashed = await bcrypt.hash('Admin@123', 12);
    await User.create({
      full_name: 'Administrator',
      email: 'admin@truegrowth.com',
      password: hashed,
      role: 'Admin',
      status: 'Active'
    });
    console.log('Admin user seeded: admin@truegrowth.com / Admin@123');
  } catch (e) {
    if (e.code === 11000) return; // already seeded by a concurrent restart
    throw e;
  }
}

module.exports = app;

// Only connect, schedule and listen when run directly (`node server.js`).
// When required (e.g. by tests), the app is exported without side effects.
if (require.main === module) {
  cron.schedule('30 2 * * *', sendDailyDigest, { timezone: 'Asia/Kolkata' }); // 02:30 UTC = 08:00 IST

  mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
      console.log('MongoDB connected');
      await initAdmin();
      app.listen(PORT, () => console.log('TrueGrowth CRM running on port ' + PORT));
    })
    .catch(err => {
      console.error('MongoDB connection failed:', err.message);
      process.exit(1);
    });
}
