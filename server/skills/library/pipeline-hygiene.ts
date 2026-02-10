import type { SkillDefinition } from '../types.js';

export const pipelineHygieneSkill: SkillDefinition = {
  id: 'pipeline-hygiene',
  name: 'Pipeline Hygiene Check',
  description: 'Analyzes deal pipeline for data quality issues, stale deals, missing fields, and risk signals. Produces actionable recommendations.',
  version: '2.1.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'computePipelineCoverage',
    'getDealsByStage',
    'aggregateStaleDeals',
    'aggregateClosingSoon',
    'getActivitySummary',
    'computeOwnerPerformance',
    'queryDeals',
    'getDeal',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

  steps: [
    {
      id: 'gather-pipeline-summary',
      name: 'Pipeline Summary',
      tier: 'compute',
      computeFn: 'computePipelineCoverage',
      computeArgs: {},
      outputKey: 'pipeline_summary',
    },

    {
      id: 'gather-stage-breakdown',
      name: 'Stage Breakdown',
      tier: 'compute',
      computeFn: 'getDealsByStage',
      computeArgs: {},
      outputKey: 'stage_breakdown',
    },

    {
      id: 'aggregate-stale-deals',
      name: 'Aggregate Stale Deals',
      tier: 'compute',
      computeFn: 'aggregateStaleDeals',
      computeArgs: { topN: 20 },
      outputKey: 'stale_deals_agg',
    },

    {
      id: 'aggregate-closing-soon',
      name: 'Aggregate Deals Closing Soon',
      tier: 'compute',
      computeFn: 'aggregateClosingSoon',
      computeArgs: { daysAhead: 30, topN: 10 },
      outputKey: 'closing_soon_agg',
    },

    {
      id: 'gather-activity',
      name: 'Activity Summary (7 days)',
      tier: 'compute',
      computeFn: 'getActivitySummary',
      computeArgs: { days: 7 },
      outputKey: 'recent_activity',
    },

    {
      id: 'compute-owner-performance',
      name: 'Owner Performance Summary',
      tier: 'compute',
      computeFn: 'computeOwnerPerformance',
      computeArgs: {},
      outputKey: 'owner_performance',
    },

    {
      id: 'classify-deal-issues',
      name: 'Classify Deal Issues (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['aggregate-stale-deals', 'aggregate-closing-soon'],
      deepseekPrompt: `You are a RevOps data analyst. Classify each deal below to identify root causes and recommend actions.

For each deal, determine:
1. root_cause: one of [rep_neglect, prospect_stalled, data_hygiene, process_gap, timing, competitive_loss, champion_change]
2. confidence: 0.0 to 1.0
3. signals: list of specific evidence supporting your classification
4. suggested_action: one concrete next step

Context:
- Stale threshold: {{goals_and_targets.thresholds.stale_deal_days}} days
- Average sales cycle: {{business_model.sales_cycle_days}} days
- Pipeline coverage target: {{goals_and_targets.pipeline_coverage_target}}x

STALE DEALS (top 20 by amount):
{{stale_deals_agg.topDeals}}

DEALS CLOSING IN 30 DAYS (top 10 by amount):
{{closing_soon_agg.topDeals}}

Return valid JSON array with one object per deal:
{
  "dealName": "...",
  "dealId": "...",
  "category": "stale" | "closing_soon",
  "root_cause": "rep_neglect | prospect_stalled | data_hygiene | process_gap | timing | competitive_loss | champion_change",
  "confidence": 0.85,
  "signals": ["signal 1", "signal 2", "signal 3"],
  "suggested_action": "specific action for this deal"
}`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dealName: { type: 'string' },
            dealId: { type: 'string' },
            category: { type: 'string', enum: ['stale', 'closing_soon'] },
            root_cause: { type: 'string' },
            confidence: { type: 'number' },
            signals: { type: 'array', items: { type: 'string' } },
            suggested_action: { type: 'string' },
          },
          required: ['dealName', 'root_cause', 'confidence', 'signals', 'suggested_action'],
        },
      },
      outputKey: 'deal_classifications',
    },

    {
      id: 'synthesize-hygiene-report',
      name: 'Synthesize Pipeline Hygiene Report',
      tier: 'claude',
      dependsOn: [
        'gather-pipeline-summary',
        'gather-stage-breakdown',
        'aggregate-stale-deals',
        'aggregate-closing-soon',
        'gather-activity',
        'compute-owner-performance',
        'classify-deal-issues',
      ],
      claudeTools: ['queryDeals', 'getDeal'],
      maxToolCalls: 3,
      claudePrompt: `You have pre-analyzed pipeline data for this workspace. All raw data has been aggregated into structured summaries, and deals have been classified by root cause. Work from these summaries and classifications, not raw records.

PIPELINE SUMMARY:
{{pipeline_summary}}

STAGE BREAKDOWN:
{{stage_breakdown}}

STALE DEALS (aggregated — summary + severity buckets + top 20 by amount):
{{stale_deals_agg}}

DEALS CLOSING IN 30 DAYS (aggregated — summary + top 10 by amount):
{{closing_soon_agg}}

ACTIVITY LAST 7 DAYS:
{{recent_activity}}

OWNER PERFORMANCE (sorted by stale rate):
{{owner_performance}}

DEAL CLASSIFICATIONS (AI-analyzed root causes for top 30 deals):
{{deal_classifications}}

Produce a Pipeline Hygiene Report with these sections:

1. PIPELINE HEALTH
   - Coverage ratio vs {{goals_and_targets.pipeline_coverage_target}}x target
   - Gap in dollars vs ${'$'}{{goals_and_targets.revenue_target}} revenue target
   - Win rate trend and deal flow assessment

2. STALE DEAL CRISIS
   - Severity breakdown: how many critical (30+ days), serious, warning, watch
   - Total value at risk from stale deals
   - Which stages have the most stale deals (pattern detection)
   - Which reps have the worst stale rates (name them)
   - Root cause breakdown from classifications: rep_neglect, prospect_stalled, data_hygiene, process_gap, etc.
   - For each root cause category, cite specific deals and their recommended actions

3. CLOSING THIS MONTH
   - Total deals and value closing in 30 days
   - Risk assessment from classifications: which deals have timing issues, data gaps, or other blockers
   - Readiness assessment: realistic vs aspirational close dates based on activity and health scores

4. REP PERFORMANCE
   - Who's executing well (low stale rate, high activity)
   - Who needs coaching (high stale rate, low activity, deals with rep_neglect classification)
   - Activity patterns and pipeline distribution

5. TOP 3 ACTIONS
   - Ranked by revenue impact
   - Each action must name specific deals or reps (use names from classifications)
   - Include root cause and expected outcome if action is taken this week
   - Example: "Action 1: Re-engage Acme Corp ($220K, stale 87 days, root cause: rep_neglect). Assign to manager for immediate outreach. Expected: move to disqualified or re-activate within 7 days."

Be direct. Use actual deal names, dollar amounts, and rep names from the data and classifications. No generic advice.
The classifications provide specific root causes and actions for each top deal — reference these directly.
If you need to drill into a specific deal for more detail, use the available tools — but prefer the pre-analyzed summaries and classifications.`,
      outputKey: 'hygiene_report',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'pipeline-hygiene',

  estimatedDuration: '1m',
};
