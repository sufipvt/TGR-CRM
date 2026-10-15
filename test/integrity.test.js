// Data stays right as the company grows: two people editing one lead, a follow-ups
// page that doesn't load years of history, one digest a day, no password hashes loaded.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');
const { claimDigestDay } = require('../services/digest');

let f;
before(async () => { f = await start(); }); // seed: leadA (caller subA), fuA, fuB
after(stop);

const editBody = (lead, changes) => ({
  action: 'update_lead', lead_id: String(lead._id), name: lead.name, phone: lead.phone,
  source_id: String(lead.source_id), status: lead.status, assigned_caller_id: String(lead.assigned_caller_id || ''),
  updated_at: lead.updated_at ? String(new Date(lead.updated_at).getTime()) : '', ...changes
});

test('the second of two people editing the same lead is told, instead of wiping the first', async () => {
  const opened = await models.Lead.findById(f.leadA._id).lean(); // both open the edit form now
  assert.ok(opened.updated_at, 'leads carry updated_at');
  const first = await as(f.admin).post('/app?page=leads', editBody(opened, { city: 'Pune' }));
  assert.equal(first.msg, 'Lead updated.');
  const second = await as(f.subA).post('/app?page=leads', editBody(opened, { city: 'Goa' }));
  assert.match(second.msg, /^Error: Someone else changed this lead/);
  assert.equal((await models.Lead.findById(f.leadA._id).lean()).city, 'Pune', 'the first save is kept');

  const reopened = await models.Lead.findById(f.leadA._id).lean();
  const retry = await as(f.subA).post('/app?page=leads', editBody(reopened, { city: 'Goa' }));
  assert.equal(retry.msg, 'Lead updated.', 'saving again after reopening works');
});

test('a lead from before this change (no updated_at) still saves', async () => {
  await models.Lead.collection.updateOne({ _id: f.leadB._id }, { $unset: { updated_at: '' } });
  const lead = await models.Lead.findById(f.leadB._id).lean();
  const res = await as(f.admin).post('/app?page=leads', editBody(lead, { city: 'Delhi' }));
  assert.equal(res.msg, 'Lead updated.');
});

test('the edit button carries the lead version and the form sends it', async () => {
  const html = await (await as(f.admin).get('/app?page=leads')).text();
  assert.ok(html.includes('name="updated_at" id="leadVersion"'));
  assert.match(html, /updated_at&#34;:&#34;\d{13}&#34;/);
});

test('the follow-ups page shows every pending one but only recent finished ones', async () => {
  const old = new Date(); old.setDate(old.getDate() - 90);
  const base = { lead_id: f.leadA._id, assigned_to_id: f.subA._id, scheduled_date: old };
  await models.FollowUp.create([
    { ...base, status: 'Pending', notes: 'old but still pending' },
    { ...base, status: 'Completed', completed_date: old, notes: 'finished long ago' }
  ]);
  const html = await (await as(f.admin).get('/app?page=followups')).text();
  assert.ok(html.includes('old but still pending'));
  assert.ok(!html.includes('finished long ago'));
  assert.ok(html.includes('Completed / Other (last 30 days)'));
  assert.ok(html.includes('lead_label&#34;:&#34;Anil D&#39;Souza (9000000001)'), 'edit keeps the lead name for the picker');
});

test('the morning digest is claimed once per day, however many servers run it', async () => {
  const results = await Promise.all([claimDigestDay('2030-01-01'), claimDigestDay('2030-01-01'), claimDigestDay('2030-01-01')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await claimDigestDay('2030-01-02'), true, 'the next day can be claimed');
});

test('password hashes are never loaded along with a user', async () => {
  const u = await models.User.findById(f.admin._id).lean();
  assert.equal(u.password, undefined);
  const withIt = await models.User.findById(f.admin._id).select('+password').lean();
  assert.ok(withIt.password);
  const lead = await models.Lead.findById(f.leadA._id).populate('assigned_caller_id').lean();
  assert.equal(lead.assigned_caller_id.password, undefined);
});
