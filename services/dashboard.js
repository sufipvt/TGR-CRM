// The dashboard's "Today" lists: what each person should act on right now.
// Every list is narrowed by the caller's own visibility filters, so a Team Leader
// sees their team's work and a Sub Team Leader only their own.
const { Lead, FollowUp } = require('../models');
const { CLOSED_STATUSES } = require('./assignment');
const { phoneLinks } = require('../utils/format');

const LIST_SIZE = 10;
const LEAD_FIELDS = 'name phone status temperature last_enquiry_at assigned_caller_id created_at';

async function listAndCount(model, where, sort, populate) {
  let q = model.find(where).sort(sort).limit(LIST_SIZE);
  for (const p of populate) q = q.populate(p);
  const [items, total] = await Promise.all([q.lean(), model.countDocuments(where)]);
  return { items, total };
}

async function loadToday({ leadFilter, fuFilter }, now = new Date()) {
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const fuLead = { path: 'lead_id', select: LEAD_FIELDS };
  const owner = { path: 'assigned_to_id', select: 'full_name' };
  const caller = { path: 'assigned_caller_id', select: 'full_name' };
  const open = { status: { $nin: CLOSED_STATUSES } };

  const [calls, uncalled, hot, visits] = await Promise.all([
    // Overdue and due today, oldest first, so nothing slips
    listAndCount(FollowUp, { ...fuFilter, status: 'Pending', scheduled_date: { $lte: endOfToday } },
      'scheduled_date', [fuLead, owner]),
    // Fresh leads nobody has logged a call on yet
    listAndCount(Lead, { ...leadFilter, status: 'New', contact_outcome: null },
      { listed_at: -1, created_at: -1 }, [caller]),
    listAndCount(Lead, { ...leadFilter, ...open, temperature: 'Hot' },
      { listed_at: -1, created_at: -1 }, [caller]),
    listAndCount(FollowUp, { ...fuFilter, type: 'Site Visit', status: { $in: ['Pending', 'Completed'] }, scheduled_date: { $gte: startOfToday, $lte: endOfToday } },
      'scheduled_date', [fuLead, owner])
  ]);
  return { calls, uncalled, hot, visits, now, phoneLinks };
}

module.exports = { loadToday, phoneLinks, LIST_SIZE };
