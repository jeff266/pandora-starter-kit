/**
 * Rep Scorecard Skill
 *
 * Composite performance scorecard combining results, pipeline health,
 * activity, and velocity metrics with graceful degradation.
 */

import type { SkillDefinition } from '../types.js';

export const repScorecardSkill: SkillDefinition = {
  id: 'rep-scorecard',
  name: 'Rep Scorecard',
  description: 'Composite performance scorecard for each rep combining results, pipeline health, activity, and velocity metrics',
  version: '1.0.0',
  category: 'reporting',
  tier: 'mixed',

  requiredTools: [
    'checkDataAvailability',
    'repScorecardCompute',
    'prepareRepScorecardSummary',
  ],

  requiredContext: ['goals_and_targets'],

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'last_7d',
  },

  steps: [
    // Step 1: Resolve time windows
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: {},
      outputKey: 'time_windows',
    },

    // Step 2: Check data availability
    {
      id: 'check-data-availability',
      name: 'Check Data Availability',
      tier: 'compute',
      computeFn: 'checkDataAvailability',
      computeArgs: {},
      outputKey: 'data_availability',
    },

    // Step 3: Compute full scorecard
    {
      id: 'compute-scorecard',
      name: 'Compute Rep Scorecard',
      tier: 'compute',
      dependsOn: ['resolve-time-windows', 'check-data-availability'],
      computeFn: 'repScorecardCompute',
      computeArgs: {},
      outputKey: 'scorecard',
    },

    // Step 4: Prepare team context
    {
      id: 'prepare-team-context',
      name: 'Prepare Team Context',
      tier: 'compute',
      dependsOn: ['compute-scorecard'],
      computeFn: 'prepareRepScorecardSummary',
      computeArgs: {},
      outputKey: 'team_context',
    },

    // Step 5: Classify coaching needs (DeepSeek)
    {
      id: 'classify-coaching-needs',
      name: 'Classify Coaching Needs (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['compute-scorecard'],
      deepseekPrompt: `You are a sales enablement analyst reviewing rep performance data.

For each underperforming rep, identify their primary coaching need.

Classify:
1. primary_gap: one of [prospecting, qualification, closing, activity_volume, deal_management, conversation_skills, pipeline_generation]
2. evidence: 2-3 specific metrics that are below team average (include numbers)
3. coaching_recommendation: one specific, actionable step their manager should take (not generic advice)
4. urgency: one of [immediate, this_quarter, developmental]

Definitions:
- prospecting: not generating enough new pipeline
- qualification: pipeline is large but low quality (high fall-out rate)
- closing: deals advance but don't close (low win rate in late stages)
- activity_volume: fewer touchpoints than team average
- deal_management: too many stale deals, poor hygiene
- conversation_skills: high talk ratio, short calls, few follow-up calls
- pipeline_generation: adequate activity but not creating new opps

Urgency:
- immediate: rep is at risk of missing quota this quarter AND there's time to course-correct
- this_quarter: concerning pattern but not yet critical
- developmental: longer-term skill gap, not urgent this quarter

Team averages for reference:
Average closed won: \${{scorecard.teamAverages.avgClosedWon}}
Average win rate: {{scorecard.teamAverages.avgWinRate}}
Average coverage ratio: {{scorecard.teamAverages.avgCoverageRatio}}
Average activities: {{scorecard.teamAverages.avgActivities}}
Average new deals: {{scorecard.teamAverages.avgNewDeals}}

Reps to classify (bottom performers):
{{scorecard.bottom3}}

Respond with ONLY a JSON object: { "classifications": [...] }`,
      deepseekSchema: {
        type: 'object',
        properties: {
          classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                repName: { type: 'string' },
                primary_gap: {
                  type: 'string',
                  enum: ['prospecting', 'qualification', 'closing', 'activity_volume', 'deal_management', 'conversation_skills', 'pipeline_generation'],
                },
                evidence: { type: 'array', items: { type: 'string' } },
                coaching_recommendation: { type: 'string' },
                urgency: {
                  type: 'string',
                  enum: ['immediate', 'this_quarter', 'developmental'],
                },
              },
              required: ['repName', 'primary_gap', 'evidence', 'coaching_recommendation', 'urgency'],
            },
          },
        },
        required: ['classifications'],
      },
      outputKey: 'coaching_classifications',
    },

    // Step 6: Synthesize scorecard report (Claude)
    {
      id: 'synthesize-scorecard-report',
      name: 'Synthesize Scorecard Report',
      tier: 'claude',
      dependsOn: ['compute-scorecard', 'classify-coaching-needs', 'prepare-team-context'],
      claudePrompt: `You are a senior RevOps analyst delivering the weekly rep scorecard for {{business_model.company_name}}.

{{#if dataFreshness.isStale}}
Note: {{dataFreshness.staleCaveat}}
{{/if}}

DATA AVAILABILITY:
{{{json data_availability}}}

TEAM SUMMARY:
Total reps: {{scorecard.reps.length}}
Average composite score: {{scorecard.teamAverages}}

TOP PERFORMERS (by composite score):
{{#each scorecard.top3}}
{{this.rank}}. {{this.repName}} - Score: {{this.overallScore}}/100
   Closed won: \${{this.closedWon}} ({{this.closedWonCount}} deals)
   Open pipeline: \${{this.openPipeline}} ({{this.openDealCount}} deals)
   {{#if this.quota}}Quota attainment: {{this.quotaAttainment}}%{{/if}}
   {{#if this.coverageRatio}}Coverage: {{this.coverageRatio}}x{{/if}}
   {{#if this.totalActivities}}Activities: {{this.totalActivities}} ({{this.activitiesPerDeal}} per deal){{/if}}
   Score breakdown: {{this.scoreBreakdown}}
{{/each}}

AT-RISK REPS (with coaching classifications):
{{#each coaching_classifications.classifications}}
Rep: {{this.repName}}
  Primary gap: {{this.primary_gap}}
  Evidence: {{this.evidence}}
  Recommendation: {{this.coaching_recommendation}}
  Urgency: {{this.urgency}}
{{/each}}

PIPELINE CONTEXT:
{{#each team_context.stageDistribution}}
- {{this.stage}}: {{this.count}} deals (\${{this.totalValue}})
{{/each}}

RECENT WINS:
{{#each team_context.recentWins}}
- {{this.name}} (\${{this.amount}}, {{this.owner}})
{{/each}}

AT-RISK DEALS (deal_risk >= 70):
{{#each team_context.atRiskDeals}}
- {{this.name}} (\${{this.amount}}, {{this.owner}}) — Risk: {{this.dealRisk}}, Stage: {{this.stage}}
{{/each}}

STALE DEALS (no activity >14 days): {{team_context.staleDealsSummary.count}} deals (\${{team_context.staleDealsSummary.totalValue}})

STRUCTURE YOUR REPORT:
1. Team pulse: 2-3 sentences on overall team health and quarter pacing.
2. Top performers: what the top reps are doing differently — specific behaviors, not just results.
3. Coaching priorities: for each at-risk rep, the specific gap, evidence, and one recommended manager action. Frame constructively.
4. Manager actions for this week: 3-5 specific actions with rep names.

RULES:
- Use specific numbers and names throughout
- If quota data is missing, focus on relative performance vs team average
- If activity data is missing, note briefly and base scorecard on results and pipeline
- Word budget: 700 words

{{voiceBlock}}`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 16 * * 5', // Friday 4 PM UTC (end of week summary)
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '60s',

  evidenceSchema: {
    entity_type: 'rep',
    columns: [
      { key: 'rep_name', display: 'Rep Name', format: 'text' },
      { key: 'overall_score', display: 'Overall Score', format: 'number' },
      { key: 'closed_won', display: 'Closed Won', format: 'currency' },
      { key: 'closed_won_count', display: 'Deals Won', format: 'number' },
      { key: 'open_pipeline', display: 'Open Pipeline', format: 'currency' },
      { key: 'open_deal_count', display: 'Open Deals', format: 'number' },
      { key: 'quota_attainment', display: 'Quota Attainment %', format: 'percentage' },
      { key: 'coverage_ratio', display: 'Coverage Ratio', format: 'number' },
      { key: 'total_activities', display: 'Activities', format: 'number' },
      { key: 'primary_gap', display: 'Primary Gap', format: 'text' },
      { key: 'coaching_recommendation', display: 'Coaching Recommendation', format: 'text' },
    ],
  },
};
