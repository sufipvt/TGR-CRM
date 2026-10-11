const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('Booking', new Schema({
  lead_id:        { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  project_id:     { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  unit_id:        { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
  closer_id:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  booking_date:   { type: Date, default: Date.now },
  sale_value:     { type: Number, default: 0 },
  booking_amount: { type: Number, required: true },
  status:         { type: String, enum: ['Tentative', 'Confirmed', 'Cancelled'], default: 'Tentative' },
  notes:          String,
  created_at:     { type: Date, default: Date.now }
}));
