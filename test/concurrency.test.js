// Ten people using the CRM at once: requests that arrive together must not
// double-save, overpay, lose notes, or lock out a whole office sharing one address.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models, baseUrl } = require('./helpers');
const { clearSettingsCache } = require('../services/settings');

let f;
const key = 'c'.repeat(48);
before(async () => {
  f = await start(); // seed: leadA 9000000001 (caller subA), bookingB sale value 50 lakh (closer subB)
  for (const [k, value] of [['capture_webhook_enabled', '1'], ['capture_webhook_key', key]]) {
    await models.Setting.findOneAndUpdate({ key: k }, { key: k, value }, { upsert: true });
  }
  clearSettingsCache();
});
after(stop);

const capture = body => fetch(baseUrl() + '/api/leads/capture', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body)
});

test('the same buyer sent five times at once makes one lead', async () => {
  const res = await Promise.all(Array.from({ length: 5 }, () => capture({ name: 'Ravi Twice', phone: '9777700001' })));
  assert.ok(res.every(r => r.ok), 'every request accepted');
  assert.equal(await models.Lead.countDocuments({ phone: '9777700001' }), 1);
});

test('enquiries arriving together are shared between agents', async () => {
  const phones = Array.from({ length: 6 }, (_, i) => '97777100' + String(i).padStart(2, '0'));
  await Promise.all(phones.map((phone, i) => capture({ name: 'Buyer ' + i, phone })));
  const leads = await models.Lead.find({ phone: { $in: phones } }).lean();
  assert.equal(leads.length, 6);
  const perAgent = {};
  for (const l of leads) perAgent[l.assigned_caller_id] = (perAgent[l.assigned_caller_id] || 0) + 1;
  assert.ok(Object.keys(perAgent).length >= 2, 'not all to one agent: ' + JSON.stringify(perAgent));
});

test('two people saving the same phone at once make one lead', async () => {
  const body = { action: 'add_lead', name: 'Meena Same', phone: '9777700002', source_id: String(f.source._id), assigned_caller_id: String(f.subA._id) };
  const res = await Promise.all([as(f.admin).post('/app?page=leads', body), as(f.superAdmin).post('/app?page=leads', body)]);
  assert.equal(await models.Lead.countDocuments({ phone: '9777700002' }), 1);
  assert.equal(res.filter(r => r.msg === 'Lead added.').length, 1);
  assert.ok(res.some(r => /already belongs to/.test(r.msg || '')), 'the second one is told it is a duplicate');
});

test('repeat enquiries at the same moment all keep their message', async () => {
  const before = await models.Lead.findById(f.leadA._id).lean();
  await Promise.all(Array.from({ length: 5 }, (_, i) => capture({ name: 'Anil', phone: '9000000001', notes: 'message ' + i })));
  const lead = await models.Lead.findById(f.leadA._id).lean();
  for (let i = 0; i < 5; i++) assert.ok(lead.notes.includes('message ' + i), 'kept message ' + i);
  assert.equal((lead.enquiry_count || 0) - (before.enquiry_count || 0), 5);
});

test('payments sent together cannot add up to more than the sale value', async () => {
  const pay = () => as(f.admin).post('/app?page=bookings', { action: 'add_payment', booking_id: String(f.bookingB._id), amount: '2000000' });
  const res = await Promise.all([pay(), pay(), pay(), pay()]);
  const total = (await models.Payment.find({ booking_id: f.bookingB._id }).lean()).reduce((s, p) => s + p.amount, 0);
  assert.ok(total <= 5000000, 'paid ' + total);
  assert.equal(res.filter(r => r.msg === 'Payment recorded.').length, 2);
  const bad = await as(f.admin).post('/app?page=bookings', { action: 'add_payment', booking_id: String(f.bookingB._id), amount: 'abc' });
  assert.match(bad.msg, /Amount must be positive/);
});

test('a demoted Team Leader loses team-wide access straight away', async () => {
  await models.Notification.deleteMany({}); // the bell would still name the lead from earlier alerts
  const page = async () => (await as(f.tlA).get('/app?page=leads')).text();
  assert.ok((await page()).includes('Anil D'), 'sees the team lead while leader');
  const res = await as(f.superAdmin).post('/app?page=teams', {
    action: 'update_team', team_id: String(f.teamA._id), name: 'Team A', team_leader_id: String(f.subA._id)
  });
  assert.equal(res.status, 302);
  assert.ok(!(await page()).includes('Anil D'), 'no longer sees subA\'s lead');
});

test('one busy person does not use up the allowance of everyone in the office', async () => {
  const busy = as(f.subB);
  let limited = false;
  for (let round = 0; round < 13 && !limited; round++) {
    const res = await Promise.all(Array.from({ length: 50 }, () => busy.get('/api/notifications')));
    limited = res.some(r => r.status === 429);
  }
  assert.ok(limited, 'the busy person is eventually slowed down');
  assert.equal((await as(f.loose).get('/api/notifications')).status, 200, 'a colleague on the same address is not');
});

test('a form with a missing field or a broken id shows a message, not the error page', async () => {
  const missing = await as(f.admin).post('/app?page=leads', { action: 'add_lead', name: 'No Source', phone: '9777700003' });
  assert.equal(missing.status, 302);
  assert.match(missing.msg, /^Error: Please fill in: source\./);
  const broken = await as(f.admin).post('/app?page=leads', { action: 'update_lead', lead_id: 'not-an-id', name: 'X', phone: '9777700004' });
  assert.equal(broken.status, 302);
  assert.match(broken.msg, /^Error: /);
});
