#!/usr/bin/env node
/**
 * Phase 6 Validation — Skill Manifests
 *
 * Tests:
 * 1. All 38 skills have valid manifests
 * 2. evaluateSkillGate returns correct gate status
 * 3. resolveReadiness computes skill_gates
 * 4. Priority skills with active bugs are correct
 */

import { getWorkspaceIntelligence } from './server/lib/workspace-intelligence.js';
import { SKILL_MANIFESTS, evaluateSkillGate, getSkillManifest } from './server/lib/skill-manifests.js';

const FRONTERA_WORKSPACE_ID = 'ff0c2e6f-e74d-41ad-b9ef-c942cf77c9d9';

// Expected 38 skill IDs
const EXPECTED_SKILLS = [
  // Priority (6)
  'pipeline-waterfall', 'pipeline-coverage', 'rep-scorecard',
  'forecast-rollup', 'stage-velocity-benchmarks', 'pipeline-conversion-rate',
  // Pipeline (6)
  'pipeline-progression', 'pipeline-hygiene', 'pipeline-movement',
  'pipeline-goals', 'pipeline-gen-forecast', 'pipeline-contribution-forecast',
  // Forecasting (3)
  'forecast-model', 'forecast-accuracy-tracking', 'monte-carlo-forecast',
  // Deal Analysis (5)
  'deal-risk-review', 'deal-scoring-model', 'deal-rfm-scoring',
  'single-thread-alert', 'stage-mismatch-detector',
  // Strategy (5)
  'strategy-insights', 'gtm-health-diagnostic', 'quarterly-pre-mortem',
  'weekly-recap', 'project-recap',
  // Conversation (3)
  'conversation-intelligence', 'competitive-intelligence', 'voice-pattern-extraction',
  // Coaching (2)
  'coaching', 'behavioral-winning-path',
  // Discovery (4)
  'icp-discovery', 'icp-taxonomy-builder', 'custom-field-discovery',
  'workspace-config-audit', 'data-quality-audit',
  // Scoring (2)
  'lead-scoring', 'contact-role-resolution',
  // Analysis (1)
  'bowtie-analysis',
];

const PRIORITY_SKILLS = [
  'pipeline-waterfall',
  'pipeline-coverage',
  'rep-scorecard',
  'forecast-rollup',
  'stage-velocity-benchmarks',
  'pipeline-conversion-rate',
];

console.log('='.repeat(80));
console.log('PHASE 6 VALIDATION — SKILL MANIFESTS');
console.log('='.repeat(80));
console.log();

// Test 1: All 38 skills have valid manifests
console.log('Test 1: All 38 skills have valid manifests');
let test1Pass = true;
for (const skillId of EXPECTED_SKILLS) {
  const manifest = getSkillManifest(skillId);
  if (!manifest) {
    console.log(`  ✗ Missing manifest: ${skillId}`);
    test1Pass = false;
  } else if (manifest.skill_id !== skillId) {
    console.log(`  ✗ Manifest ID mismatch: ${skillId} !== ${manifest.skill_id}`);
    test1Pass = false;
  }
}
if (test1Pass) {
  console.log(`  ✓ All 38 skills have valid manifests`);
}
console.log();

// Test 2: Priority skills are correct
console.log('Test 2: Priority skills with active bugs');
let test2Pass = true;
for (const skillId of PRIORITY_SKILLS) {
  const manifest = getSkillManifest(skillId);
  if (!manifest) {
    console.log(`  ✗ Missing priority manifest: ${skillId}`);
    test2Pass = false;
  } else if (manifest.fallback_behavior !== 'draft_mode' && manifest.fallback_behavior !== 'warn') {
    console.log(`  ✗ ${skillId}: unexpected fallback_behavior=${manifest.fallback_behavior}`);
    test2Pass = false;
  }
}
if (test2Pass) {
  console.log(`  ✓ All 6 priority skills present with valid fallback_behavior`);
}
console.log();

// Test 3: evaluateSkillGate returns correct values
console.log('Test 3: evaluateSkillGate function');
const mockChecklist = [
  { question_id: 'pipeline_active_stages', status: 'CONFIRMED' },
  { question_id: 'pipeline_coverage_target', status: 'CONFIRMED' },
  { question_id: 'segmentation_field', status: 'INFERRED' },
];
const mockWi = {
  workspace_id: FRONTERA_WORKSPACE_ID,
  resolved_at: new Date(),
  cache_ttl_seconds: 300,
  business: {},
  metrics: {
    pipeline_coverage: { value: 3.2, confidence: 'INFERRED' },
    pipeline_created: { value: 150000, confidence: 'INFERRED' },
  },
  segmentation: {},
  taxonomy: {},
  pipeline: {},
  data_quality: {},
  knowledge: { hypotheses: [], recent_findings: [], skill_evidence: [] },
  readiness: { overall_score: 0, by_domain: {}, blocking_gaps: [], skill_gates: {} },
};

const manifest = getSkillManifest('pipeline-waterfall');
const gateResult = evaluateSkillGate(manifest, mockChecklist, mockWi);
if (gateResult.gate === 'LIVE') {
  console.log(`  ✓ evaluateSkillGate returns LIVE when all required items are CONFIRMED`);
} else {
  console.log(`  ✗ Expected LIVE, got ${gateResult.gate}`);
}
console.log();

// Test 4: evaluateSkillGate returns DRAFT when checklist is empty
console.log('Test 4: evaluateSkillGate with empty checklist');
const emptyChecklist = [];
const emptyWi = { ...mockWi, metrics: {} };
const gateResult2 = evaluateSkillGate(manifest, emptyChecklist, emptyWi);
if (gateResult2.gate === 'DRAFT') {
  console.log(`  ✓ pipeline-waterfall returns DRAFT when checklist is empty`);
  console.log(`    Missing required: ${gateResult2.missing_required.join(', ')}`);
} else {
  console.log(`  ✗ Expected DRAFT, got ${gateResult2.gate}`);
}
console.log();

// Test 5: resolveReadiness computes skill_gates
console.log('Test 5: resolveReadiness computes skill_gates for Frontera workspace');
try {
  const wi = await getWorkspaceIntelligence(FRONTERA_WORKSPACE_ID);
  const gateCount = Object.keys(wi.readiness.skill_gates).length;

  if (gateCount === 38) {
    console.log(`  ✓ Computed skill_gates for all 38 skills`);

    // Count gate statuses
    const statusCounts = { LIVE: 0, DRAFT: 0, BLOCKED: 0 };
    for (const gate of Object.values(wi.readiness.skill_gates)) {
      statusCounts[gate]++;
    }
    console.log(`    Gate distribution: LIVE=${statusCounts.LIVE}, DRAFT=${statusCounts.DRAFT}, BLOCKED=${statusCounts.BLOCKED}`);

    // Check pipeline-waterfall specifically
    const waterfallGate = wi.readiness.skill_gates['pipeline-waterfall'];
    console.log(`    pipeline-waterfall gate: ${waterfallGate}`);

  } else {
    console.log(`  ✗ Expected 38 skill_gates, got ${gateCount}`);
  }
} catch (err) {
  console.log(`  ✗ Failed to resolve workspace intelligence: ${err.message}`);
}
console.log();

console.log('='.repeat(80));
console.log('PHASE 6 VALIDATION COMPLETE');
console.log('='.repeat(80));

process.exit(0);
