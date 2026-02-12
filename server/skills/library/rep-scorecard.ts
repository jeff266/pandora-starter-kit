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

    // Step 4: Classify coaching needs (DeepSeek)
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
Average closed won: ${{scorecard.teamAverages.avgClosedWon}}
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

    // Step 5: Synthesize scorecard report (Claude)
    {
      id: 'synthesize-scorecard-report',
      name: 'Synthesize Scorecard Report',
      tier: 'claude',
      dependsOn: ['compute-scorecard', 'classify-coaching-needs'],
      claudePrompt: `You are a VP of Sales reviewing your team's weekly performance scorecard.

BUSINESS CONTEXT:
{{businessContext}}

DATA AVAILABILITY:
{{data_availability}}

The scorecard is based on:
{{#if data_availability.hasQuotas}}- Quota data ({{data_availability.quotaCount}} quotas){{/if}}
{{#if data_availability.hasActivities}}- Activity data ({{data_availability.activityCount}} activities){{/if}}
{{#if data_availability.hasConversations}}- Conversation data ({{data_availability.conversationCount}} calls){{/if}}
{{#if data_availability.hasStageHistory}}- Stage history ({{data_availability.stageHistoryCount}} transitions){{/if}}

Do NOT mention missing data sources unless they would significantly change the analysis.

TEAM SUMMARY:
Total reps: {{scorecard.reps.length}}
Average composite score: {{scorecard.teamAverages}}

TOP PERFORMERS (by composite score):
{{#each scorecard.top3}}
{{this.rank}}. {{this.repName}} - Score: {{this.overallScore}}/100
   Closed won: ${{this.closedWon}} ({{this.closedWonCount}} deals)
   Open pipeline: ${{this.openPipeline}} ({{this.openDealCount}} deals)
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

Produce a Weekly Rep Scorecard Report:

1. TEAM PULSE (2-3 sentences)
   - Overall team health this week
   - Quarter progress vs quota pacing (if quotas available)

2. STANDOUT PERFORMERS
   - What the top reps are doing differently (specific behaviors, not just "they closed more")
   - Any patterns worth replicating across the team

3. COACHING PRIORITIES
   - For each at-risk rep: the specific gap, the evidence, and the recommended action for their manager
   - Frame as coaching opportunities, not criticism
   - Include specific 1:1 talking points

4. THIS WEEK'S MANAGER ACTIONS (3-5 bullet points)
   - Specific actions with specific rep names
   - "Schedule pipeline review with [name] focused on [gap]"
   - "Recognize [name] for [specific achievement]"

Rules:
- Use specific numbers and names throughout
- Frame bottom performers constructively — focus on the gap, not the person
- If quota data is missing, focus on relative performance (vs team average) instead of absolute attainment
- If activity data is missing, acknowledge briefly: "Activity metrics unavailable — scorecard based on results and pipeline metrics"
- Keep it actionable. Every paragraph should answer "so what?"
- Use markdown formatting with headers, bullet points, and bold text for emphasis

Word budget: 700 words.`,
      outputKey: 'narrative',
      claudeTools: ['queryDeals', 'getDealsByStage'],
      maxToolCalls: 10,
    },
  ],

  schedule: {
    cron: '0 16 * * 5', // Friday 4 PM UTC (end of week summary)
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '60s',
};
