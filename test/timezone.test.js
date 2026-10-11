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

test('a report day runs from midnight to midnight IST', () => {
  const { reportRange } = require('../services/reports');
  const r = reportRange({ from: '2030-01-15', to: '2030-01-20' });
  assert.equal(r.from.toISOString(), '2030-01-14T18:30:00.000Z');
  assert.equal(r.to.toISOString(), '2030-01-20T18:29:59.999Z');
  assert.equal(r.fromStr, '2030-01-15');
  assert.equal(r.toStr, '2030-01-20');
  const bad = reportRange({ from: 'junk', to: { $gt: '' } });
  assert.ok(!isNaN(bad.from) && !isNaN(bad.to), 'bad input falls back to the default range');
});

test('reports page and PDF accept a date range', async () => {
  for (const u of [f.superAdmin, f.tlA, f.subA]) {
    const r = await as(u).get('/app?page=reports&from=2030-01-15&to=2030-01-20');
    assert.equal(r.status, 200, u.role + ' reports page');
    const html = await r.text();
    assert.ok(html.includes('2030-01-15') && html.includes('2030-01-20'), 'range shown back as typed');
    const pdf = await as(u).get('/app/report-pdf?from=2030-01-15&to=2030-01-20');
    assert.equal(pdf.status, 200, u.role + ' report PDF');
  }
});
