// The enquiry form's buying questions: they set Hot / Warm / Cold, put a first call on
// the assigned agent's list, and project links and ad tags carry through.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models, baseUrl } = require('./helpers');
const { clearSettingsCache } = require('../services/settings');

let f, key;
const setting = (k, value) => models.Setting.findOneAndUpdate({ key: k }, { key: k, value }, { upsert: true });
before(async () => {
  f = await start(); // seed: leadA 9000000001 (caller subA), project Green Acres
  key = 'k'.repeat(48);
  await setting('capture_form_enabled', '1');
  await setting('capture_webhook_enabled', '1');
  await setting('capture_webhook_key', key);
  clearSettingsCache();
});
after(stop);

const enquire = body => fetch(baseUrl() + '/enquire', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString()
});
const minutesFromNow = d => (new Date(d).getTime() - Date.now()) / 60000;

test('the form asks the buying questions, and a project link preselects it with the ad tag', async () => {
  const plain = await (await fetch(baseUrl() + '/enquire')).text();
  assert.ok(plain.includes('When are you planning to buy?'));
  assert.ok(plain.includes('value="Immediately"') && plain.includes('value="This week"'));
  const linked = await (await fetch(baseUrl() + '/enquire?project=' + f.project._id + '&utm_source=instagram&utm_campaign=diwali')).text();
  assert.match(linked, new RegExp('value="' + f.project._id + '" selected'));
  assert.ok(linked.includes('name="utm_source" value="instagram"'));
  assert.ok(linked.includes('name="utm_campaign" value="diwali"'));
});

test('a buyer ready now becomes a Hot lead with a call due in 15 minutes', async () => {
  const res = await enquire({
    name: 'Harsh Hot', phone: '9666600001', project_id: String(f.project._id), timeline: 'Immediately',
    budget: '1 to 2 crore', property_type: '3 BHK', site_visit: 'This week', utm_source: 'instagram', utm_campaign: 'diwali'
  });
  assert.equal(res.status, 200);
  const lead = await models.Lead.findOne({ phone: '9666600001' }).lean();
  assert.equal(lead.temperature, 'Hot');
  assert.equal(lead.budget_range, '1 to 2 crore');
  assert.equal(lead.enquiry.property_type, '3 BHK');
  assert.equal(lead.enquiry.utm_campaign, 'diwali');
  assert.match(lead.notes, /Buying: Immediately · Budget: 1 to 2 crore · Looking for: 3 BHK · Site visit: This week · Ad: instagram \/ diwali/);

  const fus = await models.FollowUp.find({ lead_id: lead._id }).lean();
  assert.equal(fus.length, 1);
  assert.equal(String(fus[0].assigned_to_id), String(lead.assigned_caller_id));
  assert.equal(fus[0].status, 'Pending');
  assert.ok(Math.abs(minutesFromNow(fus[0].scheduled_date) - 15) < 2, 'due in about 15 minutes');
  assert.match(fus[0].notes, /Hot lead from enquiry form: call within 15 minutes/);

  const n = await models.Notification.findOne({ user_id: f.admin._id, lead_id: lead._id }).lean();
  assert.equal(n.title, 'New hot lead: Harsh Hot');
});

test('a browser becomes Cold with a call next morning; junk answers are ignored', async () => {
  await enquire({ name: 'Chetan Cold', phone: '9666600002', timeline: 'Just exploring', site_visit: 'Not yet' });
  const cold = await models.Lead.findOne({ phone: '9666600002' }).lean();
  assert.equal(cold.temperature, 'Cold');
  const fu = await models.FollowUp.findOne({ lead_id: cold._id }).lean();
  const due = new Date(fu.scheduled_date);
  assert.deepEqual([due.getHours(), due.getMinutes()], [11, 0]);
  assert.ok(due > new Date());

  await enquire({ name: 'Jay Junk', phone: '9666600003', timeline: 'Yesterday', budget: 'loads' });
  const junk = await models.Lead.findOne({ phone: '9666600003' }).lean();
  assert.equal(junk.temperature, undefined);
  assert.equal((junk.enquiry || {}).timeline, undefined, 'answer not on the list is dropped');
  const jfu = await models.FollowUp.findOne({ lead_id: junk._id }).lean();
  assert.ok(Math.abs(minutesFromNow(jfu.scheduled_date) - 60) < 2, 'unscored: within the hour');
});

test('a hotter repeat enquiry warms the lead up but adds no second pending call', async () => {
  await enquire({ name: 'Chetan Again', phone: '9666600002', timeline: 'Immediately' });
  const lead = await models.Lead.findOne({ phone: '9666600002' }).lean();
  assert.equal(lead.temperature, 'Hot');
  assert.match(lead.notes, /Enquired again via enquiry form \(Buying: Immediately\)/);
  assert.equal(await models.FollowUp.countDocuments({ lead_id: lead._id, status: 'Pending' }), 1);

  await enquire({ name: 'Chetan Cooler', phone: '9666600002', timeline: 'Just exploring', site_visit: 'Not yet' });
  assert.equal((await models.Lead.findById(lead._id).lean()).temperature, 'Hot', 'never cooled');
});

test('a repeat enquiry with nothing pending gets a new first call', async () => {
  assert.equal(await models.FollowUp.countDocuments({ lead_id: f.leadA._id, status: 'Pending' }), 1, 'seeded follow-up');
  await models.FollowUp.updateMany({ lead_id: f.leadA._id }, { status: 'Completed' });
  await enquire({ name: 'Anil', phone: '9000000001', timeline: 'Within 3 months' });
  const pending = await models.FollowUp.find({ lead_id: f.leadA._id, status: 'Pending' }).lean();
  assert.equal(pending.length, 1);
  assert.equal(String(pending[0].assigned_to_id), String(f.subA._id));
  assert.match(pending[0].notes, /\(enquired again\)/);
});

test('the webhook scores the same answers', async () => {
  const res = await fetch(baseUrl() + '/api/leads/capture', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ name: 'Wendy Web', phone: '9666600004', timeline: 'Within 3 months', site_visit: 'This week' })
  });
  assert.equal(res.status, 201);
  assert.equal((await models.Lead.findOne({ phone: '9666600004' }).lean()).temperature, 'Hot');
});

test('Settings offers a link per project', async () => {
  const html = await (await as(f.admin).get('/app?page=settings')).text();
  assert.ok(html.includes('id="cap_link_project"'));
  assert.ok(html.includes('?utm_source=instagram'));
});
