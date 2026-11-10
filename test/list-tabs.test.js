// Follow-ups and Bookings: status tabs with counts that keep each role's scoping.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

const get = async (user, page) => (await as(user).get('/app?page=' + page)).text();
const count = (html, tab) => Number((html.match(new RegExp('data-tab="' + tab + '"[^>]*>[^<]*<span class="tg-tab-count">(\\d+)<')) || [])[1]);

test('follow-ups open on the first tab with work, and Overdue is flagged', async () => {
  let html = await get(f.subA, 'followups');
  assert.equal(count(html, 'today'), 1);
  assert.equal(count(html, 'overdue'), 0);
  assert.match(html, /data-tab="today" class="active"/);
  assert.match(html, /data-tab-panel="overdue" aria-label="Overdue" hidden/);
  assert.ok(html.includes('/list-tabs.js'));

  await models.FollowUp.create({ lead_id: f.leadA._id, assigned_to_id: f.subA._id, scheduled_date: new Date(Date.now() - 3 * 86400000), notes: 'late one' });
  html = await get(f.subA, 'followups');
  assert.equal(count(html, 'overdue'), 1);
  assert.match(html, /data-tab="overdue" class="active tg-tab-alert"/);
  assert.match(html, /data-tab-panel="today" aria-label="Today" hidden/);
  assert.ok(html.includes('late one'));
  assert.ok(html.includes('tg-overdue'));

  const other = await get(f.subB, 'followups');
  assert.ok(!other.includes('late one'), 'another user never sees it');
  assert.equal(count(other, 'overdue'), 0);
});

test('bookings tabs count by status and keep team scoping', async () => {
  const status = (await models.Booking.findById(f.bookingB._id).lean()).status;
  const html = await get(f.admin, 'bookings');
  assert.equal(count(html, ''), 1, 'All');
  assert.equal(count(html, status), 1);
  assert.ok(html.includes('id="bookingStatusFilter"'), 'the tabs drive the existing filter');
  assert.ok(html.includes('tg-chip-bk-' + status.toLowerCase()));
  const tl = await get(f.tlA, 'bookings');
  assert.equal(count(tl, ''), 0, 'Team Leader A does not count team B\'s booking');
  assert.ok(!(await get(f.admin, 'dashboard')).includes('/list-tabs.js'));
});
