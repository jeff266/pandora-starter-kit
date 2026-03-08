/**
 * Quarterly Retrospective — Phase 1: Hypothesis Formation
 *
 * A single DeepSeek 'classify' call that receives compressed evidence
 * and returns a routing decision + working hypothesis. Target: <2K tokens.
 *
 * EC-01: Detects Conversation-Led Close before quadrant assignment.
 * EC-02: Applies history tier context and confidence reduction for Tier 2.
 */

import { callLLM } from '../utils/llm-router.js';
import type { HarvestedEvidence, WhaleDealSignal, HistoryAssessment } from './evidence-harvester.js';
import { buildHypothesisPrompt } from './synthesis-prompts.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentRoute =
  | 'coverage-agent'
  | 'conversion-agent'
  | 'win-loss-agent'
  | 'process-luck-agent'
  | 'pipeline-health-agent'
  | 'full-retro-agent';

export interface ConversationLedCloseResult {
  detected: boolean;
  confidence?: number;
  deals?: string[];
  ci_confirmed?: boolean;
  implication?: 'forecast_visibility_gap';
}

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
  conversation_led_close?: ConversationLedCloseResult;
  history_tier?: 1 | 2 | 3;
}

// ─── EC-01: Conversation-Led Close Detection ──────────────────────────────────

export function detectConversationLedClose(
  whaleSignals: WhaleDealSignal[],
): ConversationLedCloseResult {
  const whales = whaleSignals.filter(d =>
    d.pct_of_bookings >= 0.20 &&
    d.stages_jumped >= 2 &&
    d.forecast_category_30d_prior !== 'commit'
  );

  if (whales.length === 0) return { detected: false };

  const withCISignals = whales.filter(d =>
    d.ci_signals_30d !== null &&
    d.ci_signals_30d.positive_sentiment_count >= 2
  );

  return {
    detected: true,
    confidence: withCISignals.length > 0 ? 0.85 : 0.60,
    deals: whales.map(d => d.deal_name),
    ci_confirmed: withCISignals.length > 0,
    implication: 'forecast_visibility_gap',
  };
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
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned);
    return validateAndNormalize(parsed);
  } catch {
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

// ─── EC-02: Confidence reduction for Tier 2 benchmark-dependent layers ────────

const BENCHMARK_DEPENDENT_LAYERS = new Set(['variance_decomposition', 'process_vs_luck']);

function applyTier2ConfidenceReduction(result: HypothesisResult, tier: 1 | 2 | 3): HypothesisResult {
  if (tier !== 2) return result;
  if (!BENCHMARK_DEPENDENT_LAYERS.has(result.primary_layer)) return result;

  const reduced = Math.max(0, result.confidence - 0.15);
  return {
    ...result,
    confidence: reduced,
    skip_phase_2: reduced >= 0.80, // re-evaluate skip threshold after reduction
    supporting_signals: [
      ...result.supporting_signals,
      'Note: benchmark comparisons use industry proxy values (limited workspace history)',
    ],
  };
}

// ─── Main hypothesis formation ────────────────────────────────────────────────

export async function formHypothesis(
  workspaceId: string,
  evidence: HarvestedEvidence[],
  userQuestion: string,
  workspaceName: string,
  quarterLabel: string,
  whaleSignals: WhaleDealSignal[] = [],
  historyAssessment?: HistoryAssessment
): Promise<HypothesisResult> {
  const nonMissing = evidence.filter((e) => e.freshness !== 'missing');
  if (nonMissing.length === 0) {
    const missingSkills = evidence.map((e) => e.skill_id);
    return insufficientEvidenceResult(missingSkills);
  }

  const tier = historyAssessment?.tier ?? 3;
  const prompt = buildHypothesisPrompt(evidence, userQuestion, workspaceName, quarterLabel, historyAssessment);

  try {
    const response = await callLLM(workspaceId, 'classify', {
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content || '';
    let parsed = parseHypothesisJSON(raw);

    if (!parsed) {
      console.warn('[retro/hypothesis] Failed to parse DeepSeek JSON response, using fallback');
      parsed = {
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

    // EC-02: Apply Tier 2 confidence reduction for benchmark-dependent layers
    parsed = applyTier2ConfidenceReduction(parsed, tier);
    parsed.history_tier = tier;

    // EC-01: Check for Conversation-Led Close before returning quadrant classification
    if (parsed.quadrant === 'LUCKY' && whaleSignals.length > 0) {
      const clcResult = detectConversationLedClose(whaleSignals);
      if (clcResult.detected) {
        parsed.conversation_led_close = clcResult;
        // Override the LUCKY quadrant with the named pattern
        parsed.quadrant = null;
        parsed.hypothesis = `${parsed.hypothesis} However, a Conversation-Led Close pattern was detected — this may be a forecast visibility gap rather than a process failure.`;
      }
    } else if (whaleSignals.length > 0) {
      // Always run detection; attach result even if not LUCKY (informational)
      const clcResult = detectConversationLedClose(whaleSignals);
      if (clcResult.detected) {
        parsed.conversation_led_close = clcResult;
      }
    }

    return parsed;
  } catch (err) {
    console.error('[retro/hypothesis] LLM call failed:', err);
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
      history_tier: tier,
    };
  }
}
