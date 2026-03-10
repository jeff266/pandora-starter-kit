import type { AgentDefinition } from '../types.js';

export const repCoachingDigestAgent: AgentDefinition = {
  id: 'rep-coaching-digest',
  name: 'Rep Coaching Digest',
  description: 'Friday afternoon call behavior summary per rep. Surfaces talk ratio, next steps rate, champion language, and sentiment trends — then flags reps who need coaching attention heading into next week.',
  skills: [
    { skillId: 'conversation-intelligence', required: true, outputKey: 'call_intel', timeout_seconds: 180 },
    { skillId: 'coaching', required: false, outputKey: 'coaching', timeout_seconds: 120 },
    { skillId: 'rep-scorecard', required: false, outputKey: 'scorecard', timeout_seconds: 120 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are a RevOps leader writing a Friday coaching digest for the sales team. The tone is coaching-forward and constructive — not punitive. Celebrate reps who are doing things right. Flag concerns as opportunities, not failures. Be specific with names and numbers. Skip reps with zero calls this week.`,
    userPromptTemplate: `Summarize this week's call behavior and rep scorecard data into a Friday coaching digest.

CONVERSATION INTELLIGENCE:
{{call_intel}}

COACHING SIGNALS:
{{coaching}}

REP SCORECARD:
{{scorecard}}

For each rep with at least one call this week, produce a section:

**[Rep Name]** — [N] calls this week
- Talk ratio: [X]% rep / [Y]% customer (target: ≤50% rep)
- Next steps set: [N/N calls] ([%])
- Champion language detected: [Yes/No] on [N] calls
- Avg sentiment: [positive/neutral/negative]
- Trend vs last week: [improving/stable/declining]
- One coaching note: [specific, actionable, non-judgmental]

After all reps, add:

**This Week's Standout**: [Rep name] — [what they did well in one sentence]
**Coaching Focus for Next Week**: [Rep name] — [specific behavior to work on, framed as an opportunity]

Keep it under 500 words. Reps read this on Friday afternoon — it should feel like a coach's post-game notes, not a performance review.`,
    maxTokens: 2500,
  },
  goal: 'Help every rep improve their call behaviors week over week by giving them specific, honest, coaching-forward feedback every Friday — not during a quarterly review.',
  standing_questions: [
    'Which reps had the highest customer talk ratio this week and what does that signal?',
    'How many reps set explicit next steps on more than half their calls?',
    'Which reps showed champion language on their calls and which did not?',
    'Which rep had the biggest improvement or biggest decline in sentiment trend this week?',
  ],
  trigger: { type: 'cron', cron: '30 16 * * 5' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
