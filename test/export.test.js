// Export leads to CSV: admins only, same filters as the Leads page, safe in Excel.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, models } = require('./helpers');

let f;
before(async () => {
  f = await start(); // seed: leadA "Anil D'Souza" (subA), leadB "Bina Rao" (subB)
  await models.Lead.create({
    name: '=HYPERLINK("http://evil.test","click")', phone: '+91 98888 77777', source_id: f.source._id,
    project_id: f.project._id, temperature: 'Hot', status: 'Working', notes: 'Line one\nsaid "call me", later',
    assigned_caller_id: f.subA._id
  });
});
after(stop);

const parse = text => text.replace(/^﻿/, '').trim().split(/\r\n(?=(?:[^"]*"[^"]*")*[^"]*$)/);

test('an admin downloads every lead as a spreadsheet', async () => {
  const res = await as(f.admin).get('/app/export-leads');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"/);
  const text = await res.text();
  // (fetch drops the byte-order mark the server sends first for Excel)
  assert.match(text, /^\ufeff?Name,Phone,Email,City,Source,Project,Budget,Status,Temperature,/);
  const rows = parse(text);
  assert.equal(rows.length, 1 + 3);
  assert.ok(text.includes("Anil D'Souza,9000000001"));
  assert.ok(text.includes('Bina Rao,9000000002'));
  const log = await models.AuditLog.findOne({ action: 'export' }).lean();
  assert.equal(log.details.count, 3);
});

test('a formula in a lead name stays plain text, and notes with commas, quotes and lines survive', async () => {
  const text = await (await as(f.admin).get('/app/export-leads?temperature=Hot')).text();
  const rows = parse(text);
  assert.equal(rows.length, 2, 'only the Hot lead');
  assert.ok(rows[1].startsWith(`"'=HYPERLINK(""http://evil.test"",""click"")",+91 98888 77777,`), rows[1]);
  assert.ok(rows[1].includes('"Line one\nsaid ""call me"", later"'));
  assert.ok(rows[1].includes(',Green Acres,'));
  assert.ok(rows[1].includes(',Sid SubA,'));
});

test('the filters on the Leads page carry into the export', async () => {
  const page = await (await as(f.admin).get('/app?page=leads&status=Working')).text();
  assert.ok(page.includes('href="/app/export-leads?status=Working"'));
  const text = await (await as(f.admin).get('/app/export-leads?q=bina')).text();
  assert.equal(parse(text).length, 2);
  assert.ok(text.includes('Bina Rao'));
});

test('Team Leaders and agents cannot export, and see no Export or Import button', async () => {
  for (const u of [f.tlA, f.subA]) {
    const res = await as(u).get('/app/export-leads');
    assert.equal(res.status, 403);
    const page = await (await as(u).get('/app?page=leads')).text();
    assert.ok(!page.includes('/app/export-leads'));
    assert.ok(!page.includes('id="importCsvModal"'), 'the import button would only lead to "Forbidden"');
  }
});
