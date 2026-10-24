const mongoose = require('mongoose');

const { Schema } = mongoose;

// What each tile received, so the client can see that leads arrive (or why not).
// Kept 90 days.
const schema = new Schema({
  key:     { type: String, required: true },
  at:      { type: Date, default: Date.now },
  result:  { type: String, enum: ['new', 'repeat', 'test', 'refused', 'error'], required: true },
  lead_id: { type: Schema.Types.ObjectId, ref: 'Lead' },
  name:    String,
  detail:  String
});
schema.index({ key: 1, at: -1 });
schema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('IntegrationLog', schema);
