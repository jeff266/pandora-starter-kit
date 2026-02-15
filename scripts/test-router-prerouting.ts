/**
 * Task #100 (Partial): Router Pre-Routing Tests
 *
 * Tests the pre-routing optimization that bypasses LLM calls.
 * This validates the critical path for deliverable requests.
 *
 * Note: Full Task #100 requires ANTHROPIC_API_KEY for LLM-routed tests.
 */

import { classifyRequest } from '../server/router/request-router.js';
import pool from '../server/db.js';

interface PreRoutedTest {
  input: string;
  expectedType: string;
  expectedFields: Record<string, any>;
  description: string;
}

const PRE_ROUTED_TESTS: PreRoutedTest[] = [
  {
    input: 'Build me a sales process map',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'sales_process_map',
      template_id: 'sales_process_map',
      confidence: 0.95,
    },
    description: '✨ CRITICAL: Sales process map deliverable (triggers Template Assembly)',
  },
  {
    input: 'Run pipeline hygiene',
    expectedType: 'skill_execution',
    expectedFields: {
      skill_id: 'pipeline-hygiene',
      confidence: 0.99,
    },
    description: 'Skill execution: pipeline hygiene',
  },
  {
    input: 'run pipeline-hygiene',
    expectedType: 'skill_execution',
    expectedFields: {
      skill_id: 'pipeline-hygiene',
    },
    description: 'Skill execution: pipeline-hygiene (alternate syntax)',
  },
  {
    input: 'Refresh lead scores',
    expectedType: 'skill_execution',
    expectedFields: {
      skill_id: 'lead-scoring',
    },
    description: 'Skill execution: refresh lead scores',
  },
  {
    input: 'status',
    expectedType: 'evidence_inquiry',
    expectedFields: {
      target_metric: 'workspace_status',
      confidence: 0.95,
    },
    description: 'Workspace status inquiry',
  },
  {
    input: 'workspace status',
    expectedType: 'evidence_inquiry',
    expectedFields: {
      target_metric: 'workspace_status',
    },
    description: 'Workspace status (alternate)',
  },
  {
    input: 'create a sales process map',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'sales_process_map',
    },
    description: 'Sales process map (create)',
  },
  {
    input: 'generate sales process map',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'sales_process_map',
    },
    description: 'Sales process map (generate)',
  },
  {
    input: 'export sales process map',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'sales_process_map',
    },
    description: 'Sales process map (export)',
  },
  {
    input: 'Build me a gtm blueprint',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'gtm_blueprint',
    },
    description: 'GTM blueprint deliverable',
  },
  {
    input: 'generate forecast report',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'forecast_report',
    },
    description: 'Forecast report deliverable',
  },
  {
    input: 'run icp discovery',
    expectedType: 'skill_execution',
    expectedFields: {
      skill_id: 'icp-discovery',
    },
    description: 'Skill execution: ICP discovery',
  },
];

async function runPreRoutedTests(workspaceId: string): Promise<void> {
  console.log('\n================================================================');
  console.log('Task #100 (Pre-Routing): Router Classification Tests');
  console.log('================================================================\n');
  console.log('Testing pre-routed patterns (no LLM required)');
  console.log('These patterns bypass LLM classification for speed and cost.\n');

  let passed = 0;
  let failed = 0;
  const times: number[] = [];

  for (const test of PRE_ROUTED_TESTS) {
    console.log(`\nTest: ${test.description}`);
    console.log(`Input: "${test.input}"`);

    const startTime = Date.now();
    const decision = await classifyRequest(workspaceId, test.input);
    const elapsedMs = Date.now() - startTime;
    times.push(elapsedMs);

    console.log(`Result: ${decision.type} (${elapsedMs}ms, confidence: ${decision.confidence})`);

    // Check type
    const typeMatch = decision.type === test.expectedType;
    if (!typeMatch) {
      console.log(`❌ FAILED: Expected type '${test.expectedType}', got '${decision.type}'`);
      failed++;
      continue;
    }

    // Check expected fields
    let allFieldsMatch = true;
    for (const [field, expectedValue] of Object.entries(test.expectedFields)) {
      const actualValue = (decision as any)[field];
      if (typeof expectedValue === 'number') {
        if (actualValue < expectedValue) {
          console.log(`  ❌ Field mismatch: ${field} = ${actualValue}, expected >= ${expectedValue}`);
          allFieldsMatch = false;
        }
      } else if (actualValue !== expectedValue) {
        console.log(`  ❌ Field mismatch: ${field} = ${actualValue}, expected ${expectedValue}`);
        allFieldsMatch = false;
      }
    }

    // Check performance
    if (elapsedMs > 100) {
      console.log(`  ⚠️  Took ${elapsedMs}ms (expected < 100ms)`);
    }

    if (typeMatch && allFieldsMatch) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❌ FAILED');
      failed++;
    }
  }

  // Performance summary
  console.log('\n================================================================');
  console.log('Performance Summary');
  console.log('================================================================\n');

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const maxTime = Math.max(...times);
  const minTime = Math.min(...times);
  const under100 = times.filter(t => t < 100).length;

  console.log(`Pre-routed requests tested: ${times.length}`);
  console.log(`Average time: ${avgTime.toFixed(0)}ms`);
  console.log(`Min time: ${minTime}ms`);
  console.log(`Max time: ${maxTime}ms`);
  console.log(`Under 100ms: ${under100}/${times.length} (${((under100/times.length)*100).toFixed(0)}%)`);

  if (maxTime < 100) {
    console.log('✅ All pre-routed requests under 100ms target');
  } else {
    console.log(`⚠️  ${times.length - under100} request(s) exceeded 100ms (likely first-call overhead)`);
  }

  // Final summary
  console.log('\n================================================================');
  console.log('Test Results');
  console.log('================================================================\n');
  console.log(`Passed: ${passed}/${PRE_ROUTED_TESTS.length}`);
  console.log(`Failed: ${failed}/${PRE_ROUTED_TESTS.length}`);

  if (passed === PRE_ROUTED_TESTS.length) {
    console.log('\n✅ All pre-routing tests passed!');
    console.log('\n🎯 CRITICAL SUCCESS: "Build me a sales process map" correctly routes to deliverable_request');
    console.log('   This validates that Template Assembly will be triggered correctly.\n');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed\n`);
  }
}

async function testCriticalPath(workspaceId: string): Promise<void> {
  console.log('\n================================================================');
  console.log('Critical Path Validation');
  console.log('================================================================\n');

  console.log('Testing the trigger for Template Assembly & Cell Population:\n');

  const decision = await classifyRequest(workspaceId, 'Build me a sales process map');

  console.log('User input: "Build me a sales process map"');
  console.log(`\nRouter decision:`);
  console.log(`  Type: ${decision.type}`);
  console.log(`  Deliverable type: ${decision.deliverable_type}`);
  console.log(`  Template ID: ${decision.template_id}`);
  console.log(`  Confidence: ${decision.confidence}`);
  console.log(`  Needs clarification: ${decision.needs_clarification}`);
  if (decision.clarification_question) {
    console.log(`  Clarification: ${decision.clarification_question}`);
  }
  console.log(`  Estimated wait: ${decision.estimated_wait}`);

  const success = (
    decision.type === 'deliverable_request' &&
    decision.deliverable_type === 'sales_process_map'
  );

  if (success) {
    console.log('\n✅ CRITICAL PATH VALIDATED');
    console.log('   Template Assembly will be triggered correctly for sales process map requests.\n');
  } else {
    console.log('\n❌ CRITICAL PATH FAILED');
    console.log('   This will prevent Template Assembly from being triggered!\n');
  }
}

async function main(): Promise<void> {
  try {
    const workspaceResult = await pool.query(
      'SELECT id FROM workspaces ORDER BY created_at DESC LIMIT 1'
    );

    if (workspaceResult.rows.length === 0) {
      console.error('No workspaces found. Please create a workspace first.');
      process.exit(1);
    }

    const workspaceId = workspaceResult.rows[0].id;
    console.log(`Using workspace: ${workspaceId}`);

    await testCriticalPath(workspaceId);
    await runPreRoutedTests(workspaceId);

    console.log('================================================================');
    console.log('Next Steps');
    console.log('================================================================\n');
    console.log('To complete full Task #100 (LLM-routed tests), you need:');
    console.log('  1. Set ANTHROPIC_API_KEY in .env');
    console.log('  2. Run: npx tsx scripts/test-router-classification.ts\n');
    console.log('LLM-routed tests will validate:');
    console.log('  - Evidence inquiry: "Show me how you calculated win rate"');
    console.log('  - Scoped analysis: "Why did pipeline drop last week?"');
    console.log('  - Entity extraction: "What\'s happening with the Acme account?"');
    console.log('  - Freshness decisions for stale skills\n');

  } catch (err) {
    console.error('Error running tests:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
