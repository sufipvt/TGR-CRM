const { Setting } = require('../models');

async function getSettings() {
  const docs = await Setting.find();
  const map = {
    company_name: 'TrueGrowth Realty', currency: 'INR', currency_symbol: '\u20B9',
    tax_rate: '0', booking_prefix: 'TG-', lead_prefix: 'LD-', default_commission: '0'
  };
  docs.forEach(d => { map[d.key] = d.value; });
  return map;
}

module.exports = { getSettings };
