import type { SkillDefinition } from '../types.js';

export const pipelineContributionForecastSkill: SkillDefinition = {
  id: 'pipeline-contribution-forecast',
  name: 'Pipeline Contribution Forecast',
  description:
    'Cohort-based model that tracks how newly created pipeline converts to bookings across 1–4 quarter horizons. Answers: "How much will future pipeline close this quarter? Next quarter? Over the next year?" Uses historical cohort conversion rates, stage velocity benchmarks, and a three-scenario projection to show the full revenue contribution of pipeline not yet in the CRM.',
  version: '1.0.0',
  category: 'forecasting',
  tier: 'mixed',

  requiredTools: [
    'pcfResolveContext',
    'pcfBuildCohortMatrix',
    'pcfLoadVelocityBenchmarks',
    'pcfProjectCreation',
    'pcfAuditOpenPipeline',
    'calculateOutputBudget',
  ],

  requiredContext: ['goals_and_targets'],

  timeConfig: {
    analysisWindow: 'trailing_90d',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'resolve-context',
      name: 'Resolve Quarter Context & Attainment',
      tier: 'compute',
      computeFn: 'pcfResolveContext',
      computeArgs: {},
      outputKey: 'context',
    },

    {
      id: 'build-cohort-matrix',
      name: 'Build Cohort Conversion Matrix (6-quarter lookback)',
      tier: 'compute',
      dependsOn: ['resolve-context'],
      computeFn: 'pcfBuildCohortMatrix',
      computeArgs: { lookback_quarters: 6 },
      outputKey: 'cohort_matrix',
    },

    {
      id: 'load-velocity-benchmarks',
      name: 'Load Stage Velocity Benchmarks',
      tier: 'compute',
      dependsOn: ['resolve-context'],
      computeFn: 'pcfLoadVelocityBenchmarks',
      computeArgs: {},
      outputKey: 'velocity',
    },

    {
      id: 'project-creation',
      name: 'Project Future Pipeline Creation & Horizon Bookings',
      tier: 'compute',
      dependsOn: ['resolve-context', 'build-cohort-matrix', 'load-velocity-benchmarks'],
      computeFn: 'pcfProjectCreation',
      computeArgs: {},
      outputKey: 'projections',
    },

    {
      id: 'audit-open-pipeline',
      name: 'Audit Open Pipeline Credibility vs Close Dates',
      tier: 'compute',
      dependsOn: ['resolve-context', 'load-velocity-benchmarks'],
      computeFn: 'pcfAuditOpenPipeline',
      computeArgs: {},
      outputKey: 'open_pipeline_audit',
    },

    {
      id: 'classify-signals',
      name: 'Classify Creation Trends & Coverage Signals',
      tier: 'deepseek',
      dependsOn: ['resolve-context', 'build-cohort-matrix', 'project-creation', 'audit-open-pipeline'],
      deepseekPrompt: `You are a RevOps analyst reviewing a pipeline contribution model.

QUARTER CONTEXT:
{{{json context}}}

COHORT CONVERSION MATRIX:
{{{json cohort_matrix}}}

PROJECTIONS (base scenario by horizon):
{{{json projections}}}

OPEN PIPELINE AUDIT:
{{{json open_pipeline_audit}}}

Classify the situation across four dimensions. Return a JSON object:
{
  "creation_trend": "accelerating" | "stable" | "decelerating" | "insufficient_data",
  "creation_trend_reason": "one sentence with specific numbers",
  "q0_coverage": "gap_fillable" | "partial" | "gap_too_large" | "no_gap",
  "q0_coverage_reason": "one sentence on whether future creation can close the current quarter gap",
  "primary_horizon": "q0" | "q1" | "q2" | "q3",
  "primary_horizon_reason": "one sentence: which horizon receives the most bookings contribution and why",
  "lag_profile": "transactional" | "mid_market" | "enterprise",
  "lag_profile_reason": "one sentence characterizing the business by where most cohort value lands",
  "creation_window_status": "open" | "narrowing" | "effectively_closed",
  "creation_window_reason": "one sentence on how many days remain for newly created deals to close in-quarter",
  "top_action": "string — the single highest-leverage action to improve the quarter-end picture"
}

Definitions:
- gap_fillable: future creation Q+0 contribution ≥ 80% of the attainment gap
- partial: future creation covers 20–80% of the gap
- gap_too_large: future creation covers <20% of the gap
- transactional: >40% of cohort value lands in Q+0
- mid_market: primary landing in Q+1, secondary in Q+2
- enterprise: primary landing in Q+2 or Q+3

Return ONLY the JSON object.`,
      outputKey: 'signals',
      parseAs: 'json',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['project-creation', 'classify-signals'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-report',
      name: 'Synthesize Pipeline Contribution Report',
      tier: 'claude',
      dependsOn: [
        'resolve-context',
        'build-cohort-matrix',
        'load-velocity-benchmarks',
        'project-creation',
        'audit-open-pipeline',
        'classify-signals',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a Revenue Operations analyst delivering a pipeline contribution forecast. Be specific with numbers and percentages. No fluff.

QUARTER CONTEXT:
- Current quarter: {{context.current_quarter}}
- Days elapsed / remaining: {{context.days_elapsed}} / {{context.days_remaining}}
- Quota: \${{context.quota}}
- Closed won this quarter: \${{context.closed_won_this_quarter}}
- Attainment: {{context.attainment_pct}}%
- Gap to quota: \${{context.gap}}
- Open pipeline (total): \${{context.open_pipeline_total}}
- Pipeline created so far this quarter: \${{context.amount_created_this_quarter}} at \${{context.pace_per_day}}/day

COHORT CONVERSION MATRIX:
{{{json cohort_matrix}}}

VELOCITY BENCHMARKS:
- Median total sales cycle: {{velocity.median_total_cycle_days}} days
- P75 cycle: {{velocity.p75_total_cycle_days}} days

PROJECTIONS (3 scenarios):
{{{json projections}}}

OPEN PIPELINE AUDIT:
- Credible (velocity-supported close by Q-end): \${{open_pipeline_audit.credible_amount}} ({{open_pipeline_audit.credible_count}} deals)
- At-risk (too slow for stated close date): \${{open_pipeline_audit.at_risk_amount}} ({{open_pipeline_audit.at_risk_count}} deals)

SIGNALS:
{{{json signals}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:

## The Full Quarter Picture
Show the three-bucket model as a table:
| Bucket | Amount | Notes |
| Closed Won | $X | done |
| Credible Open Pipeline | $Y | velocity-supported |
| Future Creation (Q+0) | $Z | base scenario |
| **Likely Landing** | **$X+Y+Z** | vs $Q quota |

One sentence on the gap: covered, partial, or too large?

## How This Business Converts Created Pipeline (Cohort Model)
State the lag profile clearly: "This is a [transactional/mid-market/enterprise] business."
Show the conversion rates per horizon using the cohort matrix:
- Of every $1 created, how much closes in Q+0? Q+1? Q+2? Q+3?
Show which horizons are material vs. noise.

## Horizon Forecast — Three Scenarios
Show a table with bear/base/bull for each horizon:
| Horizon | Bear | Base | Bull |
| Q+0 (rest of this quarter) | | | |
| Q+1 (next quarter) | | | |
| Q+2 | | | |
| Q+3 | | | |
| Full-year contribution | | | |

Note what assumptions drive the difference between scenarios (creation pace variance).

## Stage Velocity & the Creation Window
How many days remain for a newly created deal to close in-quarter? 
What does your median sales cycle say about whether that's realistic?
Flag if the in-quarter creation window is effectively closed.

## At-Risk Open Pipeline
Call out the at-risk deals (too slow for their Q close dates) with specific dollar impact.
Is this recoverable or should these be re-forecast to Q+1?

## The One Action
Based on signals.top_action: the single highest-leverage move right now. Specific, not generic.

{{voiceBlock}}

Word budget: {{output_budget.wordBudget}} words.`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '45s',

  answers_questions: [
    'future pipeline bookings',
    'pipeline contribution',
    'how much will close',
    'creation forecast',
    'pipeline created',
    'next quarter seeding',
    'horizon forecast',
    'when will pipeline close',
    'quarter contribution',
    'seeding next quarter',
    'full year from pipeline',
    'cohort',
    'pipeline to revenue',
  ],

  evidenceSchema: {
    entity_type: 'workspace',
    columns: [
      { key: 'horizon', display: 'Horizon', format: 'text' },
      { key: 'bear_bookings', display: 'Bear Case', format: 'currency' },
      { key: 'base_bookings', display: 'Base Case', format: 'currency' },
      { key: 'bull_bookings', display: 'Bull Case', format: 'currency' },
      { key: 'conversion_rate', display: 'Cohort Conversion Rate', format: 'percentage' },
      { key: 'quarters_analyzed', display: 'Quarters Analyzed', format: 'number' },
    ],
  },
};
