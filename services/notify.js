// In-app alerts (the bell). Who hears about a lead follows the same rules as who may
// see it: its caller and closer, their team leaders, and the admins.
const { User, Team, Notification } = require('../models');

const LIST_SIZE = 10;

async function leadAudience(lead) {
  const ownerIds = [lead.assigned_caller_id, lead.assigned_closer_id].filter(Boolean);
  const owners = ownerIds.length
    ? await User.find({ _id: { $in: ownerIds }, status: 'Active' }).select('_id team_id').lean()
    : [];
  const teamIds = owners.map(u => u.team_id).filter(Boolean);
  const teams = teamIds.length
    ? await Team.find({ _id: { $in: teamIds }, team_leader_id: { $ne: null } }).select('team_leader_id').lean()
    : [];
  const leaderIds = teams.map(t => t.team_leader_id);
  const leaders = leaderIds.length
    ? await User.find({ _id: { $in: leaderIds }, status: 'Active' }).select('_id').lean()
    : [];
  const admins = await User.find({ status: 'Active', role: { $in: ['Super Admin', 'Admin'] } }).select('_id').lean();
  return [...new Set([...owners, ...leaders, ...admins].map(u => String(u._id)))];
}

// A lead arrived from the enquiry form or webhook, or an existing one enquired again.
async function notifyLeadCaptured(lead, { duplicate, via }) {
  const userIds = await leadAudience(lead);
  if (!userIds.length) return 0;
  const hot = lead.temperature === 'Hot' ? 'hot ' : '';
  const title = duplicate ? `${lead.name} enquired again` : `New ${hot}lead: ${lead.name}`;
  const body = `${lead.phone} · via ${via}`;
  const link = '/app?page=leads&q=' + encodeURIComponent(lead.phone);
  const kind = duplicate ? 'repeat_enquiry' : 'new_lead';
  await Notification.insertMany(userIds.map(user_id => ({ user_id, kind, title, body, lead_id: lead._id, link })));
  return userIds.length;
}

function timeAgo(date, now = Date.now()) {
  const mins = Math.floor((now - new Date(date).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hours / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

// Unread count plus the latest few, ready to show.
async function notificationSummary(userId) {
  const [unread, latest] = await Promise.all([
    Notification.countDocuments({ user_id: userId, read_at: null }),
    Notification.find({ user_id: userId }).sort('-created_at').limit(LIST_SIZE).lean()
  ]);
  return {
    unread,
    items: latest.map(n => ({
      id: String(n._id), kind: n.kind, title: n.title, body: n.body || '',
      link: n.link || '', read: !!n.read_at, when: timeAgo(n.created_at)
    }))
  };
}

async function markAllRead(userId) {
  const r = await Notification.updateMany({ user_id: userId, read_at: null }, { read_at: new Date() });
  return r.modifiedCount || 0;
}

module.exports = { leadAudience, notifyLeadCaptured, notificationSummary, markAllRead, timeAgo };
