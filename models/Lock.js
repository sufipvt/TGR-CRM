const mongoose = require('mongoose');

const { Schema } = mongoose;

// A short-lived lock row (see services/lock.js). The unique _id is the lock;
// the TTL index clears any lock left behind by a crash.
const lockSchema = new Schema({
  _id:        { type: String },
  created_at: { type: Date, default: Date.now }
}, { versionKey: false });

lockSchema.index({ created_at: 1 }, { expireAfterSeconds: 60 });

module.exports = mongoose.model('Lock', lockSchema);
