// The app runs on business time (Asia/Kolkata), not the server's UTC clock.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

test('a follow-up typed as 10:00 is stored as 10:00 IST and edits back as 10:00', async () => {
  const r = await as(f.subA).post('/app?page=followups', {
    action: 'add_followup', lead_id: String(f.leadA._id), scheduled_date: '2030-01-15T10:00', type: 'Call'
  });
  assert.equal(r.msg, 'Follow-up scheduled.');
  const fu = await models.FollowUp.findOne({ lead_id: f.leadA._id }).sort('-created_at');
  assert.equal(fu.scheduled_date.toISOString(), '2030-01-15T04:30:00.000Z');

  const html = await (await as(f.subA).get('/app?page=followups')).text();
  assert.ok(html.includes('2030-01-15T10:00'), 'edit form is pre-filled with the IST time');
});
