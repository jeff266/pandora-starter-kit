import type { SkillDefinition } from '../types.js';

export const pipelineConversionRateSkill: SkillDefinition = {
  id: 'pipeline-conversion-rate',
  name: 'Pipeline Conversion Rate',
  description: 'Computes week-3 pipeline conversion rate, narrow vs. broad win rates, derail rate trend, and the implied coverage target — revealing whether insufficient coverage or insufficient conversion is the root cause of plan misses.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'checkQuotaConfig',
    'computeCompletedQuarterConversions',
    'computeCurrentQuarterProjection',
    'computeWinRateAnalysis',
    'computeCoverageAdequacy',
    'prepareConversionSummary',
    'calculateOutputBudget',
    'summarizeForClaude',
    'computeMethodologyDivergence',
    'extractMethodologyComparison',
  ],

  requiredContext: ['goals_and_targets', 'business_model'],
  outputFormat: 'slack',
  estimatedDuration: '60s',

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: { analysisWindow: 'current_quarter' },
      outputKey: 'time_windows',
    },
    {
      id: 'check-quota-config',
      name: 'Check Quota Configuration',
      tier: 'compute',
      computeFn: 'checkQuotaConfig',
      computeArgs: {},
      outputKey: 'quota_config',
    },
    {
      id: 'resolve-completed-quarters',
      name: 'Compute Completed Quarter Conversions',
      tier: 'compute',
      dependsOn: ['resolve-time-windows', 'check-quota-config'],
      computeFn: 'computeCompletedQuarterConversions',
      computeArgs: { lookbackQuarters: 6 },
      outputKey: 'completed_quarters',
    },
    {
      id: 'compute-current-quarter-projection',
      name: 'Project Current Quarter Conversion',
      tier: 'compute',
      dependsOn: ['resolve-completed-quarters'],
      computeFn: 'computeCurrentQuarterProjection',
      computeArgs: {},
      outputKey: 'current_projection',
    },
    {
      id: 'compute-win-rates',
      name: 'Compute Narrow vs. Broad Win Rates',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'computeWinRateAnalysis',
      computeArgs: { lookbackQuarters: 6 },
      outputKey: 'win_rates',
    },
    {
      id: 'compute-coverage-adequacy',
      name: 'Compute Coverage Adequacy vs. Implied Need',
      tier: 'compute',
      dependsOn: ['resolve-completed-quarters', 'check-quota-config'],
      computeFn: 'computeCoverageAdequacy',
      computeArgs: {},
      outputKey: 'coverage_adequacy',
    },
    {
      id: 'compute-methodology-divergence',
      name: 'Compute Methodology Divergence (Conversion vs Win Rate)',
      tier: 'compute',
      dependsOn: ['compute-coverage-adequacy', 'compute-win-rates'],
      computeFn: 'computeMethodologyDivergence',
      computeArgs: {},
      outputKey: 'methodology_divergence',
    },

    {
      id: 'classify-conversion-health',
      name: 'Classify Conversion Health',
      tier: 'deepseek',
      dependsOn: ['resolve-completed-quarters', 'compute-win-rates', 'compute-coverage-adequacy'],
      deepseekPrompt: `You are analyzing pipeline conversion health for a B2B SaaS company.

CONVERSION DATA:
{{completed_quarters}}

WIN RATE ANALYSIS:
{{win_rates}}

COVERAGE ADEQUACY:
{{coverage_adequacy}}

Respond with JSON only:
{
  "conversion_trend": "improving" | "stable" | "declining",
  "primary_drag": "win_rate" | "derail_rate" | "deal_size_shift" | "mix_shift" | "insufficient_data",
  "severity": "high" | "medium" | "low",
  "suggested_focus": "coverage" | "conversion" | "derail_reduction" | "deal_quality",
  "summary": "one sentence diagnosis",
  "footnote": "if implied coverage from conversion rate diverges >15% from standard 3x, explain the gap in 1-2 sentences or null"
}`,
      outputKey: 'classification',
    },
    {
      id: 'prepare-conversion-summary',
      name: 'Prepare Conversion Summary',
      tier: 'compute',
      dependsOn: ['resolve-completed-quarters', 'compute-win-rates', 'compute-coverage-adequacy', 'classify-conversion-health'],
      computeFn: 'prepareConversionSummary',
      computeArgs: {},
      outputKey: 'summary',
    },
    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['prepare-conversion-summary'],
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
      id: 'synthesize-conversion-report',
      name: 'Synthesize Conversion Report',
      tier: 'claude',
      dependsOn: ['summarize-for-claude', 'classify-conversion-health', 'compute-methodology-divergence'],
      claudePrompt: `You are a RevOps analyst delivering pipeline conversion analysis.
Lead with the single most important number. Be direct — no hedging.

Write a conversion rate analysis using this data:

{{claude_input}}

CLASSIFICATION:
{{classification}}

Structure:
1. **The Key Number** — lead with week-3 conversion rate and what it implies for required coverage
2. **Win Rate Picture** — narrow vs. broad, what the gap reveals (competitive pressure vs. status quo)
3. **Trend** — improving, stable, or declining over how many quarters
4. **Coverage Gap** — if conversion rate implies a different coverage need than current, call it out with $ amount
5. **Recommended Action** — one clear action (coverage, conversion, or derail reduction)

Under 350 words.

{{#if methodology_divergence.comparisonReady}}{{#unless (eq methodology_divergence.severity "info")}}
---
METHODOLOGY DIVERGENCE FOOTNOTE — append after your main analysis as a <methodology_json> block:

The week-3 conversion rate ({{methodology_divergence.conversionRate}}) implies {{methodology_divergence.primaryValue}}x required coverage.
The win rate method (narrow win rate: {{methodology_divergence.narrowWinRate}}, derail rate: {{methodology_divergence.derailRate}}) implies {{methodology_divergence.secondaryValue}}x required coverage.
Gap: {{methodology_divergence.divergencePct}}% (severity: {{methodology_divergence.severity}}).

In exactly 1–2 sentences: explain what this gap reveals about how this team sells. What does it mean when the conversion-based method and the win-rate method disagree by this much? Consider: do they qualify out aggressively early? Are there many no-decisions? Do NOT pick a method as correct. DO explain the mechanism behind the gap. End with one sentence identifying which method is more reliable for this workspace and why.

Append this exact JSON block at the very end of your response (after all narrative):
<methodology_json>
{
  "gapExplanation": "1-2 sentences explaining the mechanism",
  "recommendedMethod": "week3_conversion_rate or win_rate_inverted",
  "recommendedRationale": "one sentence why"
}
</methodology_json>
{{/unless}}{{/if}}`,
      outputKey: 'synthesis',
    },

    {
      id: 'extract-methodology-comparison',
      name: 'Extract Methodology Comparison from Synthesis',
      tier: 'compute',
      dependsOn: ['synthesize-conversion-report'],
      computeFn: 'extractMethodologyComparison',
      computeArgs: { synthesisKey: 'synthesis', metric: 'required_coverage' },
      outputKey: 'methodology_output',
    },
  ],
};
