// Public privacy and terms pages in this client's name, and /health for monitors.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { start, stop, as, models, baseUrl } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

test('privacy and terms are public pages in the company name, linked from sign-in and the enquiry form', async () => {
  for (const [path, heading] of [['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Use']]) {
    const res = await fetch(baseUrl() + path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.ok(html.includes(`<h1>${heading}</h1>`), path);
    assert.ok(html.includes('contact our sales team'), 'no contact details set yet');
  }
  const login = await (await fetch(baseUrl() + '/login')).text();
  assert.ok(login.includes('href="/privacy"') && login.includes('href="/terms"'));
  await models.Setting.create({ key: 'capture_form_enabled', value: '1' });
  require('../services/settings').clearSettingsCache();
  const form = await (await fetch(baseUrl() + '/enquire')).text();
  assert.ok(form.includes('href="/privacy"'));
});

test('the Super Admin sets the contact details shown on both pages, and a bad email is refused', async () => {
  const bad = await as(f.superAdmin).post('/app?page=settings', { action: 'save_settings', contact_email: 'not-an-email' });
  assert.match(bad.msg, /Error: Enter a valid contact email/);
  const ok = await as(f.superAdmin).post('/app?page=settings', {
    action: 'save_settings', contact_email: 'privacy@example.com', contact_phone: '+91 98000 00000', company_address: '1 MG Road, <Pune>'
  });
  assert.equal(ok.msg, 'Settings saved.');
  require('../services/settings').clearSettingsCache();
  const html = await (await fetch(baseUrl() + '/privacy')).text();
  assert.ok(html.includes('mailto:privacy@example.com'));
  assert.ok(html.includes('+91 98000 00000'));
  assert.ok(html.includes('1 MG Road, &lt;Pune&gt;'), 'escaped');
  const settings = await (await as(f.superAdmin).get('/app?page=settings')).text();
  assert.ok(settings.includes('value="privacy@example.com"'));
});

test('/health is 200 with the database up and 503 without it', async () => {
  const up = await fetch(baseUrl() + '/health');
  assert.equal(up.status, 200);
  assert.deepEqual(await up.json(), { ok: true });
  assert.equal(up.headers.get('cache-control'), 'no-store');
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => 0, configurable: true });
  try {
    const down = await fetch(baseUrl() + '/health');
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { ok: false });
  } finally {
    delete mongoose.connection.readyState;
  }
  assert.equal((await fetch(baseUrl() + '/health')).status, 200, 'back up');
});
