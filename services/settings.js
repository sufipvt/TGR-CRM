// Company settings (one deployment = one client firm). Read on most requests for
// branding, so cached briefly in memory; save_settings clears the cache.
const { Setting } = require('../models');

const DEFAULTS = {
  company_name: process.env.COMPANY_NAME || 'TrueGrowth Realty', currency: 'INR', currency_symbol: '₹',
  tax_rate: '0', booking_prefix: 'TG-', lead_prefix: 'LD-', default_commission: '0'
};
const CACHE_TTL = 60 * 1000;
let cache = null;

async function getSettings() {
  if (cache && cache.expires > Date.now()) return { ...cache.data };
  const docs = await Setting.find();
  const map = { ...DEFAULTS };
  docs.forEach(d => { map[d.key] = d.value; });
  cache = { data: map, expires: Date.now() + CACHE_TTL };
  return { ...map };
}

function clearSettingsCache() { cache = null; }

// Product name shown in titles, login page and emails. Set APP_NAME per deployment.
const APP_NAME = process.env.APP_NAME || 'TrueGrowth CRM';

function brandFrom(settings) {
  const shortName = APP_NAME.replace(/\s*CRM$/i, '') || APP_NAME;
  const capitals = (shortName.match(/[A-Z]/g) || []).join('');
  const initials = (capitals.length >= 2 ? capitals : shortName.replace(/\s+/g, '')).slice(0, 2).toUpperCase();
  return {
    appName: APP_NAME,
    shortName,
    initials,
    company: settings.company_name || DEFAULTS.company_name,
    refPrefix: settings.booking_prefix || DEFAULTS.booking_prefix
  };
}

module.exports = { getSettings, clearSettingsCache, brandFrom, APP_NAME };
