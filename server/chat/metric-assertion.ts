/**
 * Metric Assertion Detection & Comparison
 *
 * THREE-TIER CONFIDENCE SYSTEM:
 * - COMPUTED: From CRM data. Never overwritten by assertion.
 * - CONFIRMED: User explicitly agreed with computed value.
 *   Written to metric_definitions. Confidence=1.0.
 * - ASSERTED: User stated without Pandora computing first.
 *   Written to workspace_knowledge. Confidence=0.6.
 *   NEVER written to metric_definitions.
 */

import { query } from '../db.js';

export interface MetricAssertion {
  metric_key:      string;
  asserted_value:  number;
  unit:            'percent' | 'dollars' | 'multiple' | 'days' | 'count';
  raw_match:       string;
}

export interface ComputedMetric {
  value:       number;
  unit:        string;
  methodology: string;  // human-readable explanation
  computed_at: string;
}

const METRIC_PATTERNS: Array<{
  regex:      RegExp;
  metric_key: string;
  unit:       MetricAssertion['unit'];
  extractFn:  (m: RegExpMatchArray) => number;
}> = [
  {
    regex:      /\bwin\s+rate\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*%/i,
    metric_key: 'win_rate',
    unit:       'percent',
    extractFn:  m => parseFloat(m[1]) / 100,
  },
  {
    regex:      /\bcoverage\s+(?:target\s+)?(?:is\s+)?(\d+(?:\.\d+)?)\s*x/i,
    metric_key: 'coverage_target',
    unit:       'multiple',
    extractFn:  m => parseFloat(m[1]),
  },
  {
    regex:      /\b(?:quota|target)\s+(?:is\s+)?\$([\d,]+(?:\.\d+)?)\s*([KMB]?)/i,
    metric_key: 'quota_target',
    unit:       'dollars',
    extractFn:  m => {
      const n = parseFloat(m[1].replace(/,/g, ''));
      const mult = ({ K: 1000, M: 1000000, B: 1000000000 } as any)[m[2]] ?? 1;
      return n * mult;
    },
  },
  {
    regex:      /\baverage\s+deal\s+(?:size\s+)?(?:is\s+)?\$([\d,]+(?:\.\d+)?)\s*([KMB]?)/i,
    metric_key: 'avg_deal_size',
    unit:       'dollars',
    extractFn:  m => {
      const n = parseFloat(m[1].replace(/,/g, ''));
      const mult = ({ K: 1000, M: 1000000, B: 1000000000 } as any)[m[2]] ?? 1;
      return n * mult;
    },
  },
  {
    regex:      /\b(?:sales\s+)?cycle\s+(?:is\s+)?(\d+)\s+days?/i,
    metric_key: 'avg_cycle_days',
    unit:       'days',
    extractFn:  m => parseInt(m[1]),
  },
];

/**
 * Detect if a user message contains a metric assertion.
 * Returns the first match found, or null if none.
 */
export function detectMetricAssertion(
  message: string
): MetricAssertion | null {
  for (const p of METRIC_PATTERNS) {
    const match = message.match(p.regex);
    if (match) {
      return {
        metric_key:     p.metric_key,
        asserted_value: p.extractFn(match),
        unit:           p.unit,
        raw_match:      match[0],
      };
    }
  }
  return null;
}

/**
 * Get computed metric value from CRM data or metric_definitions table.
 * Returns null if no computed value exists.
 */
export async function getComputedMetric(
  metric_key:  string,
  workspaceId: string
): Promise<ComputedMetric | null> {
  // Different metrics come from different sources

  if (metric_key === 'win_rate') {
    const result = await query<{
      won: string;
      total: string;
      earliest: string | null;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE stage_normalized = 'closed_won'
         ) AS won,
         COUNT(*) FILTER (
           WHERE stage_normalized IN (
             'closed_won', 'closed_lost'
           )
         ) AS total,
         MIN(close_date) AS earliest
       FROM deals
       WHERE workspace_id = $1
         AND close_date >= NOW() - INTERVAL '12 months'`,
      [workspaceId]
    );

    const { won, total, earliest } = result.rows[0];
    if (!total || total === '0') return null;

    const rate = parseInt(won) / parseInt(total);
    return {
      value:       rate,
      unit:        'percent',
      methodology: `${won} closed-won out of ${total} total closed deals over the last 12 months`,
      computed_at: new Date().toISOString(),
    };
  }

  if (metric_key === 'avg_deal_size') {
    const result = await query<{
      avg_amount: string | null;
      deal_count: string;
    }>(
      `SELECT
         AVG(amount) AS avg_amount,
         COUNT(*) AS deal_count
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized = 'closed_won'
         AND close_date >= NOW() - INTERVAL '12 months'`,
      [workspaceId]
    );

    const { avg_amount, deal_count } = result.rows[0];
    if (!avg_amount) return null;

    return {
      value:       Math.round(parseFloat(avg_amount)),
      unit:        'dollars',
      methodology: `average of ${deal_count} won deals in the last 12 months`,
      computed_at: new Date().toISOString(),
    };
  }

  // For other metrics, check metric_definitions table
  const result = await query<{
    value: string | null;
    unit: string;
    formula: string | null;
    created_at: string;
  }>(
    `SELECT value, unit, formula, created_at
     FROM metric_definitions
     WHERE workspace_id = $1
       AND metric_key = $2
       AND calibration_source = 'computed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, metric_key]
  );

  if (!result.rows.length || !result.rows[0].value) return null;

  return {
    value:       parseFloat(result.rows[0].value),
    unit:        result.rows[0].unit,
    methodology: result.rows[0].formula ?? 'computed',
    computed_at: result.rows[0].created_at,
  };
}

/**
 * Build a comparison response showing asserted vs computed values.
 * Asks user which to use when they differ.
 */
export function buildComparisonResponse(
  assertion:  MetricAssertion,
  computed:   ComputedMetric | null
): string {
  const formatValue = (v: number, unit: string) => {
    if (unit === 'percent')
      return `${(v * 100).toFixed(1)}%`;
    if (unit === 'dollars')
      return v >= 1000000
        ? `$${(v/1000000).toFixed(1)}M`
        : v >= 1000
        ? `$${(v/1000).toFixed(0)}K`
        : `$${v.toFixed(0)}`;
    if (unit === 'multiple')
      return `${v}x`;
    if (unit === 'days')
      return `${v} days`;
    return String(v);
  };

  const assertedStr = formatValue(
    assertion.asserted_value, assertion.unit
  );

  if (!computed) {
    return `You mentioned ${assertedStr} as your ${assertion.metric_key.replace(/_/g, ' ')}. ` +
      `I don't have enough data to verify that from your CRM yet. ` +
      `I'll store it as your stated value. You can update it anytime.\n\n` +
      `Should I use ${assertedStr} for calculations?`;
  }

  const computedStr = formatValue(computed.value, computed.unit);

  if (Math.abs(computed.value - assertion.asserted_value)
      < 0.02 * computed.value) {
    // Within 2% — they match
    return `You mentioned ${assertedStr} — that matches what I computed: ${computedStr} from your ${computed.methodology}.\n\n` +
      `Should I lock this in as your official ${assertion.metric_key.replace(/_/g, ' ')} benchmark?`;
  }

  // They differ — show the gap
  return `You mentioned ${assertedStr}, but I'm computing ${computedStr} from your ${computed.methodology}.\n\n` +
    `A few things could explain the difference: different time period, different pipeline scope, or data not yet synced.\n\n` +
    `Which should I use?\n` +
    `  A) Your number: ${assertedStr}\n` +
    `  B) My computed number: ${computedStr}\n` +
    `  C) Let me dig deeper first`;
}
