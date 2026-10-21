// The stacking view: one project's units laid out tower by tower, floor by floor,
// so a sales team sees at a glance what is free, on hold or sold.
const { Unit } = require('../models');
const { UNIT_STATUSES } = require('../config/constants');

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const NO_TOWER = '';

// { towers, tower, floors: [{ floor, units }], counts, total } for one project and tower.
async function stackingFor(projectId, wantedTower) {
  const units = await Unit.find({ project_id: projectId })
    .select('unit_number tower floor phase bhk area_sqft base_price status notes').lean();
  const towers = [...new Set(units.map(u => u.tower || NO_TOWER))].sort((a, b) => (a === NO_TOWER) - (b === NO_TOWER) || natural(a, b));
  const tower = towers.includes(wantedTower) ? wantedTower : (towers[0] ?? NO_TOWER);
  const inTower = units.filter(u => (u.tower || NO_TOWER) === tower);

  const byFloor = new Map();
  for (const u of inTower) {
    const key = Number.isInteger(u.floor) ? u.floor : null;
    if (!byFloor.has(key)) byFloor.set(key, []);
    byFloor.get(key).push(u);
  }
  // Top floor first, like the building; units without a floor last.
  const floors = [...byFloor.entries()]
    .sort(([a], [b]) => (a === null) - (b === null) || b - a)
    .map(([floor, list]) => ({ floor, units: list.sort((x, y) => natural(x.unit_number, y.unit_number)) }));

  const counts = Object.fromEntries(UNIT_STATUSES.map(s => [s, 0]));
  inTower.forEach(u => { counts[u.status] = (counts[u.status] || 0) + 1; });
  return { towers, tower, floors, counts, total: inTower.length, projectTotal: units.length };
}

module.exports = { stackingFor, NO_TOWER };
