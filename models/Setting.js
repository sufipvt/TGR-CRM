const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('Setting', new Schema({
  key:   { type: String, required: true, unique: true },
  value: Schema.Types.Mixed
}));
