// The Super Admin "Fix old follow-up times" button (one-time India time fix).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f, oldFu;
before(async () => {
  f = await start();
  // Saved by the old UTC server: typed 10:00, stored as 10:00Z
  [oldFu] = await models.FollowUp.insertMany([{
    lead_id: f.leadA._id, assigned_to_id: f.subA._id,
    scheduled_date: new Date('2026-10-20T10:00:00Z'), created_at: new Date('2026-10-01T09:00:00Z')
  }]);
});
after(stop);

const settings = async u => (await as(u).get('/app?page=settings')).text();

test('only the Super Admin sees and can use the button', async () => {
  assert.ok((await settings(f.superAdmin)).includes('Fix old follow-up times'));
  assert.ok(!(await settings(f.admin)).includes('Fix old follow-up times'));
  const r = await as(f.admin).post('/app?page=settings', { action: 'fix_followup_times' });
  assert.match(r.msg, /^Error: Forbidden/);
  const still = await models.FollowUp.findById(oldFu._id);
  assert.equal(still.scheduled_date.toISOString(), '2026-10-20T10:00:00.000Z');
});

test('fixes old follow-ups once and leaves new ones alone', async () => {
  const newFu = await models.FollowUp.findById(f.fuA._id);
  const r = await as(f.superAdmin).post('/app?page=settings', { action: 'fix_followup_times' });
  assert.equal(r.msg, 'Fixed 1 follow-up time. They now show India time.');
  const fixed = await models.FollowUp.findById(oldFu._id);
  assert.equal(fixed.scheduled_date.toISOString(), '2026-10-20T04:30:00.000Z', 'now 10:00 IST');
  const untouched = await models.FollowUp.findById(f.fuA._id);
  assert.equal(untouched.scheduled_date.getTime(), newFu.scheduled_date.getTime());

  const again = await as(f.superAdmin).post('/app?page=settings', { action: 'fix_followup_times' });
  assert.equal(again.msg, 'Nothing to fix. All follow-up times are already correct.');
  assert.equal((await models.FollowUp.findById(oldFu._id)).scheduled_date.toISOString(), '2026-10-20T04:30:00.000Z');
  assert.ok(!(await settings(f.superAdmin)).includes('Fix old follow-up times'), 'box gone once done');
});
