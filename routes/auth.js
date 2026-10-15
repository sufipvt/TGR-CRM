// Public routes: home redirect, login, logout
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { IS_PROD } = require('../config/env');
const { User } = require('../models');
const { clean } = require('../utils/request');
const { audit } = require('../services/audit');
const { loginLimiter } = require('../middleware/rateLimits');
const lockout = require('../middleware/loginLockout');

const router = express.Router();

router.get('/', (req, res) => res.redirect('/app'));

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

router.get('/login', (req, res) => {
  res.render('login', { error: req.query.error || null });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = clean(req.body.email || '').toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (lockout.isLocked(email, req.ip)) {
      return res.redirect('/login?error=' + encodeURIComponent('Too many failed attempts. Try again in 15 minutes.'));
    }
    const user = await User.findOne({ email, status: 'Active' }).select('+password');
    // Compare against a dummy hash when there is no such user, so the response
    // takes as long either way and doesn't reveal which emails have accounts.
    const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
    if (!user || !ok) {
      lockout.recordFailure(email, req.ip);
      return res.redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    lockout.recordSuccess(email, req.ip);
    const token = jwt.sign(
      { userId: user._id, role: user.role, email: user.email, name: user.full_name, team_id: user.team_id || null, tv: user.token_version || 0 },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('tg_token', token, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    });
    await audit(user.email, 'login', 'User', user._id, {});
    res.redirect('/app?page=dashboard');
  } catch (e) {
    console.error('Login error:', e);
    res.redirect('/login?error=' + encodeURIComponent('An error occurred, please try again'));
  }
});

// POST, so another website can't sign people out with a link or image.
router.post('/logout', (req, res) => {
  res.clearCookie('tg_token');
  res.redirect('/login');
});
router.get('/logout', (req, res) => res.redirect('/app'));

module.exports = router;
