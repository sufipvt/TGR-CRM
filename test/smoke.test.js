// Every page renders for every role without a server error.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

const PAGES = ['dashboard', 'leads', 'followups', 'bookings', 'projects', 'sources', 'users', 'teams', 'settings', 'reports', 'audit'];

for (const who of ['superAdmin', 'admin', 'tlA', 'subA']) {
  test(`${who}: every page renders`, async () => {
    for (const page of PAGES) {
      const r = await as(f[who]).get('/app?page=' + page);
      // Pages a role may not open redirect to the dashboard; nothing may 500.
      assert.ok([200, 302].includes(r.status), `${page} returned ${r.status}`);
      if (r.status === 200) assert.doesNotMatch(await r.text(), /Something went wrong/, page);
    }
  });
}


test('branding follows the company name in Settings', async () => {
  const r = await as(f.superAdmin).post('/app?page=settings', { action: 'save_settings', company_name: 'Skyline Homes' });
  assert.equal(r.msg, 'Settings saved.');
  const html = await (await as(f.superAdmin).get('/login')).text();
  assert.match(html, /Skyline Homes — Real Estate Sales CRM/);
});
