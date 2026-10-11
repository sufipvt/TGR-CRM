const mongoose = require('mongoose');
const { USER_ROLES } = require('../config/constants');

const { Schema } = mongoose;

module.exports = mongoose.model('User', new Schema({
  full_name: { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: USER_ROLES, required: true },
  team_id:   { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  phone:     String,
  status:    { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  created_at:{ type: Date, default: Date.now }
}));
