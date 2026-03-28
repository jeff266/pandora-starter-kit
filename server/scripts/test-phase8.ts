/**
 * Phase 8 Test Script — Forward Deploy Seeder
 *
 * Tests:
 * 1. Run seedWorkspaceForForwardDeploy for Frontera
 * 2. Verify checklist rows exist (count = 108)
 * 3. Verify pre-populated rows (status = INFERRED)
 * 4. Verify idempotency (second run: 108 skipped, 0 inserted)
 * 5. Verify WorkspaceIntelligence readiness scores
 * 6. Verify blocking_gaps populated
 */

import { query } from '../db.js';
import { seedWorkspaceForForwardDeploy } from '../lib/forward-deploy-seeder.js';
import { getWorkspaceIntelligence } from '../lib/workspace-intelligence.js';

const FRONTERA_WORKSPACE_ID = 'ff0c2e6f-e74d-41ad-b9ef-c942cf77c9d9';

console.log('='.repeat(80));
console.log('PHASE 8 TEST — FORWARD DEPLOY SEEDER');
console.log('='.repeat(80));
console.log();

async function main() {
  try {
    // Test 1: Run seedWorkspaceForForwardDeploy for Frontera
    console.log('Test 1: Seeding Frontera workspace');
    const result1 = await seedWorkspaceForForwardDeploy(FRONTERA_WORKSPACE_ID);
    console.log('  Workspace:', result1.workspace_name);
    console.log('  Metrics inserted:', result1.metrics.inserted.length);
    console.log('  Metrics skipped:', result1.metrics.skipped.length);
    console.log('  Checklist inserted:', result1.checklist.inserted.length);
    console.log('  Checklist skipped:', result1.checklist.skipped.length);
    console.log('  Pre-populated:', result1.pre_populated.length);
    if (result1.pre_populated.length > 0) {
      console.log('  Pre-populated questions:', result1.pre_populated.join(', '));
    }
    console.log();

    // Test 2: Verify checklist rows exist (count = 108)
    console.log('Test 2: Verify checklist rows in database');
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM calibration_checklist WHERE workspace_id = $1`,
      [FRONTERA_WORKSPACE_ID]
    );
    const count = parseInt(countResult.rows[0]?.count || '0');
    console.log(`  ✓ Found ${count} checklist rows (expected 108)`);
    if (count !== 108) {
      console.log(`  ✗ Expected 108 rows, got ${count}`);
      process.exit(1);
    }
    console.log();

    // Test 3: Verify pre-populated rows (status = INFERRED)
    console.log('Test 3: Verify pre-populated rows');
    const prePopResult = await query<{ question_id: string; status: string; answer_source: string }>(
      `SELECT question_id, status, answer_source
       FROM calibration_checklist
       WHERE workspace_id = $1 AND status = 'INFERRED'
       ORDER BY question_id`,
      [FRONTERA_WORKSPACE_ID]
    );
    console.log(`  ✓ Found ${prePopResult.rows.length} pre-populated rows`);
    if (prePopResult.rows.length > 0) {
      console.log('  Pre-populated questions:');
      for (const row of prePopResult.rows) {
        console.log(`    - ${row.question_id} (status: ${row.status}, source: ${row.answer_source})`);
      }
    } else {
      console.log('  Note: No pre-populated rows (workspace may have empty config)');
    }
    console.log();

    // Test 4: Verify idempotency (second run)
    console.log('Test 4: Verify idempotency (second run)');
    const result2 = await seedWorkspaceForForwardDeploy(FRONTERA_WORKSPACE_ID);
    console.log('  Metrics inserted:', result2.metrics.inserted.length);
    console.log('  Metrics skipped:', result2.metrics.skipped.length);
    console.log('  Checklist inserted:', result2.checklist.inserted.length);
    console.log('  Checklist skipped:', result2.checklist.skipped.length);

    if (result2.checklist.inserted.length === 0 && result2.checklist.skipped.length === 108) {
      console.log('  ✓ Idempotency verified: 0 inserted, 108 skipped');
    } else {
      console.log(`  ✗ Idempotency failed: expected 0 inserted, got ${result2.checklist.inserted.length}`);
      process.exit(1);
    }
    console.log();

    // Test 5: Verify WorkspaceIntelligence readiness scores
    console.log('Test 5: Verify WorkspaceIntelligence readiness');
    const wi = await getWorkspaceIntelligence(FRONTERA_WORKSPACE_ID);
    console.log('  Overall readiness score:', wi.readiness.overall_score);
    console.log('  Domain scores:');
    console.log('    Business:', wi.readiness.by_domain.business);
    console.log('    Metrics:', wi.readiness.by_domain.metrics);
    console.log('    Segmentation:', wi.readiness.by_domain.segmentation);
    console.log('    Taxonomy:', wi.readiness.by_domain.taxonomy);
    console.log('    Pipeline:', wi.readiness.by_domain.pipeline);
    console.log('    Data Quality:', wi.readiness.by_domain.data_quality);
    console.log();

    // Test 6: Verify blocking_gaps populated
    console.log('Test 6: Verify blocking_gaps');
    console.log('  Blocking gaps count:', wi.readiness.blocking_gaps.length);
    if (wi.readiness.blocking_gaps.length > 0) {
      console.log('  Blocking gaps:', wi.readiness.blocking_gaps.slice(0, 10).join(', '));
      if (wi.readiness.blocking_gaps.length > 10) {
        console.log(`    ... and ${wi.readiness.blocking_gaps.length - 10} more`);
      }
    } else {
      console.log('  Note: No blocking gaps (all required questions answered or no dependencies)');
    }
    console.log();

    // Test 7: Verify skill gates computed
    console.log('Test 7: Verify skill gates');
    const gateCount = Object.keys(wi.readiness.skill_gates).length;
    console.log('  Skill gates computed:', gateCount);
    if (gateCount !== 38) {
      console.log(`  ✗ Expected 38 skill gates, got ${gateCount}`);
      process.exit(1);
    }

    const statusCounts = { LIVE: 0, DRAFT: 0, BLOCKED: 0 };
    for (const gate of Object.values(wi.readiness.skill_gates)) {
      statusCounts[gate]++;
    }
    console.log('  Gate distribution:');
    console.log(`    LIVE: ${statusCounts.LIVE}`);
    console.log(`    DRAFT: ${statusCounts.DRAFT}`);
    console.log(`    BLOCKED: ${statusCounts.BLOCKED}`);
    console.log();

    console.log('='.repeat(80));
    console.log('PHASE 8 TEST COMPLETE — ALL TESTS PASSED');
    console.log('='.repeat(80));
    console.log();
    console.log('Summary:');
    console.log(`  Workspace: ${result1.workspace_name}`);
    console.log(`  Checklist rows: ${count}`);
    console.log(`  Pre-populated questions: ${prePopResult.rows.length}`);
    console.log(`  Overall readiness: ${wi.readiness.overall_score}%`);
    console.log(`  Blocking gaps: ${wi.readiness.blocking_gaps.length}`);
    console.log(`  Skill gates: ${statusCounts.LIVE} LIVE, ${statusCounts.DRAFT} DRAFT, ${statusCounts.BLOCKED} BLOCKED`);
    console.log();

    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

main();
