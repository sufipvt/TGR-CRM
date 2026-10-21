// Phone-first: installable app, Call / WhatsApp buttons on every list, and the
// "how did the call go?" log that closes the follow-up and books the next call.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models, baseUrl } = require('./helpers');
const { phoneLinks } = require('../utils/format');

let f;
before(async () => { f = await start(); }); // seed: leadA (caller subA) with fuA due today for subA; leadB is subB's
after(stop);

test('the app can be installed: manifest, icons, service worker and offline page', async () => {
  const res = await fetch(baseUrl() + '/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  const m = await res.json();
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/app?page=dashboard');
  for (const icon of m.icons) {
    const img = await fetch(baseUrl() + icon.src);
    assert.equal(img.status, 200, icon.src);
    assert.match(img.headers.get('content-type'), /image\/png/);
  }
  assert.ok(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.equal((await fetch(baseUrl() + '/sw.js')).status, 200);
  assert.match(await (await fetch(baseUrl() + '/offline.html')).text(), /You're offline/);
  const page = await (await as(f.subA).get('/app?page=dashboard')).text();
  assert.ok(page.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  assert.ok(page.includes('/phone.js?v='));
  assert.ok(page.includes('id="tgInstallApp" hidden'));
  const login = await (await fetch(baseUrl() + '/login')).text();
  assert.ok(login.includes('rel="manifest"'), 'installable from the sign-in page too');
});

test('phone numbers become call and WhatsApp links with +91 for Indian numbers', () => {
  assert.deepEqual(phoneLinks('98765 43210'), { tel: 'tel:+919876543210', wa: 'https://wa.me/919876543210' });
  assert.equal(phoneLinks('098765 43210').tel, 'tel:+919876543210');
  assert.equal(phoneLinks('+44 20 7946 0958').wa, 'https://wa.me/442079460958');
  assert.deepEqual(phoneLinks(''), { tel: '', wa: '' });
});

test('leads, follow-ups and today all have Call and WhatsApp buttons that ask for the outcome', async () => {
  for (const p of ['dashboard', 'leads', 'followups']) {
    const html = await (await as(f.subA).get('/app?page=' + p)).text();
    assert.ok(html.includes('href="tel:+919000000001"'), p + ' has a Call button');
    assert.ok(html.includes('href="https://wa.me/919000000001?text='), p + ' has a WhatsApp button');
    assert.ok(html.includes('data-log-call="' + f.leadA._id + '"'), p + ' asks how the call went');
    assert.ok(html.includes('id="callLogModal"'), p + ' has the call log form');
  }
});

test('logging a call records the outcome, closes the due call and books the next one', async () => {
  const next = new Date(Date.now() + 2 * 86400e3); next.setHours(11, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  const nextLocal = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T11:00`;
  const res = await as(f.subA).post('/app?page=dashboard', {
    action: 'log_call', lead_id: String(f.leadA._id), via: 'Call', contact_outcome: 'Requested Callback',
    note: 'Wants pricing for 3 BHK', next_at: nextLocal
  });
  assert.match(res.msg, /^Call logged: Requested Callback\. Follow-up marked done\. Next call /);
  const lead = await models.Lead.findById(f.leadA._id).lean();
  assert.equal(lead.contact_outcome, 'Requested Callback');
  assert.match(lead.notes, /Call by Sid SubA: Requested Callback \(Wants pricing for 3 BHK\)$/);
  const fuA = await models.FollowUp.findById(f.fuA._id).lean();
  assert.equal(fuA.status, 'Completed');
  assert.equal(fuA.outcome, 'Requested Callback: Wants pricing for 3 BHK');
  const booked = await models.FollowUp.findOne({ lead_id: f.leadA._id, status: 'Pending' }).lean();
  assert.equal(booked.scheduled_date.getTime(), next.getTime());
  assert.equal(String(booked.assigned_to_id), String(f.subA._id));
});

test('a WhatsApp log works without a call-back time and keeps earlier notes', async () => {
  await models.Lead.updateOne({ _id: f.leadA._id }, { notes: 'Met at the expo' });
  const res = await as(f.subA).post('/app?page=leads', { action: 'log_call', lead_id: String(f.leadA._id), via: 'WhatsApp', contact_outcome: 'Interested' });
  assert.equal(res.msg, 'WhatsApp logged: Interested.');
  const lead = await models.Lead.findById(f.leadA._id).lean();
  assert.match(lead.notes, /^Met at the expo\n\[.*\] WhatsApp by Sid SubA: Interested$/);
});

test('a call log is refused for someone else\'s lead, a made-up outcome, or a call-back in the past', async () => {
  const other = await as(f.subA).post('/app?page=leads', { action: 'log_call', lead_id: String(f.leadB._id), contact_outcome: 'Interested' });
  assert.match(other.msg, /^Error: /);
  assert.equal((await models.Lead.findById(f.leadB._id).lean()).contact_outcome, undefined);
  const bad = await as(f.subA).post('/app?page=leads', { action: 'log_call', lead_id: String(f.leadA._id), contact_outcome: 'Bribed' });
  assert.match(bad.msg, /Pick how the call went/);
  const past = await as(f.subA).post('/app?page=leads', { action: 'log_call', lead_id: String(f.leadA._id), contact_outcome: 'Not Reachable', next_at: '2020-01-01T10:00' });
  assert.match(past.msg, /call-back time in the future/);
  assert.equal((await models.Lead.findById(f.leadA._id).lean()).contact_outcome, 'Interested', 'nothing saved from the refused log');
});
