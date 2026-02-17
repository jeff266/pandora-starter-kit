import type { SkillDefinition } from '../types.js';

export const forecastAccuracyTrackingSkill: SkillDefinition = {
  id: 'forecast-accuracy-tracking',
  name: 'Forecast Accuracy Tracking',
  description: 'Analyzes per-rep forecast accuracy over the last 4 quarters: commit hit rates, haircut factors, sandbagging and over-commitment patterns. Produces adjusted team commit numbers for CRO review.',
  version: '1.0.0',
  category: 'forecasting',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'fatGatherRepAccuracy',
    'fatGatherHistoricalRollups',
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
      id: 'gather-rep-accuracy',
      name: 'Gather Per-Rep Forecast Accuracy',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'fatGatherRepAccuracy',
      computeArgs: {},
      outputKey: 'rep_accuracy',
    },

    {
      id: 'gather-historical-rollups',
      name: 'Gather Historical Forecast Rollup Runs',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'fatGatherHistoricalRollups',
      computeArgs: {},
      outputKey: 'historical_rollups',
    },

    {
      id: 'classify-volatile-reps',
      name: 'Classify Volatile and Edge-Case Reps',
      tier: 'deepseek',
      dependsOn: ['gather-rep-accuracy', 'gather-historical-rollups'],
      deepseekPrompt: `You are a sales performance analyst. Classify each rep with a "volatile", "insufficient_data", or "over_committer" pattern to understand the likely root cause.

REP ACCURACY DATA:
{{{json rep_accuracy}}}

HISTORICAL ROLLUP DATA:
{{{json historical_rollups}}}

For each rep whose pattern is "volatile", "insufficient_data", or "over_committer", classify them. Return a JSON array:
[
  {
    "rep_name": "string",
    "likely_cause": "new_rep" | "territory_change" | "inconsistent_crm_hygiene" | "seasonality" | "genuine_volatility",
    "reliability_grade": "A" | "B" | "C" | "D",
    "coaching_priority": "high" | "medium" | "low",
    "notes": "one-sentence explanation"
  }
]

Grade criteria:
- A: commit_hit_rate >= 80% OR pattern = 'accurate' with sufficient data
- B: commit_hit_rate 65-79% OR accurate but low sample size
- C: commit_hit_rate 50-64% OR volatile
- D: commit_hit_rate < 50% OR systematic over_committer

Skip reps with pattern "accurate" and sufficient data — they don't need classification.
Return ONLY the JSON array.`,
      outputKey: 'rep_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['gather-rep-accuracy', 'rep_classifications'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-accuracy-report',
      name: 'Synthesize Forecast Accuracy Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-rep-accuracy',
        'gather-historical-rollups',
        'classify-volatile-reps',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a RevOps analyst presenting forecast accuracy findings to the CRO at {{business_model.company_name}}.

REP ACCURACY DATA:
{{{json rep_accuracy}}}

HISTORICAL ROLLUP DATA:
{{{json historical_rollups}}}

REP CLASSIFICATIONS (for volatile/edge-case reps):
{{{json rep_classifications}}}

TIME WINDOWS:
{{{json time_windows}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:

1. **Team Forecast Accuracy Summary**
   - Overall team commit hit rate (% of committed deals that actually closed)
   - Average haircut factor across all reps
   - Data coverage note: how many quarters of history are available
   - If fewer than 2 quarters of data: state clearly that accuracy model is warming up and when full confidence activates

2. **Rep Accuracy Table**
   Format as a markdown table:
   | Rep | Win Rate | Commit Hit Rate | Pattern | Haircut | Grade |
   - Sort by commit hit rate descending
   - Bold reps with haircut_factor < 0.7 (systematic over-committers)
   - Mark reps with insufficient data as "—" for commit hit rate

3. **Sandbaggers and Over-Committers**
   - List sandbaggers: reps who consistently under-forecast then over-deliver
   - List over-committers: reps whose commits regularly don't close
   - For each, cite the evidence (commit hit rate, pattern)

4. **Adjusted Team Commit**
   - If historical rollup data exists: show most recent week's commit amount and what it would be after haircuts
   - Key insight: "Applying rep-level haircuts adjusts team commit by X%"
   - If no rollup history: show calculation based on current open pipeline patterns

5. **Quarter Trend**
   - If multiple rollup runs exist: is accuracy improving or declining?
   - Call out any rep showing rapid improvement or deterioration

6. **Coaching Callouts**
   - Reps classified as high coaching priority
   - Specific coaching recommendation for each (e.g., "Review deal qualification criteria", "CRM hygiene — close dates being pushed repeatedly")

{{voiceBlock}}

After the report, emit an <actions> block with a JSON array of actions:
[{
  "action_type": "schedule_review" | "flag_at_risk" | "accelerate_deal",
  "severity": "critical" | "warning" | "info",
  "title": "short title",
  "summary": "1-2 sentences with specific evidence",
  "recommended_steps": ["step1", "step2"],
  "target_deal_name": null,
  "owner_email": null,
  "impact_amount": null,
  "urgency_label": "this_week" | "next_week" | "overdue"
}]
<actions>[]</actions>

Word budget: {{output_budget.target_words}} words.`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 17 * * 5',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '45s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'rep_name', display: 'Rep', format: 'text' },
      { key: 'win_rate', display: 'Win Rate %', format: 'number' },
      { key: 'commit_hit_rate', display: 'Commit Hit Rate %', format: 'number' },
      { key: 'total_closed', display: 'Deals Closed', format: 'number' },
      { key: 'total_won', display: 'Deals Won', format: 'number' },
      { key: 'haircut_factor', display: 'Haircut Factor', format: 'number' },
      { key: 'pattern', display: 'Pattern', format: 'text' },
      { key: 'quarters_analyzed', display: 'Quarters Analyzed', format: 'number' },
    ],
  },
};
