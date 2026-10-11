// Role predicates. Pure functions, no database access.
function isSuperAdmin(role) { return role === 'Super Admin'; }
function isAdminRole(role)  { return ['Super Admin', 'Admin'].includes(role); }
function isTeamLeader(role) { return role === 'Team Leader'; }
function isManager(role)    { return ['Super Admin', 'Admin', 'Team Leader'].includes(role); }

// Same check as isManager, but takes the user object (used by the chatbot).
function isAdminOrMD(user) {
  return ['Super Admin', 'Admin', 'Team Leader'].includes(user.role);
}

module.exports = { isSuperAdmin, isAdminRole, isTeamLeader, isManager, isAdminOrMD };
