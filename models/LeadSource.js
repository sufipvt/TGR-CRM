const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('LeadSource', new Schema({
  name:    { type: String, required: true },
  channel: { type: String, enum: ['Online', 'Offline', 'Referral', 'Direct'] },
  active:  { type: Boolean, default: true },
  notes:   String,
  team_id: { type: Schema.Types.ObjectId, ref: 'Team' } // new leads from this source go to this team
}));
