// /app?page=inventory form actions: change a unit's status from the stacking view,
// and add a whole tower of units in one go. Managers only, like the Projects page.
const { Unit, Project, Booking } = require('../../models');
const { cleanBody, objIdOrNull } = require('../../utils/request');
const { isManager } = require('../../utils/roles');
const { audit } = require('../../services/audit');

const fail = (msg, status) => Object.assign(new Error(msg), { status });
const MAX_GENERATE = 1000;
// From the stacking view only these; Booked and Sold come from bookings.
const QUICK_STATUSES = ['Available', 'Hold', 'Blocked'];

const ACTIONS = {
  async set_unit_status(user, body) {
    const id = objIdOrNull(body.unit_id);
    if (!id) throw fail('Pick a unit', 400);
    if (!QUICK_STATUSES.includes(body.status)) throw fail('Pick Available, Hold or Blocked', 400);
    if (await Booking.exists({ unit_id: id, status: { $ne: 'Cancelled' } })) {
      throw fail('This unit has a booking. Cancel or delete the booking first.', 400);
    }
    const unit = await Unit.findOneAndUpdate({ _id: id, status: { $in: QUICK_STATUSES } }, { status: body.status }, { new: true });
    if (!unit) throw fail('That unit is booked or sold.', 409);
    await audit(user.email, 'update', 'Unit', id, { unit_number: unit.unit_number, status: body.status });
    return `${unit.unit_number} is now ${body.status}.`;
  },

  // Floors from..to, N units a floor, numbered like A-101, A-102 … A-1204.
  // Numbers already in the project are skipped, so it is safe to run twice.
  async generate_units(user, body) {
    const projectId = objIdOrNull(body.project_id);
    if (!projectId || !(await Project.exists({ _id: projectId }))) throw fail('Pick a project', 400);
    const tower = (body.tower || '').trim().slice(0, 30);
    const from = Number(body.floor_from), to = Number(body.floor_to), per = Number(body.per_floor);
    if (![from, to, per].every(Number.isInteger) || from < 0 || to < from || to > 200 || per < 1 || per > 50) {
      throw fail('Floors must be whole numbers (from ≤ to, up to 200) with 1 to 50 units a floor', 400);
    }
    const count = (to - from + 1) * per;
    if (count > MAX_GENERATE) throw fail(`That's ${count} units; add at most ${MAX_GENERATE} at a time`, 400);
    const prefix = tower ? tower + '-' : '';
    const numbers = [];
    for (let fl = from; fl <= to; fl++) {
      for (let i = 1; i <= per; i++) numbers.push({ floor: fl, unit_number: prefix + fl + String(i).padStart(2, '0') });
    }
    const existing = new Set((await Unit.find({ project_id: projectId, unit_number: { $in: numbers.map(n => n.unit_number) } })
      .select('unit_number').lean()).map(u => u.unit_number));
    const fresh = numbers.filter(n => !existing.has(n.unit_number)).map(n => ({
      ...n, project_id: projectId, tower, phase: (body.phase || '').trim().slice(0, 30),
      bhk: (body.bhk || '').slice(0, 30), area_sqft: Number(body.area_sqft || 0) || undefined,
      base_price: Number(body.base_price || 0) || undefined, status: 'Available'
    }));
    if (fresh.length) await Unit.insertMany(fresh);
    await audit(user.email, 'create', 'Unit', projectId, { generated: fresh.length, tower, floors: `${from}-${to}`, per_floor: per });
    const skipped = numbers.length - fresh.length;
    return `Added ${fresh.length} unit${fresh.length === 1 ? '' : 's'}` + (skipped ? `; ${skipped} already existed.` : '.');
  }
};

// Returns the flash message, or null when the action isn't one of these.
async function handleInventoryAction(req) {
  const body = cleanBody(req.body);
  if (!Object.hasOwn(ACTIONS, body.action)) return null;
  if (!isManager(req.user.role)) throw fail('Forbidden', 403);
  return ACTIONS[body.action](req.user, body);
}

module.exports = { handleInventoryAction };
