// Lead capture: the public enquiry form and the webhook, both off until turned on.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models, baseUrl } = require('./helpers');
const { clearSettingsCache } = require('../services/settings');

let f;
before(async () => { f = await start(); }); // seed: leadA phone 9000000001
after(stop);

const setting = async (key, value) => {
  await models.Setting.findOneAndUpdate({ key }, { key, value }, { upsert: true });
  clearSettingsCache();
};
const postForm = (path, body, headers = {}) => fetch(baseUrl() + path, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(body).toString()
});
const postJson = (path, body, headers = {}) => fetch(baseUrl() + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
});

test('both entry points are hidden while switched off', async () => {
  assert.equal((await fetch(baseUrl() + '/enquire')).status, 404);
  assert.equal((await postForm('/enquire', { name: 'X', phone: '9111111111' })).status, 404);
  assert.equal((await postJson('/api/leads/capture', { name: 'X', phone: '9111111111' })).status, 404);
  assert.equal(await models.Lead.countDocuments({ phone: '9111111111' }), 0);
});

test('an admin turns them on in Settings and gets a webhook key', async () => {
  const res = await as(f.admin).post('/app?page=settings', {
    action: 'save_lead_capture', capture_form_enabled: '1', capture_webhook_enabled: '1'
  });
  assert.equal(res.msg, 'Lead capture settings saved.');
  const key = await models.Setting.findOne({ key: 'capture_webhook_key' }).lean();
  assert.match(key.value, /^[0-9a-f]{48}$/);
  const page = await (await as(f.admin).get('/app?page=settings')).text();
  assert.ok(page.includes('/enquire'), 'link shown');
  assert.ok(page.includes('/api/leads/capture'), 'webhook URL shown');
});

test('a Sub Team Leader cannot change lead capture', async () => {
  const res = await as(f.subA).post('/app?page=settings', { action: 'save_lead_capture' });
  assert.match(res.msg, /Forbidden/);
});

test('the enquiry form creates an assigned lead with the Website Enquiry source', async () => {
  const page = await (await fetch(baseUrl() + '/enquire')).text();
  assert.ok(page.includes('Green Acres'), 'projects offered');
  const res = await postForm('/enquire', { name: 'Riya Form', phone: '+91 91111 11111', project_id: String(f.project._id), message: '2BHK please' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /received your enquiry/);
  const lead = await models.Lead.findOne({ name: 'Riya Form' }).populate('source_id').lean();
  assert.equal(lead.source_id.name, 'Website Enquiry');
  assert.equal(String(lead.project_id), String(f.project._id));
  assert.ok(lead.assigned_caller_id, 'auto-assigned');
  assert.match(lead.notes, /2BHK please/);
});

test('a form missing the phone shows an error and keeps what was typed', async () => {
  const res = await postForm('/enquire', { name: 'No Phone Person' });
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /valid phone number/);
  assert.ok(html.includes('value="No Phone Person"'));
});

test('bots that fill the hidden field get thanked but nothing is saved', async () => {
  const res = await postForm('/enquire', { name: 'Spam Bot', phone: '9222222222', website: 'http://spam' });
  assert.match(await res.text(), /received your enquiry/);
  assert.equal(await models.Lead.countDocuments({ name: 'Spam Bot' }), 0);
});

test('a repeat enquiry is noted on the existing lead instead of making a duplicate', async () => {
  await postForm('/enquire', { name: 'Anil Again', phone: '09000000001', message: 'Still interested' });
  assert.equal(await models.Lead.countDocuments({ name: 'Anil Again' }), 0);
  const lead = await models.Lead.findById(f.leadA._id).lean();
  assert.match(lead.notes, /Enquired again via enquiry form: Still interested/);
});

test('the webhook needs the key', async () => {
  const res = await postJson('/api/leads/capture', { name: 'Zap Lead', phone: '9333333333' }, { 'x-api-key': 'wrong' });
  assert.equal(res.status, 401);
});

test('the webhook saves a lead with its named source and project', async () => {
  const key = (await models.Setting.findOne({ key: 'capture_webhook_key' }).lean()).value;
  const res = await postJson('/api/leads/capture',
    { name: 'Zap Lead', phone: '9333333333', source: '99acres', project: 'green acres', notes: 'From portal' },
    { 'x-api-key': key });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  const lead = await models.Lead.findById(body.id).populate('source_id').lean();
  assert.equal(lead.source_id.name, '99acres');
  assert.equal(String(lead.project_id), String(f.project._id));
});

test('Google Ads lead form payloads are understood', async () => {
  const key = (await models.Setting.findOne({ key: 'capture_webhook_key' }).lean()).value;
  const res = await postJson('/api/leads/capture', {
    google_key: key, lead_id: 'abc',
    user_column_data: [
      { column_id: 'FULL_NAME', string_value: 'Gita Ads' },
      { column_id: 'PHONE_NUMBER', string_value: '+919444444444' },
      { column_id: 'EMAIL', string_value: 'gita@example.com' }
    ]
  });
  assert.equal(res.status, 201);
  const lead = await models.Lead.findOne({ name: 'Gita Ads' }).populate('source_id').lean();
  assert.equal(lead.source_id.name, 'Google Ads');
  assert.equal(lead.email, 'gita@example.com');
});

test('a new key stops the old one working', async () => {
  const old = (await models.Setting.findOne({ key: 'capture_webhook_key' }).lean()).value;
  await as(f.admin).post('/app?page=settings', { action: 'regenerate_capture_key' });
  const res = await postJson('/api/leads/capture', { name: 'Late Zap', phone: '9555555555' }, { 'x-api-key': old });
  assert.equal(res.status, 401);
});

test('switching the form off hides it again', async () => {
  await as(f.admin).post('/app?page=settings', { action: 'save_lead_capture', capture_webhook_enabled: '1' });
  assert.equal((await fetch(baseUrl() + '/enquire')).status, 404);
  await setting('capture_form_enabled', '');
});
