// Puts the deployment's branding (app name, company name, receipt prefix) on
// res.locals.brand for every view. Falls back to defaults if settings can't load.
const { getSettings, brandFrom } = require('../services/settings');

async function brandLocals(req, res, next) {
  try {
    res.locals.brand = brandFrom(await getSettings());
  } catch (e) {
    console.error('brandLocals: settings unavailable, using defaults:', e.message);
    res.locals.brand = brandFrom({});
  }
  next();
}

module.exports = { brandLocals };
