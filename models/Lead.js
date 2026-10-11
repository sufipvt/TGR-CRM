const mongoose = require('mongoose');
const { LEAD_STATUSES, LEAD_TEMPERATURES, CONTACT_OUTCOMES, DISPOSITION_REASONS } = require('../config/constants');

const { Schema } = mongoose;

module.exports = mongoose.model('Lead', new Schema({
  name:               { type: String, required: true },
  phone:              { type: String, required: true },
  email:              String,
  city:               String,
  project_id:         { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  budget_range:       String,
  source_id:          { type: Schema.Types.ObjectId, ref: 'LeadSource', required: true, index: true },
  status:             { type: String, enum: LEAD_STATUSES, default: 'New' },
  temperature:        { type: String, enum: LEAD_TEMPERATURES },
  contact_outcome:    { type: String, enum: CONTACT_OUTCOMES },
  disposition_reason: { type: String, enum: DISPOSITION_REASONS },
  assigned_caller_id: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  assigned_closer_id: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  notes:              String,
  created_at:         { type: Date, default: Date.now, index: true },
  qualified_at:       Date,
  booked_at:          Date
}));
