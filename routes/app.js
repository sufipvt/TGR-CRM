// Main app page: GET/POST /app
const express = require('express');
const { requireAuth, refreshUserContext } = require('../middleware/auth');
const { appActionLimiter } = require('../middleware/rateLimits');
const { appHandler } = require('../controllers/app');

const router = express.Router();

router.get('/app', requireAuth, appActionLimiter, refreshUserContext, appHandler);
router.post('/app', requireAuth, appActionLimiter, refreshUserContext, appHandler);

module.exports = router;
