const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('FollowUp', new Schema({
  lead_id:        { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  assigned_to_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scheduled_date: { type: Date, required: true },
  completed_date: Date,
  type:           { type: String, enum: ['Call', 'WhatsApp', 'Site Visit', 'Meeting', 'Email', 'Other'], default: 'Call' },
  status:         { type: String, enum: ['Pending', 'Completed', 'Missed', 'Cancelled'], default: 'Pending' },
  outcome:        String,
  notes:          String,
  created_at:     { type: Date, default: Date.now }
}));
