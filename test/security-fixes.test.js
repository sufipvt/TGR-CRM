// Fixes from the security review: team boundaries, booked units, the Booked status,
// sessions after a password reset, sign-in lockout and the morning email.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const sgMail = require('@sendgrid/mail');
const { start, stop, as, models, baseUrl } = require('./helpers');
const { sendDailyDigest } = require('../services/digest');

let f;
before(async () => { f = await start(); }); // seed: tlA leads Team A (subA); subB in Team B; loose unassigned; unitB booked (bookingB)
after(stop);

test('a Team Leader cannot pull an unassigned agent into their team', async () => {
  const res = await as(f.tlA).post('/app?page=teams', { action: 'assign_team_member', user_id: String(f.loose._id), team_id: String(f.teamA._id) });
  assert.match(res.msg, /^Error: /);
  assert.equal((await models.User.findById(f.loose._id).lean()).team_id, undefined);
});

test('a booked unit cannot be made Available or deleted while its booking stands', async () => {
  const set = status => as(f.admin).post('/app?page=projects', {
    action: 'update_unit', unit_id: String(f.unitB._id), unit_number: 'B-201', status
  });
  assert.match((await set('Available')).msg, /has a booking/);
  assert.equal((await models.Unit.findById(f.unitB._id).lean()).status, 'Booked');
  assert.match((await set('NotAStatus')).msg, /^Error: /, 'status must be a real one');
  assert.equal((await set('Sold')).msg, 'Unit updated.', 'Booked to Sold is fine');
  const del = await as(f.admin).post('/app?page=projects', { action: 'delete', table: 'units', id: String(f.unitB._id) });
  assert.match(del.msg, /has a booking/);
  assert.ok(await models.Unit.exists({ _id: f.unitB._id }));
});

test('a lead is not marked Booked by hand, only through a booking', async () => {
  const lead = f.leadA;
  const res = await as(f.admin).post('/app?page=leads', {
    action: 'update_lead', lead_id: String(lead._id), name: lead.name, phone: lead.phone, source_id: String(f.source._id),
    assigned_caller_id: String(f.subA._id), status: 'Booked'
  });
  assert.match(res.msg, /add a booking/);
  const api = await fetch(baseUrl() + '/api/lead/' + lead._id + '/status', {
    method: 'PATCH', headers: { 'content-type': 'application/json', cookie: (await cookieFor(f.admin)) }, body: JSON.stringify({ status: 'Booked' })
  });
  assert.equal(api.status, 400);
  assert.notEqual((await models.Lead.findById(lead._id).lean()).status, 'Booked');
});

test('a malformed lead id is refused, not a crash', async () => {
  const res = await as(f.subA).post('/app?page=leads', { action: 'add_followup', lead_id: 'nope', scheduled_date: '2030-01-01T10:00' });
  assert.equal(res.status, 302);
  assert.match(res.msg, /^Error: /);
});

test('when a Team Leader moves to lead another team, the old team stops alerting them', async () => {
  const res = await as(f.superAdmin).post('/app?page=teams', { action: 'update_team', team_id: String(f.teamB._id), name: 'Team B', team_leader_id: String(f.tlA._id) });
  assert.equal(res.msg, 'Team updated.');
  assert.equal((await models.Team.findById(f.teamA._id).lean()).team_leader_id, null);
  assert.equal(String((await models.Team.findById(f.teamB._id).lean()).team_leader_id), String(f.tlA._id));
  // put things back for the tests below
  await models.Team.updateOne({ _id: f.teamB._id }, { team_leader_id: null });
  await models.Team.updateOne({ _id: f.teamA._id }, { team_leader_id: f.tlA._id });
  await models.User.updateOne({ _id: f.tlA._id }, { team_id: f.teamA._id, role: 'Team Leader' });
});

// Signs in through the real form, so the cookie carries the session version.
async function cookieFor(user, password = 'pw-123456', ip = '10.9.9.9') {
  await models.User.updateOne({ _id: user._id }, { password: await bcrypt.hash(password, 4) });
  const res = await fetch(baseUrl() + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams({ email: user.email, password }).toString()
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('resetting a password signs that person out everywhere', async () => {
  const cookie = await cookieFor(f.subB);
  const page = () => fetch(baseUrl() + '/app?page=dashboard', { headers: { cookie }, redirect: 'manual' });
  assert.equal((await page()).status, 200);
  const u = await models.User.findById(f.subB._id).lean();
  const res = await as(f.superAdmin).post('/app?page=users', {
    action: 'update_user', user_id: String(u._id), full_name: u.full_name, email: u.email, role: u.role,
    status: 'Active', team_id: String(u.team_id), password: 'brand-new-pass'
  });
  assert.equal(res.msg, 'User updated.');
  const after = await page();
  assert.equal(after.status, 302);
  assert.match(after.headers.get('location'), /^\/login/);
});

test('sign out is a POST; a GET link no longer signs anyone out', async () => {
  const cookie = await cookieFor(f.loose);
  const get = await fetch(baseUrl() + '/logout', { headers: { cookie }, redirect: 'manual' });
  assert.ok(!(get.headers.get('set-cookie') || '').includes('tg_token=;'));
  const post = await fetch(baseUrl() + '/logout', { method: 'POST', headers: { cookie }, redirect: 'manual' });
  assert.equal(post.headers.get('location'), '/login');
  assert.match(post.headers.get('set-cookie') || '', /tg_token=;/);
});

test('wrong passwords from one address do not lock the owner out elsewhere', async () => {
  const try_ = (password, ip) => fetch(baseUrl() + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams({ email: f.admin.email, password }).toString()
  }).then(r => decodeURIComponent(r.headers.get('location') || ''));
  await models.User.updateOne({ _id: f.admin._id }, { password: await bcrypt.hash('right-one', 4) });
  for (let i = 0; i < 5; i++) await try_('wrong', '10.6.6.6');
  assert.match(await try_('right-one', '10.6.6.6'), /Too many failed attempts/, 'the guessing address is locked');
  assert.equal(await try_('right-one', '10.7.7.7'), '/app?page=dashboard', 'the owner elsewhere still signs in');
});

test('the morning email shows a Team Leader only their own team', async () => {
  const sent = [];
  const realSend = sgMail.send;
  sgMail.send = async msg => { sent.push(msg); };
  process.env.SENDGRID_API_KEY = 'SG.test';
  try {
    await models.Setting.deleteOne({ key: 'digest_sent_on' });
    await sendDailyDigest();
  } finally {
    sgMail.send = realSend;
    delete process.env.SENDGRID_API_KEY;
  }
  const toLeader = sent.find(m => m.to === f.tlA.email);
  assert.ok(toLeader, 'the Team Leader gets a summary');
  assert.match(toLeader.subject, /^Team Summary/);
  assert.ok(toLeader.html.includes('Sid SubA'), 'lists their own agent');
  assert.ok(!toLeader.html.includes('Bea SubB'), 'not another team\'s agent');
  const toAdmin = sent.find(m => m.to === f.admin.email);
  assert.ok(toAdmin.html.includes('Bea SubB') && toAdmin.html.includes('Sid SubA'), 'admins still see everyone');
});
