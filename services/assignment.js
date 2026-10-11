const { User, Lead } = require('../models');

// Round-robin: the active Sub Team Leader with the fewest assigned leads.
async function getNextCaller() {
  const callers = await User.find({ role: 'Sub Team Leader', status: 'Active' }).select('_id');
  if (!callers.length) return null;
  const counts = await Lead.aggregate([
    { $match: { assigned_caller_id: { $in: callers.map(c => c._id) } } },
    { $group: { _id: '$assigned_caller_id', count: { $sum: 1 } } }
  ]);
  const countMap = {};
  callers.forEach(c => { countMap[String(c._id)] = 0; });
  counts.forEach(c => { countMap[String(c._id)] = c.count; });
  return callers.sort((a, b) => countMap[String(a._id)] - countMap[String(b._id)])[0]._id;
}

module.exports = { getNextCaller };
