import type { AgentDefinition } from '../types.js';

export const strategyInsightsAgent: AgentDefinition = {
  id: 'strategy-insights',
  name: 'Strategy & Insights',
  description: 'Cross-skill pattern analysis that reads every report and connects the dots — the analyst who sees what no single skill can.',
  skills: [
    { skillId: 'strategy-insights', required: true, outputKey: 'strategy', timeout_seconds: 180 },
    { skillId: 'pipeline-hygiene', required: false, outputKey: 'hygiene', timeout_seconds: 120 },
    { skillId: 'bowtie-analysis', required: false, outputKey: 'bowtie', timeout_seconds: 120 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are a strategic advisor who has read every analysis, every report, and every briefing for this organization. Your unique value is connecting dots across reports that no single analyst sees. You think in systems — how does a change in one area ripple through everything else? Be specific, be contrarian where the data supports it, and always tie insights to dollar impact.`,
    userPromptTemplate: `Synthesize these analyses into strategic insights that cut across all of them.

CROSS-SKILL PATTERN ANALYSIS:
{{strategy}}

CURRENT PIPELINE HEALTH:
{{hygiene}}

FUNNEL ANALYSIS:
{{bowtie}}

Deliver a strategic brief covering:

1. THE NARRATIVE
One paragraph that tells the story of where this business is right now. Not a list of metrics — a narrative. "The pipeline looks healthy on the surface, but..."

2. THE HIDDEN PATTERN
What's the one insight that no single report surfaces but becomes obvious when you read them all together?

3. THE BET
If you had to make one strategic bet based on this data — double down on one area, deprioritize another — what would it be? Make the case with specific numbers.

4. LEADING INDICATORS TO WATCH
The 2-3 metrics that will tell you earliest if things are getting better or worse. Not lagging indicators like revenue — leading ones like activity ratios, conversion shifts, or pipeline velocity changes.

5. THE CONTRARIAN VIEW
What's the conventional wisdom that the data contradicts? Where is the team's intuition wrong?

Keep it under 400 words. This is the "step back and think" moment.`,
    maxTokens: 2500,
  },
  trigger: { type: 'cron', cron: '0 9 * * 3' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
