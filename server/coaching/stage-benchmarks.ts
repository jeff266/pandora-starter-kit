/**
 * Stage Velocity Benchmarks
 *
 * Computes how long won vs lost deals spend in each stage, segmented by deal size.
 * This replaces the flawed global `sales_cycle_days` signal with stage-specific,
 * segment-aware benchmarks that produce meaningful coaching signals.
 */

import { query } from '../db.js';

export interface StageBenchmarkOutcome {
  median_days: number;
  p75_days: number;
  p90_days: number;
  sample_size: number;
}

export interface StageBenchmark {
  stage_normalized: string;
  pipeline: string;
  segment: string;
  won: StageBenchmarkOutcome | null;
  lost: StageBenchmarkOutcome | null;
  confidence_tier: 'high' | 'directional' | 'insufficient';
  is_inverted: boolean;
  inversion_note?: string;
}

export interface VelocitySignal {
  signal: 'healthy' | 'watch' | 'at_risk' | 'critical' | 'premature';
  ratio: number | null;
  explanation: string;
  countdown_days: number | null;
}

function confidenceTier(wonSampleSize: number): 'high' | 'directional' | 'insufficient' {
  if (wonSampleSize >= 20) return 'high';
  if (wonSampleSize >= 5) return 'directional';
  return 'insufficient';
}

/**
 * Auto-detect deal size segment boundaries from P25/P75 of deal amounts.
 * Falls back to [10000, 50000] if insufficient data.
 */
export async function autoDetectSegmentBoundaries(workspaceId: string): Promise<[number, number]> {
  try {
    const result = await query<{ low_cutoff: string | null; high_cutoff: string | null }>(
      `SELECT
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) AS low_cutoff,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) AS high_cutoff
       FROM deals
       WHERE workspace_id = $1 AND amount > 0 AND amount IS NOT NULL`,
      [workspaceId]
    );
    const row = result.rows[0];
    const low = parseFloat(row?.low_cutoff ?? '');
    const high = parseFloat(row?.high_cutoff ?? '');
    if (!isNaN(low) && !isNaN(high) && low > 0 && high > low) {
      return [low, high];
    }
  } catch (_) {
    // ignore, use fallback
  }
  return [10000, 50000];
}

/**
 * Compute and store stage velocity benchmarks for a workspace.
 * Segments deals by size (smb/mid_market/enterprise/all), splits by outcome (won/lost),
 * and upserts results to stage_velocity_benchmarks.
 */
export async function computeAndStoreStageBenchmarks(workspaceId: string): Promise<{ rows_updated: number }> {
  const [lowCutoff, highCutoff] = await autoDetectSegmentBoundaries(workspaceId);

  const result = await query<{
    pipeline: string;
    stage_normalized: string;
    segment: string;
    outcome: string;
    median_days: string;
    p75_days: string;
    p90_days: string;
    avg_days: string;
    sample_size: string;
  }>(
    `WITH closed_deal_stages AS (
       SELECT
         CASE
           WHEN d.pipeline IS NOT NULL AND d.pipeline != ''     THEN d.pipeline
           WHEN d.scope_id IS NOT NULL
                AND d.scope_id NOT IN ('default', 'all')        THEN d.scope_id
           ELSE 'all'
         END                                                                    AS pipeline,
         dsh.stage_normalized,
         CASE
           WHEN COALESCE(d.amount, 0) <= 0          THEN 'all'
           WHEN d.amount < $2                         THEN 'smb'
           WHEN d.amount < $3                         THEN 'mid_market'
           ELSE                                            'enterprise'
         END                                                                    AS segment,
         CASE
           WHEN d.stage_normalized = 'closed_won' THEN 'won'
           ELSE 'lost'
         END                                                                    AS outcome,
         dsh.duration_days
       FROM deal_stage_history dsh
       JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
       WHERE dsh.workspace_id = $1
         AND dsh.duration_days IS NOT NULL
         AND dsh.duration_days > 0
         AND dsh.stage_normalized NOT IN ('closed_won', 'closed_lost', 'unknown', 'pipeline')
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
     ),
     with_all_segment AS (
       SELECT * FROM closed_deal_stages
       UNION ALL
       SELECT pipeline, stage_normalized, 'all', outcome, duration_days
       FROM closed_deal_stages
       UNION ALL
       SELECT 'all', stage_normalized, segment, outcome, duration_days
       FROM closed_deal_stages
       UNION ALL
       SELECT 'all', stage_normalized, 'all', outcome, duration_days
       FROM closed_deal_stages
     ),
     aggregated AS (
       SELECT
         pipeline,
         stage_normalized,
         segment,
         outcome,
         COUNT(*)::integer                                                       AS sample_size,
         PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_days)::numeric   AS median_days,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY duration_days)::numeric   AS p75_days,
         PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY duration_days)::numeric   AS p90_days,
         AVG(duration_days)::numeric(10,1)                                       AS avg_days
       FROM with_all_segment
       WHERE duration_days IS NOT NULL
       GROUP BY pipeline, stage_normalized, segment, outcome
       HAVING COUNT(*) >= 3
     )
     SELECT pipeline, stage_normalized, segment, outcome,
            median_days::text, p75_days::text, p90_days::text, avg_days::text, sample_size::text
     FROM aggregated
     ORDER BY stage_normalized, segment, outcome`,
    [workspaceId, lowCutoff, highCutoff]
  );

  if (result.rows.length === 0) {
    return { rows_updated: 0 };
  }

  // Group rows to detect inversion (won vs lost per stage+segment+pipeline)
  const groups: Record<string, { won?: typeof result.rows[0]; lost?: typeof result.rows[0] }> = {};
  for (const row of result.rows) {
    const key = `${row.pipeline}||${row.stage_normalized}||${row.segment}`;
    if (!groups[key]) groups[key] = {};
    if (row.outcome === 'won') groups[key].won = row;
    else groups[key].lost = row;
  }

  let rowsUpdated = 0;

  for (const row of result.rows) {
    const key = `${row.pipeline}||${row.stage_normalized}||${row.segment}`;
    const group = groups[key];
    const wonMedian = group.won ? parseFloat(group.won.median_days) : null;
    const lostMedian = group.lost ? parseFloat(group.lost.median_days) : null;

    const isInverted =
      wonMedian !== null && lostMedian !== null && wonMedian > lostMedian * 1.2;

    const wonSampleSize = group.won ? parseInt(group.won.sample_size, 10) : 0;
    const tier = confidenceTier(wonSampleSize);

    await query(
      `INSERT INTO stage_velocity_benchmarks
         (workspace_id, pipeline, stage_normalized, segment, outcome,
          median_days, p75_days, p90_days, avg_days, sample_size, confidence_tier, is_inverted, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (workspace_id, pipeline, stage_normalized, segment, outcome)
       DO UPDATE SET
         median_days      = EXCLUDED.median_days,
         p75_days         = EXCLUDED.p75_days,
         p90_days         = EXCLUDED.p90_days,
         avg_days         = EXCLUDED.avg_days,
         sample_size      = EXCLUDED.sample_size,
         confidence_tier  = EXCLUDED.confidence_tier,
         is_inverted      = EXCLUDED.is_inverted,
         computed_at      = now()`,
      [
        workspaceId,
        row.pipeline,
        row.stage_normalized,
        row.segment,
        row.outcome,
        parseFloat(row.median_days),
        parseFloat(row.p75_days),
        parseFloat(row.p90_days),
        row.avg_days ? parseFloat(row.avg_days) : null,
        parseInt(row.sample_size, 10),
        tier,
        isInverted,
      ]
    );
    rowsUpdated++;
  }

  return { rows_updated: rowsUpdated };
}

/**
 * Look up a benchmark for a specific stage + segment, falling back to 'all' segment.
 */
export async function lookupBenchmark(
  workspaceId: string,
  stageNormalized: string,
  segment: string,
  pipeline = 'all'
): Promise<StageBenchmark | null> {
  const result = await query<{
    pipeline: string;
    stage_normalized: string;
    segment: string;
    outcome: string;
    median_days: string;
    p75_days: string;
    p90_days: string;
    sample_size: string;
    confidence_tier: string;
    is_inverted: boolean;
  }>(
    `SELECT pipeline, stage_normalized, segment, outcome,
            median_days, p75_days, p90_days, sample_size, confidence_tier, is_inverted
     FROM stage_velocity_benchmarks
     WHERE workspace_id = $1
       AND stage_normalized = $2
       AND segment IN ($3, 'all')
       AND pipeline IN ($4, 'all')
     ORDER BY
       CASE segment WHEN $3 THEN 0 ELSE 1 END,
       CASE pipeline WHEN $4 THEN 0 ELSE 1 END`,
    [workspaceId, stageNormalized, segment, pipeline]
  );

  if (result.rows.length === 0) return null;

  // Pick the best matching row (specific segment first, then 'all')
  const wonRow = result.rows.find(r => r.outcome === 'won');
  const lostRow = result.rows.find(r => r.outcome === 'lost');
  const anyRow = wonRow ?? lostRow;
  if (!anyRow) return null;

  const benchmark: StageBenchmark = {
    stage_normalized: anyRow.stage_normalized,
    pipeline: anyRow.pipeline,
    segment: anyRow.segment,
    confidence_tier: anyRow.confidence_tier as 'high' | 'directional' | 'insufficient',
    is_inverted: anyRow.is_inverted,
    won: null,
    lost: null,
  };

  if (wonRow) {
    benchmark.won = {
      median_days: parseFloat(wonRow.median_days),
      p75_days: parseFloat(wonRow.p75_days),
      p90_days: parseFloat(wonRow.p90_days),
      sample_size: parseInt(wonRow.sample_size, 10),
    };
  }
  if (lostRow) {
    benchmark.lost = {
      median_days: parseFloat(lostRow.median_days),
      p75_days: parseFloat(lostRow.p75_days),
      p90_days: parseFloat(lostRow.p90_days),
      sample_size: parseInt(lostRow.sample_size, 10),
    };
  }

  if (benchmark.is_inverted) {
    benchmark.inversion_note = `Winning deals spend longer here — fast exits correlate with losses`;
  }

  return benchmark;
}

/**
 * Batch lookup benchmarks for multiple stages.
 * Fetches all needed benchmarks in one query to avoid N+1 problem.
 * Returns a Map keyed by "stage_normalized:segment:pipeline".
 */
export async function batchLookupBenchmarks(
  workspaceId: string,
  lookups: Array<{ stageNormalized: string; segment: string; pipeline: string }>
): Promise<Map<string, StageBenchmark | null>> {
  if (lookups.length === 0) return new Map();

  // Build WHERE clause for all lookups
  const conditions: string[] = [];
  const params: any[] = [workspaceId];
  let paramIdx = 2;

  for (const lookup of lookups) {
    conditions.push(
      `(stage_normalized = $${paramIdx} AND segment IN ($${paramIdx + 1}, 'all') AND pipeline IN ($${paramIdx + 2}, 'all'))`
    );
    params.push(lookup.stageNormalized, lookup.segment, lookup.pipeline);
    paramIdx += 3;
  }

  const result = await query<{
    pipeline: string;
    stage_normalized: string;
    segment: string;
    outcome: string;
    median_days: string;
    p75_days: string;
    p90_days: string;
    sample_size: string;
    confidence_tier: string;
    is_inverted: boolean;
  }>(
    `SELECT pipeline, stage_normalized, segment, outcome,
            median_days, p75_days, p90_days, sample_size, confidence_tier, is_inverted
     FROM stage_velocity_benchmarks
     WHERE workspace_id = $1 AND (${conditions.join(' OR ')})
     ORDER BY stage_normalized, segment, pipeline, outcome`,
    params
  );

  // Group rows by key
  const grouped = new Map<string, Array<typeof result.rows[0]>>();
  for (const row of result.rows) {
    const key = `${row.stage_normalized}:${row.segment}:${row.pipeline}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  // Build benchmark map
  const benchmarks = new Map<string, StageBenchmark | null>();
  for (const lookup of lookups) {
    const key = `${lookup.stageNormalized}:${lookup.segment}:${lookup.pipeline}`;
    const rows = grouped.get(key) ?? [];

    if (rows.length === 0) {
      benchmarks.set(key, null);
      continue;
    }

    const wonRow = rows.find(r => r.outcome === 'won');
    const lostRow = rows.find(r => r.outcome === 'lost');
    const anyRow = wonRow ?? lostRow;
    if (!anyRow) {
      benchmarks.set(key, null);
      continue;
    }

    const benchmark: StageBenchmark = {
      stage_normalized: anyRow.stage_normalized,
      pipeline: anyRow.pipeline,
      segment: anyRow.segment,
      confidence_tier: anyRow.confidence_tier as 'high' | 'directional' | 'insufficient',
      is_inverted: anyRow.is_inverted,
      won: null,
      lost: null,
    };

    if (wonRow) {
      benchmark.won = {
        median_days: parseFloat(wonRow.median_days),
        p75_days: parseFloat(wonRow.p75_days),
        p90_days: parseFloat(wonRow.p90_days),
        sample_size: parseInt(wonRow.sample_size, 10),
      };
    }
    if (lostRow) {
      benchmark.lost = {
        median_days: parseFloat(lostRow.median_days),
        p75_days: parseFloat(lostRow.p75_days),
        p90_days: parseFloat(lostRow.p90_days),
        sample_size: parseInt(lostRow.sample_size, 10),
      };
    }

    if (benchmark.is_inverted) {
      benchmark.inversion_note = `Winning deals spend longer here — fast exits correlate with losses`;
    }

    benchmarks.set(key, benchmark);
  }

  return benchmarks;
}

/**
 * Compute a velocity signal for a deal in a given stage.
 * Returns the signal category and plain-English explanation.
 */
export function computeVelocitySignal(
  daysInStage: number,
  stageLabel: string,
  benchmark: StageBenchmark | null,
  legacyFallback?: { salesCycleDays: number; wonMedian: number; wonP75: number; direction: string }
): VelocitySignal {
  if (!benchmark || !benchmark.won) {
    if (legacyFallback) {
      return computeLegacyVelocitySignal(legacyFallback, stageLabel);
    }
    return {
      signal: 'watch',
      ratio: null,
      explanation: `${daysInStage}d in ${stageLabel} — no benchmark data yet for this stage.`,
      countdown_days: null,
    };
  }

  const wonMedian = benchmark.won.median_days;
  const lostMedian = benchmark.lost?.median_days ?? null;

  if (benchmark.is_inverted) {
    if (daysInStage < wonMedian * 0.5) {
      return {
        signal: 'premature',
        ratio: daysInStage / wonMedian,
        explanation: `${daysInStage}d in ${stageLabel} — winning deals spend ${Math.round(wonMedian)}d here. Moving through too fast may indicate insufficient engagement.`,
        countdown_days: null,
      };
    }
    return {
      signal: 'healthy',
      ratio: daysInStage / wonMedian,
      explanation: `${daysInStage}d in ${stageLabel} — this is a stage where winning deals take their time (avg ${Math.round(wonMedian)}d). Taking time here is healthy.`,
      countdown_days: null,
    };
  }

  const ratio = daysInStage / wonMedian;

  if (ratio <= 1.2) {
    return {
      signal: 'healthy',
      ratio,
      explanation: `${daysInStage}d in ${stageLabel} — right on pace with your ${Math.round(wonMedian)}d win benchmark.`,
      countdown_days: null,
    };
  }

  if (ratio <= 2.0) {
    const countdownDays = lostMedian !== null ? Math.max(0, Math.ceil(lostMedian - daysInStage)) : null;
    return {
      signal: 'watch',
      ratio,
      explanation: `${daysInStage}d in ${stageLabel} — ${ratio.toFixed(1)}× your typical win pace of ${Math.round(wonMedian)}d. Watch closely.`,
      countdown_days: countdownDays,
    };
  }

  if (lostMedian !== null && daysInStage > lostMedian) {
    return {
      signal: 'critical',
      ratio,
      explanation: `${daysInStage}d in ${stageLabel} — past your lost deal median of ${Math.round(lostMedian)}d (win pace: ${Math.round(wonMedian)}d). This needs intervention or disqualification.`,
      countdown_days: 0,
    };
  }

  const countdownDays = lostMedian !== null ? Math.max(0, Math.ceil(lostMedian - daysInStage)) : null;
  return {
    signal: 'at_risk',
    ratio,
    explanation: `${daysInStage}d in ${stageLabel} — ${ratio.toFixed(1)}× your win pace.${lostMedian ? ` Lost deals average ${Math.round(lostMedian)}d here.` : ''}`,
    countdown_days: countdownDays,
  };
}

function computeLegacyVelocitySignal(
  { salesCycleDays, wonMedian, wonP75, direction }: { salesCycleDays: number; wonMedian: number; wonP75: number; direction: string },
  stageLabel: string
): VelocitySignal {
  if (direction === 'lower_wins') {
    if (salesCycleDays > wonP75 * 2) {
      return { signal: 'critical', ratio: salesCycleDays / wonMedian, explanation: `${salesCycleDays}d total — significantly past your win pattern threshold.`, countdown_days: null };
    }
    if (salesCycleDays > wonP75) {
      return { signal: 'at_risk', ratio: salesCycleDays / wonMedian, explanation: `${salesCycleDays}d total — past your win pattern p75 threshold.`, countdown_days: null };
    }
    if (salesCycleDays <= wonMedian) {
      return { signal: 'healthy', ratio: salesCycleDays / wonMedian, explanation: `${salesCycleDays}d total — at or under your win pattern median.`, countdown_days: null };
    }
    return { signal: 'watch', ratio: salesCycleDays / wonMedian, explanation: `${salesCycleDays}d total — between median and p75 of your win pattern.`, countdown_days: null };
  }
  if (salesCycleDays < wonMedian) {
    return { signal: 'critical', ratio: salesCycleDays / wonMedian, explanation: `${salesCycleDays}d — below the expected minimum for this dimension.`, countdown_days: null };
  }
  if (salesCycleDays >= wonMedian * 2) {
    return { signal: 'healthy', ratio: salesCycleDays / wonMedian, explanation: `${salesCycleDays}d — exceeds the expected range.`, countdown_days: null };
  }
  return { signal: 'watch', ratio: salesCycleDays / wonMedian, explanation: `${salesCycleDays}d — within expected range.`, countdown_days: null };
}

/**
 * Compute composite health label from velocity and engagement signals.
 */
export function computeCompositeLabel(
  velocitySignal: 'healthy' | 'watch' | 'at_risk' | 'critical' | 'premature',
  engagementSignal: 'active' | 'cooling' | 'dark' | 'no_data' | null
): { label: string; color: 'green' | 'yellow' | 'amber' | 'red' } {
  const eng = engagementSignal ?? 'no_data';

  if (velocitySignal === 'premature') {
    return { label: 'Premature Advancement — Low Engagement', color: 'amber' };
  }

  if (velocitySignal === 'healthy') {
    if (eng === 'active') return { label: 'Healthy', color: 'green' };
    if (eng === 'cooling') return { label: 'Healthy', color: 'green' };
    return { label: 'Watch Closely', color: 'yellow' };
  }

  if (velocitySignal === 'watch') {
    if (eng === 'active') return { label: 'Running Long, But Active', color: 'yellow' };
    if (eng === 'cooling') return { label: 'Watch Closely', color: 'yellow' };
    return { label: 'At Risk', color: 'amber' };
  }

  if (velocitySignal === 'at_risk') {
    if (eng === 'active') return { label: 'At Risk (But Active)', color: 'amber' };
    return { label: 'At Risk', color: 'red' };
  }

  return { label: 'Critical', color: 'red' };
}
