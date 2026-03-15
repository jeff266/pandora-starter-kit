/**
 * Voice Pattern Extraction Skill
 *
 * Monthly skill (1st of each month at 6 AM UTC) that mines internal call
 * transcripts (is_internal = true) for stable language patterns and persists
 * them into workspace_voice_patterns.
 *
 * Steps:
 *   1. extract-internal-calls (COMPUTE)  — extractVoiceCalls tool
 *   2. classify-patterns       (DEEPSEEK) — JSON pattern classification
 *   3. update-voice-profile    (COMPUTE)  — persistVoicePatterns tool
 *
 * Output: skill_runs only (internal — no Slack push).
 */

import type { SkillDefinition } from '../types.js';

export const voicePatternExtractionSkill: SkillDefinition = {
  id: 'voice-pattern-extraction',
  name: 'Voice Pattern Extraction',
  description: 'Mines internal sales call transcripts (Gong/Fireflies is_internal=true) to extract stable language patterns unique to each workspace. Learns how the team describes risk, urgency, and wins, then injects those patterns into Pandora\'s synthesis prompts so the output sounds like the team wrote it.',
  version: '1.0.0',
  category: 'intelligence',
  tier: 'mixed',

  requiredTools: ['extractVoiceCalls', 'persistVoicePatterns'],
  requiredContext: [],

  schedule: {
    cron: '0 6 1 * *',
    description: '6 AM UTC on the 1st of each month',
  },

  steps: [
    {
      id: 'extract-internal-calls',
      name: 'Extract Internal Call Transcripts',
      tier: 'compute',
      computeFn: 'extractVoiceCalls',
      computeArgs: {},
      outputKey: 'extract_result',
    },

    {
      id: 'classify-patterns',
      name: 'Classify Language Patterns',
      tier: 'deepseek',
      dependsOn: ['extract-internal-calls'],
      deepseekPrompt: `{{#if (eq extract_result.status "insufficient_data")}}
Insufficient data — return empty classification.
{
  "risk_phrases": [],
  "urgency_phrases": [],
  "win_phrases": [],
  "pipeline_vocabulary": [],
  "common_shorthand": {},
  "confidence": 0.0
}
{{else}}
Analyze these internal sales team call excerpts. Extract the specific language patterns this team uses. Focus on:

1. How they describe deals that are at risk or going cold (risk_phrases)
2. How they express urgency or time pressure (urgency_phrases)
3. How they describe wins or positive momentum (win_phrases)
4. Domain-specific vocabulary they use for their product or process (pipeline_vocabulary)
5. Shorthand or nicknames they use for specific deals, accounts, or concepts (common_shorthand)

Return ONLY valid JSON in this exact shape:
{
  "risk_phrases": ["phrase1", "phrase2"],
  "urgency_phrases": ["phrase1", "phrase2"],
  "win_phrases": ["phrase1", "phrase2"],
  "pipeline_vocabulary": ["term1", "term2"],
  "common_shorthand": { "shorthand": "what it means" },
  "confidence": 0.0
}

Rules:
- Only include phrases that appear multiple times across different calls (not one-off language)
- Maximum 10 items per array
- Maximum 10 entries in common_shorthand
- Do not include generic business language ("pipeline", "close", "deal") — only distinctive vocabulary specific to this team
- If insufficient distinctive patterns found, return empty arrays rather than generic phrases
- confidence: 0.0–1.0 reflecting how confident you are these are truly distinctive patterns

CALL EXCERPTS ({{extract_result.callsFound}} internal calls):
{{{extract_result.excerptBlob}}}
{{/if}}`,
      outputKey: 'classify_result',
      parseAs: 'json',
    },

    {
      id: 'update-voice-profile',
      name: 'Persist Voice Profile',
      tier: 'compute',
      dependsOn: ['extract-internal-calls', 'classify-patterns'],
      computeFn: 'persistVoicePatterns',
      computeArgs: {},
      outputKey: 'persist_result',
    },
  ],

  outputFormat: { type: 'sections', sections: [] } as any,
  estimatedDuration: '120 seconds',

  answers_questions: [
    'voice patterns',
    'how does this team talk',
    'language patterns',
    'internal call analysis',
  ],

  evidenceSchema: {
    entity_type: 'workspace',
    columns: [
      { key: 'callsAnalyzed', display: 'Calls Analyzed', format: 'number' },
      { key: 'confidence', display: 'Confidence', format: 'number' },
      { key: 'riskPhrases', display: 'Risk Phrases Found', format: 'number' },
      { key: 'urgencyPhrases', display: 'Urgency Phrases Found', format: 'number' },
      { key: 'winPhrases', display: 'Win Phrases Found', format: 'number' },
    ],
  },
};
