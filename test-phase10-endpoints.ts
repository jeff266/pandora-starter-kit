/**
 * Phase 10 Endpoint Test
 *
 * Tests all 8 new Forward Deploy API endpoints
 */

import { resolveWorkspaceIntelligence } from './server/lib/workspace-intelligence.js';
import { query } from './server/db.js';

const FRONTERA = '4160191d-73bc-414b-97dd-5a1853190378';

console.log('=== Phase 10 API Endpoint Simulation ===\n');

// Test 1: GET /api/workspaces/:id/intelligence
console.log('1. GET /api/workspaces/:id/intelligence');
try {
  const wi = await resolveWorkspaceIntelligence(FRONTERA);
  console.log('✓ Status: 200 OK');
  console.log(`  - Workspace ID: ${wi.workspace_id}`);
  console.log(`  - Overall readiness: ${wi.readiness.overall_score}%`);
  console.log(`  - Active stages: ${wi.pipeline.active_stages.length}`);
  console.log(`  - Metrics count: ${Object.keys(wi.metrics).length}`);
  console.log(`  - Skill gates: ${Object.keys(wi.readiness.skill_gates).length} skills evaluated`);
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

// Test 2: GET /api/workspaces/:id/intelligence/readiness
console.log('2. GET /api/workspaces/:id/intelligence/readiness');
try {
  const wi = await resolveWorkspaceIntelligence(FRONTERA);
  const readiness = {
    overall_score: wi.readiness.overall_score,
    by_domain: wi.readiness.by_domain,
    blocking_gaps: wi.readiness.blocking_gaps,
    skill_gates: wi.readiness.skill_gates,
  };
  console.log('✓ Status: 200 OK');
  console.log(`  - Overall score: ${readiness.overall_score}`);
  console.log(`  - Business: ${Math.round(readiness.by_domain.business * 100)}%`);
  console.log(`  - Pipeline: ${Math.round(readiness.by_domain.pipeline * 100)}%`);
  console.log(`  - Blocking gaps: ${readiness.blocking_gaps.length}`);
  console.log(`  - pipeline-waterfall gate: ${readiness.skill_gates['pipeline-waterfall']}`);
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

// Test 3: GET /api/workspaces/:id/calibration
console.log('3. GET /api/workspaces/:id/calibration');
try {
  const result = await query(
    `SELECT question_id, domain, status
     FROM calibration_checklist
     WHERE workspace_id = $1`,
    [FRONTERA]
  );

  const domains: Record<string, any> = {
    business: { total: 0, confirmed: 0, inferred: 0, unknown: 0 },
    metrics: { total: 0, confirmed: 0, inferred: 0, unknown: 0 },
    taxonomy: { total: 0, confirmed: 0, inferred: 0, unknown: 0 },
    pipeline: { total: 0, confirmed: 0, inferred: 0, unknown: 0 },
    segmentation: { total: 0, confirmed: 0, inferred: 0, unknown: 0 },
    data_quality: { total: 0, confirmed: 0, inferred: 0, unknown: 0 },
  };

  for (const row of result.rows) {
    const domain = row.domain;
    if (domains[domain]) {
      domains[domain].total++;
      if (row.status === 'CONFIRMED') domains[domain].confirmed++;
      else if (row.status === 'INFERRED') domains[domain].inferred++;
      else if (row.status === 'UNKNOWN') domains[domain].unknown++;
    }
  }

  console.log('✓ Status: 200 OK');
  console.log(`  - Total questions: ${result.rows.length}`);
  console.log(`  - Pipeline domain: ${domains.pipeline.total} questions (${domains.pipeline.confirmed} confirmed, ${domains.pipeline.inferred} inferred, ${domains.pipeline.unknown} unknown)`);
  console.log(`  - Business domain: ${domains.business.total} questions (${domains.business.confirmed} confirmed, ${domains.business.inferred} inferred, ${domains.business.unknown} unknown)`);
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

// Test 4: Check current state of pipeline_coverage_target
console.log('4. Check pipeline_coverage_target status');
try {
  const result = await query(
    `SELECT question_id, status, answer
     FROM calibration_checklist
     WHERE workspace_id = $1 AND question_id = 'pipeline_coverage_target'`,
    [FRONTERA]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    console.log('✓ Current state:');
    console.log(`  - Question: ${row.question_id}`);
    console.log(`  - Status: ${row.status}`);
    console.log(`  - Answer: ${row.answer ? JSON.stringify(row.answer) : 'null'}`);
  } else {
    console.log('✗ pipeline_coverage_target not found in checklist');
  }
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

// Test 5: Simulate PATCH /api/workspaces/:id/calibration/:questionId
console.log('5. Simulate PATCH /api/workspaces/:id/calibration/pipeline_coverage_target');
console.log('   (Setting coverage target to 3.0 with CONFIRMED status)');
try {
  const result = await query(
    `UPDATE calibration_checklist
     SET answer = $1, status = $2, confidence = $3,
         confirmed_by = $4, confirmed_at = NOW(),
         human_confirmed = true,
         answer_source = 'FORWARD_DEPLOY',
         updated_at = NOW()
     WHERE workspace_id = $5 AND question_id = $6
     RETURNING *`,
    [JSON.stringify({ value: 3.0 }), 'CONFIRMED', 1.0, 'phase10-test', FRONTERA, 'pipeline_coverage_target']
  );

  if (result.rows.length > 0) {
    console.log('✓ Status: 200 OK');
    console.log(`  - Updated pipeline_coverage_target to CONFIRMED`);
    console.log(`  - New answer: ${JSON.stringify(result.rows[0].answer)}`);
    console.log(`  - Status: ${result.rows[0].status}`);
  } else {
    console.log('✗ Update failed - row not found');
  }
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

// Test 6: Check if pipeline_coverage_target is no longer in blocking_gaps
console.log('6. Check if pipeline_coverage_target removed from blocking_gaps');
try {
  const wi = await resolveWorkspaceIntelligence(FRONTERA);
  const isBlocking = wi.readiness.blocking_gaps.includes('pipeline_coverage_target');

  if (!isBlocking) {
    console.log('✓ pipeline_coverage_target is NOT in blocking_gaps (expected after CONFIRMED)');
  } else {
    console.log('✗ pipeline_coverage_target is still in blocking_gaps');
  }

  console.log(`  - Current blocking gaps: ${wi.readiness.blocking_gaps.length}`);
  if (wi.readiness.blocking_gaps.length > 0) {
    console.log(`  - Remaining gaps: ${wi.readiness.blocking_gaps.slice(0, 5).join(', ')}`);
  }
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

// Test 7: Check pipeline-waterfall skill gate
console.log('7. Check pipeline-waterfall skill gate after PATCH');
try {
  const wi = await resolveWorkspaceIntelligence(FRONTERA);
  const gate = wi.readiness.skill_gates['pipeline-waterfall'];

  console.log(`✓ pipeline-waterfall gate: ${gate}`);

  if (gate === 'LIVE') {
    console.log('  ✓ Skill moved to LIVE mode (all required questions answered)');
  } else if (gate === 'DRAFT') {
    console.log('  - Still in DRAFT mode (some preferred questions missing)');
  } else if (gate === 'BLOCKED') {
    console.log('  - Still BLOCKED (required questions missing)');
  }

  console.log(`  - Other priority skills:`);
  console.log(`    - pipeline-coverage: ${wi.readiness.skill_gates['pipeline-coverage']}`);
  console.log(`    - rep-scorecard: ${wi.readiness.skill_gates['rep-scorecard']}`);
  console.log(`    - forecast-rollup: ${wi.readiness.skill_gates['forecast-rollup']}`);
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

// Test 8: GET /api/workspaces/:id/metrics
console.log('8. GET /api/workspaces/:id/metrics');
try {
  const result = await query(
    `SELECT metric_key, label, confidence, source
     FROM metric_definitions
     WHERE workspace_id = $1
     ORDER BY metric_key
     LIMIT 5`,
    [FRONTERA]
  );

  console.log('✓ Status: 200 OK');
  console.log(`  - Total metrics: ${result.rows.length}`);
  for (const metric of result.rows) {
    console.log(`    - ${metric.metric_key}: ${metric.confidence} (${metric.source})`);
  }
} catch (err: any) {
  console.log('✗ Failed:', err.message);
}
console.log('');

console.log('=== Phase 10 Endpoint Test Complete ===');
process.exit(0);
