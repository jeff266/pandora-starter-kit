import type { AgentDefinition } from '../types.js';

export const bowtieReviewAgent: AgentDefinition = {
  id: 'bowtie-review',
  name: 'Bowtie Funnel Review',
  description: 'Weekly full-funnel review combining bowtie analysis, pipeline goals, and deal risk into a unified ops briefing.',
  skills: [
    { skillId: 'bowtie-analysis', required: true, outputKey: 'bowtie', timeout_seconds: 120 },
    { skillId: 'pipeline-goals', required: true, outputKey: 'goals', timeout_seconds: 120 },
    { skillId: 'deal-risk-review', required: false, outputKey: 'risks', timeout_seconds: 180 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are a VP of Revenue Operations delivering a weekly full-funnel review. Connect the dots between funnel health, activity targets, and deal risks. Be specific with numbers, rep names, and actions. Every recommendation should be tied to a metric.`,
    userPromptTemplate: `Synthesize these three analyses into a unified weekly ops briefing.

BOWTIE FUNNEL:
{{bowtie}}

ACTIVITY GOALS:
{{goals}}

DEAL RISKS:
{{risks}}

Write a unified briefing covering:
1. Funnel health headline (one sentence: healthy, at risk, or critical?)
2. The number to know: what's the gap and what activity closes it?
3. Conversion bottleneck: where in the funnel are we losing deals?
4. Rep action items: top 3 specific things reps should do this week
5. Risk watch: which deals need intervention before they slip?
6. One leading indicator to track this week

Keep it under 600 words. This is read standing up at the Monday meeting.`,
    maxTokens: 2500,
  },
  trigger: { type: 'cron', cron: '0 7 * * 1' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
