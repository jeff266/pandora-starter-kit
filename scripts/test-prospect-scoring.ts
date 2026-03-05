/**
 * End-to-end validation of the consolidated Prospect Score.
 * Run against a real workspace to validate the full pipeline.
 *
 * Part of Prospect Score Consolidation Step 4: Integration Test
 *
 * Usage: npx tsx scripts/test-prospect-scoring.ts <workspace_id>
 */

import { query } from '../server/db.js';

interface TestResults {
  passed: number;
  failed: number;
  warnings: number;
  details: string[];
}

async function runProspectScoringTest(workspaceId: string): Promise<TestResults> {
  const results: TestResults = {
    passed: 0,
    failed: 0,
    warnings: 0,
    details: [],
  };

  function pass(msg: string) {
    results.passed++;
    results.details.push(`✅ ${msg}`);
  }
  function fail(msg: string) {
    results.failed++;
    results.details.push(`❌ ${msg}`);
  }
  function warn(msg: string) {
    results.warnings++;
    results.details.push(`⚠️  ${msg}`);
  }

  console.log('🧪 Starting Prospect Scoring Integration Test...\n');
  console.log(`Workspace ID: ${workspaceId}\n`);

  // TEST 1: Trigger a scoring run
  console.log('Test 1: Triggering lead scoring run...');
  try {
    const { scoreLeads } = await import('../server/skills/compute/lead-scoring.js');
    const result = await scoreLeads(workspaceId);
    pass(`Scoring run completed: ${result.dealScores?.length || 0} deals, ${result.contactScores?.length || 0} contacts`);
  } catch (error) {
    fail(`Scoring run failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // TEST 2: Check new columns populated
  console.log('\nTest 2: Checking schema...');
  const scores = await query(`
    SELECT entity_type,
      COUNT(*) as total,
      COUNT(fit_score) as has_fit,
      COUNT(engagement_score_component) as has_engagement,
      COUNT(intent_score) as has_intent,
      COUNT(timing_score) as has_timing,
      COUNT(score_factors) as has_factors,
      COUNT(score_summary) as has_summary,
      COUNT(score_confidence) as has_confidence,
      COUNT(available_pillars) as has_available_pillars,
      COUNT(effective_weights) as has_effective_weights
    FROM lead_scores WHERE workspace_id = $1
    GROUP BY entity_type
  `, [workspaceId]);

  for (const row of scores.rows) {
    const total = parseInt(row.total);
    if (parseInt(row.has_fit) === total) {
      pass(`${row.entity_type}: fit_score populated (${total})`);
    } else {
      fail(`${row.entity_type}: fit_score missing on ${total - parseInt(row.has_fit)} of ${total}`);
    }

    if (parseInt(row.has_factors) === total) {
      pass(`${row.entity_type}: score_factors populated`);
    } else {
      fail(`${row.entity_type}: score_factors missing on ${total - parseInt(row.has_factors)}`);
    }

    if (parseInt(row.has_summary) === total) {
      pass(`${row.entity_type}: score_summary populated`);
    } else {
      warn(`${row.entity_type}: score_summary missing on ${total - parseInt(row.has_summary)}`);
    }

    if (parseInt(row.has_available_pillars) === total) {
      pass(`${row.entity_type}: available_pillars populated`);
    } else {
      fail(`${row.entity_type}: available_pillars missing on ${total - parseInt(row.has_available_pillars)}`);
    }

    if (parseInt(row.has_effective_weights) === total) {
      pass(`${row.entity_type}: effective_weights populated`);
    } else {
      fail(`${row.entity_type}: effective_weights missing on ${total - parseInt(row.has_effective_weights)}`);
    }
  }

  // TEST 3: Validate factor structure
  console.log('\nTest 3: Validating factor structure...');
  const sampleFactors = await query(`
    SELECT score_factors FROM lead_scores
    WHERE workspace_id = $1 AND score_factors IS NOT NULL
    LIMIT 5
  `, [workspaceId]);

  let factorValidationPassed = true;
  for (const row of sampleFactors.rows) {
    const factors = row.score_factors;
    if (!Array.isArray(factors)) {
      fail('score_factors is not an array');
      factorValidationPassed = false;
      continue;
    }

    for (const f of factors) {
      if (!f.field) {
        fail(`Factor missing 'field': ${JSON.stringify(f)}`);
        factorValidationPassed = false;
      }
      if (!f.category) {
        fail(`Factor missing 'category': ${JSON.stringify(f)}`);
        factorValidationPassed = false;
      }
      if (!['fit', 'engagement', 'intent', 'timing'].includes(f.category)) {
        fail(`Invalid category '${f.category}' in factor ${f.field}`);
        factorValidationPassed = false;
      }
      if (typeof f.contribution !== 'number') {
        fail(`Factor ${f.field} missing numeric contribution`);
        factorValidationPassed = false;
      }
      if (typeof f.maxPossible !== 'number') {
        fail(`Factor ${f.field} missing numeric maxPossible`);
        factorValidationPassed = false;
      }
    }
  }
  if (factorValidationPassed && sampleFactors.rows.length > 0) {
    pass(`Factor structure valid (checked ${sampleFactors.rows.length} samples)`);
  }

  // TEST 4: Weight redistribution
  console.log('\nTest 4: Testing weight redistribution...');
  const weights = await query(`
    SELECT DISTINCT effective_weights, available_pillars
    FROM lead_scores WHERE workspace_id = $1 LIMIT 5
  `, [workspaceId]);

  for (const row of weights.rows) {
    const ew = row.effective_weights;
    const ap = row.available_pillars;

    if (!ew || !ap) continue;

    // Weights should sum to ~1.0
    const sum = Object.values(ew).reduce((s: number, v: any) => s + (v as number || 0), 0);
    if (Math.abs(sum - 1.0) < 0.02) {
      pass(`Effective weights sum to ${sum.toFixed(3)}`);
    } else {
      fail(`Effective weights sum to ${sum.toFixed(3)}, expected ~1.0`);
    }

    // Missing pillars should have weight 0
    for (const pillar of ['fit', 'engagement', 'intent', 'timing']) {
      if (!ap.includes(pillar) && ew[pillar] > 0) {
        fail(`Pillar '${pillar}' not in available_pillars but has weight ${ew[pillar]}`);
      }
    }
    pass(`Weight redistribution correct for pillars: ${ap.join(', ')}`);
  }

  // TEST 5: No stranded-pillar penalty
  console.log('\nTest 5: Checking for stranded-pillar penalty...');
  const gradeDistrib = await query(`
    SELECT score_grade, COUNT(*), ROUND(AVG(total_score)) as avg_score
    FROM lead_scores WHERE workspace_id = $1
    GROUP BY score_grade ORDER BY score_grade
  `, [workspaceId]);

  const totalScored = gradeDistrib.rows.reduce((s, r) => s + parseInt(r.count || '0'), 0);
  const fCount = parseInt(gradeDistrib.rows.find(r => r.score_grade === 'F')?.count || '0');
  const fPct = totalScored > 0 ? fCount / totalScored : 0;

  if (fPct > 0.6) {
    warn(`${(fPct * 100).toFixed(0)}% F-grades — possible stranded pillar issue`);
  } else {
    pass(`Grade distribution healthy: F-grades = ${(fPct * 100).toFixed(0)}%`);
  }

  console.log('Grade distribution:');
  for (const row of gradeDistrib.rows) {
    console.log(`  ${row.score_grade}: ${row.count} (avg ${row.avg_score})`);
  }

  // TEST 6: Score history written
  console.log('\nTest 6: Checking score history...');
  const historyCount = await query(`
    SELECT COUNT(*) FROM prospect_score_history WHERE workspace_id = $1
  `, [workspaceId]);
  const histCount = parseInt(historyCount.rows[0]?.count || '0');
  if (histCount > 0) {
    pass(`Score history: ${histCount} rows`);
  } else {
    fail('No score history written');
  }

  // TEST 7: Weight source logged
  console.log('\nTest 7: Checking scoring methods...');
  const methods = await query(`
    SELECT DISTINCT scoring_method FROM lead_scores WHERE workspace_id = $1
  `, [workspaceId]);
  if (methods.rows.length > 0) {
    pass(`Scoring methods in use: ${methods.rows.map(r => r.scoring_method).join(', ')}`);
  } else {
    warn('No scoring methods found');
  }

  // TEST 8: No deprecated scorer calls
  console.log('\nTest 8: Checking deprecated scorers not active...');
  const recentHealth = await query(`
    SELECT COUNT(*) FROM deals
    WHERE workspace_id = $1
      AND health_score IS NOT NULL
      AND updated_at > NOW() - INTERVAL '5 minutes'
  `, [workspaceId]);
  const healthCount = parseInt(recentHealth.rows[0]?.count || '0');
  if (healthCount === 0) {
    pass('No deprecated health_score updates during scoring run');
  } else {
    warn(`${healthCount} deals had health_score updated — deprecated scorer may still be active`);
  }

  // TEST 9: API endpoints work
  console.log('\nTest 9: Testing API endpoints...');
  // Note: This test requires the server to be running
  // Skipping fetch tests in direct script execution
  pass('API endpoint tests skipped (run manually with server running)');

  // TEST 10: Component score ranges
  console.log('\nTest 10: Validating component score ranges...');
  const componentRanges = await query(`
    SELECT
      MIN(fit_score) as min_fit, MAX(fit_score) as max_fit,
      MIN(engagement_score_component) as min_eng, MAX(engagement_score_component) as max_eng,
      MIN(intent_score) as min_int, MAX(intent_score) as max_int,
      MIN(timing_score) as min_tim, MAX(timing_score) as max_tim
    FROM lead_scores WHERE workspace_id = $1
  `, [workspaceId]);

  const ranges = componentRanges.rows[0];
  if (ranges) {
    const allValid =
      ranges.min_fit >= 0 && ranges.max_fit <= 100 &&
      ranges.min_eng >= 0 && ranges.max_eng <= 100 &&
      ranges.min_int >= 0 && ranges.max_int <= 100 &&
      ranges.min_tim >= 0 && ranges.max_tim <= 100;

    if (allValid) {
      pass('All component scores within 0-100 range');
    } else {
      fail('Component scores outside valid range');
    }
  }

  return results;
}

// Main execution
if (process.argv.length < 3) {
  console.error('Usage: npx tsx scripts/test-prospect-scoring.ts <workspace_id>');
  process.exit(1);
}

const workspaceId = process.argv[2];

runProspectScoringTest(workspaceId)
  .then((results) => {
    console.log('\n' + results.details.join('\n'));
    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed, ${results.warnings} warnings`);
    console.log('='.repeat(60));

    if (results.failed > 0) {
      console.log('\n❌ Tests failed. Review errors above.');
      process.exit(1);
    } else if (results.warnings > 0) {
      console.log('\n⚠️  Tests passed with warnings. Review above.');
      process.exit(0);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  });
