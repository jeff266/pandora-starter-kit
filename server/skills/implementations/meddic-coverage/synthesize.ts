/**
 * MEDDIC Coverage — Synthesize Phase
 *
 * Uses Claude to produce a comprehensive coverage assessment with:
 * - Weighted coverage score (0-100)
 * - Executive summary
 * - Gap narrative
 * - Recommended actions with priority
 * - Contradiction flags
 * - Stage appropriateness notes
 */

import { createLogger } from '../../../utils/logger.js';
import type { CorpusData } from './compute.js';
import type { ClassifyResult, FieldExtraction } from './classify.js';

const logger = createLogger('meddic-coverage-synthesize');

export interface RecommendedAction {
  field: string;
  action: string;
  priority: 'P1' | 'P2' | 'P3';
}

export interface ContradictionFlag {
  field: string;
  source_a: string;
  source_b: string;
  note: string;
}

export interface CoverageAssessment {
  coverage_score: number;
  executive_summary: string;
  gap_narrative: string;
  recommended_actions: RecommendedAction[];
  contradiction_flags: ContradictionFlag[];
  stage_appropriateness_note: string | null;
}

/**
 * Synthesize coverage assessment using Claude
 */
export async function synthesizeCoverage(
  corpus: CorpusData,
  classifications: ClassifyResult
): Promise<CoverageAssessment> {
  logger.info('Starting coverage synthesis', {
    dealId: corpus.deal.id,
    fieldCount: classifications.field_count,
    confirmedCount: classifications.confirmed_count,
  });

  // Build prompt for Claude
  const prompt = buildSynthesisPrompt(corpus, classifications);

  // Call Claude
  const response = await callClaude(prompt);

  // Parse response
  const assessment = parseCoverageAssessment(response);

  logger.info('Coverage synthesis complete', {
    dealId: corpus.deal.id,
    coverageScore: assessment.coverage_score,
    actionCount: assessment.recommended_actions.length,
    contradictionCount: assessment.contradiction_flags.length,
  });

  return assessment;
}

/**
 * Build Claude synthesis prompt
 */
function buildSynthesisPrompt(
  corpus: CorpusData,
  classifications: ClassifyResult
): string {
  const fieldExtractions = JSON.stringify(classifications.extractions, null, 2);

  return `Deal: ${corpus.deal.name} | Stage: ${corpus.deal.stage} | Owner: ${corpus.deal.owner_name}
Methodology: ${corpus.methodology.base_methodology} v${corpus.methodology.version}
Close Date: ${corpus.deal.close_date || 'N/A'}
Amount: ${corpus.deal.amount ? '$' + corpus.deal.amount.toLocaleString() : 'N/A'}

Activity Coverage:
- Total Calls: ${corpus.corpus_stats.total_calls} (kept ${corpus.corpus_stats.calls_kept})
- Total Emails: ${corpus.corpus_stats.total_emails}
- Total Notes: ${corpus.corpus_stats.total_notes}
- Bookend Applied: ${corpus.corpus_stats.bookend_applied}
- Limited Evidence: ${corpus.limited_evidence}

FIELD EXTRACTIONS:
${fieldExtractions}

Produce a coverage assessment as JSON:
{
  "coverage_score": number (0-100, weighted by confidence),
  "executive_summary": string (2-3 sentences summarizing overall coverage),
  "gap_narrative": string (describe which fields are missing or weak, and why this matters given the current stage),
  "recommended_actions": [{ "field": string, "action": string (specific action to address gap), "priority": "P1"|"P2"|"P3" }],
  "contradiction_flags": [{ "field": string, "source_a": string, "source_b": string, "note": string }],
  "stage_appropriateness_note": string | null (note if some fields are not expected at current stage)
}

Scoring weights:
- confirmed + high confidence = 1.0 (full weight)
- confirmed + medium = 0.7
- confirmed + low = 0.5
- partial + high = 0.5
- partial + medium = 0.3
- partial + low = 0.2
- missing = 0

Priority rules:
- P1 (Critical): Missing field is essential for current stage, blocks progression
- P2 (Important): Missing field should be captured soon, not immediately blocking
- P3 (Nice to have): Missing field is less critical at current stage

Note: Some fields may not be expected at the current stage (e.g., Decision Process not needed in Discovery stage).
Consider the deal's stage when assessing gaps and prioritizing actions.

Return ONLY valid JSON. No preamble.`;
}

/**
 * Call Claude API
 */
async function callClaude(prompt: string): Promise<string> {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      temperature: 0.3,
      messages: [
        { role: 'user', content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as any;
  return data.content?.[0]?.text || '';
}

/**
 * Parse coverage assessment from Claude response
 */
function parseCoverageAssessment(llmOutput: string): CoverageAssessment {
  try {
    // Extract JSON from response
    const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in Claude output', {
        output: llmOutput.slice(0, 200),
      });

      return createDefaultAssessment();
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    const assessment: CoverageAssessment = {
      coverage_score: validateScore(parsed.coverage_score),
      executive_summary: parsed.executive_summary || 'Unable to generate summary',
      gap_narrative: parsed.gap_narrative || 'Unable to generate gap narrative',
      recommended_actions: validateActions(parsed.recommended_actions),
      contradiction_flags: validateContradictions(parsed.contradiction_flags),
      stage_appropriateness_note: parsed.stage_appropriateness_note || null,
    };

    return assessment;
  } catch (error: any) {
    logger.error('Failed to parse coverage assessment', {
      error: error.message,
      output: llmOutput.slice(0, 500),
    });

    return createDefaultAssessment();
  }
}

/**
 * Validate coverage score
 */
function validateScore(score: any): number {
  const num = Number(score);
  if (isNaN(num) || num < 0) return 0;
  if (num > 100) return 100;
  return Math.round(num);
}

/**
 * Validate recommended actions
 */
function validateActions(actions: any): RecommendedAction[] {
  if (!Array.isArray(actions)) return [];

  return actions
    .filter(a => a && typeof a === 'object')
    .map(a => ({
      field: String(a.field || 'unknown'),
      action: String(a.action || 'No action specified'),
      priority: validatePriority(a.priority),
    }))
    .slice(0, 10); // Limit to 10 actions
}

/**
 * Validate priority value
 */
function validatePriority(priority: any): 'P1' | 'P2' | 'P3' {
  if (['P1', 'P2', 'P3'].includes(priority)) {
    return priority;
  }
  return 'P2'; // Default to P2
}

/**
 * Validate contradiction flags
 */
function validateContradictions(contradictions: any): ContradictionFlag[] {
  if (!Array.isArray(contradictions)) return [];

  return contradictions
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      field: String(c.field || 'unknown'),
      source_a: String(c.source_a || 'unknown'),
      source_b: String(c.source_b || 'unknown'),
      note: String(c.note || 'No details provided'),
    }))
    .slice(0, 10); // Limit to 10 contradictions
}

/**
 * Create default assessment for error cases
 */
function createDefaultAssessment(): CoverageAssessment {
  return {
    coverage_score: 0,
    executive_summary: 'Unable to generate coverage assessment due to parsing error',
    gap_narrative: 'Failed to analyze field coverage',
    recommended_actions: [],
    contradiction_flags: [],
    stage_appropriateness_note: null,
  };
}
