// The tiles on the Integrations page. Each tile is a lead source the client can
// switch on by itself: it gets its own URL and secret key, and its leads are tagged
// with `source`. Adding a tile here is all it takes; nothing else is per-tile.
// `steps` is shown in the tile's setup panel, written for the client's admin.
const INTEGRATIONS = [
  {
    key: 'google_ads', name: 'Google Ads', source: 'Google Ads', icon: 'fa-brands fa-google', color: '#4285f4',
    blurb: 'Lead form ads on Search, YouTube and Display.',
    steps: [
      'In Google Ads, open the campaign, then Assets, then your lead form.',
      'Under "Lead delivery", choose Webhook integration.',
      'Paste the URL below into "Webhook URL" and the key into "Key".',
      'Click "Send test data". It shows below as a test and no lead is made.'
    ]
  },
  {
    key: 'facebook', name: 'Facebook & Instagram', source: 'Facebook', icon: 'fa-brands fa-meta', color: '#0866ff',
    blurb: 'Lead ads on Facebook and Instagram, sent through Zapier, Pabbly or Make.',
    steps: [
      'In Zapier (or Pabbly Connect or Make), make a new zap with the trigger "Facebook Lead Ads: New Lead" and pick your page and form.',
      'Add the action "Webhooks: POST" with the URL below and payload type JSON.',
      'Map the form fields to name, phone and, if you have them, email, city and project.',
      'Add a header named X-Api-Key with the key below, then test the zap.'
    ],
    note: 'A direct "Connect Facebook" button is coming once Meta approves it.'
  },
  {
    key: '99acres', name: '99acres', source: '99acres', initials: '99', color: '#0078db',
    blurb: 'Leads from your 99acres listings.',
    portal: true
  },
  {
    key: 'magicbricks', name: 'MagicBricks', source: 'MagicBricks', initials: 'MB', color: '#d8232a',
    blurb: 'Leads from your MagicBricks listings.',
    portal: true
  },
  {
    key: 'housing', name: 'Housing.com', source: 'Housing.com', initials: 'H', color: '#7b2fbe',
    blurb: 'Leads from your Housing.com listings.',
    portal: true
  },
  {
    key: 'zapier', name: 'Zapier, Pabbly & Make', source: 'Zapier', icon: 'fa-solid fa-bolt', color: '#ff4f00',
    blurb: 'Any app those tools connect to: landing pages, chat bots, sheets.',
    steps: [
      'Make a zap (or scenario) with the trigger you want.',
      'Add the action "Webhooks: POST" with the URL below and payload type JSON.',
      'Send name and phone, and optionally email, city, project and notes.',
      'Add a header named X-Api-Key with the key below.'
    ]
  }
];

const PORTAL_STEPS = name => [
  `Email your ${name} account manager and ask them to push your leads to a CRM webhook.`,
  'Send them the URL and key below. The ready-made email below has both.',
  'They send name and phone (and email, project and city if they can) with the key in an X-Api-Key header.',
  'When their first lead arrives, it shows in the list below.'
];

INTEGRATIONS.forEach(t => { if (t.portal) t.steps = PORTAL_STEPS(t.name); });

const byKey = key => INTEGRATIONS.find(t => t.key === key) || null;

module.exports = { INTEGRATIONS, byKey };
