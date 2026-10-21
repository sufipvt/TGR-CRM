// Lets phones install the CRM as an app: the web app manifest (named after this
// deployment's brand) and the service worker's offline page live here and in public/.
const express = require('express');

const router = express.Router();

router.get('/manifest.webmanifest', (req, res) => {
  const brand = res.locals.brand;
  res.type('application/manifest+json').set('Cache-Control', 'public, max-age=3600').send(JSON.stringify({
    name: brand.appName,
    short_name: brand.shortName.slice(0, 12),
    description: 'Leads, follow-ups and bookings for ' + brand.company,
    start_url: '/app?page=dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6fb',
    theme_color: '#1a56db',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: 'Today', url: '/app?page=dashboard' },
      { name: 'Add a lead', url: '/app?page=leads#new' },
      { name: 'Follow-ups', url: '/app?page=followups' }
    ]
  }));
});

module.exports = router;
