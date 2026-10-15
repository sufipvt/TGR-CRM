const mongoose = require('mongoose');
const { USER_ROLES } = require('../config/constants');

const { Schema } = mongoose;

module.exports = mongoose.model('User', new Schema({
  full_name: { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  // Never loaded unless asked for with .select('+password') (only sign-in does).
  password:  { type: String, required: true, select: false },
  role:      { type: String, enum: USER_ROLES, required: true },
  team_id:   { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  phone:     String,
  status:    { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  // Goes up when the password is reset or the account is deactivated; sessions
  // signed with an older number stop working (middleware/auth.js).
  token_version: { type: Number, default: 0 },
  created_at:{ type: Date, default: Date.now }
}));
