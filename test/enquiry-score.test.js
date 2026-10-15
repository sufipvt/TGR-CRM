// The enquiry answers -> Hot / Warm / Cold rules, and when the first call is due.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../services/enquiryScore');

const score = input => s.scoreAnswers(s.readAnswers(input));

test('buying now or soon with a visit is Hot, some intent Warm, browsing Cold', () => {
  assert.equal(score({ timeline: 'Immediately' }), 'Hot');
  assert.equal(score({ timeline: 'Within 3 months', site_visit: 'This week' }), 'Hot');
  assert.equal(score({ timeline: 'Within 3 months' }), 'Warm');
  assert.equal(score({ timeline: '3 to 6 months', site_visit: 'Next week' }), 'Warm');
  assert.equal(score({ timeline: 'Just exploring', site_visit: 'This week' }), 'Warm');
  assert.equal(score({ timeline: 'Just exploring', site_visit: 'Not yet' }), 'Cold');
});

test('no answers, or answers not on the list, are not scored', () => {
  assert.equal(score({}), null);
  assert.equal(score({ timeline: 'Tomorrow!!', site_visit: { $gt: '' } }), null);
  assert.deepEqual(s.readAnswers({ budget: 'a lot', property_type: '2 BHK' }).budget, '');
});

test('ad tags are cleaned and kept short', () => {
  const a = s.readAnswers({ utm_source: 'insta<script>', utm_campaign: 'x'.repeat(100) });
  assert.equal(a.utm_source, 'instascript');
  assert.equal(a.utm_campaign.length, 60);
});

test('first call: Hot 15 minutes, Warm 2 hours, unscored 1 hour, Cold next day at 11', () => {
  const now = new Date(2026, 9, 15, 22, 0, 0);
  assert.equal(s.firstCallDue('Hot', now) - now, 15 * 60 * 1000);
  assert.equal(s.firstCallDue('Warm', now) - now, 2 * 60 * 60 * 1000);
  assert.equal(s.firstCallDue(null, now) - now, 60 * 60 * 1000);
  const cold = s.firstCallDue('Cold', now);
  assert.deepEqual([cold.getDate(), cold.getHours(), cold.getMinutes()], [16, 11, 0]);
});

test('a warmer answer wins, a colder one never cools the lead', () => {
  assert.equal(s.hotter('Hot', 'Cold'), 'Hot');
  assert.equal(s.hotter('Cold', 'Hot'), 'Hot');
  assert.equal(s.hotter('Warm', undefined), 'Warm');
});

test('answers read as one line for the notes', () => {
  const line = s.answersLine(s.readAnswers({ timeline: 'Immediately', budget: '1 to 2 crore', property_type: '3 BHK', site_visit: 'This week', utm_source: 'instagram', utm_campaign: 'diwali' }));
  assert.equal(line, 'Buying: Immediately · Budget: 1 to 2 crore · Looking for: 3 BHK · Site visit: This week · Ad: instagram / diwali');
});
