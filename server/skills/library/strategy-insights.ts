import type { SkillDefinition } from '../types.js';

export const strategyInsightsSkill: SkillDefinition = {
  id: 'strategy-insights',
  name: 'Strategy & Insights',
  description: 'Strategic Pipeline Review: Synthesizes all other skill outputs to identify org-wide patterns, contradictions, and strategic opportunities. Outputs: strategic_themes, risk_implications. Use to: brief leadership, identify systemic gaps, or trigger org-wide campaigns.',
  version: '1.1.0',
  category: 'intelligence',
  tier: 'mixed',

  requiredTools: ['prepareStrategyInsights'],
  requiredContext: [],

  steps: [
    {
      id: 'gather-insights-data',
      name: 'Gather Skill Outputs & Check Input Freshness',
      tier: 'compute',
      computeFn: 'prepareStrategyInsights',
      computeArgs: {},
      outputKey: 'insights_data',
    },

    {
      id: 'synthesize-strategy',
      name: 'Synthesize Strategic Insights',
      tier: 'claude',
      dependsOn: ['gather-insights-data'],
      claudePrompt: `You are a strategic advisor to a RevOps consultant who manages multiple client engagements. You have access to every analysis that has been run across all clients. Your job is to identify patterns, contradictions, and strategic implications that no single report can see.

{{#unless insights_data.dataAvailable}}
⚠️ INSUFFICIENT DATA — DO NOT SYNTHESIZE

{{insights_data.warningMessage}}

Skills with recent outputs: {{#if insights_data.skillsWithRecentRuns.length}}{{#each insights_data.skillsWithRecentRuns}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}{{else}}none{{/if}}

Please output the following message verbatim and nothing else:

**Strategy & Insights could not run** — not enough upstream skill data is available (need at least 3 skills with outputs from the last 14 days).

To generate this report, run these skills first:
{{#each insights_data.skillsMissingRuns}}
- {{this}}
{{/each}}

Once those have completed, re-run Strategy & Insights.
{{else}}
{{#if insights_data.limitedData}}
⚠️ LIMITED DATA CAVEAT: {{insights_data.warningMessage}}
This synthesis is based on partial data. Treat recommendations as directional, not definitive.

{{/if}}
You think in terms of:
- Cross-client patterns: is the same issue showing up everywhere?
- Leading indicators: what's about to become a problem?
- Opportunity cost: where is effort being wasted?
- Leverage points: what one change would create the most impact?

RECENT SKILL OUTPUTS (last 14 days):
{{#each insights_data.recentOutputs.skills}}
### {{@key}} (ran: {{this.ran}})
{{this.output}}

{{/each}}

{{#if insights_data.recentOutputs.agentCount}}
RECENT AGENT BRIEFINGS:
{{#each insights_data.recentOutputs.agents}}
### {{@key}} (ran: {{this.ran}})
{{this.output}}

{{/each}}
{{/if}}

CROSS-WORKSPACE METRICS:
{{#each insights_data.crossWorkspace.workspaces}}
- {{this.name}}: {{this.open_deals}} open deals, pipeline \${{this.open_pipeline}}, won {{this.won_this_month}} (\${{this.won_amount_this_month}}) this month
{{/each}}

STAGE MOVEMENT TRENDS:
{{#each insights_data.trends.stageMovement}}
- {{this.stage_normalized}}: {{this.moved_this_week}} this week vs {{this.moved_last_week}} last week
{{/each}}

Write a strategic insights brief covering:

1. THE BIG PICTURE
One paragraph: what's the overall trajectory? Getting better or worse?

2. CROSS-CUTTING PATTERNS
What themes appear across multiple skill outputs? Are the same deals showing up in risk reports AND hygiene reports AND threading alerts?

3. LEADING INDICATORS
What signals suggest something is about to change? Conversion rate shifts, activity drops, pipeline thinning, stage velocity changes.

4. CONTRADICTIONS
Any cases where one report says things are fine but another says they're not? Call these out explicitly.

5. STRATEGIC RECOMMENDATIONS
Top 3 actions ranked by expected impact. Each must be specific (name a deal, rep, or metric) and time-bound.

6. WHAT TO STOP DOING
One thing the team should deprioritize based on the data.

Keep it under 500 words. This is the "so what?" layer.

{{voiceBlock}}
{{/unless}}`,
      maxTokens: 2500,
      outputKey: 'report',
    },
  ],

  schedule: {
    cron: '30 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: {
    type: 'narrative',
    sections: ['big_picture', 'patterns', 'leading_indicators', 'contradictions', 'recommendations', 'stop_doing'],
  } as any,

  estimatedDuration: '300 seconds',
  answers_questions: ['strategy', 'market', 'positioning', 'competitive position', 'strategic'],

  evidenceSchema: {
    entity_type: 'workspace',
    columns: [
      { key: 'workspace_name', display: 'Workspace', format: 'text' },
      { key: 'insight_type', display: 'Insight Type', format: 'text' },
      { key: 'finding', display: 'Finding', format: 'text' },
      { key: 'source_skills', display: 'Source Skills', format: 'text' },
      { key: 'severity', display: 'Severity', format: 'severity' },
      { key: 'recommendation', display: 'Recommendation', format: 'text' },
    ],
  },
};
