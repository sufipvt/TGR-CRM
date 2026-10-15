// Team data isolation: which leads / follow-ups / bookings each role can see or edit.
const { Types } = require('mongoose');
const { User, Lead } = require('../models');
const { isAdminRole, isTeamLeader } = require('../utils/roles');

// Get all Sub-TL user IDs under a Team Leader's team
async function getTeamMemberIds(user) {
  if (!user.team_id) return [];
  const members = await User.find({ team_id: user.team_id }).select('_id');
  return members.map(m => m._id);
}

// Visibility filters per role
async function visibleLeadFilter(user) {
  if (isAdminRole(user.role)) return {};
  if (isTeamLeader(user.role)) {
    const memberIds = await getTeamMemberIds(user);
    return {
      $or: [
        { assigned_caller_id: { $in: memberIds } },
        { assigned_closer_id: { $in: memberIds } }
      ]
    };
  }
  // Sub Team Leader — sees only own leads (as caller or closer)
  const uid = new Types.ObjectId(user.userId);
  return { $or: [{ assigned_caller_id: uid }, { assigned_closer_id: uid }] };
}
async function visibleFollowUpFilter(user) {
  if (isAdminRole(user.role)) return {};
  if (isTeamLeader(user.role)) {
    const memberIds = await getTeamMemberIds(user);
    return { assigned_to_id: { $in: memberIds } };
  }
  return { assigned_to_id: new Types.ObjectId(user.userId) };
}
async function visibleBookingFilter(user) {
  if (isAdminRole(user.role)) return {};
  if (isTeamLeader(user.role)) {
    const memberIds = await getTeamMemberIds(user);
    return { closer_id: { $in: memberIds } };
  }
  return { closer_id: new Types.ObjectId(user.userId) };
}
async function canEditLead(user, leadId) {
  if (!Types.ObjectId.isValid(String(leadId || ''))) return false;
  if (isAdminRole(user.role)) return true;
  const lead = await Lead.findById(leadId).select('assigned_caller_id assigned_closer_id');
  if (!lead) return false;
  const uid = String(user.userId);
  if (String(lead.assigned_caller_id || '') === uid || String(lead.assigned_closer_id || '') === uid) return true;
  if (isTeamLeader(user.role)) {
    const memberIds = (await getTeamMemberIds(user)).map(String);
    return memberIds.includes(String(lead.assigned_caller_id || '')) || memberIds.includes(String(lead.assigned_closer_id || ''));
  }
  return false;
}

// Can this user act on records owned by targetUserId (a follow-up's assignee,
// a booking's closer)? Admins: anyone. Team Leaders: anyone in their team.
// Sub Team Leaders: only themselves.
async function canActForUser(user, targetUserId) {
  if (isAdminRole(user.role)) return true;
  if (!targetUserId) return false;
  const target = String(targetUserId);
  if (target === String(user.userId)) return true;
  if (isTeamLeader(user.role)) {
    return (await getTeamMemberIds(user)).map(String).includes(target);
  }
  return false;
}

// Can this user hand work (a lead, follow-up, booking) to targetUserId?
// Admins: anyone. Everyone else: themselves or someone in their own team.
async function canAssignTo(user, targetUserId) {
  if (isAdminRole(user.role)) return true;
  if (!targetUserId) return true; // leaving it unassigned is always allowed
  const target = String(targetUserId);
  if (target === String(user.userId)) return true;
  return (await getTeamMemberIds(user)).map(String).includes(target);
}

module.exports = {
  getTeamMemberIds,
  visibleLeadFilter,
  visibleFollowUpFilter,
  visibleBookingFilter,
  canEditLead,
  canActForUser,
  canAssignTo
};
