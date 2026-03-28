#!/usr/bin/env node
/**
 * Phase 7 Validation — Calibration Questions
 *
 * Tests:
 * 1. All manifest references covered (zero missing)
 * 2. Question count >= 100
 * 3. All 6 domains represented
 * 4. required_for_live questions have skill_dependencies
 * 5. depends_on arrays reference valid question_ids
 * 6. getSkillBlockingQuestions works correctly
 */

import { SKILL_MANIFESTS } from './server/lib/skill-manifests.js';
import {
  CALIBRATION_QUESTIONS,
  getQuestionsByDomain,
  getQuestionById,
  getSkillBlockingQuestions,
  getRequiredQuestions,
} from './server/lib/calibration-questions.js';

console.log('='.repeat(80));
console.log('PHASE 7 VALIDATION — CALIBRATION QUESTIONS');
console.log('='.repeat(80));
console.log();

// Test 1: All manifest references covered
console.log('Test 1: All manifest references covered');
const questionIds = new Set(CALIBRATION_QUESTIONS.map((q) => q.question_id));
const allManifestRefs = Object.values(SKILL_MANIFESTS).flatMap((m) => [
  ...m.required_checklist_items,
  ...m.preferred_checklist_items,
]);
const uniqueManifestRefs = [...new Set(allManifestRefs)];
const missing = uniqueManifestRefs.filter((id) => !questionIds.has(id));

if (missing.length === 0) {
  console.log(`  ✓ All ${uniqueManifestRefs.length} manifest references covered`);
  console.log(`  ✓ ${questionIds.size} questions defined`);
} else {
  console.log(`  ✗ MISSING QUESTIONS: ${missing.join(', ')}`);
  process.exit(1);
}
console.log();

// Test 2: Question count >= 100
console.log('Test 2: Question count');
if (CALIBRATION_QUESTIONS.length >= 100) {
  console.log(`  ✓ ${CALIBRATION_QUESTIONS.length} questions defined (>= 100)`);
} else {
  console.log(`  ✗ Only ${CALIBRATION_QUESTIONS.length} questions (need >= 100)`);
  process.exit(1);
}
console.log();

// Test 3: All 6 domains represented
console.log('Test 3: Domain coverage');
const domainCounts = {
  pipeline: getQuestionsByDomain('pipeline').length,
  segmentation: getQuestionsByDomain('segmentation').length,
  taxonomy: getQuestionsByDomain('taxonomy').length,
  metrics: getQuestionsByDomain('metrics').length,
  business: getQuestionsByDomain('business').length,
  data_quality: getQuestionsByDomain('data_quality').length,
};

let allDomainsValid = true;
for (const [domain, count] of Object.entries(domainCounts)) {
  const minCount = domain === 'segmentation' ? 10 : 15;
  if (count >= minCount) {
    console.log(`  ✓ ${domain}: ${count} questions (>= ${minCount})`);
  } else {
    console.log(`  ✗ ${domain}: ${count} questions (need >= ${minCount})`);
    allDomainsValid = false;
  }
}
if (!allDomainsValid) {
  process.exit(1);
}
console.log();

// Test 4: required_for_live questions have skill_dependencies
console.log('Test 4: Required questions have skill dependencies');
const requiredQuestions = getRequiredQuestions();
const invalidRequired = requiredQuestions.filter((q) => q.skill_dependencies.length === 0);
if (invalidRequired.length === 0) {
  console.log(`  ✓ All ${requiredQuestions.length} required_for_live questions have skill_dependencies`);
} else {
  console.log(`  ✗ ${invalidRequired.length} required questions missing skill_dependencies:`);
  invalidRequired.forEach((q) => console.log(`    - ${q.question_id}`));
  process.exit(1);
}
console.log();

// Test 5: depends_on arrays reference valid question_ids
console.log('Test 5: depends_on references are valid');
let invalidDeps = 0;
for (const q of CALIBRATION_QUESTIONS) {
  for (const depId of q.depends_on) {
    if (!questionIds.has(depId)) {
      console.log(`  ✗ ${q.question_id} depends_on invalid ID: ${depId}`);
      invalidDeps++;
    }
  }
}
if (invalidDeps === 0) {
  console.log(`  ✓ All depends_on references are valid`);
} else {
  console.log(`  ✗ ${invalidDeps} invalid dependency references`);
  process.exit(1);
}
console.log();

// Test 6: getSkillBlockingQuestions works
console.log('Test 6: getSkillBlockingQuestions function');
const waterfallBlocking = getSkillBlockingQuestions('pipeline-waterfall');
const expectedBlocking = ['pipeline_active_stages', 'pipeline_coverage_target'];
const waterfallBlockingIds = waterfallBlocking.map((q) => q.question_id);
const hasAll = expectedBlocking.every((id) => waterfallBlockingIds.includes(id));

if (hasAll && waterfallBlocking.length > 0) {
  console.log(`  ✓ pipeline-waterfall has ${waterfallBlocking.length} blocking questions`);
  console.log(`    Blocking IDs: ${waterfallBlockingIds.join(', ')}`);
} else {
  console.log(`  ✗ pipeline-waterfall missing expected blocking questions`);
  console.log(`    Expected: ${expectedBlocking.join(', ')}`);
  console.log(`    Got: ${waterfallBlockingIds.join(', ')}`);
  process.exit(1);
}
console.log();

// Test 7: getQuestionById works
console.log('Test 7: getQuestionById function');
const q = getQuestionById('pipeline_active_stages');
if (q && q.question_id === 'pipeline_active_stages') {
  console.log(`  ✓ getQuestionById returns correct question`);
  console.log(`    Question: "${q.question}"`);
} else {
  console.log(`  ✗ getQuestionById failed`);
  process.exit(1);
}
console.log();

// Summary
console.log('='.repeat(80));
console.log('PHASE 7 VALIDATION COMPLETE — ALL TESTS PASSED');
console.log('='.repeat(80));
console.log();
console.log('Summary:');
console.log(`  Total questions: ${CALIBRATION_QUESTIONS.length}`);
console.log(`  Required for LIVE: ${requiredQuestions.length}`);
console.log(`  Manifest references covered: ${uniqueManifestRefs.length}/${uniqueManifestRefs.length}`);
console.log();
console.log('Domain breakdown:');
Object.entries(domainCounts).forEach(([domain, count]) => {
  console.log(`  ${domain}: ${count} questions`);
});
console.log();

process.exit(0);
