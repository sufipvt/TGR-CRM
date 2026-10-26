// Towers and floors on units, the Hold status, and the floor-by-floor stacking view.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f, sky;
before(async () => {
  f = await start(); // seed: Green Acres with unitA (Available) and unitB (Booked)
  sky = await models.Project.create({ name: 'Skyline Heights' });
});
after(stop);

const page = async (u, qs = '') => (await as(u).get('/app?page=inventory&project=' + sky._id + qs)).text();
const gen = (u, body) => as(u).post('/app?page=inventory&project=' + sky._id, { action: 'generate_units', project_id: String(sky._id), ...body });

test('a manager adds a whole tower in one go, and running it twice adds nothing new', async () => {
  const r = await gen(f.tlA, { tower: 'A', floor_from: '1', floor_to: '3', per_floor: '2', bhk: '2BHK', base_price: '5000000' });
  assert.equal(r.msg, 'Added 6 units.');
  const units = await models.Unit.find({ project_id: sky._id }).sort('unit_number').lean();
  assert.deepEqual(units.map(u => u.unit_number), ['A-101', 'A-102', 'A-201', 'A-202', 'A-301', 'A-302']);
  assert.equal(units[5].floor, 3);
  assert.equal(units[5].tower, 'A');
  assert.equal(units[5].status, 'Available');
  const again = await gen(f.tlA, { tower: 'A', floor_from: '3', floor_to: '4', per_floor: '2' });
  assert.equal(again.msg, 'Added 2 units; 2 already existed.');
  assert.ok(await models.AuditLog.exists({ entity: 'Unit', 'details.generated': 6 }));
});

test('bad ranges are refused, and agents cannot add units', async () => {
  assert.match((await gen(f.admin, { floor_from: '5', floor_to: '2', per_floor: '4' })).msg, /^Error: Floors must be whole numbers/);
  assert.match((await gen(f.admin, { floor_from: '0', floor_to: '100', per_floor: '20' })).msg, /^Error: That's 2020 units/);
  assert.match((await gen(f.subA, { floor_from: '1', floor_to: '1', per_floor: '1' })).msg, /Forbidden/);
});

test('the stacking view shows each tower top floor first, with counts by status', async () => {
  await gen(f.admin, { tower: 'B', floor_from: '0', floor_to: '0', per_floor: '1' });
  const html = await page(f.admin);
  assert.ok(html.includes('>Tower A</a>') && html.includes('>Tower B</a>'));
  assert.ok(html.indexOf('Floor 4') < html.indexOf('Floor 1'), 'top floor first');
  assert.ok(html.includes('Available · <strong>8</strong>'));
  const b = await page(f.admin, '&tower=B');
  assert.ok(b.includes('>Ground<'));
  assert.ok(b.includes('B-001'));
  assert.ok(!b.includes('A-101'));
  const agent = await (await as(f.subA).get('/app?page=inventory')).text();
  assert.ok(!agent.includes('id="genUnitsModal"'), 'agents are sent to the dashboard');
});

test('Hold keeps a unit for a buyer: it can still be booked, and a booked unit cannot be changed here', async () => {
  const unit = await models.Unit.findOne({ project_id: sky._id, unit_number: 'A-101' });
  const r = await as(f.admin).post('/app?page=inventory&project=' + sky._id + '&tower=A', { action: 'set_unit_status', unit_id: String(unit._id), status: 'Hold' });
  assert.equal(r.msg, 'A-101 is now Hold.');
  assert.match(r.location, /tower=A/, 'back on the same tower');
  const offered = await (await as(f.admin).get('/api/units/' + sky._id)).json();
  assert.ok(offered.some(u => u.unit_number === 'A-101' && u.status === 'Hold'), 'offered when booking');

  const lead = await models.Lead.create({ name: 'Hold Buyer', phone: '9300000001', source_id: f.source._id, assigned_caller_id: f.subA._id, assigned_closer_id: f.subA._id });
  const booked = await as(f.admin).post('/app?page=bookings', {
    action: 'add_booking', lead_id: String(lead._id), unit_id: String(unit._id), closer_id: String(f.subA._id), sale_value: '5000000'
  });
  assert.doesNotMatch(booked.msg, /^Error/, booked.msg);
  assert.equal((await models.Unit.findById(unit._id)).status, 'Booked');

  const back = await as(f.admin).post('/app?page=inventory', { action: 'set_unit_status', unit_id: String(unit._id), status: 'Available' });
  assert.match(back.msg, /^Error: This unit has a booking/);
  assert.match((await as(f.admin).post('/app?page=inventory', { action: 'set_unit_status', unit_id: String(unit._id), status: 'Sold' })).msg, /^Error: Pick Available, Hold or Blocked/);
});

test('the unit form saves tower, floor and phase, and refuses a broken floor', async () => {
  const ok = await as(f.admin).post('/app?page=projects', {
    action: 'add_unit', project_id: String(sky._id), unit_number: 'C-1205', tower: 'C', floor: '12', phase: 'Phase 2', status: 'Blocked'
  });
  assert.equal(ok.msg, 'Unit added.');
  const u = await models.Unit.findOne({ unit_number: 'C-1205' }).lean();
  assert.equal(u.floor, 12);
  assert.equal(u.phase, 'Phase 2');
  assert.equal(u.status, 'Blocked');
  const bad = await as(f.admin).post('/app?page=projects', { action: 'add_unit', project_id: String(sky._id), unit_number: 'C-X', floor: '1.5' });
  assert.match(bad.msg, /^Error: Floor must be a whole number/);
  const projects = await (await as(f.admin).get('/app?page=projects')).text();
  assert.ok(projects.includes('Tower C · Floor 12'));
  assert.ok(projects.includes('page=inventory&amp;project=' + sky._id));
});
