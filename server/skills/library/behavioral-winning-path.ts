/**
 * Behavioral Winning Path Skill
 *
 * Identifies behavioral milestone sequences that characterize won vs. lost deals,
 * sourced from conversation intelligence, email engagement, contact roles, or
 * stage history depending on data availability.
 *
 * Tier 1: Conversation Intelligence (Gong / Fireflies) — HIGH confidence
 * Tier 2: Email Engagement — MEDIUM confidence
 * Tier 3: Contact Role Coverage — LOW-MEDIUM confidence
 * Tier 4: Stage History Only — LOW confidence
 */

import type { SkillDefinition } from '../types.js';

export const behavioralWinningPathSkill: SkillDefinition = {
  id: 'behavioral-winning-path',
  name: 'Behavioral Winning Path',
  description:
    'Identifies behavioral milestone sequences that characterize won vs. lost deals, sourced from conversation intelligence, email engagement, contact roles, or stage history depending on data availability',
  version: '1.0.0',
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

    // Step 2: Extract behavioral milestones for all four tiers
    {
      id: 'extract-milestones',
      name: 'Extract Behavioral Milestones',
      tier: 'compute',
      dependsOn: ['probe-data-tier'],
      computeFn: 'bwpExtractMilestones',
      computeArgs: { periodDays: 180 },
      outputKey: 'milestone_matrix',
    },

    // Step 3: DeepSeek — classify transcript excerpts (Tier 1 only; gracefully no-ops otherwise)
    {
      id: 'classify-transcripts',
      name: 'Classify Transcript Signals (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['extract-milestones'],
      deepseekPrompt: `You are classifying sales call transcript excerpts to identify behavioral signals. Answer ONLY in JSON.

{{#if milestone_matrix.transcriptExcerptsForClassification.length}}
For each excerpt below, classify the behavioral signals present. Return true only if clearly present in the text.

Excerpts:
{{{json milestone_matrix.transcriptExcerptsForClassification}}}

For each excerpt (by conversationId), return a classification object.
{{else}}
No transcript excerpts available for this workspace (Tier {{milestone_matrix.tier}} data).
Return an empty classifications array.
{{/if}}

Return ONLY this JSON structure:
{
  "classifications": [
    {
      "conversationId": "string",
      "dealId": "string",
      "use_case_articulated": false,
      "success_metric_stated": false,
      "technical_win_language": false,
      "blocking_objection_present": false,
      "executive_decision_language": false,
      "primary_speaker": "balanced"
    }
  ],
  "skipped": false
}`,
      deepseekSchema: {
        type: 'object',
        properties: {
          classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                conversationId: { type: 'string' },
                dealId: { type: 'string' },
                use_case_articulated: { type: 'boolean' },
                success_metric_stated: { type: 'boolean' },
                technical_win_language: { type: 'boolean' },
                blocking_objection_present: { type: 'boolean' },
                executive_decision_language: { type: 'boolean' },
                primary_speaker: { type: 'string' },
              },
              required: ['conversationId', 'dealId'],
            },
          },
          skipped: { type: 'boolean' },
        },
        required: ['classifications'],
      },
      outputKey: 'transcript_classifications',
    },

    // Step 4: Claude synthesis
    {
      id: 'synthesize-winning-path',
      name: 'Synthesize Behavioral Winning Path',
      tier: 'claude',
      dependsOn: ['extract-milestones', 'classify-transcripts'],
      claudePrompt: `You are a RevOps analyst synthesizing a Behavioral Winning Path analysis.

Data tier: {{milestone_matrix.tierLabel}}
Analysis window: {{milestone_matrix.analysisPeriodDays}} days of closed deals
Won deals: {{milestone_matrix.totalWonDeals}} | Avg cycle: {{milestone_matrix.avgWonCycleDays}} days
Lost deals: {{milestone_matrix.totalLostDeals}} | Avg cycle: {{milestone_matrix.avgLostCycleDays}} days
Data confidence: {{milestone_matrix.confidenceNote}}

{{#if milestone_matrix.wonMilestones.length}}
Top behavioral milestones (won deals, sorted by lift):
{{{json milestone_matrix.wonMilestones}}}

Key absences in lost deals:
{{{json milestone_matrix.lostAbsences}}}

{{#if transcript_classifications.classifications.length}}
Transcript signal classifications (DeepSeek):
{{{json transcript_classifications.classifications}}}
{{/if}}
{{else}}
No milestone data available — insufficient closed deal history. Explain that more closed deals are needed to generate behavioral patterns (minimum ~10 won and ~10 lost in the analysis window).
{{/if}}

Write a RevOps synthesis with the following structure. Be direct and specific. No filler.

## Behavioral Winning Path — {{milestone_matrix.tierLabel}}

**Headline:** [1 sentence — the single most differentiating behavioral pattern between won and lost deals]

**Top 3 Milestones by Win Rate Lift:**
{{#each milestone_matrix.wonMilestones}}{{#unless this.insufficientData}}
- **{{this.title}}** — present in {{this.wonPct}}% of won deals vs {{this.lostPct}}% of lost deals · {{this.lift}}× win rate lift · _{{this.subtitle}}_
{{/unless}}{{/each}}

(Select only the 3 highest-lift milestones. Skip insufficient_data ones.)

**Biggest Risk Signal:**
[1–2 sentences — the absence pattern in lost deals most actionable for reps working open pipeline right now]

**Coaching Implication:**
[1–2 sentences — what managers should reinforce or inspect based on this pattern]

{{#unless (eq milestone_matrix.tier 1)}}
**Data Caveat:**
[1 sentence — what richer data would reveal that current signals cannot]
{{/unless}}

Rules:
- Use specific numbers from the data (percentages, lift scores, days)
- If total won or lost < 10, lead with a data scarcity caveat before the analysis
- If tier is 4 (stage history only), be explicit that these are structural proxies, not behavioral proof
- Word budget: 400 words

{{voiceBlock}}

After your synthesis, emit an <actions> block with a JSON array of coaching actions:
- action_type: "coach_rep" | "inspect_deal" | "process_change" | "connect_data"
- severity: "critical" | "warning" | "info"
- title: short action title
- summary: 1-2 sentence explanation
- recommended_steps: array of 1-3 concrete steps
- owner_email: manager email if available
- urgency_label: "this_week" | "next_week" | "next_month"

Focus on the top 3 most actionable coaching or process insights. Example:
<actions>
[{"action_type":"coach_rep","severity":"warning","title":"Enforce discovery call within 30 days","summary":"Won deals had discovery calls within 30 days at 3x the rate of lost deals. No discovery call in this window is the strongest predictor of loss.","recommended_steps":["Add discovery call completion to deal qualification checklist","Flag deals with no call activity after 14 days","Review open pipeline deals missing discovery calls"],"urgency_label":"this_week"}]
</actions>`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 6 * * 1', // Monday 6 AM UTC — available before weekly pipeline review
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '60s',

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
  ],

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'milestone_id', display: 'Milestone', format: 'text' },
      { key: 'title', display: 'Behavior', format: 'text' },
      { key: 'won_pct', display: 'Won %', format: 'number' },
      { key: 'lost_pct', display: 'Lost %', format: 'number' },
      { key: 'lift', display: 'Win Rate Lift', format: 'number' },
      { key: 'source', display: 'Data Source', format: 'text' },
      { key: 'tier', display: 'Tier', format: 'number' },
    ],
  },
};
