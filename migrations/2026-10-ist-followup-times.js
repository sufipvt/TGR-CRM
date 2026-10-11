// ONE-TIME migration for the switch to India time (Asia/Kolkata).
//
// Before the switch the server ran on UTC, so a follow-up typed in as 10:00 was
// stored as 10:00 UTC (= 15:30 IST). After the switch the app reads and writes
// IST, so those older follow-ups would show 5h30 late. This moves every
// follow-up created BEFORE the switch back by 5h30, so each shows the time the
// agent actually typed.
//
// Safe to re-run: each follow-up is marked tz_fixed and never shifted twice.
// Follow-ups created after the switch are already correct and are skipped.
//
// Same fix as the Super Admin button on the Settings page (services/istFollowupFix.js).
// Usage:
//   node migrations/2026-10-ist-followup-times.js            # dry run
//   node migrations/2026-10-ist-followup-times.js --apply    # write
//   --before <ISO time> overrides the switch time.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.development.local') });
const mongoose = require('mongoose');
const { FollowUp } = require('../models');
const { IST_SWITCH_AT, SHIFT_MS, countUnfixedFollowUps, fixFollowUpTimes } = require('../services/istFollowupFix');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  const beforeArg = arg('--before');
  const apply = process.argv.includes('--apply');
  const before = beforeArg ? new Date(beforeArg) : IST_SWITCH_AT;
  if (isNaN(before)) {
    console.error('--before must be an ISO time, e.g. --before 2026-10-11T17:41:46Z');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);
  const count = await countUnfixedFollowUps(before);
  const sample = await FollowUp.collection.find({ created_at: { $lt: before }, tz_fixed: { $ne: true } })
    .sort({ scheduled_date: -1 }).limit(3).toArray();
  console.log(`Follow-ups created before ${before.toISOString()} and not yet fixed: ${count}`);
  sample.forEach(f => console.log(`  ${f._id}  ${f.scheduled_date.toISOString()}  ->  ${new Date(f.scheduled_date.getTime() - SHIFT_MS).toISOString()}`));

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write.');
  } else {
    const shifted = await fixFollowUpTimes(before);
    console.log(`\nShifted ${shifted} follow-ups back by 5h30.`);
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
