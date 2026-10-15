const mongoose = require('mongoose');
const { LEAD_STATUSES, LEAD_TEMPERATURES, CONTACT_OUTCOMES, DISPOSITION_REASONS } = require('../config/constants');

const { Schema } = mongoose;

const leadSchema = new Schema({
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
  booked_at:          Date,
  // Where the lead sits in lists, newest first: when it arrived, or when it last enquired again.
  listed_at:          { type: Date, default: function () { return this.created_at || new Date(); } },
  last_enquiry_at:    Date,
  enquiry_count:      { type: Number, default: 0 },
  // Answers from the enquiry form or webhook, kept as given (see services/enquiryScore.js)
  enquiry: {
    timeline: String, budget: String, property_type: String, site_visit: String,
    utm_source: String, utm_medium: String, utm_campaign: String
  }
}, {
  // Set on every save and update; the edit form sends it back so a save can tell
  // whether someone else changed the lead in the meantime.
  timestamps: { createdAt: false, updatedAt: 'updated_at' }
});

// Leads from before listed_at existed have none; lists sort them after, by created_at.
leadSchema.index({ listed_at: -1, created_at: -1 });
// Dashboard and list filters by status or temperature, newest first
leadSchema.index({ status: 1, listed_at: -1 });
leadSchema.index({ temperature: 1, listed_at: -1 });

module.exports = mongoose.model('Lead', leadSchema);
