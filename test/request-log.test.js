// Request ids: every response carries one, and error pages show it as a reference.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, baseUrl } = require('./helpers');

let f;
before(async () => { f = await start(); });
after(stop);

test('every response has a request id', async () => {
  const r = await as(f.subA).get('/app?page=leads');
  assert.match(r.headers.get('x-request-id') || '', /^[0-9a-f]{12}$/);
});

test('the 404 page shows the request id as a reference', async () => {
  const r = await fetch(baseUrl() + '/no-such-page');
  assert.equal(r.status, 404);
  const id = r.headers.get('x-request-id');
  assert.ok((await r.text()).includes('Reference: ' + id));
});
