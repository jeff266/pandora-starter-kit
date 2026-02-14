import type { SkillDefinition } from '../types.js';

export const pipelineGoalsSkill: SkillDefinition = {
  id: 'pipeline-goals',
  name: 'Pipeline Activity Goals',
  description: 'Reverse-engineers quota into weekly activity targets: how many meetings, calls, and deals each rep needs to hit their number.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: ['preparePipelineGoalsSummary'],
  requiredContext: ['goals_and_targets'],

  steps: [
    {
      id: 'compute-goals',
      name: 'Compute Pipeline Goals & Reverse Math',
      tier: 'compute',
      computeFn: 'preparePipelineGoalsSummary',
      computeArgs: {},
      outputKey: 'goals_data',
    },

    {
      id: 'classify-gaps',
      name: 'Classify Rep Activity Gaps',
      tier: 'deepseek',
      dependsOn: ['compute-goals'],
      deepseekPrompt: `You are a sales operations analyst classifying activity gaps for each rep.

TARGETS & ACTUALS:
{{{json goals_data.targets}}}

HISTORICAL RATES:
{{{json goals_data.rates}}}

REVERSE MATH:
{{{json goals_data.reverseMath}}}

REP BREAKDOWN:
{{{json goals_data.repBreakdown}}}

For each rep, classify:
1. status: on_track | at_risk | behind | no_data
2. primary_gap: one of [pipeline_volume, meeting_pace, call_pace, win_rate, deal_size, no_gap]
3. weekly_prescription: specific number of meetings/calls needed per week
4. urgency: immediate | this_week | this_month

Respond with ONLY a JSON object:
{
  "rep_classifications": [
    {
      "rep": "string",
      "status": "string",
      "primary_gap": "string",
      "weekly_prescription": "string",
      "urgency": "string"
    }
  ],
  "team_status": "on_track | at_risk | behind",
  "biggest_lever": "string"
}`,
      outputKey: 'gap_classifications',
      parseAs: 'json',
    },

    {
      id: 'synthesize-report',
      name: 'Generate Activity Goals Report',
      tier: 'claude',
      dependsOn: ['compute-goals', 'classify-gaps'],
      claudePrompt: `You are a sales operations leader delivering weekly activity targets to a sales team. Be specific with numbers, rep names, and actions. No fluff.

{{#if goals_data.targets.quotaWarning}}
⚠️ {{goals_data.targets.quotaWarning}}
{{/if}}

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

# Quota & Attainment
- Monthly target: \${{goals_data.targets.quota.monthly}} (source: {{goals_data.targets.quota.source}})
- Won this month: \${{goals_data.targets.attainment.amount_won}} ({{goals_data.targets.attainment.deals_won}} deals)
- Gap to close: \${{goals_data.reverseMath.gap}}
- Days remaining: {{goals_data.targets.timing.daysRemaining}}

# Pipeline Math
- Open pipeline: \${{goals_data.targets.pipeline.open_pipeline}} ({{goals_data.targets.pipeline.open_deals}} deals)
- Expected from pipeline (at {{goals_data.rates.winRate}} win rate): \${{goals_data.reverseMath.expectedFromPipeline}}
- Pipeline gap: {{goals_data.reverseMath.pipelineGap}} additional deals needed
- Avg deal size: \${{goals_data.targets.pipeline.avg_deal_size}}

# Weekly Activity Targets
- Deals to create: {{goals_data.reverseMath.weeklyTargets.deals_to_create}}/week
- Meetings: {{goals_data.reverseMath.weeklyTargets.meetings_per_week}}/week
- Calls: {{goals_data.reverseMath.weeklyTargets.calls_per_week}}/week

# Activity Benchmarks (Won Deals)
- Avg activities per won deal: {{goals_data.rates.activityBenchmarks.avg_activities}}
- Avg meetings: {{goals_data.rates.activityBenchmarks.avg_meetings}}
- Avg calls: {{goals_data.rates.activityBenchmarks.avg_calls}}

# Current Pace
- Activities this month: {{goals_data.rates.currentPace.activities_this_month}}
- Meetings this month: {{goals_data.rates.currentPace.meetings_this_month}}
- Meeting pace gap: {{goals_data.reverseMath.paceAssessment.meetingPaceGap}}

# Team Status: {{gap_classifications.team_status}}
Biggest lever: {{gap_classifications.biggest_lever}}

# Rep Activity Gaps
{{#each gap_classifications.rep_classifications}}
- **{{this.rep}}** [{{this.status}}]: {{this.primary_gap}} — {{this.weekly_prescription}} ({{this.urgency}})
{{/each}}

# Rep Pipeline & Activity Detail
{{#each goals_data.repBreakdown}}
- **{{this.rep}}**: {{this.openDeals}} open deals (\${{this.pipelineValue}}), won {{this.wonThisMonth}} (\${{this.wonValue}}), {{this.meetings}} meetings / {{this.calls}} calls this month
{{/each}}

Write an activity goals briefing covering:
1. Headline: are we on track or not? (one sentence with the dollar gap)
2. The math: show the reverse calculation simply
3. Weekly targets for the team (meetings, calls, pipeline creation)
4. Rep-specific prescriptions (who needs to do what)
5. The one activity that would have the biggest impact
6. What "good" looks like this week (specific numbers)

Keep it under 500 words. This is a manager's playbook for the week.`,
      maxTokens: 2000,
      outputKey: 'report',
    },
  ],

  outputFormat: {
    type: 'narrative',
    sections: ['headline', 'reverse_math', 'weekly_targets', 'rep_prescriptions', 'biggest_lever'],
  },

  evidenceSchema: {
    entity_type: 'rep',
    columns: [
      { key: 'rep_name', display: 'Rep Name', format: 'text' },
      { key: 'quota', display: 'Quota', format: 'currency' },
      { key: 'won_this_month', display: 'Won This Month', format: 'currency' },
      { key: 'open_pipeline', display: 'Open Pipeline', format: 'currency' },
      { key: 'gap_to_quota', display: 'Gap to Quota', format: 'currency' },
      { key: 'meetings_this_month', display: 'Meetings This Month', format: 'number' },
      { key: 'calls_this_month', display: 'Calls This Month', format: 'number' },
      { key: 'status', display: 'Status', format: 'text' },
      { key: 'primary_gap', display: 'Primary Gap', format: 'text' },
      { key: 'weekly_prescription', display: 'Weekly Prescription', format: 'text' },
    ],
  },
};
