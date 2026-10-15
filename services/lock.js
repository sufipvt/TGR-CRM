// Run one piece of work at a time for a given key, across every request (and
// every server instance, since the lock lives in MongoDB). Used where two people
// acting at the same moment would otherwise both pass a check and both write:
// a repeat enquiry creating two leads, two leads going to the same agent,
// two payments together exceeding the sale value.
const { Lock } = require('../models');

const WAIT_MS = 25;
const MAX_WAIT_MS = 10 * 1000;
// A lock older than this was left by a server that stopped mid-request; take it over.
// (Mongo's TTL cleanup also removes it, but only about once a minute.)
const STALE_MS = 30 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withLock(key, fn) {
  const started = Date.now();
  for (;;) {
    try {
      await Lock.create({ _id: key });
      break;
    } catch (e) {
      if (e.code !== 11000) throw e;
      await Lock.deleteOne({ _id: key, created_at: { $lt: new Date(Date.now() - STALE_MS) } });
      if (Date.now() - started > MAX_WAIT_MS) {
        throw Object.assign(new Error('The system is busy. Please try again.'), { status: 503 });
      }
      await sleep(WAIT_MS + Math.floor(Math.random() * WAIT_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await Lock.deleteOne({ _id: key }).catch(() => {});
  }
}

module.exports = { withLock };
