const mongoose = require('mongoose');

const { Schema } = mongoose;

// One in-app alert for one user (the bell in the top bar). Old ones expire on their own.
const notificationSchema = new Schema({
  user_id:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind:       { type: String, enum: ['new_lead', 'repeat_enquiry'], required: true },
  title:      { type: String, required: true },
  body:       String,
  lead_id:    { type: Schema.Types.ObjectId, ref: 'Lead' },
  link:       String,
  read_at:    Date,
  created_at: { type: Date, default: Date.now }
});

notificationSchema.index({ user_id: 1, created_at: -1 });
notificationSchema.index({ created_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
