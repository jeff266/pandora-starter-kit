/**
 * Editorial Synthesis Engine
 *
 * Replaces section-generator.ts for agent-powered briefings.
 * Makes editorial decisions about what to include, what to emphasize,
 * and how to structure the narrative.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../utils/logger.js';
import type {
  EditorialInput,
  EditorialOutput,
  EditorialDecision,
  TuningPair,
} from './editorial-types.js';
import type { SectionContent, MetricCard, DealCard } from '../reports/types.js';
import type { SkillEvidence, EvidenceClaim } from '../skills/types.js';

const logger = createLogger('EditorialSynthesizer');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Editorial synthesis: One Claude call to produce the entire briefing.
 * The agent sees all evidence at once and makes holistic editorial decisions.
 */
export async function editorialSynthesize(
  input: EditorialInput
): Promise<EditorialOutput> {
  const startTime = Date.now();

  logger.info('[EditorialSynthesize] Starting synthesis', {
    agent_id: input.agent.id,
    workspace_id: input.workspaceId,
    skills_count: Object.keys(input.skillEvidence).length,
    sections_available: input.availableSections.length,
  });

  // Build the synthesis prompt
  const systemPrompt = buildSystemPrompt(input);
  const userPrompt = buildUserPrompt(input);

  // Call Claude with structured output
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  const usage = response.usage;
  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

  logger.info('[EditorialSynthesize] Claude response received', {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    response_length: responseText.length,
  });

  // Parse the structured JSON response
  const parsedOutput = parseEditorialResponse(responseText);

  const synthesisTime = Date.now() - startTime;

  const output: EditorialOutput = {
    editorial_decisions: parsedOutput.editorial_decisions,
    sections: parsedOutput.sections,
    opening_narrative: parsedOutput.opening_narrative,
    skills_referenced: Object.keys(input.skillEvidence),
    sections_included: parsedOutput.sections.map(s => s.section_id),
    sections_dropped: input.availableSections
      .map(s => s.id)
      .filter(id => !parsedOutput.sections.find(sec => sec.section_id === id)),
    tokens_used: usage.input_tokens + usage.output_tokens,
    synthesis_duration_ms: synthesisTime,
  };

  logger.info('[EditorialSynthesize] Synthesis complete', {
    sections_included: output.sections_included.length,
    sections_dropped: output.sections_dropped.length,
    editorial_decisions: output.editorial_decisions.length,
    tokens_used: output.tokens_used,
    duration_ms: synthesisTime,
  });

  return output;
}

/**
 * Build the system prompt with role, audience, and tuning
 */
function buildSystemPrompt(input: EditorialInput): string {
  const parts: string[] = [];

  // Role and goal
  parts.push(`You are the ${input.agent.name} for ${input.agent.workspaceId || 'this workspace'}.`);
  parts.push(`Your goal: ${input.agent.description}`);
  parts.push('');

  // Audience
  parts.push('AUDIENCE:');
  parts.push(`Role: ${input.audience.role}`);
  parts.push(`Detail level: ${input.audience.detail_preference}`);
  parts.push('');

  // Vocabulary preferences
  if (input.audience.vocabulary_avoid?.length || input.audience.vocabulary_prefer?.length) {
    parts.push('VOCABULARY:');
    if (input.audience.vocabulary_avoid?.length) {
      parts.push(`- Avoid these terms: ${input.audience.vocabulary_avoid.join(', ')}`);
    }
    if (input.audience.vocabulary_prefer?.length) {
      parts.push(`- Prefer these terms: ${input.audience.vocabulary_prefer.join(', ')}`);
    }
    parts.push('');
  }

  // Focus questions
  if (input.focusQuestions && input.focusQuestions.length > 0) {
    parts.push('FOCUS QUESTIONS (the reader wants these answered):');
    input.focusQuestions.forEach((q, i) => {
      parts.push(`${i + 1}. ${q}`);
    });
    parts.push('');
  }

  // Data window
  if (input.dataWindow) {
    const windowLabels: Record<string, string> = {
      current_week: 'This Week',
      current_month: 'This Month',
      current_quarter: 'This Quarter',
      trailing_30d: 'Trailing 30 Days',
      trailing_90d: 'Trailing 90 Days',
      fiscal_year: 'Fiscal Year',
    };
    const compLabels: Record<string, string> = {
      previous_period: 'Previous Period',
      same_period_last_year: 'Same Period Last Year',
      none: 'No Comparison',
    };
    parts.push(`DATA WINDOW: ${windowLabels[input.dataWindow.primary] || input.dataWindow.primary} compared to ${compLabels[input.dataWindow.comparison] || input.dataWindow.comparison}`);
    parts.push('');
  }

  // Tuning from feedback
  if (input.tuningPairs.length > 0) {
    parts.push('LEARNED PREFERENCES (from previous feedback):');
    const tuningInstructions = formatTuningForPrompt(input.tuningPairs);
    parts.push(tuningInstructions);
    parts.push('');
  }

  // Memory context (Phase 3)
  if (input.memoryContext) {
    parts.push(input.memoryContext);
    parts.push('');
  }

  // Core instructions
  parts.push('INSTRUCTIONS:');
  parts.push('1. Read all evidence. Your primary job is answering the focus questions.');
  parts.push('2. Decide which sections to include based on what the evidence supports.');
  parts.push('3. Adjust depth and vocabulary for the audience.');
  parts.push(`4. Write an opening narrative (2-3 sentences) that frames the briefing for a ${input.audience.role}.`);
  parts.push('5. Output your editorial decisions and section content as structured JSON.');
  parts.push('');

  return parts.join('\n');
}

/**
 * Build the user prompt with evidence and section library
 */
function buildUserPrompt(input: EditorialInput): string {
  const parts: string[] = [];

  // Evidence summary
  parts.push('EVIDENCE FROM SKILLS:');
  parts.push('');
  for (const [skillId, evidence] of Object.entries(input.skillEvidence)) {
    parts.push(`## ${skillId}`);
    const summary = summarizeEvidence(evidence);
    parts.push(summary);
    parts.push('');
  }

  // Available sections
  parts.push('AVAILABLE SECTIONS:');
  parts.push('');
  for (const section of input.availableSections) {
    parts.push(`- ${section.id}: ${section.description}`);
    parts.push(`  Skills: ${section.skills.join(', ')}`);
  }
  parts.push('');

  // Output format
  parts.push('OUTPUT FORMAT:');
  parts.push('Return a JSON object with this exact structure:');
  parts.push('{');
  parts.push('  "editorial_decisions": [');
  parts.push('    {');
  parts.push('      "decision": "lead_with" | "drop_section" | "promote_finding" | "merge_sections" | "add_callout" | "adjust_depth",');
  parts.push('      "reasoning": "Coverage dropped 40% — this is the story this week",');
  parts.push('      "affected_sections": ["section-id"]');
  parts.push('    }');
  parts.push('  ],');
  parts.push('  "opening_narrative": "2-3 sentence opening that frames the briefing",');
  parts.push('  "sections": [');
  parts.push('    {');
  parts.push('      "section_id": "the-number",');
  parts.push('      "title": "The Number",');
  parts.push('      "narrative": "1-3 paragraph summary with specific data points",');
  parts.push('      "metrics": [{"label": "Forecast", "value": "$1.33M", "delta": "+$200K", "delta_direction": "up", "severity": "good"}],');
  parts.push('      "deal_cards": [{"name": "Acme Corp", "amount": "$450K", "owner": "Jane", "stage": "Proposal", "signal": "No activity 14 days", "signal_severity": "warning", "detail": "Last engagement was demo on 2/1", "action": "Schedule follow-up call this week"}],');
  parts.push('      "source_skills": ["forecast-rollup"],');
  parts.push('      "data_freshness": "2026-02-21T10:00:00Z",');
  parts.push('      "confidence": 0.9');
  parts.push('    }');
  parts.push('  ]');
  parts.push('}');

  return parts.join('\n');
}

/**
 * Summarize skill evidence into key findings (keep under 500 tokens per skill)
 * 
 * Skill run output shape is either:
 *   { narrative, evidence: { claims, evaluated_records, data_sources, parameters } }
 * or directly SkillEvidence (if evidence gatherer already unwrapped it)
 */
function summarizeEvidence(rawEvidence: any): string {
  const parts: string[] = [];

  const narrative = rawEvidence?.narrative;
  const evidence: SkillEvidence | undefined = rawEvidence?.evidence || 
    (rawEvidence?.claims ? rawEvidence : undefined);

  if (narrative && typeof narrative === 'string') {
    const trimmedNarrative = narrative.substring(0, 800);
    parts.push('Narrative:');
    parts.push(trimmedNarrative);
  }

  if (evidence?.claims && evidence.claims.length > 0) {
    const sortedClaims = [...evidence.claims]
      .sort((a, b) => {
        const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2, good: 3 };
        return (severityOrder[a.severity || 'info'] || 99) - (severityOrder[b.severity || 'info'] || 99);
      })
      .slice(0, 5);

    parts.push('Key findings:');
    for (const claim of sortedClaims) {
      const severity = claim.severity ? `[${claim.severity.toUpperCase()}]` : '';
      parts.push(`- ${severity} ${claim.claim_text}`);
      if (claim.metric_name && claim.metric_values) {
        const metric = `${claim.metric_name}: ${claim.metric_values.join(', ')}`;
        parts.push(`  ${metric}`);
      }
      if (claim.entity_ids && claim.entity_ids.length > 0 && claim.entity_ids.length <= 3) {
        parts.push(`  Entities: ${claim.entity_ids.join(', ')}`);
      } else if (claim.entity_ids && claim.entity_ids.length > 3) {
        parts.push(`  ${claim.entity_ids.length} entities affected`);
      }
    }
  }

  if (evidence?.evaluated_records && evidence.evaluated_records.length > 0) {
    parts.push(`Evaluated ${evidence.evaluated_records.length} records`);
  }

  if (evidence?.data_sources && evidence.data_sources.length > 0) {
    const sources = evidence.data_sources.map((ds: any) => ds.source).join(', ');
    parts.push(`Sources: ${sources}`);
  }

  if (parts.length === 0) {
    parts.push('(No structured evidence available)');
  }

  return parts.join('\n');
}

/**
 * Format tuning pairs into prompt instructions
 */
function formatTuningForPrompt(pairs: TuningPair[]): string {
  const instructions = pairs
    .filter(p => p.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)  // Max 10 tuning instructions
    .map(p => {
      if (typeof p.value === 'object' && p.value.instruction) {
        return `- ${p.value.instruction}`;
      }
      return `- ${p.key}: ${JSON.stringify(p.value)}`;
    });

  return instructions.join('\n');
}

/**
 * Parse Claude's JSON response into EditorialOutput structure
 */
function parseEditorialResponse(responseText: string): {
  editorial_decisions: EditorialDecision[];
  opening_narrative: string;
  sections: SectionContent[];
} {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    const parsed = JSON.parse(jsonText);

    return {
      editorial_decisions: parsed.editorial_decisions || [],
      opening_narrative: parsed.opening_narrative || '',
      sections: parsed.sections || [],
    };
  } catch (error) {
    logger.error('[EditorialSynthesize] Failed to parse Claude response as JSON', error as Error);
    logger.debug('[EditorialSynthesize] Raw response', { responseText: responseText.substring(0, 500) });

    // Fallback: return empty structure
    return {
      editorial_decisions: [{
        decision: 'add_callout',
        reasoning: 'Failed to parse editorial response',
        affected_sections: [],
      }],
      opening_narrative: 'Unable to generate briefing due to parsing error.',
      sections: [],
    };
  }
}
