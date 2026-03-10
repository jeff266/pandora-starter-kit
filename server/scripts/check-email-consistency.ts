/**
 * Email Consistency Diagnostic
 *
 * Run this before Phase 2 (role-based data scoping) goes live.
 * Validates that owner_email normalization is working correctly.
 *
 * Usage:
 *   npx tsx server/scripts/check-email-consistency.ts [workspace_id]
 */

import { query } from '../db.js';
import { normalizeEmail } from '../utils/email-normalization.js';

async function checkWorkspace(workspaceId: string) {
  console.log(`\n=== Checking workspace: ${workspaceId} ===\n`);

  // Get workspace members
  const members = await query(
    `SELECT email, role FROM workspace_members WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (members.rows.length === 0) {
    console.log('⚠️  No workspace members found');
    return;
  }

  console.log(`✅ Workspace members: ${members.rows.length}`);
  for (const member of members.rows) {
    console.log(`   - ${member.email} (${member.role})`);
  }

  // Check deals with owner_email populated
  const dealsWithEmail = await query(
    `SELECT COUNT(*) as count FROM deals
     WHERE workspace_id = $1 AND owner_email IS NOT NULL`,
    [workspaceId]
  );

  const dealsWithoutEmail = await query(
    `SELECT COUNT(*) as count FROM deals
     WHERE workspace_id = $1 AND owner_email IS NULL`,
    [workspaceId]
  );

  console.log(`\nDeal ownership data:`);
  console.log(`✅ Deals with owner_email: ${dealsWithEmail.rows[0].count}`);
  if (parseInt(dealsWithoutEmail.rows[0].count) > 0) {
    console.log(`⚠️  Deals without owner_email: ${dealsWithoutEmail.rows[0].count} (will be fixed on next sync)`);
  }

  // Check for email normalization issues
  console.log(`\nEmail normalization check:`);
  let allMatch = true;

  for (const member of members.rows) {
    const normalized = normalizeEmail(member.email);

    // Find deals owned by this member (exact match)
    const exactMatch = await query(
      `SELECT COUNT(*) as count FROM deals
       WHERE workspace_id = $1 AND owner_email = $2`,
      [workspaceId, normalized]
    );

    // Find deals with similar email (case-insensitive, including variants)
    const similarMatch = await query(
      `SELECT DISTINCT owner_email, COUNT(*) as count
       FROM deals
       WHERE workspace_id = $1
         AND LOWER(owner_email) = $2
       GROUP BY owner_email`,
      [workspaceId, normalized]
    );

    const exactCount = parseInt(exactMatch.rows[0].count);
    const variantCount = similarMatch.rows.length;

    if (exactCount > 0) {
      console.log(`✅ ${member.email}: ${exactCount} deals`);
    } else if (variantCount > 0) {
      console.log(`⚠️  ${member.email}: 0 exact matches, but found ${variantCount} variant(s):`);
      for (const variant of similarMatch.rows) {
        console.log(`     - ${variant.owner_email} (${variant.count} deals)`);
      }
      allMatch = false;
    } else {
      console.log(`ℹ️  ${member.email}: 0 deals (might not own any deals)`);
    }
  }

  // Check for deals owned by emails not in workspace
  const unknownOwners = await query(
    `SELECT owner_email, COUNT(*) as count
     FROM deals
     WHERE workspace_id = $1
       AND owner_email IS NOT NULL
       AND owner_email NOT IN (
         SELECT email FROM workspace_members WHERE workspace_id = $1
       )
     GROUP BY owner_email`,
    [workspaceId]
  );

  if (unknownOwners.rows.length > 0) {
    console.log(`\n⚠️  Deals owned by emails not in workspace:`);
    for (const row of unknownOwners.rows) {
      console.log(`   - ${row.owner_email}: ${row.count} deals`);
    }
    console.log(`   → Add these users to workspace or reassign deals`);
  }

  if (allMatch && unknownOwners.rows.length === 0 && parseInt(dealsWithoutEmail.rows[0].count) === 0) {
    console.log(`\n✅ Email consistency check PASSED`);
    console.log(`   → Safe to enable Phase 2 (role-based scoping)`);
  } else {
    console.log(`\n⚠️  Email consistency check needs attention`);
    console.log(`   → Fix issues above before enabling Phase 2`);
  }
}

async function main() {
  const workspaceId = process.argv[2];

  if (!workspaceId) {
    // Check all workspaces
    const workspaces = await query(`SELECT id, name FROM workspaces ORDER BY created_at`);

    if (workspaces.rows.length === 0) {
      console.log('No workspaces found');
      process.exit(0);
    }

    console.log(`Found ${workspaces.rows.length} workspace(s)\n`);

    for (const ws of workspaces.rows) {
      await checkWorkspace(ws.id);
    }
  } else {
    await checkWorkspace(workspaceId);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
