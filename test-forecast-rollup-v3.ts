/**
 * Test script to validate Forecast Roll-up v3.0 enhancements
 *
 * Run with: npx tsx test-forecast-rollup-v3.ts
 */

import { forecastRollupSkill } from './server/skills/library/forecast-rollup.js';
import { toolRegistry } from './server/skills/tool-definitions.js';

console.log('='.repeat(80));
console.log('FORECAST ROLL-UP V3.0 VALIDATION');
console.log('='.repeat(80));

// 1. Verify skill metadata
console.log('\n1. SKILL METADATA:');
console.log(`   ID: ${forecastRollupSkill.id}`);
console.log(`   Name: ${forecastRollupSkill.name}`);
console.log(`   Version: ${forecastRollupSkill.version}`);
console.log(`   Description: ${forecastRollupSkill.description}`);
console.log(`   Estimated Duration: ${forecastRollupSkill.estimatedDuration}`);

// 2. Verify required tools
console.log('\n2. REQUIRED TOOLS:');
const requiredTools = forecastRollupSkill.requiredTools || [];
console.log(`   Total: ${requiredTools.length}`);

const missingTools: string[] = [];
requiredTools.forEach(toolName => {
  const exists = toolRegistry.has(toolName);
  const status = exists ? '✓' : '✗';
  console.log(`   ${status} ${toolName}`);
  if (!exists) missingTools.push(toolName);
});

// 3. Verify step sequence
console.log('\n3. STEP SEQUENCE:');
const steps = forecastRollupSkill.steps || [];
console.log(`   Total steps: ${steps.length}`);

steps.forEach((step, index) => {
  const num = (index + 1).toString().padStart(2, ' ');
  const tier = step.tier.padEnd(10);
  const fn = step.computeFn || step.claudePrompt ?
    (step.computeFn || step.deepseekPrompt ? '(DeepSeek)' : '(Claude)') : '';
  console.log(`   ${num}. [${tier}] ${step.id} - ${step.name} ${fn}`);

  if (step.dependsOn && step.dependsOn.length > 0) {
    console.log(`       Depends on: ${step.dependsOn.join(', ')}`);
  }
});

// 4. Verify new steps
console.log('\n4. NEW V3.0 STEPS:');
const newStepIds = [
  'resolve-time-windows',
  'gather-previous-forecast',
  'gather-deal-concentration-risk',
  'classify-forecast-risks',
  'calculate-output-budget'
];

const foundNewSteps: string[] = [];
newStepIds.forEach(stepId => {
  const found = steps.find(s => s.id === stepId);
  const status = found ? '✓' : '✗';
  console.log(`   ${status} ${stepId}`);
  if (found) foundNewSteps.push(stepId);
});

// 5. Verify DeepSeek step
console.log('\n5. DEEPSEEK RISK CLASSIFICATION:');
const deepseekStep = steps.find(s => s.tier === 'deepseek');
if (deepseekStep) {
  console.log(`   ✓ Found DeepSeek step: ${deepseekStep.id}`);
  console.log(`   ✓ Has prompt: ${!!deepseekStep.deepseekPrompt}`);
  console.log(`   ✓ Output key: ${deepseekStep.outputKey}`);

  // Check for risk type keywords in prompt
  const prompt = deepseekStep.deepseekPrompt || '';
  const riskTypes = ['sandbagging', 'over_forecasting', 'whale_dependency', 'category_gaming'];
  const foundRiskTypes = riskTypes.filter(type => prompt.includes(type));
  console.log(`   ✓ Risk types in prompt: ${foundRiskTypes.length}/${riskTypes.length}`);
} else {
  console.log('   ✗ DeepSeek step not found!');
}

// 6. Verify Claude prompt enhancements
console.log('\n6. CLAUDE SYNTHESIS ENHANCEMENTS:');
const claudeStep = steps.find(s => s.tier === 'claude');
if (claudeStep?.claudePrompt) {
  const prompt = claudeStep.claudePrompt;
  const enhancements = [
    { keyword: 'Executive Summary', description: 'Executive summary section' },
    { keyword: 'Risk-Adjusted Landing Zone', description: 'Risk-adjusted landing zone' },
    { keyword: 'Concentration Risk', description: 'Concentration risk section' },
    { keyword: 'Behavioral Risks', description: 'Behavioral risks section' },
    { keyword: 'Top 3 Deals', description: 'Top 3 deals analysis' },
    { keyword: 'Whale Deals', description: 'Whale deals analysis' },
    { keyword: 'output_budget', description: 'Output budget reference' },
  ];

  enhancements.forEach(({ keyword, description }) => {
    const found = prompt.includes(keyword);
    const status = found ? '✓' : '✗';
    console.log(`   ${status} ${description}`);
  });
} else {
  console.log('   ✗ Claude step or prompt not found!');
}

// 7. Verify time config
console.log('\n7. TIME CONFIGURATION:');
if (forecastRollupSkill.timeConfig) {
  const tc = forecastRollupSkill.timeConfig;
  console.log(`   ✓ Analysis window: ${tc.analysisWindow}`);
  console.log(`   ✓ Change window: ${tc.changeWindow}`);
  console.log(`   ✓ Trend comparison: ${tc.trendComparison || 'none'}`);
} else {
  console.log('   ✗ Time config not found!');
}

// 8. Summary
console.log('\n' + '='.repeat(80));
console.log('VALIDATION SUMMARY:');
console.log('='.repeat(80));

const totalSteps = steps.length;
const expectedSteps = 10;
const newStepsFound = foundNewSteps.length;
const expectedNewSteps = newStepIds.length;

console.log(`Steps: ${totalSteps}/${expectedSteps} ${totalSteps === expectedSteps ? '✓' : '✗'}`);
console.log(`New steps: ${newStepsFound}/${expectedNewSteps} ${newStepsFound === expectedNewSteps ? '✓' : '✗'}`);
console.log(`Missing tools: ${missingTools.length === 0 ? '✓ None' : '✗ ' + missingTools.join(', ')}`);
console.log(`DeepSeek step: ${deepseekStep ? '✓ Present' : '✗ Missing'}`);
console.log(`Version: ${forecastRollupSkill.version === '3.0.0' ? '✓ 3.0.0' : '✗ ' + forecastRollupSkill.version}`);

const allGood =
  totalSteps === expectedSteps &&
  newStepsFound === expectedNewSteps &&
  missingTools.length === 0 &&
  !!deepseekStep &&
  forecastRollupSkill.version === '3.0.0';

console.log('\n' + (allGood ? '✅ ALL VALIDATIONS PASSED' : '⚠️  SOME VALIDATIONS FAILED'));
console.log('='.repeat(80));
