// The bell: captured leads alert the people who may see them, and a repeat
// enquiry puts the existing lead back on top instead of hiding in its notes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models, baseUrl } = require('./helpers');
const { clearSettingsCache } = require('../services/settings');

let f;
before(async () => {
  f = await start(); // seed: leadA 9000000001 (caller subA, Team A led by tlA)
  await models.Setting.findOneAndUpdate({ key: 'capture_form_enabled' }, { key: 'capture_form_enabled', value: '1' }, { upsert: true });
  clearSettingsCache();
});
after(stop);

const enquire = body => fetch(baseUrl() + '/enquire', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString()
});
const notesFor = user => models.Notification.find({ user_id: user._id }).lean();

test('a new enquiry alerts its assigned agent and the admins, nobody else', async () => {
  assert.equal((await enquire({ name: 'Nora New', phone: '9555500001' })).status, 200);
  const lead = await models.Lead.findOne({ phone: '9555500001' }).lean();
  assert.ok(lead.assigned_caller_id, 'assigned automatically');
  assert.ok(lead.listed_at, 'has a list position');

  for (const u of [f.admin, f.superAdmin]) {
    const n = await notesFor(u);
    assert.equal(n.length, 1, u.full_name + ' alerted');
    assert.equal(n[0].kind, 'new_lead');
    assert.equal(n[0].title, 'New lead: Nora New');
    assert.equal(n[0].link, '/app?page=leads&q=9555500001');
  }
  assert.equal((await notesFor({ _id: lead.assigned_caller_id })).length, 1, 'agent alerted');
  for (const u of [f.subA, f.subB, f.loose]) {
    if (String(u._id) === String(lead.assigned_caller_id)) continue;
    assert.equal((await notesFor(u)).length, 0, u.full_name + ' not alerted');
  }
});

test('a repeat enquiry bumps the existing lead and alerts its owners', async () => {
  const before = await models.Lead.findById(f.leadA._id).lean();
  assert.equal((await enquire({ name: 'Anil again', phone: '+91 90000 00001', message: 'Still keen' })).status, 200);
  assert.equal(await models.Lead.countDocuments({ phone: /9000000001/ }), 1, 'no second lead');

  const a = await models.Lead.findById(f.leadA._id).lean();
  assert.equal(a.enquiry_count, 1);
  assert.ok(a.last_enquiry_at);
  assert.ok(a.listed_at > (before.listed_at || before.created_at), 'moved up');
  assert.match(a.notes, /Enquired again via enquiry form: Still keen/);

  for (const u of [f.subA, f.tlA, f.admin, f.superAdmin]) {
    const n = (await notesFor(u)).filter(x => x.kind === 'repeat_enquiry');
    assert.equal(n.length, 1, u.full_name + ' alerted');
    assert.equal(n[0].title, "Anil D'Souza enquired again");
  }
  for (const u of [f.subB, f.loose]) {
    assert.equal((await notesFor(u)).filter(x => x.kind === 'repeat_enquiry').length, 0, u.full_name + ' not alerted');
  }
});

test('the re-enquired lead tops the list with a badge', async () => {
  const html = await (await as(f.admin).get('/app?page=leads')).text();
  const anil = html.indexOf('"fw-medium">Anil D&#39;Souza</div>');
  const nora = html.indexOf('"fw-medium">Nora New</div>');
  assert.ok(anil > 0 && nora > 0, 'both listed');
  assert.ok(anil < nora, 'repeat enquiry above the newer lead');
  assert.ok(html.includes('Re-enquired'));
});

test('each user reads and clears only their own alerts', async () => {
  const mine = await (await as(f.subA).get('/api/notifications')).json();
  assert.ok(mine.unread >= 1);
  assert.ok(mine.items.some(n => n.title === "Anil D'Souza enquired again" && n.link.startsWith('/app?page=leads&q=')));

  const other = await (await as(f.subB).get('/api/notifications')).json();
  assert.ok(!other.items.some(n => n.title.includes('Anil')), 'subB sees nothing about Team A');

  const adminBefore = (await (await as(f.admin).get('/api/notifications')).json()).unread;
  const res = await as(f.subA).postJson('/api/notifications/read', {});
  assert.equal(res.status, 200);
  assert.equal((await (await as(f.subA).get('/api/notifications')).json()).unread, 0);
  assert.equal((await (await as(f.admin).get('/api/notifications')).json()).unread, adminBefore, 'admin untouched');
});

test('the top bar shows the bell with the unread count', async () => {
  const html = await (await as(f.admin).get('/app?page=dashboard')).text();
  assert.match(html, /id="tgBellCount" >2</);
  assert.ok(html.includes('Anil D&#39;Souza enquired again'));
  assert.ok(html.includes('/notify.js?v='));
});
