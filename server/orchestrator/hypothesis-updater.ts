/**
 * Hypothesis Updater - Pure arithmetic validation of standing hypotheses
 *
 * No LLM calls. Compares current metric values against thresholds,
 * adjusts confidence scores, and writes back to standing_hypotheses table.
 *
 * Confidence adjustment rules:
 * - Validated: +0.08 (capped at 0.95)
 * - Contradicted: -0.12 (floored at 0.05)
 * - Neutral/No data: unchanged
 */

import { query } from '../db.js';
import { SkillSummary, HypothesisUpdate, PriorContext } from './types.js';

// ============================================================================
// Metric Resolution
// ============================================================================

/**
 * Maps hypothesis metric_keys to current values from skill summary key_metrics.
 *
 * metric_key naming convention:
 *   '{skill_id}.{metric_name}'
 *   e.g. 'pipeline-coverage.coverage_ratio'
 *        'forecast-rollup.closed_won'
 *        'rep-scorecard.team_win_rate'
 *
 * Also supports short names without skill prefix:
 *   'coverage_ratio' → searches all skill summaries
 *   'closed_won' → searches all skill summaries
 */
function resolveMetricValue(
  metricKey: string,
  skillSummaries: SkillSummary[]
): { value: number; skillId: string } | null {

  // Try exact match with skill prefix first
  // Format: 'skill-id.metric_name'
  if (metricKey.includes('.')) {
    const parts = metricKey.split('.');
    const skillId = parts[0];
    const metricName = parts.slice(1).join('.'); // Handle dots in metric name

    const skill = skillSummaries.find(s => s.skill_id === skillId);
    if (skill?.key_metrics?.[metricName] !== undefined) {
      const val = Number(skill.key_metrics[metricName]);
      if (!isNaN(val)) {
        return { value: val, skillId: skill.skill_id };
      }
    }
  }

  // Fall back: search all skill summaries for the key
  for (const skill of skillSummaries) {
    if (!skill.key_metrics) continue;
    const val = skill.key_metrics[metricKey];
    if (val !== undefined) {
      const num = Number(val);
      if (!isNaN(num)) {
        return { value: num, skillId: skill.skill_id };
      }
    }
  }

  // Try common aliases
  const ALIASES: Record<string, string[]> = {
    'coverage_ratio':   ['coverageRatio', 'coverage'],
    'closed_won':       ['closedWon', 'closed_won_amount'],
    'win_rate':         ['winRate', 'team_win_rate'],
    'open_pipeline':    ['totalPipeline', 'open_pipeline'],
    'avg_deal_size':    ['avgDealSize', 'average_deal_size'],
    'deals_at_risk':    ['dealsAtRisk', 'at_risk_count'],
    'stale_deals':      ['staleDeals', 'stale_count'],
    'single_threaded':  ['singleThreaded', 'single_thread_count'],
  };

  const aliases = ALIASES[metricKey] || [];
  for (const alias of aliases) {
    for (const skill of skillSummaries) {
      if (!skill.key_metrics) continue;
      const val = skill.key_metrics[alias];
      if (val !== undefined) {
        const num = Number(val);
        if (!isNaN(num)) {
          return { value: num, skillId: skill.skill_id };
        }
      }
    }
  }

  return null;
}

// ============================================================================
// Hypothesis Evaluation
// ============================================================================

/**
 * Determines if a metric value validates or contradicts a hypothesis threshold.
 *
 * Convention:
 *   threshold > 0 means "metric should be ABOVE this"
 *   threshold < 0 means "metric should be BELOW this"
 *     (store absolute value, negate for below-check)
 *   threshold = 0 means "metric should be non-zero"
 *
 * LOCKED CONVENTION: ratios stored as 0-1.
 * Never compare 0.82 against threshold of 3.0 —
 * that would always fail. The threshold must match
 * the storage format of the metric.
 */
function evaluateHypothesis(
  currentValue: number,
  threshold: number,
  unit: string
): 'validated' | 'contradicted' | 'neutral' {

  // Sanity check: if unit is 'x' (coverage ratio)
  // and value looks like a raw number (> 10),
  // it's likely a display value not a stored ratio.
  // Log a warning but don't crash.
  if (unit === 'x' && currentValue > 10) {
    console.warn(
      `[HypothesisUpdater] Suspicious value for coverage ratio: ${currentValue}. ` +
      `Expected 0-5 range. Check metric extraction.`
    );
  }

  if (threshold === 0) {
    // "metric should be non-zero"
    return currentValue > 0 ? 'validated' : 'contradicted';
  }

  if (threshold > 0) {
    // "metric should be ABOVE threshold"
    // Validated if within 10% below threshold or above
    const tolerance = Math.abs(threshold) * 0.10;
    if (currentValue >= threshold - tolerance)
      return 'validated';
    if (currentValue < threshold - tolerance)
      return 'contradicted';
  }

  if (threshold < 0) {
    // "metric should be BELOW |threshold|"
    const absThreshold = Math.abs(threshold);
    const tolerance = absThreshold * 0.10;
    if (currentValue <= absThreshold + tolerance)
      return 'validated';
    if (currentValue > absThreshold + tolerance)
      return 'contradicted';
  }

  return 'neutral';
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatMetricValue(value: number, unit: string): string {
  if (unit === '$') {
    if (value >= 1_000_000)
      return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)
      return `$${Math.round(value / 1_000)}K`;
    return `$${Math.round(value)}`;
  }
  if (unit === 'x') {
    return `${value.toFixed(2)}x`;
  }
  if (unit === '%') {
    // LOCKED CONVENTION: stored as 0-1, display ×100
    const displayVal = value <= 1 ? value * 100 : value;
    return `${displayVal.toFixed(1)}%`;
  }
  if (unit === 'days') {
    return `${Math.round(value)} days`;
  }
  return String(Math.round(value * 100) / 100);
}

function buildHypothesisSummary(
  hypothesisText: string,
  valueDisplay: string,
  thresholdDisplay: string,
  evaluation: string,
  direction: string,
  delta: number
): string {

  const pctChange = Math.abs(Math.round(delta * 100));

  if (direction === 'confirmed') {
    return `Confirmed: ${hypothesisText} Current: ${valueDisplay} (above threshold ${thresholdDisplay}).`;
  }

  if (direction === 'refuted') {
    return `Refuted: ${hypothesisText} Current: ${valueDisplay} consistently below threshold ${thresholdDisplay}.`;
  }

  if (evaluation === 'validated') {
    return `Holding: ${hypothesisText} Current ${valueDisplay} validates threshold ${thresholdDisplay}. Confidence +${pctChange}pp.`;
  }

  if (evaluation === 'contradicted') {
    return `Weakening: ${hypothesisText} Current ${valueDisplay} is below threshold ${thresholdDisplay}. Confidence -${pctChange}pp.`;
  }

  return `Stable: ${hypothesisText} Current: ${valueDisplay}.`;
}

// ============================================================================
// Main Update Function
// ============================================================================

/**
 * Updates confidence scores for all hypotheses based on current week's skill data.
 *
 * Pure arithmetic — no LLM.
 * Writes updates back to standing_hypotheses table.
 * Returns delta array for report metadata.
 */
export async function updateHypotheses(
  workspaceId: string,
  hypotheses: PriorContext['hypotheses'],
  skillSummaries: SkillSummary[]
): Promise<HypothesisUpdate[]> {

  if (!hypotheses.length || !skillSummaries.length) {
    return [];
  }

  const updates: HypothesisUpdate[] = [];
  const processedMetrics = new Set<string>(); // Prevent double-counting

  for (const hypothesis of hypotheses) {
    try {
      // Skip if already processed (prevent double-counting)
      if (processedMetrics.has(hypothesis.metric_key)) {
        console.log(
          `[HypothesisUpdater] Skipping duplicate metric_key: ${hypothesis.metric_key}`
        );
        continue;
      }
      processedMetrics.add(hypothesis.metric_key);

      const resolved = resolveMetricValue(hypothesis.metric_key, skillSummaries);

      if (!resolved) {
        // No matching metric this week — confidence unchanged
        console.log(
          `[HypothesisUpdater] No metric found for key: ${hypothesis.metric_key}`
        );
        continue;
      }

      const { value: currentValue, skillId } = resolved;
      const oldConfidence = hypothesis.confidence;

      // Evaluate
      const evaluation = evaluateHypothesis(
        currentValue,
        hypothesis.threshold,
        hypothesis.unit
      );

      // Adjust confidence
      let newConfidence = oldConfidence;
      if (evaluation === 'validated') {
        newConfidence = Math.min(0.95, oldConfidence + 0.08);
      } else if (evaluation === 'contradicted') {
        newConfidence = Math.max(0.05, oldConfidence - 0.12);
      }
      // 'neutral': no change

      const delta = newConfidence - oldConfidence;

      // Determine direction
      const direction =
        newConfidence > 0.85 ? 'confirmed' :
        newConfidence < 0.25 ? 'refuted' :
        Math.abs(delta) < 0.03 ? 'holding' :
        delta > 0 ? 'strengthening' : 'weakening';

      // Build human-readable summary
      const valueDisplay = formatMetricValue(currentValue, hypothesis.unit);
      const thresholdDisplay = formatMetricValue(
        Math.abs(hypothesis.threshold),
        hypothesis.unit
      );

      const summary = buildHypothesisSummary(
        hypothesis.hypothesis_text,
        valueDisplay,
        thresholdDisplay,
        evaluation,
        direction,
        delta
      );

      updates.push({
        metric_key: hypothesis.metric_key,
        hypothesis_text: hypothesis.hypothesis_text,
        old_confidence: oldConfidence,
        new_confidence: newConfidence,
        confidence_delta: delta,
        direction,
        current_value: currentValue,
        threshold: hypothesis.threshold,
        unit: hypothesis.unit,
        evidence_skill: skillId,
        summary,
      });

      // Write back to standing_hypotheses table
      await query(`
        UPDATE standing_hypotheses
        SET
          confidence = $1,
          current_value = $2,
          updated_at = NOW()
        WHERE workspace_id = $3
          AND metric_key = $4
      `, [
        newConfidence,
        currentValue,
        workspaceId,
        hypothesis.metric_key,
      ]);

      console.log(
        `[HypothesisUpdater] ${hypothesis.metric_key}: ` +
        `${(oldConfidence * 100).toFixed(0)}% → ` +
        `${(newConfidence * 100).toFixed(0)}% ` +
        `(${evaluation}, ${direction})`
      );

    } catch (err) {
      console.error(
        `[HypothesisUpdater] Failed for ${hypothesis.metric_key}:`, err
      );
      // Non-fatal — continue with next hypothesis
    }
  }

  if (updates.length > 0) {
    console.log(
      `[HypothesisUpdater] Updated ${updates.length} hypotheses for workspace ${workspaceId}`
    );
  }

  return updates;
}
