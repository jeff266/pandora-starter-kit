/**
 * Pipeline Movement Skill
 *
 * Week-over-week delta: what changed since last Monday and does it matter?
 * Runs every Monday at 7am (before Pipeline Hygiene at 8am).
 *
 * Phase 1 — COMPUTE (7 steps, zero tokens)
 * Phase 2 — CLASSIFY (DeepSeek: stall-reason classification for stalled deals)
 * Phase 3 — SYNTHESIZE (Claude: narrative + structured MovementSummary)
 *
 * Estimated token cost: ~3,400/run
 */

import type { SkillDefinition } from '../types.js';

export const pipelineMovementSkill: SkillDefinition = {
  id: 'pipeline-movement',
  name: 'Pipeline Movement',
  description: 'Week-over-week pipeline delta: what changed, what moved, coverage trend, and goal trajectory. Outputs: headline, net_delta, top_movements, trend_signal.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'computePipelineSnapshotNow',
    'computePipelineSnapshotLastWeek',
    'computeDealMovementsThisWeek',
    'computeStageVelocityDeltas',
    'getTrendFromPipelineRuns',
    'computeNetPipelineDelta',
  ],

  requiredContext: ['goals_and_targets'],

  timeConfig: {
    analysisWindow: 'trailing_7d',
    changeWindow: 'last_7d',
  },

  steps: [
    // ── Step 1: Time windows ─────────────────────────────────────────────────
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: {
        analysisWindow: 'trailing_7d',
        changeWindow:   'last_7d',
      },
      outputKey: 'time_windows',
    },

    // ── Step 2: Current pipeline snapshot ────────────────────────────────────
    {
      id: 'snapshot-now',
      name: 'Current Pipeline Snapshot',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'computePipelineSnapshotNow',
      computeArgs: {},
      outputKey: 'snapshot_now',
    },

    // ── Step 3: Last-week pipeline snapshot (reconstructed from history) ──────
    {
      id: 'snapshot-last-week',
      name: 'Last-Week Pipeline Snapshot',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'computePipelineSnapshotLastWeek',
      computeArgs: {},
      outputKey: 'snapshot_last_week',
    },

    // ── Step 4: Deal-level movement classification ────────────────────────────
    {
      id: 'deal-movements',
      name: 'Classify Deal Movements',
      tier: 'compute',
      dependsOn: ['snapshot-now', 'snapshot-last-week'],
      computeFn: 'computeDealMovementsThisWeek',
      computeArgs: {},
      outputKey: 'movements',
    },

    // ── Step 5: Stage velocity (this week vs historical avg) ──────────────────
    {
      id: 'stage-velocity',
      name: 'Stage Velocity Deltas',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'computeStageVelocityDeltas',
      computeArgs: {},
      outputKey: 'velocity_deltas',
    },

    // ── Step 6: 4-week trend from prior skill_runs ────────────────────────────
    {
      id: 'trend-data',
      name: '4-Week Trend from Prior Runs',
      tier: 'compute',
      computeFn: 'getTrendFromPipelineRuns',
      computeArgs: { limit: 4 },
      outputKey: 'trend',
    },

    // ── Step 7: Net delta summary ─────────────────────────────────────────────
    {
      id: 'net-delta',
      name: 'Compute Net Pipeline Delta',
      tier: 'compute',
      dependsOn: ['snapshot-now', 'snapshot-last-week', 'deal-movements', 'trend-data'],
      computeFn: 'computeNetPipelineDelta',
      computeArgs: {},
      outputKey: 'net_delta',
    },

    // ── Step 8: DeepSeek — classify stall reasons ────────────────────────────
    {
      id: 'classify-stalls',
      name: 'Classify Stall Reasons',
      tier: 'deepseek',
      dependsOn: ['deal-movements'],
      deepseekPrompt: `You are classifying why B2B sales deals have stalled.

For each stalled deal below, classify the most likely stall reason using ONLY the signals available.
Use one of these six categories:
- no_activity       — no logged touchpoints in 14+ days
- stage_age         — in current stage significantly longer than typical
- champion_dark     — primary contact hasn't engaged recently
- awaiting_response — rep sent something, waiting on prospect
- internal_delay    — legal/procurement/internal approval likely
- unknown           — insufficient signal to classify

STALLED DEALS:
{{#each movements.stalled.deals}}
- {{name}} (\${{amount}}) — Stage: {{toStage}} — Days stalled: {{daysInStage}} — Owner: {{owner}}
{{/each}}

Return a JSON array of classifications.`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dealName:    { type: 'string' },
            stallReason: {
              type: 'string',
              enum: ['no_activity', 'stage_age', 'champion_dark', 'awaiting_response', 'internal_delay', 'unknown'],
            },
            confidence:  { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['dealName', 'stallReason', 'confidence'],
        },
      },
      outputKey: 'stall_classifications',
    },

    // ── Step 9: Claude — synthesize movement narrative ────────────────────────
    {
      id: 'synthesize-movement',
      name: 'Synthesize Pipeline Movement Narrative',
      tier: 'claude',
      dependsOn: [
        'snapshot-now',
        'snapshot-last-week',
        'deal-movements',
        'stage-velocity',
        'trend-data',
        'net-delta',
        'classify-stalls',
      ],
      claudeTools: [],
      maxToolCalls: 0,
      claudePrompt: `You are analyzing pipeline movement for a B2B RevOps team.

PIPELINE MOVEMENT THIS WEEK:
NET DELTA:
{{{json net_delta}}}

DEAL MOVEMENTS:
{{{json movements}}}

STAGE VELOCITY:
{{{json velocity_deltas}}}

4-WEEK TREND:
{{{json trend}}}

STALL CLASSIFICATIONS:
{{{json stall_classifications}}}

Your job: explain what changed this week, why it matters to the quarterly goal, and what to do about it.

STRUCTURE (follow this order exactly):
1. The headline: net change in one sentence. Example: "Pipeline grew $180K this week — coverage moved from 2.7× to 2.93×."
2. What drove it: the 2–3 most significant movements. Name specific deals and amounts.
3. The concern: what's moving in the wrong direction. Name stalled or lost deals and their stall reasons.
4. The trend: is this week better or worse than the 4-week pattern?
5. The goal connection: connect to the gap and weeks remaining. Is the trajectory on track?

VOICE RULES:
- No fear language. State trajectory, not alarm.
- Numbers must match the compute data exactly. Never estimate or round differently.
- If on_track = true, lead with that.
- If on_track = false, lead with the specific gap and lever.
- Maximum 300 words. Depth over breadth.
- Prose paragraphs only. No bullet lists.

After your narrative, emit a JSON summary block:
<summary>
{
  "headline": "one sentence pipeline movement headline",
  "trend_signal": "positive|neutral|negative",
  "on_track": true|false,
  "primary_concern": "one sentence or null",
  "recommended_action": "one specific concrete action or null"
}
</summary>`,
      outputKey: 'movement_report',
    },
  ],

  schedule: {
    cron:    '0 7 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'pipeline-movement',

  estimatedDuration: '2m',

  answers_questions: [
    'what changed this week',
    'pipeline movement',
    'week over week',
    'coverage trend',
    'on track',
    'pipeline delta',
    'stalled deals',
    'pipeline growth',
  ],
};
