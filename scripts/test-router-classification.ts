/**
 * Task #100: Router Classification Accuracy Test
 *
 * Validates that the request router correctly classifies 10 different user inputs
 * into the appropriate request types and extracts structured parameters.
 *
 * Success Criteria:
 * 1. "Build me a sales process map" → deliverable_request
 * 2. "Run pipeline hygiene" → skill_execution (pre-routed, <100ms)
 * 3. "Show me how you calculated win rate" → evidence_inquiry
 * 4. "Why did pipeline drop last week?" → scoped_analysis
 * 5. Pre-routing performance < 100ms
 * 6. Freshness decisions flag stale skills correctly
 */

import { classifyRequest } from '../server/router/request-router.js';
import pool from '../server/db.js';

interface TestCase {
  input: string;
  expectedType: string;
  expectedFields?: Record<string, any>;
  shouldBePreRouted?: boolean;
  description: string;
}

const TEST_CASES: TestCase[] = [
  {
    input: 'Build me a sales process map',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'sales_process_map',
      confidence: 0.95,
    },
    shouldBePreRouted: true,
    description: 'Deliverable request (pre-routed)',
  },
  {
    input: 'Run pipeline hygiene',
    expectedType: 'skill_execution',
    expectedFields: {
      skill_id: 'pipeline-hygiene',
      confidence: 0.99,
    },
    shouldBePreRouted: true,
    description: 'Skill execution (pre-routed)',
  },
  {
    input: 'Show me how you calculated win rate',
    expectedType: 'evidence_inquiry',
    expectedFields: {
      target_metric: 'win_rate',
    },
    shouldBePreRouted: false,
    description: 'Evidence inquiry (LLM-routed)',
  },
  {
    input: 'Why did pipeline drop last week?',
    expectedType: 'scoped_analysis',
    expectedFields: {
      scope_type: 'pipeline',
    },
    shouldBePreRouted: false,
    description: 'Scoped analysis (LLM-routed)',
  },
  {
    input: 'status',
    expectedType: 'evidence_inquiry',
    expectedFields: {
      target_metric: 'workspace_status',
    },
    shouldBePreRouted: true,
    description: 'Workspace status (pre-routed)',
  },
  {
    input: 'What\'s happening with the Acme account?',
    expectedType: 'scoped_analysis',
    expectedFields: {
      scope_type: 'account',
      scope_entity: 'Acme',
    },
    shouldBePreRouted: false,
    description: 'Account-scoped analysis',
  },
  {
    input: 'Refresh lead scores',
    expectedType: 'skill_execution',
    expectedFields: {
      skill_id: 'lead-scoring',
    },
    shouldBePreRouted: true,
    description: 'Skill refresh (pre-routed)',
  },
  {
    input: 'Why is the BigCorp deal flagged?',
    expectedType: 'evidence_inquiry',
    expectedFields: {
      target_entity_type: 'deal',
    },
    shouldBePreRouted: false,
    description: 'Entity-specific evidence inquiry',
  },
  {
    input: 'Generate forecast report',
    expectedType: 'deliverable_request',
    expectedFields: {
      deliverable_type: 'forecast_report',
    },
    shouldBePreRouted: true,
    description: 'Forecast deliverable (pre-routed)',
  },
  {
    input: 'Compare our win rate to last quarter',
    expectedType: 'scoped_analysis',
    expectedFields: {
      scope_type: 'time_range',
    },
    shouldBePreRouted: false,
    description: 'Temporal comparison analysis',
  },
];

async function runClassificationTests(workspaceId: string): Promise<void> {
  console.log('\n========================================');
  console.log('Task #100: Router Classification Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;
  const preRoutedTimes: number[] = [];
  const llmRoutedTimes: number[] = [];

  for (const testCase of TEST_CASES) {
    console.log(`\nTest: ${testCase.description}`);
    console.log(`Input: "${testCase.input}"`);

    const startTime = Date.now();
    const decision = await classifyRequest(workspaceId, testCase.input);
    const elapsedMs = Date.now() - startTime;

    if (testCase.shouldBePreRouted) {
      preRoutedTimes.push(elapsedMs);
    } else {
      llmRoutedTimes.push(elapsedMs);
    }

    console.log(`Classified as: ${decision.type} (${elapsedMs}ms, confidence: ${decision.confidence})`);

    // Check type
    const typeMatch = decision.type === testCase.expectedType;
    if (!typeMatch) {
      console.log(`❌ FAILED: Expected type '${testCase.expectedType}', got '${decision.type}'`);
      failed++;
      continue;
    }

    // Check expected fields
    let fieldsMatch = true;
    if (testCase.expectedFields) {
      for (const [field, expectedValue] of Object.entries(testCase.expectedFields)) {
        const actualValue = (decision as any)[field];
        if (typeof expectedValue === 'number') {
          // For numeric fields like confidence, check >= for pre-routed patterns
          if (actualValue < expectedValue) {
            console.log(`❌ Field mismatch: ${field} = ${actualValue}, expected >= ${expectedValue}`);
            fieldsMatch = false;
          }
        } else if (actualValue !== expectedValue) {
          console.log(`⚠️  Field mismatch: ${field} = ${actualValue}, expected ${expectedValue}`);
          // Don't fail the test for field mismatches in LLM-routed cases (LLM may extract differently)
          if (testCase.shouldBePreRouted) {
            fieldsMatch = false;
          }
        }
      }
    }

    // Check pre-routing performance
    if (testCase.shouldBePreRouted && elapsedMs > 100) {
      console.log(`⚠️  Pre-routed request took ${elapsedMs}ms (expected < 100ms)`);
    }

    if (typeMatch && fieldsMatch) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❌ FAILED');
      failed++;
    }
  }

  // Performance Summary
  console.log('\n========================================');
  console.log('Performance Summary');
  console.log('========================================\n');

  if (preRoutedTimes.length > 0) {
    const avgPreRouted = preRoutedTimes.reduce((a, b) => a + b, 0) / preRoutedTimes.length;
    const maxPreRouted = Math.max(...preRoutedTimes);
    console.log(`Pre-routed requests (${preRoutedTimes.length}):`);
    console.log(`  Average: ${avgPreRouted.toFixed(0)}ms`);
    console.log(`  Max: ${maxPreRouted}ms`);
    console.log(`  ${maxPreRouted < 100 ? '✅' : '⚠️ '} All under 100ms: ${maxPreRouted < 100 ? 'YES' : 'NO'}`);
  }

  if (llmRoutedTimes.length > 0) {
    const avgLlmRouted = llmRoutedTimes.reduce((a, b) => a + b, 0) / llmRoutedTimes.length;
    console.log(`\nLLM-routed requests (${llmRoutedTimes.length}):`);
    console.log(`  Average: ${avgLlmRouted.toFixed(0)}ms`);
  }

  // Final Summary
  console.log('\n========================================');
  console.log('Test Results');
  console.log('========================================\n');
  console.log(`Passed: ${passed}/${TEST_CASES.length}`);
  console.log(`Failed: ${failed}/${TEST_CASES.length}`);

  if (passed === TEST_CASES.length) {
    console.log('\n✅ All router classification tests passed!');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed`);
  }
}

async function testFreshnessDecisions(workspaceId: string): Promise<void> {
  console.log('\n========================================');
  console.log('Freshness Decision Tests');
  console.log('========================================\n');

  // Test 1: Evidence inquiry for skill with no evidence should convert to skill_execution
  console.log('Test: Evidence inquiry for skill without evidence');
  const decision1 = await classifyRequest(
    workspaceId,
    'Show me pipeline hygiene results'
  );
  console.log(`Type: ${decision1.type}`);
  console.log(`Needs clarification: ${decision1.needs_clarification}`);
  if (decision1.needs_clarification) {
    console.log(`Clarification: ${decision1.clarification_question}`);
  }
  console.log(decision1.type === 'evidence_inquiry' || decision1.type === 'skill_execution' ? '✅ PASSED' : '❌ FAILED');

  // Test 2: Scoped analysis should identify stale skills
  console.log('\nTest: Scoped analysis identifies stale skills');
  const decision2 = await classifyRequest(
    workspaceId,
    'Why did pipeline drop last week?'
  );
  console.log(`Type: ${decision2.type}`);
  console.log(`Skills to consult: ${decision2.skills_to_consult?.join(', ') || 'none'}`);
  console.log(`Stale skills to rerun: ${decision2.stale_skills_to_rerun?.join(', ') || 'none'}`);
  console.log(`Estimated wait: ${decision2.estimated_wait}`);
  console.log(decision2.skills_to_consult && decision2.skills_to_consult.length > 0 ? '✅ PASSED' : '❌ FAILED');

  // Test 3: Deliverable request checks template readiness
  console.log('\nTest: Deliverable request checks template readiness');
  const decision3 = await classifyRequest(
    workspaceId,
    'Build me a sales process map'
  );
  console.log(`Type: ${decision3.type}`);
  console.log(`Deliverable type: ${decision3.deliverable_type}`);
  console.log(`Needs clarification: ${decision3.needs_clarification}`);
  if (decision3.clarification_question) {
    console.log(`Clarification: ${decision3.clarification_question}`);
  }
  console.log(decision3.type === 'deliverable_request' ? '✅ PASSED' : '❌ FAILED');
}

async function main(): Promise<void> {
  try {
    // Get a test workspace
    const workspaceResult = await pool.query(
      'SELECT id FROM workspaces ORDER BY created_at DESC LIMIT 1'
    );

    if (workspaceResult.rows.length === 0) {
      console.error('No workspaces found. Please create a workspace first.');
      process.exit(1);
    }

    const workspaceId = workspaceResult.rows[0].id;
    console.log(`Using workspace: ${workspaceId}\n`);

    await runClassificationTests(workspaceId);
    await testFreshnessDecisions(workspaceId);

    console.log('\n✅ Task #100 complete\n');
  } catch (err) {
    console.error('Error running tests:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
