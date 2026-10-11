// One-time fix for the switch to India time (PR #18, merged 2026-10-11 17:41 UTC).
//
// Before the switch the server ran on UTC, so a follow-up typed in as 10:00 was
// stored as 10:00 UTC (= 15:30 IST) and now shows 5h30 late. This moves every
// follow-up created before the switch back by 5h30. Each one is marked tz_fixed,
// so it is never shifted twice. Copies of the CRM set up after the switch have
// nothing to fix.
const { FollowUp } = require('../models');

const IST_SWITCH_AT = new Date('2026-10-11T17:41:46Z');
const SHIFT_MS = 5.5 * 60 * 60 * 1000;

const unfixed = before => ({ created_at: { $lt: before }, tz_fixed: { $ne: true } });

function countUnfixedFollowUps(before = IST_SWITCH_AT) {
  return FollowUp.collection.countDocuments(unfixed(before));
}

async function fixFollowUpTimes(before = IST_SWITCH_AT) {
  let shifted = 0;
  for await (const f of FollowUp.collection.find(unfixed(before)).project({ scheduled_date: 1 })) {
    if (!f.scheduled_date) continue;
    // tz_fixed in the filter makes the write a no-op if two runs overlap
    const r = await FollowUp.collection.updateOne(
      { _id: f._id, tz_fixed: { $ne: true } },
      { $set: { scheduled_date: new Date(f.scheduled_date.getTime() - SHIFT_MS), tz_fixed: true } }
    );
    shifted += r.modifiedCount;
  }
  return shifted;
}

module.exports = { IST_SWITCH_AT, SHIFT_MS, countUnfixedFollowUps, fixFollowUpTimes };
