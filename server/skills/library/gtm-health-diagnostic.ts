import type { SkillDefinition } from '../types.js';

export const gtmHealthDiagnosticSkill: SkillDefinition = {
  id: 'gtm-health-diagnostic',
  name: 'GTM Health Diagnostic',
  description: 'Diagnoses whether a plan miss (or risk) is a coverage problem, a conversion problem, both, or neither — using pre-computed skill outputs. Detects floating bar scenario. Renders a verdict with recommended actions.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'loadSkillOutputs',
    'computeGtmCoverageAdequacy',
    'computeGtmHistoricalContext',
    'prepareGtmSummary',
    'calculateOutputBudget',
    'summarizeForClaude',
  ],

  requiredContext: ['goals_and_targets', 'business_model'],
  outputFormat: 'slack',
  estimatedDuration: '60s',

  schedule: {
    cron: '0 9 * * 1',
    trigger: 'on_demand',
  },

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'load-skill-outputs',
      name: 'Load Pre-Computed Skill Outputs',
      tier: 'compute',
      computeFn: 'loadSkillOutputs',
      computeArgs: {
        skillIds: ['pipeline-coverage', 'pipeline-conversion-rate', 'forecast-rollup'],
        maxAgeDays: 7,
      },
      outputKey: 'skill_outputs',
    },
    {
      id: 'compute-coverage-adequacy',
      name: 'Compute Coverage Adequacy (conversion-adjusted)',
      tier: 'compute',
      dependsOn: ['load-skill-outputs'],
      computeFn: 'computeGtmCoverageAdequacy',
      computeArgs: {},
      outputKey: 'coverage_adequacy',
    },
    {
      id: 'compute-historical-context',
      name: 'Compute Historical Coverage & Conversion Context',
      tier: 'compute',
      dependsOn: ['load-skill-outputs'],
      computeFn: 'computeGtmHistoricalContext',
      computeArgs: { lookbackQuarters: 6 },
      outputKey: 'historical_context',
    },
    {
      id: 'classify-gtm-problem',
      name: 'Classify GTM Problem',
      tier: 'deepseek',
      dependsOn: ['compute-coverage-adequacy', 'compute-historical-context'],
      deepseekPrompt: `You are diagnosing a go-to-market health problem for a B2B SaaS company.
Every plan miss comes down to exactly two root causes: insufficient coverage or insufficient conversion.
Conflating them leads to the wrong fix.

COVERAGE ADEQUACY:
{{coverage_adequacy}}

HISTORICAL CONTEXT:
{{historical_context}}

Respond with JSON only:
{
  "primaryProblem": "coverage_only" | "conversion_only" | "both" | "healthy" | "floating_bar",
  "confidence": "high" | "medium" | "low",
  "secondarySignals": ["mix_shift" | "competitive_pressure" | "rep_capacity" | "pipeline_quality"],
  "recommendedFocus": "pipeline_generation" | "qualification_rigor" | "competitive_response" | "derail_reduction" | "maintain_course",
  "coverageAdequate": true | false,
  "conversionAdequate": true | false,
  "floatingBarDetected": true | false,
  "wrongResponseWarning": "what NOT to do given this diagnosis (1 sentence)"
}`,
      outputKey: 'classification',
    },
    {
      id: 'prepare-gtm-summary',
      name: 'Prepare GTM Summary',
      tier: 'compute',
      dependsOn: ['load-skill-outputs', 'compute-coverage-adequacy', 'compute-historical-context', 'classify-gtm-problem'],
      computeFn: 'prepareGtmSummary',
      computeArgs: {},
      outputKey: 'summary',
    },
    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['prepare-gtm-summary'],
      computeFn: 'calculateOutputBudget',
      computeArgs: { targetTokens: 2000 },
      outputKey: 'output_budget',
    },
    {
      id: 'summarize-for-claude',
      name: 'Summarize for Claude',
      tier: 'compute',
      dependsOn: ['calculate-output-budget'],
      computeFn: 'summarizeForClaude',
      computeArgs: {},
      outputKey: 'claude_input',
    },
    {
      id: 'synthesize-gtm-health-report',
      name: 'Synthesize GTM Health Report',
      tier: 'claude',
      dependsOn: ['summarize-for-claude', 'classify-gtm-problem'],
      claudePrompt: `You are diagnosing a go-to-market health problem for a B2B SaaS company.
Your job: render a verdict, show the math, and give a clear recommended path.
Do not hedge. RevOps teams need a clear diagnosis, not a list of possibilities.

Write a GTM health diagnostic using this data:

{{claude_input}}

DIAGNOSIS:
{{classification}}

Structure:
1. **Verdict** — one sentence. "This is a [coverage/conversion/both] problem."
2. **Evidence** — the exact numbers that support the verdict (coverage ratio, conversion rate, gap $)
3. **What NOT to Do** — the common wrong response to this diagnosis
4. **Recommended Actions** — 2–3 specific, sequenced steps with $ targets where possible
5. **Watch Signal** — one leading indicator to track this week

If floating bar detected: add a callout explaining that coverage looks adequate but pipeline quality is degrading.

Under 400 words.`,
      outputKey: 'synthesis',
    },
  ],
};
