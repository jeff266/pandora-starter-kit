/**
 * Test script for workspace seeding
 * Creates a test workspace and verifies roles, members, and flags are seeded correctly
 */

import { query } from '../server/db.js';
import { seedNewWorkspace } from '../server/permissions/seed-workspace.js';
import { getFlagsForPlan } from '../server/permissions/feature-flags.js';

async function testWorkspaceSeed() {
  console.log('🧪 Testing workspace seeding...\n');

  try {
    // 1. Create a test workspace
    console.log('1️⃣  Creating test workspace...');
    const slug = `test-seed-${Date.now()}`;
    const workspaceResult = await query(
      `INSERT INTO workspaces (name, slug, plan) VALUES ($1, $2, $3) RETURNING id`,
      ['Test Workspace - Seed Verification', slug, 'starter']
    );
    const workspaceId = workspaceResult.rows[0].id;
    console.log(`   ✓ Workspace created: ${workspaceId}\n`);

    // Create a test user (or use existing one)
    const userResult = await query(
      `SELECT id FROM workspace_users LIMIT 1`
    );

    let creatorId: string;
    if (userResult.rows.length > 0) {
      creatorId = userResult.rows[0].id;
      console.log(`   ✓ Using existing user: ${creatorId}\n`);
    } else {
      // Create a test user if none exist
      const newUserResult = await query(
        `INSERT INTO workspace_users (workspace_id, display_name, email)
         VALUES ($1, $2, $3) RETURNING id`,
        [workspaceId, 'Test Admin', 'admin@test.com']
      );
      creatorId = newUserResult.rows[0].id;
      console.log(`   ✓ Created test user: ${creatorId}\n`);
    }

    // 2. Call seedNewWorkspace
    console.log('2️⃣  Seeding workspace...');
    const result = await seedNewWorkspace(workspaceId, creatorId, 'starter');
    console.log(`   ✓ Seeding complete:`);
    console.log(`     - Roles created: ${Object.keys(result.roles).length}`);
    console.log(`     - Member created: ${result.memberCreated}`);
    console.log(`     - Flags seeded: ${result.flagsSeeded}\n`);

    // 3. Query and print created roles
    console.log('3️⃣  Verifying roles...');
    const rolesResult = await query(
      `SELECT name, system_type, is_system, permissions
       FROM workspace_roles
       WHERE workspace_id = $1
       ORDER BY system_type`,
      [workspaceId]
    );

    console.log(`   Found ${rolesResult.rows.length} roles:`);
    for (const role of rolesResult.rows) {
      const permissions = typeof role.permissions === 'string'
        ? JSON.parse(role.permissions)
        : role.permissions;
      const permCount = Object.values(permissions).filter((v: any) => v === true).length;
      console.log(`     - ${role.name} (${role.system_type}): ${permCount} permissions`);
    }
    console.log('');

    // 4. Verify admin member exists with correct role
    console.log('4️⃣  Verifying admin member...');
    const memberResult = await query(
      `SELECT wu.*, wu.role as user_role
       FROM workspace_users wu
       WHERE wu.workspace_id = $1 AND wu.id = $2`,
      [workspaceId, creatorId]
    );

    if (memberResult.rows.length === 0) {
      console.log('   ❌ ERROR: Admin member not found!');
    } else {
      const member = memberResult.rows[0];
      console.log(`   ✓ Admin member found:`);
      console.log(`     - User ID: ${member.id}`);
      console.log(`     - Role: ${member.user_role}`);
      console.log(`     - Display Name: ${member.display_name}`);
      console.log(`     - Active: ${member.is_active ? 'Yes' : 'No'}\n`);

      if (member.user_role !== 'admin') {
        console.log(`   ⚠️  WARNING: Creator has ${member.user_role} role, expected admin`);
      }
    }

    // 5. Verify correct number of flags for starter plan
    console.log('5️⃣  Verifying feature flags...');
    const flagsResult = await query(
      `SELECT key, value, flag_type, set_by
       FROM workspace_flags
       WHERE workspace_id = $1
       ORDER BY flag_type, key`,
      [workspaceId]
    );

    const expectedFlags = getFlagsForPlan('starter');
    console.log(`   Expected flags: ${expectedFlags.length}`);
    console.log(`   Actual flags: ${flagsResult.rows.length}`);

    if (flagsResult.rows.length !== expectedFlags.length) {
      console.log(`   ⚠️  WARNING: Flag count mismatch!\n`);
    } else {
      console.log(`   ✓ Flag count matches\n`);
    }

    // Group flags by type
    const featureFlags = flagsResult.rows.filter((f: any) => f.flag_type === 'feature');
    const capabilityFlags = flagsResult.rows.filter((f: any) => f.flag_type === 'capability');

    console.log(`   Feature flags (${featureFlags.length}):`);
    for (const flag of featureFlags) {
      const value = typeof flag.value === 'string' ? JSON.parse(flag.value) : flag.value;
      console.log(`     - ${flag.key}: ${value ? '✓' : '✗'}`);
    }

    console.log(`\n   Capability flags (${capabilityFlags.length}):`);
    for (const flag of capabilityFlags) {
      const value = typeof flag.value === 'string' ? JSON.parse(flag.value) : flag.value;
      console.log(`     - ${flag.key}: ${value ? '✓' : '✗'}`);
    }

    console.log('\n✅ All verifications complete!\n');

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await query('DELETE FROM workspace_flags WHERE workspace_id = $1', [workspaceId]);
    await query('DELETE FROM workspace_roles WHERE workspace_id = $1', [workspaceId]);
    await query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    console.log('   ✓ Cleanup complete\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run the test
testWorkspaceSeed()
  .then(() => {
    console.log('🎉 Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });
