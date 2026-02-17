import type { SkillDefinition } from '../types.js';

export const stageVelocityBenchmarksSkill: SkillDefinition = {
  id: 'stage-velocity-benchmarks',
  name: 'Stage Velocity Benchmarks',
  description: 'Calculates time-in-stage benchmarks (median, p75, p90) and flags deals exceeding thresholds. Identifies stalled, grinding, and regression-risk deals.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'svbComputeBenchmarks',
    'svbFlagSlowDeals',
    'calculateOutputBudget',
  ],

  requiredContext: ['business_model'],

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
      computeArgs: {
        analysisWindow: 'current_quarter',
        changeWindow: 'last_7d',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'compute-benchmarks',
      name: 'Compute Stage Benchmarks',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'svbComputeBenchmarks',
      computeArgs: { lookback_months: 12 },
      outputKey: 'benchmarks',
    },

    {
      id: 'flag-slow-deals',
      name: 'Flag Slow Deals Against Benchmarks',
      tier: 'compute',
      dependsOn: ['compute-benchmarks'],
      computeFn: 'svbFlagSlowDeals',
      computeArgs: {},
      outputKey: 'flagged_deals',
    },

    {
      id: 'classify-patterns',
      name: 'Classify Velocity Patterns',
      tier: 'deepseek',
      dependsOn: ['compute-benchmarks', 'flag-slow-deals'],
      deepseekPrompt: `You are a sales pipeline analyst. Classify each slow deal's velocity pattern.

BENCHMARKS:
{{{json benchmarks}}}

FLAGGED DEALS (above p75 threshold):
{{{json flagged_deals}}}

For each flagged deal, classify its pattern. Return a JSON array:
[
  {
    "deal_id": "string",
    "deal_name": "string",
    "pattern": "stalled" | "grinding" | "stuck_at_gate" | "regression_risk",
    "reason": "one-sentence explanation with specific evidence"
  }
]

Pattern definitions:
- stalled: No activity signal AND in stage well beyond p90. Deal appears abandoned.
- grinding: Active (has recent calls/activity) but progressing slowly. Taking longer than normal but not dead.
- stuck_at_gate: Blocked at a specific milestone — security review, legal, procurement, board approval.
- regression_risk: Has regressed to an earlier stage before, or shows signs of potential regression.

Classify ALL deals in the flagged list. Return ONLY the JSON array.`,
      outputKey: 'pattern_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['flag-slow-deals', 'pattern_classifications'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-report',
      name: 'Synthesize Velocity Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'compute-benchmarks',
        'flag-slow-deals',
        'classify-patterns',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a RevOps analyst delivering a pipeline velocity review for {{business_model.company_name}}.

STAGE BENCHMARKS (median/p75/p90 days):
{{{json benchmarks}}}

SLOW DEALS (above p75 threshold):
{{{json flagged_deals}}}

PATTERN CLASSIFICATIONS:
{{{json pattern_classifications}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:

1. **Velocity Summary**: How long are deals spending in each stage on average? Which stages are fastest/slowest? Compare median vs p90 to show spread.

2. **Slow Deal Inventory**: List every deal above the p75 threshold with: name, amount, stage, days in stage, benchmark median, how many days over benchmark. Bold critical (p90+) deals.

3. **Pattern Breakdown**: Group slow deals by pattern (stalled/grinding/stuck_at_gate/regression_risk). For each group, describe the common thread.

4. **Velocity Trends**: Are any stages getting slower? Compare current period against the 12-month baseline.

5. **Actions**: Specific deals to push this week. For each: what action, who owns it, what outcome to expect.

{{voiceBlock}}

After the report, emit an <actions> block with a JSON array of actions:
[{
  "action_type": "accelerate_deal" | "flag_at_risk" | "schedule_review",
  "severity": "critical" | "warning" | "info",
  "title": "short title",
  "summary": "1-2 sentences",
  "recommended_steps": ["step1", "step2"],
  "target_deal_name": "exact deal name",
  "owner_email": "rep email if known",
  "impact_amount": deal amount as number,
  "urgency_label": "overdue" | "this_week" | "next_week"
}]
<actions>[]</actions>`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 7 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '30s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'days_in_stage', display: 'Days in Stage', format: 'number' },
      { key: 'benchmark_median', display: 'Benchmark Median', format: 'number' },
      { key: 'benchmark_p75', display: 'P75 Threshold', format: 'number' },
      { key: 'benchmark_p90', display: 'P90 Threshold', format: 'number' },
      { key: 'days_over_benchmark', display: 'Days Over P75', format: 'number' },
      { key: 'severity', display: 'Severity', format: 'severity' },
      { key: 'pattern', display: 'Pattern', format: 'text' },
      { key: 'owner', display: 'Owner', format: 'text' },
    ],
  },
};
