// Public pages every deployment needs: the privacy policy and terms (in this
// client's name, linked from the sign-in page and the enquiry form; Meta asks
// for them before approving lead ads), and /health for Render and uptime monitors.
const express = require('express');
const mongoose = require('mongoose');
const { getSettings } = require('../services/settings');

const router = express.Router();

// Bump when the wording of views/legal.ejs changes.
const LEGAL_UPDATED = '21 October 2026';

async function renderLegal(kind, res, next) {
  try {
    const s = await getSettings();
    res.set('Cache-Control', 'public, max-age=600').render('legal', {
      kind,
      updated: LEGAL_UPDATED,
      contact: {
        email: s.contact_email || '',
        phone: s.contact_phone || '',
        address: s.company_address || ''
      }
    });
  } catch (e) { next(e); }
}

router.get('/privacy', (req, res, next) => renderLegal('privacy', res, next));
router.get('/terms', (req, res, next) => renderLegal('terms', res, next));

// 200 when the app can reach its database, 503 when it can't. Says nothing else
// about the deployment, so it is safe to leave public.
router.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (mongoose.connection.readyState !== 1) throw new Error('not connected');
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000).unref())
    ]);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

module.exports = router;
