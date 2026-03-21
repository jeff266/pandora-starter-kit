// Week-over-week diff engine for WBR/QBR skill run evidence
// Compares the two most recent completed runs of a skill and surfaces
// numeric deltas for MetricCard enrichment.

import { query } from '../db.js';

interface ClaimSnapshot {
  claim_id: string;
  metric_name: string;
  metric_values: number[];
  severity: string;
}

export interface MetricDelta {
  claim_id: string;
  metric_name: string;
  current_value: number;
  previous_value: number;
  delta: number;
  delta_pct: number;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Compares the two most recent completed runs of a skill within the
 * last 21 days and returns per-claim numeric deltas.
 *
 * Returns [] when:
 *   - Fewer than two completed runs exist (first-ever WBR generates cleanly)
 *   - evidence->claims is absent or malformed
 *   - Only per-entity arrays (e.g. per-deal days_since_activity) — those are
 *     filtered out (metric_values must have exactly one element to diff)
 */
export async function computeSkillDiff(
  workspaceId: string,
  skillId: string,
): Promise<MetricDelta[]> {
  try {
    const result = await query<{
      id: string;
      claims: ClaimSnapshot[] | null;
    }>(
      `SELECT id,
              (output->'evidence'->'claims') AS claims
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = $2
         AND status = 'completed'
         AND output->'evidence'->'claims' IS NOT NULL
         AND created_at > now() - INTERVAL '21 days'
       ORDER BY created_at DESC
       LIMIT 2`,
      [workspaceId, skillId],
    );

    if (result.rows.length < 2) return [];

    const [currentRow, priorRow] = result.rows;
    const currentClaims: ClaimSnapshot[] = currentRow.claims ?? [];
    const priorClaims: ClaimSnapshot[] = priorRow.claims ?? [];

    const priorMap = new Map(priorClaims.map(c => [c.claim_id, c]));
    const deltas: MetricDelta[] = [];

    for (const current of currentClaims) {
      const prior = priorMap.get(current.claim_id);
      if (!prior) continue;

      // Only aggregate single-value metrics — skip per-entity arrays
      if ((current.metric_values?.length ?? 0) !== 1) continue;
      if ((prior.metric_values?.length ?? 0) !== 1) continue;

      const currentVal = current.metric_values[0];
      const priorVal = prior.metric_values[0];

      if (typeof currentVal !== 'number' || typeof priorVal !== 'number') continue;
      if (priorVal === 0) continue;

      const delta = currentVal - priorVal;
      const deltaPct = (delta / Math.abs(priorVal)) * 100;

      deltas.push({
        claim_id: current.claim_id,
        metric_name: current.metric_name,
        current_value: currentVal,
        previous_value: priorVal,
        delta,
        delta_pct: deltaPct,
        direction: Math.abs(delta) < 0.001 ? 'flat' : delta > 0 ? 'up' : 'down',
      });
    }

    return deltas;
  } catch {
    // Never fail report generation due to diff errors
    return [];
  }
}
