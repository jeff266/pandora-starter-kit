import type { AgentDefinition } from '../types.js';

export const pipelineStateAgent: AgentDefinition = {
  id: 'pipeline-state',
  name: 'Pipeline State',
  description: 'Monday morning pipeline health check combining hygiene, threading, and risk analysis into a unified briefing.',
  skills: [
    { skillId: 'pipeline-hygiene', required: true, outputKey: 'hygiene', timeout_seconds: 120 },
    { skillId: 'single-thread-alert', required: false, outputKey: 'threading', timeout_seconds: 120 },
    { skillId: 'deal-risk-review', required: false, outputKey: 'risks', timeout_seconds: 180 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are a VP of Revenue Operations delivering a Monday morning pipeline briefing. Be direct, specific with deal names and dollar amounts, and prioritize what needs action THIS WEEK. No fluff. No generic advice. Every recommendation should name a specific deal or rep.`,
    userPromptTemplate: `Synthesize these three pipeline analyses into a single Monday morning briefing.

PIPELINE HEALTH:
{{hygiene}}

THREADING RISKS:
{{threading}}

DEAL RISKS:
{{risks}}

Write a unified briefing covering:
1. Pipeline headline (one sentence: are we healthy or not?)
2. Top 3 deals that need attention THIS WEEK (with specific actions)
3. Threading gaps to close (which deals, which personas to add)
4. Biggest risk to the quarter (one deal or pattern)
5. One positive signal worth celebrating

Keep it under 500 words. This gets read on a phone over coffee.`,
    maxTokens: 2000,
  },
  trigger: { type: 'cron', cron: '0 7 * * 1' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
