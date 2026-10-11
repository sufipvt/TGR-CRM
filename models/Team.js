const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('Team', new Schema({
  name:            { type: String, required: true, unique: true },
  team_leader_id:  { type: Schema.Types.ObjectId, ref: 'User' },
  created_at:      { type: Date, default: Date.now }
}));
