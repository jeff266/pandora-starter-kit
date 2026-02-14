import type { AgentDefinition } from '../types.js';

export const attainmentVsGoalAgent: AgentDefinition = {
  id: 'attainment-vs-goal',
  name: 'Attainment vs Goal',
  description: 'Are we going to hit the number? Quota tracking with forecast context.',
  skills: [
    { skillId: 'pipeline-goals', required: true, outputKey: 'goals', timeout_seconds: 120 },
    { skillId: 'forecast-rollup', required: true, outputKey: 'forecast', timeout_seconds: 120 },
    { skillId: 'pipeline-coverage', required: false, outputKey: 'coverage', timeout_seconds: 120 },
    { skillId: 'rep-scorecard', required: false, outputKey: 'reps', timeout_seconds: 120 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are a CRO looking at the numbers mid-period. Your job is to give a straight answer: will we hit the number or not? No hedging. Use the data to make a call, then explain what has to happen for the answer to change. Be specific with dollar amounts, deal names, and rep names.`,
    userPromptTemplate: `Build an attainment vs goal assessment.

QUOTA & PIPELINE MATH:
{{goals}}

FORECAST:
{{forecast}}

PIPELINE COVERAGE:
{{coverage}}

REP PERFORMANCE:
{{reps}}

Structure as:

THE CALL
One sentence: "We will / will not hit \$X this [month/quarter]."
Then the confidence level (high/medium/low) and why.

THE MATH
| Metric | Target | Actual | Gap | Status |
Quota, attained, coverage ratio, win rate needed, deals needed.

FORECAST VS QUOTA
Commit: \$X (Y% of quota)
Best case: \$X (Y% of quota)
Worst case: \$X (Y% of quota)
How much of the gap depends on best-case deals pulling in?

COVERAGE CHECK
Pipeline-to-quota ratio. Is it 3x? 4x? Below 2x?
Weighted pipeline (by stage probability) vs quota.
How much pipeline needs to be CREATED in the remaining days?

REP-LEVEL BREAKDOWN
Who's tracking ahead of their number? Who's behind?
Which reps have enough pipeline? Which need to prospect?
One specific action per rep.

WHAT HAS TO GO RIGHT
The 3-5 things that must happen to hit the number.
Name specific deals that must close.
Name specific pipeline that must be created.

WHAT COULD GO WRONG
The 2-3 risks that could blow the quarter.
Deals in commit that are at risk (from forecast data).

Keep it under 500 words. This is the executive check-in.`,
    maxTokens: 2500,
  },
  trigger: { type: 'cron', cron: '0 7 * * 1,4' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
