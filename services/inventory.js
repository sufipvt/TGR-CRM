// Unit counts per project, taken from the units themselves so they can't drift.
// A project with no units entered keeps the hand-typed totals as a fallback.
const { Unit } = require('../models');

// Map of projectId -> { total, available } for every project that has units.
async function unitCountsByProject() {
  const rows = await Unit.aggregate([
    { $group: {
      _id: '$project_id',
      total: { $sum: 1 },
      available: { $sum: { $cond: [{ $eq: ['$status', 'Available'] }, 1, 0] } }
    } }
  ]);
  return new Map(rows.map(r => [String(r._id), { total: r.total, available: r.available }]));
}

// The counts to show for one project: from its units when it has any.
function unitCountsFor(project, counts) {
  const c = counts.get(String(project._id));
  if (c) return { total_units: c.total, available_units: c.available, from_units: true };
  return { total_units: project.total_units || 0, available_units: project.available_units || 0, from_units: false };
}

module.exports = { unitCountsByProject, unitCountsFor };
