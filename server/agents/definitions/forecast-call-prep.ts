import type { AgentDefinition } from '../types.js';

export const forecastCallPrepAgent: AgentDefinition = {
  id: 'forecast-call-prep',
  name: 'Forecast Call Prep',
  description: 'Pre-meeting brief for forecast reviews combining forecast data, deal risks, rep performance, and scoring into a cheat sheet.',
  skills: [
    { skillId: 'forecast-rollup', required: true, outputKey: 'forecast', timeout_seconds: 120 },
    { skillId: 'deal-risk-review', required: true, outputKey: 'risks', timeout_seconds: 180 },
    { skillId: 'rep-scorecard', required: false, outputKey: 'scorecard', timeout_seconds: 120 },
    { skillId: 'lead-scoring', required: false, outputKey: 'scores', timeout_seconds: 120 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are preparing a revenue leader for a forecast call. Your job is to arm them with the data they need to ask the right questions and challenge the right assumptions. Be specific. Name deals, name reps, name risks.`,
    userPromptTemplate: `Build a forecast call prep brief from these analyses.

FORECAST ROLL-UP:
{{forecast}}

DEAL RISKS:
{{risks}}

REP PERFORMANCE:
{{scorecard}}

DEAL SCORES:
{{scores}}

Structure the brief as:
1. Forecast summary: commit vs best case vs worst case
2. Deals to challenge: which commits are at risk and why
3. Upside opportunities: which best-case deals could pull in
4. Rep-level questions: who to press, who to praise
5. Scoring insights: which deals have strong ICP fit but poor engagement (untapped potential)
6. Three specific questions to ask in the call

Keep it actionable. This is a cheat sheet, not a report.`,
    maxTokens: 3000,
  },
  trigger: { type: 'manual' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
