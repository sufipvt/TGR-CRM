const { User, Lead, Project, LeadSource } = require('../models');

// Leads still being worked: what "busy" means when sharing out new leads.
const CLOSED_STATUSES = ['Booked', 'Lost', 'Not Interested'];

// The team a new lead should go to: its project's team, else its source's team, else none.
async function teamFor({ project_id, source_id } = {}) {
  if (project_id) {
    const p = await Project.findById(project_id).select('team_id').lean();
    if (p && p.team_id) return p.team_id;
  }
  if (source_id) {
    const s = await LeadSource.findById(source_id).select('team_id').lean();
    if (s && s.team_id) return s.team_id;
  }
  return null;
}

// Round-robin: the active Sub Team Leader with the fewest open leads, from the
// lead's team when its project or source names one (falling back to everyone
// if that team has no active Sub Team Leaders).
async function getNextCaller(lead = {}) {
  const teamId = await teamFor(lead);
  let callers = [];
  if (teamId) callers = await User.find({ role: 'Sub Team Leader', status: 'Active', team_id: teamId }).select('_id');
  if (!callers.length) callers = await User.find({ role: 'Sub Team Leader', status: 'Active' }).select('_id');
  if (!callers.length) return null;
  const counts = await Lead.aggregate([
    { $match: { assigned_caller_id: { $in: callers.map(c => c._id) }, status: { $nin: CLOSED_STATUSES } } },
    { $group: { _id: '$assigned_caller_id', count: { $sum: 1 } } }
  ]);
  const countMap = {};
  callers.forEach(c => { countMap[String(c._id)] = 0; });
  counts.forEach(c => { countMap[String(c._id)] = c.count; });
  return callers.sort((a, b) => countMap[String(a._id)] - countMap[String(b._id)])[0]._id;
}

module.exports = { getNextCaller, teamFor, CLOSED_STATUSES };
