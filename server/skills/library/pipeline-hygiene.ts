import type { SkillDefinition } from '../types.js';

export const pipelineHygieneSkill: SkillDefinition = {
  id: 'pipeline-hygiene',
  name: 'Pipeline Hygiene Check',
  description: 'Analyzes deal pipeline for data quality issues, stale deals, missing fields, and risk signals. Produces actionable recommendations.',
  version: '2.0.0',
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
      ],
      claudeTools: ['queryDeals', 'getDeal'],
      maxToolCalls: 3,
      claudePrompt: `You have pre-analyzed pipeline data for this workspace. All raw data has been aggregated into structured summaries — work from these summaries, not raw records.

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
   - Root cause patterns from the top 20 deals (rep neglect, prospect stalled, data hygiene, etc.)

3. CLOSING THIS MONTH
   - Total deals and value closing in 30 days
   - Which of the top deals look at risk (low health score, high risk, wrong stage)
   - Readiness assessment: realistic vs aspirational close dates

4. REP PERFORMANCE
   - Who's executing well (low stale rate, high activity)
   - Who needs coaching (high stale rate, low activity)
   - Activity patterns and pipeline distribution

5. TOP 3 ACTIONS
   - Ranked by revenue impact
   - Each action must name specific deals or reps
   - Include expected outcome if action is taken this week

Be direct. Use actual deal names, dollar amounts, and rep names from the data. No generic advice.
If you need to drill into a specific deal, use the available tools — but prefer the pre-analyzed summaries.`,
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
