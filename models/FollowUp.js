const mongoose = require('mongoose');
const { SITE_VISIT_OUTCOMES } = require('../config/constants');

const { Schema } = mongoose;

const followUpSchema = new Schema({
  lead_id:        { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  assigned_to_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scheduled_date: { type: Date, required: true },
  completed_date: Date,
  type:           { type: String, enum: ['Call', 'WhatsApp', 'Site Visit', 'Meeting', 'Email', 'Other'], default: 'Call' },
  status:         { type: String, enum: ['Pending', 'Completed', 'Missed', 'Cancelled'], default: 'Pending' },
  outcome:        String,
  visit_outcome:  { type: String, enum: SITE_VISIT_OUTCOMES },
  notes:          String,
  created_at:     { type: Date, default: Date.now }
});

// Pending / overdue / today lists filter by assignee + status and sort by date
followUpSchema.index({ assigned_to_id: 1, status: 1, scheduled_date: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
