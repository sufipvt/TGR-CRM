const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('Payment', new Schema({
  booking_id:   { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  amount:       { type: Number, required: true },
  payment_date: { type: Date, default: Date.now },
  method:       { type: String, enum: ['Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Card', 'Other'] },
  reference:    String,
  notes:        String
}));
