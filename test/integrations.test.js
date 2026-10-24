// Integrations page: one tile per lead source, each with its own switch, key,
// source tag, default project and a log of what arrived.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models, baseUrl } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

const postJson = (path, body, headers = {}) => fetch(baseUrl() + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const keyOf = async tile => (await models.Integration.findOne({ key: tile }).lean()).api_key;

test('admins see the tiles; agents and Team Leaders do not', async () => {
  const html = await (await as(f.admin).get('/app?page=integrations')).text();
  for (const name of ['Website form', 'Google Ads', 'Facebook &amp; Instagram', '99acres', 'MagicBricks', 'Housing.com', 'Other tools']) {
    assert.ok(html.includes(name), name);
  }
  assert.ok(html.includes('Not connected'));
  assert.ok(html.includes('href="/app?page=integrations"'), 'in the menu');
  for (const u of [f.tlA, f.subA]) {
    const page = await (await as(u).get('/app?page=integrations')).text();
    assert.ok(!page.includes('id="int_99acres"'));
    const r = await as(u).post('/app?page=integrations', { action: 'save_integration', tile: '99acres', enabled: '1' });
    assert.match(r.msg, /Forbidden/);
  }
  assert.equal(await models.Integration.countDocuments(), 0);
});

test('a tile is off until switched on, and then takes leads only with its own key', async () => {
  assert.equal((await postJson('/api/leads/in/99acres', { name: 'P', phone: '9400000001' })).status, 404);
  const r = await as(f.admin).post('/app?page=integrations', { action: 'save_integration', tile: '99acres', enabled: '1', project_id: String(f.project._id) });
  assert.equal(r.msg, '99acres is on.');
  const key = await keyOf('99acres');
  assert.match(key, /^[0-9a-f]{48}$/);
  const source = await models.LeadSource.findOne({ name: '99acres' }).lean();
  assert.ok(source, 'source made for the tile');

  assert.equal((await postJson('/api/leads/in/99acres', { name: 'P', phone: '9400000001' }, { 'x-api-key': 'wrong' })).status, 401);
  await as(f.admin).post('/app?page=integrations', { action: 'save_integration', tile: 'magicbricks', enabled: '1' });
  const otherKey = await keyOf('magicbricks');
  assert.equal((await postJson('/api/leads/in/99acres', { name: 'P', phone: '9400000001' }, { 'x-api-key': otherKey })).status, 401, 'another tile\'s key');

  const ok = await postJson('/api/leads/in/99acres', { name: 'Priya Portal', phone: '9400000001', source: 'Hacked' }, { 'x-api-key': key });
  assert.equal(ok.status, 201);
  const lead = await models.Lead.findOne({ phone: '9400000001' }).lean();
  assert.equal(String(lead.source_id), String(source._id), 'the tile decides the source');
  assert.equal(String(lead.project_id), String(f.project._id), 'default project');
  assert.ok(lead.assigned_caller_id, 'assigned');
  assert.match(lead.notes, /Captured via 99acres/);

  const again = await postJson('/api/leads/in/99acres', { name: 'Priya Portal', phone: '94000 00001' }, { 'x-api-key': key });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);

  const html = await (await as(f.admin).get('/app?page=integrations')).text();
  assert.ok(html.includes('Connected · 2 this week'));
  assert.ok(html.includes('Wrong or missing key'));
  assert.ok(html.includes('Priya Portal'));
  assert.ok(html.includes('Email for your 99acres account manager'));
  assert.ok(await models.AuditLog.countDocuments({ entity: 'Integration' }) >= 2);
});

test('Google Ads lead forms work on their tile, and Google\'s test data makes no lead', async () => {
  await as(f.admin).post('/app?page=integrations', { action: 'save_integration', tile: 'google_ads', enabled: '1' });
  const key = await keyOf('google_ads');
  const cols = [{ column_id: 'FULL_NAME', string_value: 'Gita Google' }, { column_id: 'PHONE_NUMBER', string_value: '+91 94000 00002' }];
  const test1 = await postJson('/api/leads/in/google_ads', { google_key: key, is_test: true, user_column_data: cols });
  assert.equal(test1.status, 200);
  assert.equal(await models.Lead.countDocuments({ name: 'Gita Google' }), 0);
  const real = await postJson('/api/leads/in/google_ads', { google_key: key, user_column_data: cols });
  assert.equal(real.status, 201);
  const lead = await models.Lead.findOne({ name: 'Gita Google' }).populate('source_id').lean();
  assert.equal(lead.source_id.name, 'Google Ads');
  const log = await models.IntegrationLog.find({ key: 'google_ads' }).sort('at').lean();
  assert.deepEqual(log.map(l => l.result), ['test', 'new']);
});

test('switching a tile off or making a new key stops the old sender', async () => {
  const old = await keyOf('99acres');
  await as(f.admin).post('/app?page=integrations', { action: 'new_integration_key', tile: '99acres' });
  assert.notEqual(await keyOf('99acres'), old);
  assert.equal((await postJson('/api/leads/in/99acres', { name: 'Q', phone: '9400000003' }, { 'x-api-key': old })).status, 401);
  const key = await keyOf('99acres');
  await as(f.admin).post('/app?page=integrations', { action: 'save_integration', tile: '99acres' });
  assert.equal((await postJson('/api/leads/in/99acres', { name: 'Q', phone: '9400000003' }, { 'x-api-key': key })).status, 404);
  assert.equal(await models.Lead.countDocuments({ phone: '9400000003' }), 0);
  assert.equal((await postJson('/api/leads/in/nope', { name: 'Q', phone: '9400000003' })).status, 404);
  const bad = await as(f.admin).post('/app?page=integrations', { action: 'save_integration', tile: 'nope' });
  assert.match(bad.msg, /Unknown integration/);
});

test('the website form and the general webhook keep their own switches', async () => {
  await as(f.admin).post('/app?page=integrations', { action: 'save_lead_capture', section: 'webhook', capture_webhook_enabled: '1' });
  await as(f.admin).post('/app?page=integrations', { action: 'save_lead_capture', section: 'form', capture_form_enabled: '1' });
  require('../services/settings').clearSettingsCache();
  const { captureSettings } = require('../services/capture');
  const cfg = await captureSettings();
  assert.equal(cfg.formEnabled, true);
  assert.equal(cfg.webhookEnabled, true, 'saving the form tile left the webhook on');
  const settings = await (await as(f.admin).get('/app?page=settings')).text();
  assert.ok(settings.includes('set up on the <a href="/app?page=integrations">Integrations</a> page'));
});
