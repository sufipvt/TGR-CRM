// Booking receipt page
const express = require('express');
const { Booking, Payment } = require('../models');
const { sendErrorPage } = require('../utils/errorPage');
const { isManager } = require('../utils/roles');
const { getSettings } = require('../services/settings');
const { requireAuth, refreshUserContext } = require('../middleware/auth');
const { appActionLimiter } = require('../middleware/rateLimits');

const router = express.Router();

// ---------------------------------------------------------------------------
// RECEIPT
// ---------------------------------------------------------------------------
router.get('/app/receipt/:bookingId', requireAuth, appActionLimiter, refreshUserContext, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId).populate('lead_id project_id unit_id closer_id');
    if (!booking) return res.status(404).send('Booking not found');
    // RBAC: closers can only view their own booking receipts
    if (!isManager(req.user.role)) {
      if (req.user.role !== 'Closer' || String(booking.closer_id?._id) !== String(req.user.userId)) {
        return res.status(403).send('Forbidden');
      }
    }
    const payments = await Payment.find({ booking_id: booking._id }).sort('payment_date');
    const amount_paid = payments.reduce((s, p) => s + p.amount, 0);
    const settings = await getSettings();
    res.render('receipt', { booking, payments, amount_paid, settings });
  } catch (e) {
    console.error('Receipt error:', e);
    sendErrorPage(res, 500, 'We couldn\u2019t load this receipt. Please try again.');
  }
});

module.exports = router;
