const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('Unit', new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  unit_number: { type: String, required: true },
  type:        String,
  bhk:         String,
  area_sqft:   Number,
  base_price:  Number,
  status:      { type: String, enum: ['Available', 'Blocked', 'Booked', 'Sold'], default: 'Available' },
  notes:       String
}));
