// Project unit counts come from the units themselves once a project has any.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

const projectsPage = async () => (await as(f.admin).get('/app?page=projects')).text();

test('a project with units shows counts from its units, not the typed numbers', async () => {
  // Seed: Green Acres has A-101 Available and B-201 Booked. Typed numbers disagree.
  await models.Project.updateOne({ _id: f.project._id }, { total_units: 40, available_units: 33 });
  const html = await projectsPage();
  assert.match(html, /1\/2 units available/);
  assert.ok(!html.includes('33/40'), 'typed numbers are not shown');
});

test('booking-style status changes move the count with no manual edit', async () => {
  await models.Unit.updateOne({ _id: f.unitA._id }, { status: 'Sold' });
  assert.match(await projectsPage(), /0\/2 units available/);
  await models.Unit.create({ project_id: f.project._id, unit_number: 'C-301' });
  assert.match(await projectsPage(), /1\/3 units available/);
});

test('a project with no units keeps the hand-typed numbers', async () => {
  await models.Project.create({ name: 'Blue Hills', total_units: 12, available_units: 5 });
  assert.match(await projectsPage(), /5\/12 units available/);
});

test('saving a project whose count fields are locked keeps its stored numbers', async () => {
  const res = await as(f.admin).post('/app?page=projects', {
    action: 'update_project', project_id: String(f.project._id), name: 'Green Acres', status: 'Upcoming', project_type: 'Other'
  });
  assert.equal(res.msg, 'Project updated.');
  const p = await models.Project.findById(f.project._id).lean();
  assert.equal(p.total_units, 40);
  assert.equal(p.available_units, 33);
});

test('typed counts still save for a project without units', async () => {
  const p = await models.Project.findOne({ name: 'Blue Hills' });
  await as(f.admin).post('/app?page=projects', {
    action: 'update_project', project_id: String(p._id), name: 'Blue Hills', status: 'Upcoming',
    project_type: 'Other', total_units: '20', available_units: '7'
  });
  assert.match(await projectsPage(), /7\/20 units available/);
});
