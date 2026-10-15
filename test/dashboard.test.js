// The dashboard's Today panel: calls due, new uncalled leads, hot leads and site
// visits, each limited to what the viewer may see, with actions in one tap.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f;
before(async () => { f = await start(); }); // seed: leadA/fuA for subA (Team A), leadB/fuB for subB
after(stop);

const dash = async user => (await (await as(user).get('/app?page=dashboard')).text());
const tabCount = (html, label) => Number((html.match(new RegExp(label + ' <span class="badge [^"]+">(\\d+)<')) || [])[1]);

test('a Sub Team Leader sees only their own calls and new leads, with call buttons', async () => {
  const html = await dash(f.subA);
  assert.equal(tabCount(html, 'Calls due'), 1);
  assert.equal(tabCount(html, 'New, not called'), 1);
  assert.ok(html.includes('Anil D&#39;Souza'));
  assert.ok(!html.includes('Bina Rao'), 'other team hidden');
  assert.ok(html.includes('href="tel:+919000000001"'));
  assert.ok(html.includes('https://wa.me/919000000001?text='));
  assert.ok(html.includes(`onclick="tgCompleteFollowup('${f.fuA._id}')"`));
});

test('an admin sees everyone, with who owns each call', async () => {
  const html = await dash(f.admin);
  assert.equal(tabCount(html, 'Calls due'), 2);
  assert.ok(html.includes('Anil D&#39;Souza') && html.includes('Bina Rao'));
  assert.ok(html.includes('Sid SubA') && html.includes('Bea SubB'));
});

test('hot leads and today\'s site visits get their own lists and a Hot KPI', async () => {
  await models.Lead.updateOne({ _id: f.leadA._id }, { temperature: 'Hot' });
  const visit = new Date(); visit.setHours(23, 0, 0, 0);
  await models.FollowUp.create({ lead_id: f.leadA._id, assigned_to_id: f.subA._id, scheduled_date: visit, type: 'Site Visit' });
  const html = await dash(f.subA);
  assert.equal(tabCount(html, 'Hot leads'), 1);
  assert.equal(tabCount(html, 'Site visits today'), 1);
  assert.match(html, /Hot Leads<\/div>\s*<div class="tg-kpi-value">1</);
  assert.ok(html.includes('href="/app?page=leads&amp;temperature=Hot"'), 'KPI links to the filtered list');

  await models.Lead.updateOne({ _id: f.leadA._id }, { status: 'Lost' });
  assert.equal(tabCount(await dash(f.subA), 'Hot leads'), 0, 'closed leads drop off');
  await models.Lead.updateOne({ _id: f.leadA._id }, { status: 'New' });
});

test('a logged call takes the lead off "New, not called"', async () => {
  await models.Lead.updateOne({ _id: f.leadA._id }, { contact_outcome: 'Interested' });
  assert.equal(tabCount(await dash(f.subA), 'New, not called'), 0);
});

test('Done on the dashboard completes the call and comes back to the dashboard', async () => {
  const denied = await as(f.subB).post('/app?page=dashboard', { action: 'complete_followup', followup_id: String(f.fuA._id) });
  assert.match(denied.msg, /^Error: /);
  const res = await as(f.subA).post('/app?page=dashboard', { action: 'complete_followup', followup_id: String(f.fuA._id), outcome: 'Spoke, visiting Sunday' });
  assert.equal(res.msg, 'Follow-up completed.');
  assert.match(res.location, /page=dashboard/);
  assert.equal((await models.FollowUp.findById(f.fuA._id).lean()).status, 'Completed');
});

test('quick buttons open the right form on each page', async () => {
  const html = await dash(f.tlA);
  for (const link of ['/app?page=leads#new', '/app?page=followups#new', '/app?page=bookings#new', '/app?page=leads#import']) {
    assert.ok(html.includes(link), link);
  }
  assert.ok((await (await as(f.tlA).get('/app?page=leads')).text()).includes('data-quick="new"'));
  assert.ok((await (await as(f.tlA).get('/app?page=followups')).text()).includes('data-quick="new"'));
  assert.ok((await (await as(f.tlA).get('/app?page=bookings')).text()).includes('data-quick="new"'));
});
