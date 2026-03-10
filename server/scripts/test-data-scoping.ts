/**
 * Test Script for Role-Based Data Scoping (Phase 2 RBAC)
 *
 * Tests that data visibility filters are correctly applied based on user roles.
 *
 * Usage:
 *   npx tsx server/scripts/test-data-scoping.ts <workspace_id>
 *
 * Prerequisites:
 *   - Run check-email-consistency.ts first to ensure owner_email data is clean
 *   - Workspace must have at least one admin and one rep/viewer with deals
 */

import { query } from '../db.js';
import { normalizeEmail } from '../utils/email-normalization.js';
import { getDataVisibilityScope } from '../permissions/data-visibility.js';
import { buildDealScopeFilter } from '../middleware/apply-data-scope.js';

interface TestUser {
  email: string;
  role: string;
  pandora_role: string;
  permissions: Record<string, boolean>;
}

interface TestResult {
  user: string;
  role: string;
  dealsFilter: string;
  totalDealsInWorkspace: number;
  dealsReturnedForUser: number;
  expectedBehavior: string;
  passed: boolean;
  details?: string;
}

async function getWorkspaceMembers(workspaceId: string): Promise<TestUser[]> {
  const result = await query<{
    email: string;
    role: string;
    pandora_role: string;
    permissions: any;
  }>(
    `SELECT
       u.email,
       wm.role,
       wm.pandora_role,
       wr.permissions
     FROM workspace_members wm
     JOIN users u ON u.user_id = wm.user_id
     LEFT JOIN workspace_roles wr ON wr.id = wm.role_id
     WHERE wm.workspace_id = $1 AND wm.status = 'active'
     ORDER BY wm.pandora_role DESC`,
    [workspaceId]
  );

  return result.rows.map(row => ({
    email: row.email,
    role: row.role,
    pandora_role: row.pandora_role,
    permissions: typeof row.permissions === 'string'
      ? JSON.parse(row.permissions)
      : (row.permissions || {}),
  }));
}

async function getTotalDeals(workspaceId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1`,
    [workspaceId]
  );
  return parseInt(result.rows[0].count, 10);
}

async function getDealsForUser(
  workspaceId: string,
  userEmail: string,
  scopeSQL: string,
  scopeParams: any[]
): Promise<number> {
  let sql = `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1`;
  const params: any[] = [workspaceId];

  if (scopeSQL) {
    // Replace parameter placeholders
    let renumberedSQL = scopeSQL;
    if (scopeParams.length > 0) {
      renumberedSQL = scopeSQL.replace(/\$(\d+)/g, (_, num) => `$${parseInt(num, 10) + 1}`);
      params.push(...scopeParams);
    }
    sql += ` ${renumberedSQL}`;
  }

  const result = await query<{ count: string }>(sql, params);
  return parseInt(result.rows[0].count, 10);
}

async function getDealOwnersForUser(
  workspaceId: string,
  userEmail: string,
  scopeSQL: string,
  scopeParams: any[]
): Promise<string[]> {
  let sql = `SELECT DISTINCT owner_email FROM deals WHERE workspace_id = $1`;
  const params: any[] = [workspaceId];

  if (scopeSQL) {
    let renumberedSQL = scopeSQL;
    if (scopeParams.length > 0) {
      renumberedSQL = scopeSQL.replace(/\$(\d+)/g, (_, num) => `$${parseInt(num, 10) + 1}`);
      params.push(...scopeParams);
    }
    sql += ` ${renumberedSQL}`;
  }

  sql += ` AND owner_email IS NOT NULL ORDER BY owner_email`;

  const result = await query<{ owner_email: string }>(sql, params);
  return result.rows.map(r => r.owner_email);
}

async function testUserScoping(
  workspaceId: string,
  user: TestUser,
  totalDeals: number
): Promise<TestResult> {
  console.log(`\n  Testing: ${user.email} (${user.pandora_role || user.role})`);

  // Compute data scope
  const dataScope = getDataVisibilityScope(user.permissions);
  console.log(`    Data scope: dealsFilter=${dataScope.dealsFilter}, canExport=${dataScope.canExport}`);

  // Build scope filter (simulating req object)
  const mockReq = {
    dataScope,
    user: { email: user.email },
  } as any;

  const scopeFilter = buildDealScopeFilter(mockReq, 0);
  console.log(`    Scope SQL: ${scopeFilter.sql || '(none - sees all)'}`);
  console.log(`    Scope params: ${JSON.stringify(scopeFilter.params)}`);

  // Query deals with scope applied
  const dealsReturned = await getDealsForUser(
    workspaceId,
    user.email,
    scopeFilter.sql,
    scopeFilter.params
  );

  // Get distinct owners visible to this user
  const visibleOwners = await getDealOwnersForUser(
    workspaceId,
    user.email,
    scopeFilter.sql,
    scopeFilter.params
  );

  console.log(`    Deals returned: ${dealsReturned} / ${totalDeals}`);
  console.log(`    Visible owners: ${visibleOwners.join(', ')}`);

  // Determine expected behavior
  let expectedBehavior: string;
  let passed: boolean;
  let details: string | undefined;

  const normalizedEmail = normalizeEmail(user.email);

  if (dataScope.dealsFilter === 'all') {
    // Admin: should see all deals
    expectedBehavior = 'See all deals (admin)';
    passed = dealsReturned === totalDeals;
    if (!passed) {
      details = `Expected ${totalDeals} deals but got ${dealsReturned}`;
    }
  } else if (dataScope.dealsFilter === 'own') {
    // Rep/Viewer: should see only own deals
    expectedBehavior = `See only deals where owner_email = '${normalizedEmail}'`;

    // Check that all visible owners match the user's email
    const allOwnersMatch = visibleOwners.every(owner => owner === normalizedEmail);
    passed = allOwnersMatch && dealsReturned >= 0;

    if (!passed) {
      details = `Expected only deals owned by ${normalizedEmail}, but found: ${visibleOwners.join(', ')}`;
    } else if (dealsReturned === 0) {
      details = `User has no deals (this is OK if they don't own any deals)`;
    }
  } else {
    expectedBehavior = `Unknown filter: ${dataScope.dealsFilter}`;
    passed = false;
    details = 'Unexpected dealsFilter value';
  }

  return {
    user: user.email,
    role: user.pandora_role || user.role,
    dealsFilter: dataScope.dealsFilter,
    totalDealsInWorkspace: totalDeals,
    dealsReturnedForUser: dealsReturned,
    expectedBehavior,
    passed,
    details,
  };
}

async function main() {
  const workspaceId = process.argv[2];

  if (!workspaceId) {
    console.error('Usage: npx tsx server/scripts/test-data-scoping.ts <workspace_id>');
    process.exit(1);
  }

  console.log(`\n=== Role-Based Data Scoping Test ===`);
  console.log(`Workspace: ${workspaceId}\n`);

  // Get workspace info
  const wsInfo = await query<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (wsInfo.rows.length === 0) {
    console.error(`❌ Workspace not found: ${workspaceId}`);
    process.exit(1);
  }

  console.log(`Workspace name: ${wsInfo.rows[0].name}`);

  // Get total deals
  const totalDeals = await getTotalDeals(workspaceId);
  console.log(`Total deals in workspace: ${totalDeals}\n`);

  if (totalDeals === 0) {
    console.log('⚠️  No deals found in workspace. Run a sync first.');
    process.exit(0);
  }

  // Get workspace members
  const members = await getWorkspaceMembers(workspaceId);

  if (members.length === 0) {
    console.error('❌ No workspace members found');
    process.exit(1);
  }

  console.log(`Found ${members.length} workspace member(s)`);

  // Test each user
  const results: TestResult[] = [];

  for (const member of members) {
    try {
      const result = await testUserScoping(workspaceId, member, totalDeals);
      results.push(result);
    } catch (err) {
      console.error(`  ❌ Error testing ${member.email}:`, err);
      results.push({
        user: member.email,
        role: member.pandora_role || member.role,
        dealsFilter: 'error',
        totalDealsInWorkspace: totalDeals,
        dealsReturnedForUser: 0,
        expectedBehavior: 'Error during test',
        passed: false,
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Print summary
  console.log('\n=== Test Results Summary ===\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.user} (${result.role})`);
    console.log(`   Filter: ${result.dealsFilter}`);
    console.log(`   Expected: ${result.expectedBehavior}`);
    console.log(`   Returned: ${result.dealsReturnedForUser} / ${result.totalDealsInWorkspace} deals`);
    if (result.details) {
      console.log(`   Details: ${result.details}`);
    }
    console.log('');
  }

  // Overall status
  console.log(`\n${'='.repeat(50)}`);
  if (failed === 0) {
    console.log('✅ ALL TESTS PASSED');
    console.log(`   ${passed} user(s) tested successfully`);
    console.log('   → Role-based data scoping is working correctly');
  } else {
    console.log(`⚠️  ${failed} TEST(S) FAILED`);
    console.log(`   ${passed} passed, ${failed} failed`);
    console.log('   → Review failed tests above');
  }
  console.log(`${'='.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
