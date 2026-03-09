/**
 * Behavioral Winning Path Skill — v2
 *
 * Discovers behavioral milestone sequences from closed won deal transcripts
 * using DeepSeek (discovery pass + scoring pass), then synthesizes findings
 * with Claude. Falls back to predefined proxies for Tiers 2–4.
 *
 * Tier 1: Conversation Intelligence (Gong / Fireflies) — discovery-first, HIGH confidence
 * Tier 2: Email Engagement — predefined proxies, MEDIUM confidence
 * Tier 3: Contact Role Coverage — predefined proxies, LOW-MEDIUM confidence
 * Tier 4: Stage History Only — predefined proxies, LOW confidence
 */

import type { SkillDefinition } from '../types.js';

export const behavioralWinningPathSkill: SkillDefinition = {
  id: 'behavioral-winning-path',
  name: 'Behavioral Winning Path',
  description:
    'Discovers behavioral milestone sequences from closed won deal transcripts (Tier 1) or derives structural proxies from email/CRM data (Tiers 2–4). Identifies what separates won deals from lost deals in behavioral terms.',
  version: '2.0.0',
  category: 'intelligence',
  tier: 'mixed',

  requiredTools: [
    'bwpProbeTier',
    'bwpExtractMilestones',
  ],

  requiredContext: [],

  steps: [
    // Step 1: Probe data tier (zero tokens, fast)
    {
      id: 'probe-data-tier',
      name: 'Probe Data Tier',
      tier: 'compute',
      computeFn: 'bwpProbeTier',
      computeArgs: {},
      outputKey: 'tier_probe',
    },

    // Step 2: Extract behavioral milestones
    // For Tier 1: runs DeepSeek discovery + scoring internally (no separate classify step)
    // For Tiers 2–4: returns predefined proxy milestones
    {
      id: 'extract-milestones',
      name: 'Extract Behavioral Milestones',
      tier: 'compute',
      dependsOn: ['probe-data-tier'],
      computeFn: 'bwpExtractMilestones',
      computeArgs: { periodDays: 548 }, // 18 months — structural patterns need long windows
      outputKey: 'milestone_matrix',
    },

    // Step 3: Claude synthesis
    {
      id: 'synthesize-winning-path',
      name: 'Synthesize Behavioral Winning Path',
      tier: 'claude',
      dependsOn: ['extract-milestones'],
      claudePrompt: `You are a RevOps analyst synthesizing a Behavioral Winning Path analysis.

Pipeline: {{#if milestone_matrix.meta.pipelineId}}{{milestone_matrix.meta.pipelineId}}{{else}}All Pipelines{{/if}}
Won cycle median: {{milestone_matrix.wonMedianDays}} days
Analysis: {{milestone_matrix.meta.totalWonDeals}} won + {{milestone_matrix.meta.totalLostDeals}} lost deals, trailing 18 months
Discovery: {{milestone_matrix.discoveryNote}}{{#if milestone_matrix.isDiscovered}} — {{milestone_matrix.meta.transcriptsSampled}} transcripts analyzed{{/if}}

{{#if milestone_matrix.wonMilestones.length}}
DISCOVERED MILESTONES (ordered by avg timing):
{{{json milestone_matrix.wonMilestones}}}

BIGGEST GAPS (milestones with highest lift, sorted desc):
{{{json milestone_matrix.lostAbsences}}}
{{else}}
No milestone data available — insufficient closed deal history. Explain that more closed deals are needed to generate behavioral patterns (minimum ~10 won and ~10 lost in the analysis window).
{{/if}}

VOICE RULES:
- Calm, specific, data-first. Write like a RevOps analyst reading a report.
- Report what the data shows. If data coverage is limited, state the limitation once, plainly, then analyze what is available.
- Never use fear language, urgency language, or implicit product CTAs.
- Never say "flying blind", "alarming", "unlock", or "you need to".

Write a Behavioral Winning Path analysis for this pipeline.
3–4 paragraphs. No generic GTM advice. Everything you say must be grounded in the discovered milestones and pipeline data above.

Structure:
1. What this pipeline's winning motion actually looks like, in specific behavioral terms (not stage names). Use the milestone titles{{#if milestone_matrix.isDiscovered}} and evidence phrases{{/if}}.
2. The single most differentiating behavior — highest lift milestone — and what it implies about how buyers here make decisions.
3. Where lost deals break down. Connect the biggest absence pattern to what reps should watch for in open pipeline.
4. One coaching implication for managers reviewing this pipeline right now.

Do not write bullet points. Do not use the phrase "it's important to". Write like a senior RevOps analyst who has read these transcripts.

{{#unless milestone_matrix.isDiscovered}}
Note: Milestones are structural proxies derived from {{milestone_matrix.tierLabel}}.
{{/unless}}

{{voiceBlock}}

After your synthesis, emit an <actions> block with a JSON array of coaching actions:
- action_type: "coach_rep" | "inspect_deal" | "process_change" | "connect_data"
- severity: "critical" | "warning" | "info"
- title: short action title
- summary: 1-2 sentence explanation
- recommended_steps: array of 1-3 concrete steps
- urgency_label: "this_week" | "next_week" | "next_month"

Focus on the top 3 most actionable coaching or process insights.
<actions>
[{"action_type":"coach_rep","severity":"warning","title":"Enforce discovery call within first quarter of cycle","summary":"Won deals showed discovery call behavior at significantly higher rates than lost deals. Absence of this milestone early is the strongest predictor of loss.","recommended_steps":["Add discovery milestone to deal qualification checklist","Flag deals with no call activity after 25% of median cycle","Review open pipeline deals missing early discovery calls"],"urgency_label":"this_week"}]
</actions>`,
      outputKey: 'narrative',
    },

    // Step 4: Compute Stage Progression
    {
      id: 'compute-stage-progression',
      name: 'Compute Stage Progression',
      tier: 'compute',
      dependsOn: ['extract-milestones'],
      computeFn: 'bwpComputeStageProgression',
      computeArgs: {},
      outputKey: 'stage_progression_matrix',
    },

    // Step 5: Synthesize Stage Progression
    {
      id: 'synthesize-stage-progression',
      name: 'Synthesize Stage Progression',
      tier: 'claude',
      dependsOn: ['compute-stage-progression'],
      claudePrompt: `You are a RevOps analyst synthesizing a Stage Progression analysis.

Pipeline: {{#if stage_progression_matrix.pipelineId}}{{stage_progression_matrix.pipelineName}}{{else}}All Pipelines{{/if}}
Analysis: {{stage_progression_matrix.meta.totalProgressors}} progressors vs {{stage_progression_matrix.meta.totalStallers}} stallers across {{stage_progression_matrix.meta.usableStages}} stages with transcript coverage

STAGE RESULTS (ordered by signal gap, largest first):
{{#each stage_progression_matrix.stages}}{{#unless this.coverageTooLow}}{{#unless this.insufficientSignal}}
Stage: {{this.stageName}} | {{this.wonMedianDays}}d median | {{this.signalGapMultiplier}}× gap | {{this.progressorCount}} progressors / {{this.stallerCount}} stallers
Top progression signals:
{{#each this.progressionSignals}}  - {{this.title}}: {{this.progressorPct}}% of progressors, {{this.progressionLift}}× lift. Evidence: {{this.evidence.[0]}}
{{/each}}Top warning signals:
{{#each this.warningSignals}}  - {{this.title}}: {{this.description}} Evidence: {{this.evidence.[0]}}
{{/each}}{{/unless}}{{/unless}}{{/each}}

VOICE RULES:
- Calm, specific, data-first.
- Report what the data shows. State limitations once, plainly.
- Never use fear language, urgency language, or CTAs.
- Never say "flying blind", "alarming", "unlock", or "you need to".

Write a Stage Progression analysis for this pipeline. 3 paragraphs.

1. The stage with the largest signal gap — what are progressors actually doing that stallers aren't? Use the evidence phrases. Be specific about the behavior, not the outcome.
2. The most consistent warning signal across stages — what buyer behavior predicts stalling? If it appears in multiple stages, say so.
3. The single most actionable coaching implication for reps with deals currently in the highest-gap stage.

Do not write bullet points. Write like a senior RevOps analyst who has read these transcripts.`,
      outputKey: 'stage_progression_narrative',
    },
  ],

  // Quarterly cadence. Winning behaviors are structural patterns over 18 months of closed
  // deals — not a weekly signal. Running weekly produces noise on small samples.
  schedule: {
    cron: '0 5 1 1,4,7,10 *', // First day of each quarter at 5 AM UTC
    trigger: 'on_demand',
    description: 'Quarterly — Jan 1, Apr 1, Jul 1, Oct 1 at 5 AM UTC',
  },

  outputFormat: 'markdown',
  estimatedDuration: '90s',

  answers_questions: [
    'behavioral winning path',
    'what behaviors win deals',
    'winning behaviors',
    'lost deal patterns',
    'discovery call',
    'champion multithreaded',
    'technical win',
    'executive sponsor',
    'why do deals close',
    'what separates won and lost',
    'deal patterns',
    'milestone',
    'winning path',
  ],

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'milestone_id', display: 'Milestone', format: 'text' },
      { key: 'title', display: 'Behavior', format: 'text' },
      { key: 'is_discovered', display: 'Discovered', format: 'text' },
      { key: 'won_pct', display: 'Won %', format: 'number' },
      { key: 'lost_pct', display: 'Lost %', format: 'number' },
      { key: 'lift', display: 'Win Rate Lift', format: 'number' },
      { key: 'source', display: 'Data Source', format: 'text' },
      { key: 'tier', display: 'Tier', format: 'number' },
    ],
  },
};
