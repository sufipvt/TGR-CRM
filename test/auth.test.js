// Login: real password check and per-account lockout (guide blocks 27, 28, 30).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { start, stop, models } = require('./helpers');

let base;
before(async () => {
  await start();
  await models.User.create({ full_name: 'Lia Login', email: 'lia@t.test', password: await bcrypt.hash('correct horse', 4), role: 'Admin' });
  base = require('./helpers').baseUrl();
});
after(stop);

const login = (email, password) => fetch(base + '/login', {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ email, password }).toString()
}).then(r => decodeURIComponent(r.headers.get('location') || ''));

test('correct password signs in', async () => {
  assert.equal(await login('lia@t.test', 'correct horse'), '/app?page=dashboard');
});

test('five wrong passwords lock the account, even for the right password', async () => {
  for (let i = 0; i < 5; i++) assert.match(await login('lia@t.test', 'wrong'), /Invalid email or password/);
  assert.match(await login('lia@t.test', 'correct horse'), /Too many failed attempts/);
});
