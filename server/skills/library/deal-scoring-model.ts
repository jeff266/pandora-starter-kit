/**
 * Deal Scoring Model Skill — Daily 5-Dimension Scoring
 *
 * Scores every open deal 0-100 across 5 weighted dimensions:
 *   1. Qualification/Fit      (20%)
 *   2. Engagement/Signals     (25%)
 *   3. Velocity/Timing        (20%)
 *   4. Seller Execution       (20%)
 *   5. Pipeline Position      (15%)
 *
 * Writes ai_score + ai_score_breakdown to deals table.
 * Used by Command Center for deal row color-coding.
 * Schedule: Daily 6 AM
 */

import type { SkillDefinition } from '../types.js';

export const dealScoringModelSkill: SkillDefinition = {
  id: 'deal-scoring-model',
  name: 'Deal Scoring Model',
  description: 'Scores all open deals 0-100 across 5 dimensions. Writes ai_score to deals table for Command Center color-coding.',
  version: '1.0.0',
  category: 'scoring',
  tier: 'claude',
  slackTemplate: 'deal-scoring-model',

  requiredTools: [
    'dsmGatherOpenDeals',
    'dsmGatherScoringContext',
    'dsmComputeAndWriteScores',
    'dsmBuildFindings',
  ],
  requiredContext: [],

  steps: [
    // ─── PHASE 1: COMPUTE ─────────────────────────────────────────────────────

    {
      id: 'gather-open-deals',
      name: 'Gather Open Deals with Activity + Contact Signals',
      tier: 'compute',
      computeFn: 'dsmGatherOpenDeals',
      computeArgs: {},
      outputKey: 'open_deals_data',
    },

    {
      id: 'gather-scoring-context',
      name: 'Gather Stage Benchmarks and Rep Win Rates',
      tier: 'compute',
      computeFn: 'dsmGatherScoringContext',
      computeArgs: {},
      outputKey: 'scoring_context',
    },

    {
      id: 'compute-scores',
      name: 'Compute 5-Dimension Scores and Write to CRM',
      tier: 'compute',
      dependsOn: ['gather-open-deals', 'gather-scoring-context'],
      computeFn: 'dsmComputeAndWriteScores',
      computeArgs: {},
      outputKey: 'score_results',
    },

    {
      id: 'emit-findings',
      name: 'Emit Findings for Critical and At-Risk Deals',
      tier: 'compute',
      dependsOn: ['compute-scores'],
      computeFn: 'dsmBuildFindings',
      computeArgs: {},
      outputKey: 'findings_result',
    },

    // ─── PHASE 2: DEEPSEEK — Classify Top At-Risk Deals ──────────────────────

    {
      id: 'classify-at-risk',
      name: 'Classify Primary Risk Factor for At-Risk Deals (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['compute-scores'],
      deepseekPrompt: `You are a RevOps analyst classifying deal risk factors.

For each deal below, identify:
- primary_risk_factor: the dimension with the biggest weakness
  Values: "qualification" | "engagement" | "velocity" | "execution" | "position"
- risk_narrative: one sentence explaining the biggest risk (use deal name, stage, amount)
- top_action: the single most impactful next step for the rep
- confidence_in_score: "high" (full data) | "medium" (some gaps) | "low" (limited data)

Deals to classify (sorted by amount at risk):

{{{json score_results.top_at_risk}}}

Respond ONLY with a JSON array:
[
  {
    "deal_id": "uuid",
    "primary_risk_factor": "engagement",
    "risk_narrative": "string",
    "top_action": "string",
    "confidence_in_score": "high|medium|low"
  }
]`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            deal_id: { type: 'string' },
            primary_risk_factor: {
              type: 'string',
              enum: ['qualification', 'engagement', 'velocity', 'execution', 'position'],
            },
            risk_narrative: { type: 'string' },
            top_action: { type: 'string' },
            confidence_in_score: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['deal_id', 'primary_risk_factor', 'risk_narrative', 'top_action'],
        },
      },
      outputKey: 'at_risk_classifications',
      parseAs: 'json',
    },

    // ─── PHASE 3: CLAUDE — Synthesize Slack Report ───────────────────────────

    {
      id: 'synthesize-report',
      name: 'Generate Deal Score Report (Claude)',
      tier: 'claude',
      dependsOn: ['compute-scores', 'classify-at-risk'],
      claudePrompt: `You are a VP of Revenue Operations reviewing the daily deal health scorecard.

## Score Distribution

Deals scored today: {{score_results.scored}}
Average score: {{score_results.avg_score}}/100

Distribution:
- Strong (80-100): {{score_results.score_distribution.strong}} deals
- Solid (60-79): {{score_results.score_distribution.solid}} deals
- Uncertain (40-59): {{score_results.score_distribution.uncertain}} deals
- At Risk (20-39): {{score_results.score_distribution.at_risk}} deals
- Critical (0-19): {{score_results.score_distribution.critical}} deals

## Biggest Score Movers

Improved:
{{{json score_results.biggest_improvers}}}

Declined:
{{{json score_results.biggest_decliners}}}

## High-Value At-Risk Deals (>$50K, score <40)

{{{json score_results.high_value_at_risk}}}

## Risk Classifications (DeepSeek analysis)

{{{json at_risk_classifications}}}

---

Write a concise Slack-ready deal score report:

1. **Score Distribution** — One-line bar: "Strong [N] | Solid [N] | Uncertain [N] | At Risk [N] | Critical [N]"
   Average score: [X]/100

2. **🔴 Critical Deals** (score < 40, sorted by amount) — for each: deal name, amount, score, risk narrative, top action

3. **📈 Biggest Improvers** — top 3 deals that moved up, what changed

4. **📉 Biggest Decliners** — top 3 deals that dropped, what changed

5. **Team Pattern** — one synthesis insight about the overall portfolio (e.g., "Engagement scores are low across the board — last activity gaps averaging 18 days")

Keep sections tight — 2-3 lines each. Use deal names and dollar amounts.

{{voiceBlock}}`,
      outputKey: 'report',
      parseAs: 'markdown',
    },
  ],

  schedule: {
    cron: '0 6 * * *',
    trigger: ['on_demand'],
  },

  outputFormat: 'slack',
  estimatedDuration: '90s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'overall_score', display: 'AI Score', format: 'number' },
      { key: 'primary_risk', display: 'Primary Risk', format: 'text' },
      { key: 'score_delta', display: 'Score Change', format: 'number' },
    ],
  },
};
