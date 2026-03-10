import type { AgentDefinition } from '../types.js';

export const dealRiskSweepAgent: AgentDefinition = {
  id: 'deal-risk-sweep',
  name: 'Deal Risk Sweep',
  description: 'Monday morning per-rep risk scan. Groups every open deal by owner and flags deals with no recent call, stalled stages, declining sentiment, or missing next steps.',
  skills: [
    { skillId: 'deal-risk-review', required: true, outputKey: 'risk_review', timeout_seconds: 180 },
    { skillId: 'conversation-intelligence', required: false, outputKey: 'call_intel', timeout_seconds: 120 },
    { skillId: 'stage-velocity-benchmarks', required: false, outputKey: 'velocity', timeout_seconds: 120 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are a VP of Revenue Operations running a Monday morning deal risk sweep. Your job is to surface every deal that is quietly slipping so reps can act this week. Be direct. Name deals, reps, and amounts. No filler.`,
    userPromptTemplate: `Review these deal risk signals and call intelligence for all open deals, then produce a per-rep risk table.

DEAL RISK REVIEW:
{{risk_review}}

CONVERSATION INTELLIGENCE:
{{call_intel}}

STAGE VELOCITY BENCHMARKS:
{{velocity}}

For each rep who owns at least one at-risk deal, write:

**[Rep Name] — [# deals at risk] / [total open deals]**
| Deal | Amount | Stage | Risk Signal | Recommended Action |
|------|--------|-------|-------------|-------------------|
[One row per at-risk deal]

Flag a deal if ANY of these are true:
- No call or email activity in 14+ days
- Stalled in current stage past the P75 benchmark
- Last call had declining or negative sentiment
- No agreed next steps after last call
- Single-threaded (only one contact on deal)

After the table, add one line: "This week's highest-priority close risk: [Deal Name] — [reason in one sentence]."

Keep it punchy. This is read over coffee on Monday.`,
    maxTokens: 2500,
  },
  goal: 'Surface every deal quietly slipping through the cracks before Monday standup — so reps know exactly where to focus their week.',
  standing_questions: [
    'Which deals have had no call or activity in 14+ days, grouped by rep?',
    'Which deals are stalled in their current stage past the typical benchmark?',
    'Which deals have declining sentiment signals from the most recent call?',
    'Which deals are missing agreed next steps after the last conversation?',
  ],
  trigger: { type: 'cron', cron: '30 7 * * 1' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
