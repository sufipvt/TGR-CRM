const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('AuditLog', new Schema({
  user_email: String,
  action:     String,
  entity:     String,
  entity_id:  { type: String, index: true },
  details:    Schema.Types.Mixed,
  created_at: { type: Date, default: Date.now, expires: 15552000 } // 180 days TTL
}));
