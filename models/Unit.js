const mongoose = require('mongoose');
const { UNIT_STATUSES } = require('../config/constants');

const { Schema } = mongoose;

const schema = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  unit_number: { type: String, required: true },
  tower:       String, // block or wing, e.g. "A"
  floor:       Number,
  phase:       String,
  type:        String,
  bhk:         String,
  area_sqft:   Number,
  base_price:  Number,
  status:      { type: String, enum: UNIT_STATUSES, default: 'Available' },
  notes:       String
});
schema.index({ project_id: 1, tower: 1, floor: -1 });

module.exports = mongoose.model('Unit', schema);
