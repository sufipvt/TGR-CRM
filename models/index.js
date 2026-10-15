// Every Mongoose model, registered once at module load.
module.exports = {
  User: require('./User'),
  Project: require('./Project'),
  Unit: require('./Unit'),
  LeadSource: require('./LeadSource'),
  Lead: require('./Lead'),
  FollowUp: require('./FollowUp'),
  Booking: require('./Booking'),
  Payment: require('./Payment'),
  Team: require('./Team'),
  AuditLog: require('./AuditLog'),
  Setting: require('./Setting'),
  Notification: require('./Notification')
};
