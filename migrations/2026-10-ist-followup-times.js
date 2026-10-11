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
// Usage (run right after the IST deploy is live):
//   node migrations/2026-10-ist-followup-times.js --before 2026-10-12T10:00:00Z          # dry run
//   node migrations/2026-10-ist-followup-times.js --before 2026-10-12T10:00:00Z --apply  # write
// --before: the moment the IST deploy went live (from Render's deploy log), in UTC.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.development.local') });
const mongoose = require('mongoose');

const SHIFT_MS = 5.5 * 60 * 60 * 1000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  const beforeArg = arg('--before');
  const apply = process.argv.includes('--apply');
  const before = new Date(beforeArg);
  if (!beforeArg || isNaN(before)) {
    console.error('Pass --before <ISO time the IST deploy went live>, e.g. --before 2026-10-12T10:00:00Z');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);
  const followups = mongoose.connection.db.collection('followups');
  const filter = { created_at: { $lt: before }, tz_fixed: { $ne: true } };

  const count = await followups.countDocuments(filter);
  const sample = await followups.find(filter).sort({ scheduled_date: -1 }).limit(3).toArray();
  console.log(`Follow-ups created before ${before.toISOString()} and not yet fixed: ${count}`);
  sample.forEach(f => console.log(`  ${f._id}  ${f.scheduled_date.toISOString()}  ->  ${new Date(f.scheduled_date.getTime() - SHIFT_MS).toISOString()}`));

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write.');
  } else {
    let shifted = 0;
    for await (const f of followups.find(filter).project({ scheduled_date: 1 })) {
      // tz_fixed in the filter makes each write a no-op if this ever runs twice at once
      const r = await followups.updateOne(
        { _id: f._id, tz_fixed: { $ne: true } },
        { $set: { scheduled_date: new Date(f.scheduled_date.getTime() - SHIFT_MS), tz_fixed: true } }
      );
      shifted += r.modifiedCount;
    }
    console.log(`\nShifted ${shifted} follow-ups back by 5h30.`);
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
