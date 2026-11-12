// Larger text and dark mode are per-device choices made in the top bar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

test('every page has the Larger text button and applies the saved choice before painting', async () => {
  for (const page of ['dashboard', 'leads', 'followups']) {
    const html = await (await as(f.subA).get('/app?page=' + page)).text();
    assert.ok(html.includes('id="tgTextToggle"'), page);
    assert.ok(html.includes('/text-size.js'), page);
    assert.ok(html.indexOf("localStorage.getItem('tgText')") < html.indexOf('/theme.css'), 'set in <head> before the styles load');
  }
});

test('admin pages use the shared chips, and the audit log reads as words, not JSON', async () => {
  const users = await (await as(f.superAdmin).get('/app?page=users')).text();
  assert.ok(users.includes('tg-chip tg-chip-role-super-admin'));
  assert.ok(users.includes('tg-chip-good">Active'));
  const sources = await (await as(f.admin).get('/app?page=sources')).text();
  assert.ok(sources.includes('tg-c-lead fw-medium'));
  await require('../services/audit').audit(f.admin.email, 'update', 'Lead', String(f.leadA._id), { status_from: 'New', status_to: 'Working' });
  const log = await (await as(f.superAdmin).get('/app?page=audit')).text();
  assert.ok(log.includes('status from: New · status to: Working'));
  assert.ok(!log.includes('{&#34;status_from'));
});
