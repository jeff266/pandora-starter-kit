/**
 * Pipeline Hygiene Check Skill
 *
 * Analyzes deal pipeline for data quality issues, stale deals, missing fields,
 * and risk signals. Produces actionable recommendations.
 *
 * Runs: Monday 8 AM (cron) + on demand
 * Output: Slack formatted message
 * Tier: Mixed (compute for data gathering, Claude for analysis)
 */

import type { SkillDefinition } from '../types.js';

export const pipelineHygieneSkill: SkillDefinition = {
  id: 'pipeline-hygiene',
  name: 'Pipeline Hygiene Check',
  description: 'Analyzes deal pipeline for data quality issues, stale deals, missing fields, and risk signals. Produces actionable recommendations.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'queryDeals',
    'getDealsByStage',
    'getStaleDeals',
    'getPipelineSummary',
    'getActivitySummary',
    'getDealsClosingInRange',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

  steps: [
    // Step 1: Gather pipeline summary
    {
      id: 'gather-pipeline-data',
      name: 'Gather Pipeline Summary',
      tier: 'compute',
      computeFn: 'computePipelineCoverage',
      computeArgs: {},
      outputKey: 'pipeline_summary',
    },

    // Step 2: Gather stage breakdown
    {
      id: 'gather-stage-breakdown',
      name: 'Gather Stage Breakdown',
      tier: 'compute',
      computeFn: 'getDealsByStage',
      computeArgs: {},
      outputKey: 'stage_breakdown',
    },

    // Step 3: Gather stale deals
    {
      id: 'gather-stale-deals',
      name: 'Gather Stale Deals',
      tier: 'compute',
      computeFn: 'getStaleDeals',
      computeArgs: {},
      outputKey: 'stale_deals',
    },

    // Step 4: Gather deals closing soon
    {
      id: 'gather-closing-soon',
      name: 'Gather Deals Closing in Next 30 Days',
      tier: 'compute',
      computeFn: 'getDealsClosingInRange',
      computeArgs: {
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      outputKey: 'closing_soon',
    },

    // Step 5: Gather recent activity
    {
      id: 'gather-activity',
      name: 'Gather Recent Activity Summary',
      tier: 'compute',
      computeFn: 'getActivitySummary',
      computeArgs: { days: 7 },
      outputKey: 'recent_activity',
    },

    // Step 6: Analyze hygiene with Claude
    {
      id: 'analyze-hygiene',
      name: 'Analyze Pipeline Hygiene',
      tier: 'claude',
      dependsOn: [
        'gather-pipeline-data',
        'gather-stage-breakdown',
        'gather-stale-deals',
        'gather-closing-soon',
        'gather-activity',
      ],
      claudeTools: ['queryDeals', 'getDealsClosingInRange', 'getDeal'],
      maxToolCalls: 5,
      claudePrompt: `You have pipeline data for this workspace. Analyze it for hygiene issues.

Their targets:
- Pipeline coverage target: {{goals_and_targets.pipeline_coverage_target}}x
- Revenue target: ${'$'}{{goals_and_targets.revenue_target}}
- Stale deal threshold: {{goals_and_targets.thresholds.stale_deal_days}} days
- Sales cycle: {{business_model.sales_cycle_days}} days

Pipeline Summary:
{{pipeline_summary}}

Stage Breakdown:
{{stage_breakdown}}

Stale Deals ({{stale_deals.length}} deals):
{{stale_deals}}

Closing in 30 Days:
{{closing_soon}}

Activity Last 7 Days:
{{recent_activity}}

Produce a Pipeline Hygiene Report with these sections:

1. COVERAGE STATUS
   - Current coverage ratio vs target
   - Gap in dollars (how much more pipeline needed to hit target)
   - Assessment: on track, at risk, or critical

2. PIPELINE QUALITY
   - Stage distribution assessment (healthy balance or bottlenecks?)
   - Identify stages where deals are stuck
   - Velocity concerns (deals sitting too long in early stages)

3. STALE DEALS
   - List each stale deal with: name, amount, days stale, current stage
   - Recommended action for each (re-engage, disqualify, or escalate)
   - Total value at risk from stale deals

4. AT-RISK DEALS
   - Deals closing within 30 days with low activity or missing data
   - List name, amount, close date, and specific risk factor
   - Recommended immediate actions

5. DATA QUALITY
   - Count of deals missing critical fields: amount, close date, owner
   - Impact on forecast accuracy
   - Specific deals to fix (if < 10, list them; otherwise give count)

6. TOP 3 ACTIONS
   - Ranked by impact (revenue at risk or forecast accuracy)
   - Each action should be specific and assignable
   - Include expected outcome for each

Be specific. Use actual deal names and dollar amounts. Don't generalize.
Format as clear sections with bullet points.`,
      outputKey: 'hygiene_report',
    },
  ],

  schedule: {
    cron: '0 8 * * 1', // Monday 8 AM
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'pipeline-hygiene',

  estimatedDuration: '2m',
};
