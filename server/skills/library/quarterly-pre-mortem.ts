import type { SkillDefinition } from '../types.js';

export const quarterlyPreMortemSkill: SkillDefinition = {
  id: 'quarterly-pre-mortem',
  name: 'Quarterly Pre-Mortem',
  description:
    'Runs at the start of each quarter (or on-demand). Reads prior Monday skill outputs — Monte Carlo, GTM health, pipeline progression, coverage, and conversion rate — and composes a forward-looking failure-mode analysis. Each failure mode is persisted as a standing hypothesis row for weekly threshold monitoring. Zero CRM queries: all computation is from cached skill outputs.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'loadSkillOutputs',
    'computeQuarterContext',
    'writeStandingHypotheses',
    'preparePreMortemSummary',
    'calculateOutputBudget',
    'summarizeForClaude',
  ],

  requiredContext: ['goals_and_targets', 'business_model'],
  outputFormat: 'slack',
  estimatedDuration: '90s',

  schedule: {
    cron: '0 8 1 1,4,7,10 *',
    trigger: 'on_demand',
  },

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'load-all-skill-outputs',
      name: 'Load Pre-Computed Skill Outputs',
      tier: 'compute',
      computeFn: 'loadSkillOutputs',
      computeArgs: {
        skillIds: [
          'monte-carlo-forecast',
          'gtm-health-diagnostic',
          'pipeline-progression',
          'pipeline-coverage',
          'pipeline-conversion-rate',
        ],
        maxAgeDays: 7,
      },
      outputKey: 'skill_outputs',
    },
    {
      id: 'compute-quarter-context',
      name: 'Compute Quarter Context',
      tier: 'compute',
      dependsOn: ['load-all-skill-outputs'],
      computeFn: 'computeQuarterContext',
      computeArgs: {},
      outputKey: 'quarter_context',
    },
    {
      id: 'identify-failure-modes',
      name: 'Identify Failure Modes',
      tier: 'deepseek',
      dependsOn: ['compute-quarter-context'],
      deepseekPrompt: `You are running a pre-mortem analysis for a B2B SaaS sales team at the start of a new quarter.
A pre-mortem asks: "If we miss our number this quarter, what will have caused it?"
Your job is to identify the 2–4 most likely failure modes given the data below.

QUARTER CONTEXT:
{{quarter_context}}

SKILL OUTPUTS (from prior Monday runs):
{{skill_outputs}}

For each failure mode, produce a standing hypothesis: a specific, measurable claim that Pandora can monitor weekly.
Every hypothesis needs: a metric name, a current numeric value, a numeric alert threshold, and a direction (below/above).

Respond with valid JSON only:
{
  "quarterLabel": "Q2 2026",
  "headline": "One sentence: P50 landing and what it depends on",
  "composition": "Which segment wins or loses the quarter and why",
  "upsideScenario": "What achievable upside looks like if leading indicators hold",
  "failureModes": [
    {
      "rank": 1,
      "name": "Short name for this failure mode",
      "hypothesis": "Full sentence: the specific claim Pandora will monitor (e.g. 'Large deal conversion is the swing variable this quarter')",
      "probability": 38,
      "metric": "machine_readable_metric_key (e.g. large_deal_win_rate, pipeline_coverage_ratio, week3_conversion_rate)",
      "currentValue": 2.9,
      "alertThreshold": 2.5,
      "alertDirection": "below",
      "leadingIndicator": "What to watch weekly as an early signal",
      "action": "What to do now to prevent this failure",
      "reviewWeeks": 8
    }
  ]
}

Rules:
- Rank failure modes by probability (highest first)
- Use only metrics that appear in the skill outputs — do not invent data
- alertThreshold must be a specific number, not a range
- alertDirection: "below" means alert fires when currentValue drops below threshold; "above" means when it rises above
- reviewWeeks: how many weeks until this hypothesis should be reviewed (typically 8)
- 2 failure modes minimum, 4 maximum`,
      outputKey: 'failure_modes',
    },
    {
      id: 'write-standing-hypotheses',
      name: 'Write Standing Hypotheses to Database',
      tier: 'compute',
      dependsOn: ['identify-failure-modes'],
      computeFn: 'writeStandingHypotheses',
      computeArgs: {},
      outputKey: 'hypothesis_write_result',
    },
    {
      id: 'prepare-pre-mortem-summary',
      name: 'Prepare Pre-Mortem Summary',
      tier: 'compute',
      dependsOn: [
        'load-all-skill-outputs',
        'compute-quarter-context',
        'identify-failure-modes',
        'write-standing-hypotheses',
      ],
      computeFn: 'preparePreMortemSummary',
      computeArgs: {},
      outputKey: 'pre_mortem_summary',
    },
    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['prepare-pre-mortem-summary'],
      computeFn: 'calculateOutputBudget',
      computeArgs: { targetTokens: 2500 },
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
      id: 'synthesize-pre-mortem',
      name: 'Synthesize Pre-Mortem Briefing',
      tier: 'claude',
      dependsOn: ['summarize-for-claude', 'identify-failure-modes', 'write-standing-hypotheses'],
      claudePrompt: `You are writing a quarterly pre-mortem briefing for a B2B SaaS RevOps leader.
A pre-mortem runs forward, not backward: it identifies the most likely failure modes BEFORE they happen.
Write as if Pandora derived this from data — because it did. No hedging, no "it depends."

DATA:
{{claude_input}}

FAILURE MODES + STANDING HYPOTHESES:
{{failure_modes}}

HYPOTHESES WRITTEN TO DATABASE:
{{hypothesis_write_result}}

Write the pre-mortem in this structure:

**[Quarter] Pre-Mortem** — generated [today's date]

HEADLINE: [P50 landing and what it depends on — one sentence]

COMPOSITION: [Which segment or set of deals determines the quarter. Be specific: name the segment, the count, the expected closes at base rate, the combined contribution.]

FAILURE MODE 1: [Name]
  Probability: [X]%
  Leading indicator: [what to watch]
  Action: [what to do now]
  Monitor: weekly, every Monday briefing
  Alert threshold: [specific threshold that will trigger an alert]

FAILURE MODE 2: [Name]
  [same structure]

[Additional failure modes if identified]

UPSIDE SCENARIO: [What achievable upside looks like — not heroic, grounded in data]

STANDING HYPOTHESES RECORDED: [N] failure modes are now monitored weekly. Concierge will alert if any threshold is crossed.

Rules:
- Under 450 words
- Name specific deals only if they appear in the skill outputs
- Every number must come from the data — do not invent values
- Write "Standing hypotheses recorded: N" using the actual count from hypothesis_write_result
- Tone: direct, confident, data-grounded. Not cheerful. Not alarming.`,
      outputKey: 'synthesis',
    },
  ],
};
