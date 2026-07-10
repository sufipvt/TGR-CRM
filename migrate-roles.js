// ONE-TIME migration — run with: node migrate-roles.js
// Maps old 4 roles → new hierarchy, creates a Default Team for existing agents
require('dotenv').config({ path: '.env.development.local' });
const mongoose = require('mongoose');

const ROLE_MAP = {
  'Admin':  'Super Admin',
  'MD':     'Admin',
  'Caller': 'Sub Team Leader',
  'Closer': 'Sub Team Leader'
};

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to:', process.env.MONGODB_URI.replace(/:[^:@]+@/, ':****@')); // hides password in log
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const teams = db.collection('teams');

  let defaultTeam = await teams.findOne({ name: 'Default Team' });
  if (!defaultTeam) {
    const result = await teams.insertOne({ name: 'Default Team', team_leader_id: null, created_at: new Date() });
    defaultTeam = { _id: result.insertedId };
    console.log('✅ Created Default Team:', defaultTeam._id);
  } else {
    console.log('ℹ️  Default Team already exists:', defaultTeam._id);
  }

  const allUsers = await users.find({}).toArray();
  console.log(`\nFound ${allUsers.length} users. Migrating...\n`);

  let migrated = 0, skipped = 0;
  for (const u of allUsers) {
    const newRole = ROLE_MAP[u.role];
    if (!newRole) {
      console.log(`⚠️  SKIPPED (already migrated or unknown role): ${u.email} → "${u.role}"`);
      skipped++;
      continue;
    }
    const update = { role: newRole };
    if (newRole === 'Sub Team Leader') update.team_id = defaultTeam._id;
    await users.updateOne({ _id: u._id }, { $set: update });
    console.log(`✅ ${u.email}: ${u.role} → ${newRole}`);
    migrated++;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Migration complete. ${migrated} migrated, ${skipped} skipped.`);
  console.log('Next: verify with Step 4 in the guide, then move to Phase 1b.');
  console.log('='.repeat(50));
  await mongoose.disconnect();
}

migrate().catch(e => { console.error('❌ Migration failed:', e); process.exit(1); });