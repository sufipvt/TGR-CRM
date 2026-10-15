// Site visits: marking one done asks how it went (a no-show marks it Missed), and
// Reports sums visits, show-ups, outcomes and bookings after a visit per agent.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');
const { SITE_VISIT_OUTCOMES } = require('../config/constants');
const { siteVisitReport } = require('../services/reports');

let f;
before(async () => { f = await start(); }); // leadA/subA (Team A), leadB/subB (Team B)
after(stop);

const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
const visitFor = (lead, user) => models.FollowUp.create({ lead_id: lead._id, assigned_to_id: user._id, scheduled_date: hourAgo(), type: 'Site Visit' });
const complete = (user, fu, extra = {}) => as(user).post('/app?page=followups', { action: 'complete_followup', followup_id: String(fu._id), ...extra });

test('the Done popup offers the same visit outcomes the server accepts', async () => {
  const html = await (await as(f.subA).get('/app?page=followups')).text();
  const offered = [...html.matchAll(/<option value="([^"]+)">\1<\/option>/g)].map(m => m[1]).filter(v => SITE_VISIT_OUTCOMES.includes(v));
  assert.deepEqual(offered, SITE_VISIT_OUTCOMES);
  assert.ok(html.includes('id="completeFuVisit"'));
});

test('a site visit cannot be marked done without saying how it went', async () => {
  const v = await visitFor(f.leadA, f.subA);
  for (const extra of [{}, { visit_outcome: 'Loved it!!' }]) {
    const res = await complete(f.subA, v, extra);
    assert.equal(res.msg, 'Error: Pick how the site visit went.');
  }
  assert.equal((await models.FollowUp.findById(v._id).lean()).status, 'Pending');

  const ok = await complete(f.subA, v, { visit_outcome: 'Interested', outcome: 'Liked the corner flat' });
  assert.equal(ok.msg, 'Site visit recorded: Interested.');
  const done = await models.FollowUp.findById(v._id).lean();
  assert.equal(done.status, 'Completed');
  assert.equal(done.visit_outcome, 'Interested');
  assert.equal(done.outcome, 'Liked the corner flat');
});

test('a no-show marks the visit Missed', async () => {
  const v = await visitFor(f.leadA, f.subA);
  const res = await complete(f.subA, v, { visit_outcome: 'No show' });
  assert.equal(res.msg, 'Site visit marked as a no-show.');
  const missed = await models.FollowUp.findById(v._id).lean();
  assert.equal(missed.status, 'Missed');
  assert.equal(missed.visit_outcome, 'No show');
});

test('ordinary calls still complete without a visit outcome', async () => {
  const res = await complete(f.subA, f.fuA);
  assert.equal(res.msg, 'Follow-up completed.');
  assert.equal((await models.FollowUp.findById(f.fuA._id).lean()).visit_outcome, undefined);
});

test('another team cannot record someone else\'s visit', async () => {
  const v = await visitFor(f.leadA, f.subA);
  const res = await complete(f.subB, v, { visit_outcome: 'Interested' });
  assert.match(res.msg, /^Error: /);
  assert.equal((await models.FollowUp.findById(v._id).lean()).status, 'Pending');
});

test('the report counts visits, show-ups, outcomes and bookings after a visit', async () => {
  const vb = await visitFor(f.leadB, f.subB);
  await complete(f.subB, vb, { visit_outcome: 'Interested' });
  await models.Lead.updateOne({ _id: f.leadB._id }, { status: 'Booked' });

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000), to = new Date();
  const all = await siteVisitReport({}, from, to);
  // subA: Interested, No show, one still pending; subB: Interested and booked
  assert.deepEqual(
    { scheduled: all.total.scheduled, done: all.total.done, no_show: all.total.no_show, pending: all.total.pending, booked: all.total.booked },
    { scheduled: 4, done: 2, no_show: 1, pending: 1, booked: 1 }
  );
  assert.equal(all.total.show_rate, 67);
  assert.equal(all.total.booking_rate, 50);
  assert.deepEqual(all.outcomes, { Interested: 2, 'No show': 1 });
  const sid = all.agents.find(a => a.name === 'Sid SubA');
  assert.deepEqual([sid.scheduled, sid.done, sid.no_show, sid.interested, sid.booked], [3, 1, 1, 1, 0]);

  const admin = await (await as(f.admin).get('/app?page=reports')).text();
  assert.ok(admin.includes('id="siteVisitReport"'));
  assert.ok(admin.includes('Booked after a visit · 50%'));
});

test('a Sub Team Leader\'s report shows only their own visits', async () => {
  const html = await (await as(f.subA).get('/app?page=reports')).text();
  const section = html.slice(html.indexOf('id="siteVisitReport"'), html.indexOf('Team Performance'));
  assert.ok(section.includes('Sid SubA'));
  assert.ok(!section.includes('Bea SubB'));
});
