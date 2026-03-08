/**
 * Quarterly Retrospective — Phase 1: Hypothesis Formation
 *
 * A single DeepSeek 'classify' call that receives compressed evidence
 * and returns a routing decision + working hypothesis. Target: <2K tokens.
 */

import { callLLM } from '../utils/llm-router.js';
import type { HarvestedEvidence } from './evidence-harvester.js';
import { buildHypothesisPrompt } from './synthesis-prompts.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentRoute =
  | 'coverage-agent'
  | 'conversion-agent'
  | 'win-loss-agent'
  | 'process-luck-agent'
  | 'pipeline-health-agent'
  | 'full-retro-agent';

export interface HypothesisResult {
  primary_layer: 'variance_decomposition' | 'win_loss_pattern' | 'process_vs_luck' | 'forward_pipeline_health';
  quadrant?: 'REPLICABLE' | 'UNLUCKY' | 'LUCKY' | 'STRUCTURAL' | null;
  hypothesis: string;
  confidence: number;
  supporting_signals: string[];
  contradicting_signals: string[];
  data_gaps: string[];
  recommended_route: AgentRoute;
  skip_phase_2: boolean;
}

// ─── Fallback when evidence is insufficient ───────────────────────────────────

export function insufficientEvidenceResult(missingSkills: string[]): HypothesisResult {
  return {
    primary_layer: 'variance_decomposition',
    quadrant: null,
    hypothesis: 'Insufficient cached evidence to form a hypothesis.',
    confidence: 0,
    supporting_signals: [],
    contradicting_signals: [],
    data_gaps: missingSkills,
    recommended_route: 'full-retro-agent',
    skip_phase_2: false,
  };
}

// ─── JSON parsing helper ──────────────────────────────────────────────────────

function parseHypothesisJSON(raw: string): HypothesisResult | null {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(cleaned);
    return validateAndNormalize(parsed);
  } catch {
    // Try extracting the first { ... } block
    const jsonMatch = cleaned.match(/\{[\s\S]+\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateAndNormalize(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const VALID_LAYERS = new Set(['variance_decomposition', 'win_loss_pattern', 'process_vs_luck', 'forward_pipeline_health']);
const VALID_ROUTES = new Set(['coverage-agent', 'conversion-agent', 'win-loss-agent', 'process-luck-agent', 'pipeline-health-agent', 'full-retro-agent']);
const VALID_QUADRANTS = new Set(['REPLICABLE', 'UNLUCKY', 'LUCKY', 'STRUCTURAL', null, undefined]);

function validateAndNormalize(parsed: any): HypothesisResult {
  const layer = VALID_LAYERS.has(parsed.primary_layer)
    ? parsed.primary_layer
    : 'variance_decomposition';

  const route = VALID_ROUTES.has(parsed.recommended_route)
    ? parsed.recommended_route
    : 'full-retro-agent';

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  const quadrant = VALID_QUADRANTS.has(parsed.quadrant) ? parsed.quadrant ?? null : null;

  const toArray = (v: any): string[] =>
    Array.isArray(v) ? v.map(String).filter(Boolean) : [];

  const skipPhase2 = typeof parsed.skip_phase_2 === 'boolean'
    ? parsed.skip_phase_2
    : confidence >= 0.80;

  return {
    primary_layer: layer,
    quadrant,
    hypothesis: String(parsed.hypothesis || 'No hypothesis formed').slice(0, 500),
    confidence,
    supporting_signals: toArray(parsed.supporting_signals).slice(0, 5),
    contradicting_signals: toArray(parsed.contradicting_signals).slice(0, 5),
    data_gaps: toArray(parsed.data_gaps).slice(0, 5),
    recommended_route: route,
    skip_phase_2: skipPhase2,
  };
}

// ─── Main hypothesis formation ────────────────────────────────────────────────

export async function formHypothesis(
  workspaceId: string,
  evidence: HarvestedEvidence[],
  userQuestion: string,
  workspaceName: string,
  quarterLabel: string
): Promise<HypothesisResult> {
  // Check for completely empty evidence
  const nonMissing = evidence.filter((e) => e.freshness !== 'missing');
  if (nonMissing.length === 0) {
    const missingSkills = evidence.map((e) => e.skill_id);
    return insufficientEvidenceResult(missingSkills);
  }

  const prompt = buildHypothesisPrompt(evidence, userQuestion, workspaceName, quarterLabel);

  try {
    const response = await callLLM(workspaceId, 'classify', {
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content || '';
    const parsed = parseHypothesisJSON(raw);

    if (!parsed) {
      console.warn('[retro/hypothesis] Failed to parse DeepSeek JSON response, using fallback');
      return {
        primary_layer: 'variance_decomposition',
        quadrant: null,
        hypothesis: 'Unable to classify — using full retrospective analysis.',
        confidence: 0.4,
        supporting_signals: nonMissing.map((e) => e.headline),
        contradicting_signals: [],
        data_gaps: evidence.filter((e) => e.freshness === 'missing').map((e) => e.skill_id),
        recommended_route: 'full-retro-agent',
        skip_phase_2: false,
      };
    }

    return parsed;
  } catch (err) {
    console.error('[retro/hypothesis] LLM call failed:', err);
    // Soft fallback — route to full-retro-agent
    return {
      primary_layer: 'variance_decomposition',
      quadrant: null,
      hypothesis: 'Hypothesis formation failed — falling back to full analysis.',
      confidence: 0.3,
      supporting_signals: [],
      contradicting_signals: [],
      data_gaps: [],
      recommended_route: 'full-retro-agent',
      skip_phase_2: false,
    };
  }
}
