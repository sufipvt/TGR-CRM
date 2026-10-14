// A second lead with the same phone is caught in the form, the live check and CSV import.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { start, stop, as, models, baseUrl } = require('./helpers');
const { phoneKey } = require('../services/duplicates');

let f;
before(async () => { f = await start(); }); // seed: leadA phone 9000000001 (team A), leadB 9000000002 (team B)
after(stop);

const newLead = (phone, extra = {}) => ({
  action: 'add_lead', name: 'Dup Test', phone, source_id: String(f.source._id), ...extra
});
const count = phone => models.Lead.countDocuments({ phone });

test('phone keys ignore formatting and country codes', () => {
  assert.equal(phoneKey('+91 90000-00001'), '9000000001');
  assert.equal(phoneKey('09000000001'), '9000000001');
  assert.equal(phoneKey('12345'), '', 'too short to compare');
});

test('adding a lead with a phone already in the CRM is refused, naming the lead to an admin', async () => {
  const res = await as(f.admin).post('/app?page=leads', newLead('+91 90000 00001'));
  assert.match(res.msg, /already belongs to Anil D'Souza \(New, Sid SubA\)/);
  assert.match(res.msg, /Save anyway/);
  assert.equal(await count('+91 90000 00001'), 0);
});

test('"Save anyway" adds the duplicate', async () => {
  const res = await as(f.admin).post('/app?page=leads', newLead('+91 90000 00001', { allow_duplicate: '1' }));
  assert.equal(res.msg, 'Lead added.');
  assert.equal(await count('+91 90000 00001'), 1);
});

test('someone who cannot see the existing lead is told only that it exists', async () => {
  const res = await as(f.subA).post('/app?page=leads', newLead('9000000002'));
  assert.match(res.msg, /already belongs to a lead outside your team/);
  assert.ok(!res.msg.includes('Bina'), 'no name from another team');
});

test('editing a lead without changing its phone is not blocked by an old duplicate', async () => {
  const res = await as(f.admin).post('/app?page=leads', {
    action: 'update_lead', lead_id: String(f.leadA._id), name: "Anil D'Souza", phone: '9000000001', source_id: String(f.source._id)
  });
  assert.equal(res.msg, 'Lead updated.');
});

test('changing a phone to one another lead has is refused', async () => {
  const res = await as(f.admin).post('/app?page=leads', {
    action: 'update_lead', lead_id: String(f.leadA._id), name: "Anil D'Souza", phone: '90000 00002', source_id: String(f.source._id)
  });
  assert.match(res.msg, /already belongs to Bina Rao/);
});

test('the live phone check respects team scoping', async () => {
  const seen = await (await as(f.admin).get('/api/lead-phone-check?phone=9000000002')).json();
  assert.deepEqual({ ...seen }, { duplicate: true, visible: true, name: 'Bina Rao', status: 'New', caller: 'Bea SubB' });
  const hidden = await (await as(f.subA).get('/api/lead-phone-check?phone=9000000002')).json();
  assert.deepEqual(hidden, { duplicate: true, visible: false });
  const self = await (await as(f.admin).get('/api/lead-phone-check?phone=9000000002&exclude=' + f.leadB._id)).json();
  assert.deepEqual(self, { duplicate: false });
});

test('CSV import skips phones already in the CRM and repeats within the file', async () => {
  const csv = 'name,phone\nOld Anil,+91 9000000001\nNew Person,9111111111\nNew Person Again,91111 11111\n';
  const form = new FormData();
  form.append('csv_file', new Blob([csv], { type: 'text/csv' }), 'leads.csv');
  const token = jwt.sign({ userId: f.admin._id, role: f.admin.role, email: f.admin.email, name: f.admin.full_name },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  const res = await fetch(baseUrl() + '/app/import-leads', {
    method: 'POST', body: form, redirect: 'manual', headers: { cookie: 'tg_token=' + token }
  });
  const msg = new URL(res.headers.get('location'), baseUrl()).searchParams.get('msg');
  assert.equal(msg, 'Imported 1 leads. 2 skipped: phone already in the CRM. ');
  assert.equal(await models.Lead.countDocuments({ name: /^New Person/ }), 1);
});
