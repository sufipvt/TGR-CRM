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

router.get('/login', (req, res) => {
  res.render('login', { error: req.query.error || null });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = clean(req.body.email || '').toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (lockout.isLocked(email)) {
      return res.redirect('/login?error=' + encodeURIComponent('Too many failed attempts. Try again in 15 minutes.'));
    }
    const user = await User.findOne({ email, status: 'Active' });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      lockout.recordFailure(email);
      return res.redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    lockout.recordSuccess(email);
    const token = jwt.sign(
      { userId: user._id, role: user.role, email: user.email, name: user.full_name, team_id: user.team_id || null },
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

router.get('/logout', (req, res) => {
  res.clearCookie('tg_token');
  res.redirect('/login');
});

module.exports = router;
