const mongoose = require('mongoose');

const { Schema } = mongoose;

module.exports = mongoose.model('Project', new Schema({
  name:            { type: String, required: true },
  developer:       String,
  location:        String,
  city:            String,
  state:           String,
  project_type:    { type: String, enum: ['Apartment', 'Villa', 'Plot', 'Commercial', 'Penthouse', 'Studio', 'Other'] },
  status:          { type: String, enum: ['Upcoming', 'Under Construction', 'Ready to Move', 'Sold Out'], default: 'Upcoming' },
  total_units:     { type: Number, default: 0 },
  available_units: { type: Number, default: 0 },
  price_range:     String,
  team_id:         { type: Schema.Types.ObjectId, ref: 'Team' }, // new leads for this project go to this team
  notes:           String,
  created_at:      { type: Date, default: Date.now }
}));
