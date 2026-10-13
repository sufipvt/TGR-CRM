// Leads page: search, filters and paging run in the database and keep team scoping.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f;
before(async () => {
  f = await start();
  const rows = [];
  for (let i = 1; i <= 60; i++) {
    rows.push({ name: 'Bulk Lead ' + String(i).padStart(2, '0'), phone: '98' + String(i).padStart(8, '0'),
      source_id: f.source._id, assigned_caller_id: f.subA._id, status: i <= 5 ? 'Qualified' : 'New',
      created_at: new Date(Date.UTC(2030, 0, 1) + i * 60000) });
  }
  await models.Lead.insertMany(rows);
});
after(stop);

const page = async (user, qs) => (await as(user).get('/app?page=leads' + qs)).text();

test('leads are shown 50 per page, newest first', async () => {
  const p1 = await page(f.admin, '');
  assert.ok(p1.includes('Bulk Lead 60'), 'newest lead on page 1');
  assert.ok(!p1.includes('Bulk Lead 10<'), 'older leads not on page 1');
  assert.match(p1, /Showing 1–50 of 62 leads/);
  const p2 = await page(f.admin, '&p=2');
  assert.match(p2, /Showing 51–62 of 62 leads/);
  assert.ok(p2.includes('Bulk Lead 01'));
  const past = await page(f.admin, '&p=99');
  assert.match(past, /Page 2 of 2/, 'a page past the end shows the last page');
});

test('search and filters run on the server', async () => {
  const byName = await page(f.admin, '&q=bulk%20lead%2007');
  assert.match(byName, /Showing 1–1 of 1 leads/);
  const byPhone = await page(f.admin, '&q=9000000002');
  assert.ok(byPhone.includes('Bina Rao'));
  const qualified = await page(f.admin, '&status=Qualified');
  assert.match(qualified, /of 5 leads/);
  assert.ok(qualified.includes('value="Qualified" selected'), 'chosen filter shown back');
  const newOnly = await page(f.admin, '&status=New');
  assert.ok(newOnly.includes('status=New&amp;p=2'), 'filters kept in the Next link');
  const regex = await page(f.admin, '&q=.*');
  assert.ok(regex.includes('No leads match these filters.'), 'search text is not a regex');
  const junk = await page(f.admin, '&status=Bogus&source=nope&p=-3');
  assert.match(junk, /Showing 1–50 of 62 leads/, 'bad filter values are ignored');
});

test('a Team Leader only pages through their own team', async () => {
  const tl = await page(f.tlA, '');
  assert.match(tl, /of 61 leads/);
  assert.ok(!(await page(f.tlA, '&q=Bina')).includes('Bina Rao'), 'other team lead never found by search');
  const sub = await page(f.subB, '');
  assert.match(sub, /of 1 leads/);
});

test('a quick action returns to the same filtered page', async () => {
  const lead = await models.Lead.findOne({ name: 'Bulk Lead 03' });
  const r = await as(f.admin).post('/app?page=leads&status=Qualified&q=bulk&p=1',
    { action: 'quick_disposition', lead_id: String(lead._id), status: 'Working' });
  assert.match(r.location, /^\/app\?page=leads&q=bulk&status=Qualified&msg=/);
  const html = await page(f.admin, '&status=New&p=2');
  assert.ok(html.includes('action="/app?page=leads&amp;status=New&amp;p=2"'), 'forms post back to this page');
});

test('deleting a lead is a POST that returns to the same filtered page', async () => {
  const lead = await models.Lead.findOne({ name: 'Bulk Lead 59' });
  const r = await as(f.admin).post('/app?page=leads&status=New&p=2', { action: 'delete', table: 'leads', id: String(lead._id) });
  assert.equal(r.msg, 'Deleted successfully.');
  assert.match(r.location, /^\/app\?page=leads&status=New&p=2&msg=/);
  assert.equal(await models.Lead.exists({ _id: lead._id }), null);
});
