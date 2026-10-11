// Security regressions from the vibecoding-guide audit (blocks 22, 23, 29).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

test('lead names are HTML-escaped inside Edit button attributes', async () => {
  const html = await (await as(f.superAdmin).get('/app?page=leads')).text();
  assert.ok(html.includes('Anil D&#39;Souza'), 'apostrophe is escaped');
  assert.ok(!/onclick='[^']*D'Souza/.test(html), 'raw apostrophe never lands inside an onclick');
});

test('operator injection in a delete link is refused and deletes nothing', async () => {
  const before = await models.FollowUp.countDocuments();
  const r = await as(f.superAdmin).get('/app?page=leads&delete=1&table=leads&id[$exists]=true');
  assert.equal(r.msg, 'Error: Invalid id');
  assert.equal(await models.FollowUp.countDocuments(), before);
});

test('Team Leader cannot delete a lead in another team', async () => {
  const r = await as(f.tlA).get(`/app?page=leads&delete=1&table=leads&id=${f.leadB._id}`);
  assert.match(r.msg, /^Error: Forbidden/);
  assert.ok(await models.Lead.exists({ _id: f.leadB._id }));
});

test('Team Leader cannot see another team\'s lead timeline or receipt', async () => {
  const tl = as(f.tlA);
  assert.equal((await tl.get(`/api/lead-timeline/${f.leadB._id}`)).status, 403);
  assert.equal((await tl.get(`/api/lead-timeline/${f.leadA._id}`)).status, 200);
  assert.equal((await tl.get(`/app/receipt/${f.bookingB._id}`)).status, 403);
});

test('Sub Team Leader can open their own receipt (was blocked by the retired Closer role)', async () => {
  assert.equal((await as(f.subB).get(`/app/receipt/${f.bookingB._id}`)).status, 200);
});

test('Team Leader cannot complete another team\'s follow-up', async () => {
  const r = await as(f.tlA).post('/app?page=followups', { action: 'complete_followup', followup_id: String(f.fuB._id) });
  assert.match(r.msg, /^Error: Forbidden/);
  assert.equal((await models.FollowUp.findById(f.fuB._id)).status, 'Pending');
});

test('Team Leader cannot pull an agent out of another team', async () => {
  const tl = as(f.tlA);
  const r = await tl.post('/app?page=teams', { action: 'assign_team_member', user_id: String(f.subB._id), team_id: String(f.teamA._id) });
  assert.match(r.msg, /own team/);
  assert.equal(String((await models.User.findById(f.subB._id)).team_id), String(f.teamB._id));

  const ok = await tl.post('/app?page=teams', { action: 'assign_team_member', user_id: String(f.loose._id), team_id: String(f.teamA._id) });
  assert.equal(ok.msg, 'Team member assigned.');
});

test('Team Leader cannot assign their lead to someone outside the team', async () => {
  const r = await as(f.tlA).post('/app?page=leads', {
    action: 'update_lead', lead_id: String(f.leadA._id), name: f.leadA.name, phone: f.leadA.phone,
    assigned_caller_id: String(f.subB._id), assigned_closer_id: ''
  });
  assert.match(r.msg, /your own team/);
  assert.equal(String((await models.Lead.findById(f.leadA._id)).assigned_caller_id), String(f.subA._id));
});

test('Super Admin can save settings', async () => {
  const r = await as(f.superAdmin).post('/app?page=settings', { action: 'save_settings', company_name: 'Acme Realty' });
  assert.equal(r.msg, 'Settings saved.');
});

test('chat only searches leads the user can see', async () => {
  const mine = await (await as(f.subA).postJson('/api/chat', { message: '/search a' })).json();
  assert.match(mine.reply, /Anil/);
  assert.doesNotMatch(mine.reply, /Bina/);
  const regex = await (await as(f.subA).postJson('/api/chat', { message: '/search (.*' })).json();
  assert.match(regex.reply, /No leads found/);
});
