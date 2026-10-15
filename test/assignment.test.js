// Routing new leads to a team by project or source, and bulk lead updates.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');
const { getNextCaller } = require('../services/assignment');

let f;
before(async () => { f = await start(); });
after(stop);
// Seed: subA in Team A, subB in Team B, loose (no team). subA has leadA, subB has leadB.

test('with no team set, new leads go to whoever has the fewest open leads', async () => {
  assert.equal(String(await getNextCaller()), String(f.loose._id), 'loose has 0 leads');
});

test('closed leads do not count as work', async () => {
  // Give loose two closed leads: still the least busy by open leads.
  await models.Lead.create([
    { name: 'Closed 1', phone: '9100000001', source_id: f.source._id, assigned_caller_id: f.loose._id, status: 'Booked' },
    { name: 'Closed 2', phone: '9100000002', source_id: f.source._id, assigned_caller_id: f.loose._id, status: 'Lost' }
  ]);
  assert.equal(String(await getNextCaller()), String(f.loose._id));
});

test('an admin sets a project to Team B and its new leads go to Team B', async () => {
  const res = await as(f.admin).post('/app?page=projects', {
    action: 'update_project', project_id: String(f.project._id), name: 'Green Acres', status: 'Upcoming',
    project_type: 'Other', team_id: String(f.teamB._id)
  });
  assert.equal(res.msg, 'Project updated.');
  const add = await as(f.admin).post('/app?page=leads', {
    action: 'add_lead', name: 'Routed Lead', phone: '9200000001', source_id: String(f.source._id), project_id: String(f.project._id)
  });
  assert.equal(add.msg, 'Lead added.');
  const lead = await models.Lead.findOne({ name: 'Routed Lead' }).lean();
  assert.equal(String(lead.assigned_caller_id), String(f.subB._id));
});

test('a source team applies when the project has none', async () => {
  const src = await models.LeadSource.create({ name: 'Portal A', team_id: f.teamA._id });
  const add = await as(f.admin).post('/app?page=leads', {
    action: 'add_lead', name: 'Source Routed', phone: '9200000002', source_id: String(src._id)
  });
  assert.equal(add.msg, 'Lead added.');
  const lead = await models.Lead.findOne({ name: 'Source Routed' }).lean();
  assert.equal(String(lead.assigned_caller_id), String(f.subA._id));
});

test('a team with no active Sub Team Leaders falls back to everyone', async () => {
  const empty = await models.Team.create({ name: 'Empty Team' });
  const p = await models.Project.create({ name: 'Lonely Towers', team_id: empty._id });
  assert.ok(await getNextCaller({ project_id: p._id }), 'someone still gets the lead');
});

test('a Team Leader cannot change which team a project routes to', async () => {
  await as(f.tlA).post('/app?page=projects', {
    action: 'update_project', project_id: String(f.project._id), name: 'Green Acres', status: 'Upcoming',
    project_type: 'Other', team_id: String(f.teamA._id)
  });
  const p = await models.Project.findById(f.project._id).lean();
  assert.equal(String(p.team_id), String(f.teamB._id), 'unchanged');
});

test('bulk status change updates only the leads the user may edit', async () => {
  const res = await as(f.subA).post('/app?page=leads', {
    action: 'bulk_update_leads', bulk_status: 'Working',
    lead_ids: [String(f.leadA._id), String(f.leadB._id)]
  });
  assert.equal(res.msg, 'Updated 1 lead. 1 skipped (not yours to change).');
  assert.equal((await models.Lead.findById(f.leadA._id).lean()).status, 'Working');
  assert.equal((await models.Lead.findById(f.leadB._id).lean()).status, 'New');
});

test('a manager reassigns several leads at once', async () => {
  const body = new URLSearchParams({ action: 'bulk_update_leads', bulk_caller_id: String(f.subB._id), bulk_status: 'Qualified' });
  body.append('lead_ids', String(f.leadA._id));
  body.append('lead_ids', String(f.leadB._id));
  const res = await as(f.admin).post('/app?page=leads', body);
  assert.equal(res.msg, 'Updated 2 leads.');
  const a = await models.Lead.findById(f.leadA._id).lean();
  assert.equal(String(a.assigned_caller_id), String(f.subB._id));
  assert.equal(a.status, 'Qualified');
  assert.ok(a.qualified_at, 'qualified time stamped');
});

test('a Team Leader cannot bulk-assign leads to another team', async () => {
  const res = await as(f.tlA).post('/app?page=leads', {
    action: 'bulk_update_leads', bulk_caller_id: String(f.subB._id), lead_ids: String(f.leadA._id)
  });
  assert.match(res.msg, /only assign work to your own team/);
});

test('bulk needs a change and at least one lead, and never sets Booked', async () => {
  const none = await as(f.admin).post('/app?page=leads', { action: 'bulk_update_leads', bulk_status: 'Working' });
  assert.match(none.msg, /Select at least one lead/);
  const booked = await as(f.admin).post('/app?page=leads', { action: 'bulk_update_leads', bulk_status: 'Booked', lead_ids: String(f.leadA._id) });
  assert.match(booked.msg, /Choose a new status or agent/);
});

test('the pages show where leads are routed and offer bulk checkboxes', async () => {
  const sources = await (await as(f.admin).get('/app?page=sources')).text();
  assert.match(sources, /Portal A<\/td>[\s\S]*?Team A/);
  const projects = await (await as(f.admin).get('/app?page=projects')).text();
  assert.ok(projects.includes('New leads → Team B'));
  const leads = await (await as(f.admin).get('/app?page=leads')).text();
  assert.ok(leads.includes('name="lead_ids"') && leads.includes('id="bulkLeadForm"'));
});
