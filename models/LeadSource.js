const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('LeadSource', new Schema({
  name:    { type: String, required: true },
  channel: { type: String, enum: ['Online', 'Offline', 'Referral', 'Direct'] },
  active:  { type: Boolean, default: true },
  notes:   String
}));
