import type { AgentDefinition } from '../types.js';

export const fridayRecapAgent: AgentDefinition = {
  id: 'friday-recap',
  name: 'Friday Recap',
  description: 'Weekly recap combining pipeline results with RevOps project accomplishments into a Friday email.',
  skills: [
    { skillId: 'weekly-recap', required: true, outputKey: 'pipeline_recap', timeout_seconds: 120 },
    { skillId: 'project-recap', required: false, outputKey: 'project_recap', timeout_seconds: 60 },
    { skillId: 'pipeline-goals', required: false, outputKey: 'goals', timeout_seconds: 120 },
  ],
  synthesis: {
    enabled: true,
    provider: 'claude',
    systemPrompt: `You are writing a Friday recap email for a RevOps leader to send to their team or stakeholders. The tone is confident but honest — celebrate wins, acknowledge gaps, and set up next week. This should feel like a leader writing to their team, not a robot generating a report.

The email has two halves:
1. Pipeline & Revenue — what happened with deals, pipeline, and revenue this week
2. RevOps Operations — what the RevOps team built, fixed, and shipped this week

Both matter. The pipeline half shows business impact. The operations half shows the team is investing in infrastructure that compounds over time.`,
    userPromptTemplate: `Write a Friday recap email.

PIPELINE & REVENUE THIS WEEK:
{{pipeline_recap}}

REVOPS PROJECT WORK:
{{project_recap}}

GOALS & PACE:
{{goals}}

Structure the email as:

Subject line: "Week of [date] — [one-line headline]"

WINS THIS WEEK
2-3 highlights across pipeline and project work. Lead with the most impressive number or accomplishment.

PIPELINE SNAPSHOT
Key deal movements, new pipeline created, deals won/lost, notable changes. Use specific deal names and dollar amounts.

REVOPS TEAM ACCOMPLISHMENTS
What we shipped and built this week. Frame it in terms of business impact, not just technical work. Instead of "fixed token usage," say "reduced AI analysis costs by 99%, saving \$X/month."

LOOKING AHEAD
What's on deck for next week. 2-3 priorities.
Any risks or blockers to flag.

SCORECARD
| Metric | This Week | Target | Status |
Quick table: revenue, pipeline, win rate, activity volume.

Keep the whole email under 400 words. It should take 90 seconds to read on a phone. No fluff, no filler paragraphs.`,
    maxTokens: 2500,
  },
  trigger: { type: 'cron', cron: '0 16 * * 5' },
  delivery: { channel: 'slack', format: 'slack' },
  workspaceIds: 'all',
  enabled: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
