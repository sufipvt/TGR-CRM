const mongoose = require('mongoose');

const { Schema } = mongoose;

// One row per tile the client has set up (see config/integrations.js).
module.exports = mongoose.model('Integration', new Schema({
  key:        { type: String, required: true, unique: true },
  enabled:    { type: Boolean, default: false },
  api_key:    { type: String, required: true },
  source_id:  { type: Schema.Types.ObjectId, ref: 'LeadSource' },
  project_id: { type: Schema.Types.ObjectId, ref: 'Project' }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }));
