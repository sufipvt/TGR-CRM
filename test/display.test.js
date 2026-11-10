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
