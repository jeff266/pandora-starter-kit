/**
 * Win-Pattern Discovery Engine
 *
 * Analyzes closed deals to discover what actually predicts winning.
 * No assumptions. Only patterns backed by data.
 */

import { query } from '../db';
import type { PoolClient } from 'pg';

export interface WinPattern {
  dimension: string;
  segment: DealSegment;
  won_median: number;
  won_p25: number;
  won_p75: number;
  lost_median: number;
  lost_p25: number;
  lost_p75: number;
  separation_score: number;
  direction: 'higher_wins' | 'lower_wins';
  sample_size_won: number;
  sample_size_lost: number;
  relevant_stages: string[];
  discovered_at: string;
}

export interface DealSegment {
  size_band_min: number | null;
  size_band_max: number | null;
  pipeline: string | null;
}

export interface DiscoveryResult {
  workspace_id: string;
  discovered_at: string;
  total_closed_deals: number;
  won_deals: number;
  lost_deals: number;
  segments_analyzed: number;
  patterns_found: WinPattern[];
  dimensions_checked: number;
  insufficient_data: string[];
}

interface ClosedDeal {
  id: string;
  amount: number;
  outcome: 'won' | 'lost';
  stage_normalized: string;
  pipeline_name: string | null;
  created_date: string;
  close_date: string;
  sales_cycle_days: number;
}

interface DealMetrics {
  deal_id: string;
  amount: number;
  outcome: 'won' | 'lost';

  // Conversation metrics
  call_count: number | null;
  total_call_minutes: number | null;
  avg_call_duration_minutes: number | null;
  unique_external_participants: number | null;
  avg_external_per_call: number | null;
  avg_talk_ratio_rep: number | null;
  avg_talk_ratio_buyer: number | null;
  avg_questions_per_call: number | null;
  avg_action_items_per_call: number | null;
  first_call_days_from_creation: number | null;
  days_between_calls_avg: number | null;

  // CRM metrics
  sales_cycle_days: number;
  stage_regression_count: number | null;
  contact_count: number | null;
}

/**
 * Main discovery function - analyze closed deals and find patterns
 */
export async function discoverWinPatterns(
  workspaceId: string
): Promise<DiscoveryResult> {
  const startTime = Date.now();
  console.log(`[Coaching] Starting win pattern discovery for workspace ${workspaceId}`);

  // Step 1: Gather closed deals
  const closedDealsResult = await query<ClosedDeal>(
    `SELECT
      d.id,
      COALESCE(d.amount, 0) as amount,
      CASE WHEN d.stage_normalized = 'closed_won' THEN 'won' ELSE 'lost' END as outcome,
      d.stage_normalized,
      d.pipeline as pipeline_name,
      d.created_at as created_date,
      d.close_date,
      EXTRACT(days FROM d.close_date::timestamp - d.created_at::timestamp) as sales_cycle_days
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
       AND d.created_at > NOW() - INTERVAL '12 months'
       AND d.close_date IS NOT NULL
     ORDER BY d.close_date DESC`,
    [workspaceId]
  );

  const closedDeals = closedDealsResult.rows;
  const wonDeals = closedDeals.filter(d => d.outcome === 'won');
  const lostDeals = closedDeals.filter(d => d.outcome === 'lost');

  console.log(`[Coaching] Found ${wonDeals.length} won, ${lostDeals.length} lost deals`);

  // Minimum threshold check
  if (wonDeals.length < 15 || lostDeals.length < 10) {
    console.log(`[Coaching] Insufficient data for discovery (need 15+ won, 10+ lost)`);
    return {
      workspace_id: workspaceId,
      discovered_at: new Date().toISOString(),
      total_closed_deals: closedDeals.length,
      won_deals: wonDeals.length,
      lost_deals: lostDeals.length,
      segments_analyzed: 0,
      patterns_found: [],
      dimensions_checked: 0,
      insufficient_data: ['Need 15+ won and 10+ lost deals to discover patterns'],
    };
  }

  // Step 2: Auto-segment by deal size
  const segments = autoSegmentBySize(closedDeals);
  console.log(`[Coaching] Created ${segments.length} size-based segments`);

  // Step 3: Compute metrics for all closed deals
  const dealMetrics = await computeAllDealMetrics(workspaceId, closedDeals.map(d => d.id));
  console.log(`[Coaching] Computed metrics for ${dealMetrics.length} deals`);

  // Step 4: Find patterns for each segment
  const allPatterns: WinPattern[] = [];
  const dimensionsChecked = new Set<string>();
  const insufficientData: string[] = [];

  for (const segment of segments) {
    const segmentDeals = filterDealsForSegment(dealMetrics, segment);
    const segmentWon = segmentDeals.filter(d => d.outcome === 'won');
    const segmentLost = segmentDeals.filter(d => d.outcome === 'lost');

    if (segmentWon.length < 5 || segmentLost.length < 5) {
      console.log(`[Coaching] Skipping segment (min ${segment.size_band_min}, max ${segment.size_band_max}): insufficient data`);
      continue;
    }

    console.log(`[Coaching] Analyzing segment: ${segmentWon.length} won, ${segmentLost.length} lost`);

    // Test each dimension
    const dimensions = getDimensionsToTest();
    for (const dim of dimensions) {
      dimensionsChecked.add(dim);

      const wonValues = segmentWon.map(d => d[dim as keyof DealMetrics] as number).filter(v => v != null && !isNaN(v));
      const lostValues = segmentLost.map(d => d[dim as keyof DealMetrics] as number).filter(v => v != null && !isNaN(v));

      const separation = computeSeparation(wonValues, lostValues);
      if (!separation) continue;

      const pattern: WinPattern = {
        dimension: dim,
        segment,
        won_median: median(wonValues),
        won_p25: percentile(wonValues, 25),
        won_p75: percentile(wonValues, 75),
        lost_median: median(lostValues),
        lost_p25: percentile(lostValues, 25),
        lost_p75: percentile(lostValues, 75),
        separation_score: separation.score,
        direction: separation.direction,
        sample_size_won: wonValues.length,
        sample_size_lost: lostValues.length,
        relevant_stages: ['all'], // TODO: Stage-specific detection in future iteration
        discovered_at: new Date().toISOString(),
      };

      allPatterns.push(pattern);
      console.log(`[Coaching] Found pattern: ${dim} (${separation.direction}, score ${separation.score.toFixed(2)})`);
    }
  }

  // Step 5: Store patterns (supersede old ones)
  await storePatterns(workspaceId, allPatterns);

  const duration = Date.now() - startTime;
  console.log(`[Coaching] Discovery complete in ${duration}ms: ${allPatterns.length} patterns found`);

  return {
    workspace_id: workspaceId,
    discovered_at: new Date().toISOString(),
    total_closed_deals: closedDeals.length,
    won_deals: wonDeals.length,
    lost_deals: lostDeals.length,
    segments_analyzed: segments.length,
    patterns_found: allPatterns,
    dimensions_checked: dimensionsChecked.size,
    insufficient_data: insufficientData,
  };
}

/**
 * Auto-segment deals by size
 */
function autoSegmentBySize(deals: ClosedDeal[]): DealSegment[] {
  const amounts = deals.map(d => d.amount).filter(a => a > 0).sort((a, b) => a - b);

  if (amounts.length < 30) {
    // Not enough data to segment
    return [{ size_band_min: null, size_band_max: null, pipeline: null }];
  }

  const q1 = percentile(amounts, 25);
  const q3 = percentile(amounts, 75);

  // Only segment if there's meaningful spread
  if (q3 < q1 * 3) {
    return [{ size_band_min: null, size_band_max: null, pipeline: null }];
  }

  return [
    { size_band_min: null, size_band_max: q1, pipeline: null },
    { size_band_min: q1, size_band_max: q3, pipeline: null },
    { size_band_min: q3, size_band_max: null, pipeline: null },
  ];
}

/**
 * Compute all metrics for closed deals
 */
async function computeAllDealMetrics(
  workspaceId: string,
  dealIds: string[]
): Promise<DealMetrics[]> {
  if (dealIds.length === 0) return [];

  // Conversation aggregates per deal
  const convMetrics = await query<{
    deal_id: string;
    call_count: number;
    total_call_minutes: number;
    avg_call_duration_minutes: number;
    unique_external_participants: number;
    avg_external_per_call: number;
    avg_talk_ratio_rep: number;
    avg_talk_ratio_buyer: number;
    avg_questions_per_call: number;
    avg_action_items_per_call: number;
    first_call_date: string;
    last_call_date: string;
  }>(
    `WITH deal_convs AS (
      SELECT
        c.deal_id,
        c.id as conv_id,
        c.call_date,
        c.duration_seconds,
        c.call_metrics,
        c.action_items,
        c.resolved_participants
      FROM conversations c
      WHERE c.deal_id = ANY($1::uuid[])
        AND c.workspace_id = $2
    ),
    external_participants AS (
      SELECT
        dc.deal_id,
        dc.conv_id,
        p->>'email' as email
      FROM deal_convs dc,
      LATERAL jsonb_array_elements(COALESCE(dc.resolved_participants, '[]'::jsonb)) p
      WHERE p->>'role' = 'external'
        AND (p->>'confidence')::numeric >= 0.7
    )
    SELECT
      dc.deal_id,
      COUNT(DISTINCT dc.conv_id)::integer as call_count,
      COALESCE(SUM(dc.duration_seconds) / 60.0, 0) as total_call_minutes,
      COALESCE(AVG(dc.duration_seconds) / 60.0, 0) as avg_call_duration_minutes,
      COUNT(DISTINCT ep.email)::integer as unique_external_participants,
      COALESCE(AVG(ep_per_call.ext_count), 0) as avg_external_per_call,
      AVG((dc.call_metrics->>'talk_ratio_rep')::numeric) as avg_talk_ratio_rep,
      AVG((dc.call_metrics->>'talk_ratio_buyer')::numeric) as avg_talk_ratio_buyer,
      AVG((dc.call_metrics->>'question_count')::numeric) as avg_questions_per_call,
      AVG(jsonb_array_length(COALESCE(dc.action_items, '[]'::jsonb))) as avg_action_items_per_call,
      MIN(dc.call_date) as first_call_date,
      MAX(dc.call_date) as last_call_date
    FROM deal_convs dc
    LEFT JOIN external_participants ep ON ep.deal_id = dc.deal_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer as ext_count
      FROM jsonb_array_elements(COALESCE(dc.resolved_participants, '[]'::jsonb)) p
      WHERE p->>'role' = 'external' AND (p->>'confidence')::numeric >= 0.7
    ) ep_per_call ON true
    GROUP BY dc.deal_id`,
    [dealIds, workspaceId]
  );

  // CRM metrics per deal
  const crmMetrics = await query<{
    deal_id: string;
    amount: number;
    outcome: 'won' | 'lost';
    sales_cycle_days: number;
    stage_regression_count: number;
    contact_count: number;
    created_at: string;
  }>(
    `SELECT
      d.id as deal_id,
      COALESCE(d.amount, 0) as amount,
      CASE WHEN d.stage_normalized = 'closed_won' THEN 'won' ELSE 'lost' END as outcome,
      EXTRACT(days FROM d.close_date::timestamp - d.created_at::timestamp)::integer as sales_cycle_days,
      COALESCE((
        SELECT COUNT(*)::integer
        FROM deal_stage_history dsh
        WHERE dsh.deal_id = d.id
          AND EXISTS (
            SELECT 1 FROM deal_stage_history prev
            WHERE prev.deal_id = d.id
              AND prev.stage_normalized = dsh.stage_normalized
              AND prev.entered_at < dsh.entered_at
              AND prev.exited_at IS NOT NULL
          )
      ), 0) as stage_regression_count,
      COALESCE((
        SELECT COUNT(*)::integer
        FROM deal_contacts dc
        WHERE dc.deal_id = d.id
      ), 0) as contact_count,
      d.created_at
     FROM deals d
     WHERE d.id = ANY($1::uuid[])`,
    [dealIds]
  );

  // Merge conversation and CRM metrics
  const convMap = new Map(convMetrics.rows.map(c => [c.deal_id, c]));
  const crmMap = new Map(crmMetrics.rows.map(c => [c.deal_id, c]));

  const combined: DealMetrics[] = [];
  for (const dealId of dealIds) {
    const conv = convMap.get(dealId);
    const crm = crmMap.get(dealId);
    if (!crm) continue;

    const firstCallDaysFromCreation = conv?.first_call_date && crm.created_at
      ? daysBetween(new Date(crm.created_at), new Date(conv.first_call_date))
      : null;

    const daysBetweenCallsAvg = conv?.call_count && conv.call_count > 1 && conv.first_call_date && conv.last_call_date
      ? daysBetween(new Date(conv.first_call_date), new Date(conv.last_call_date)) / (conv.call_count - 1)
      : null;

    combined.push({
      deal_id: dealId,
      amount: crm.amount,
      outcome: crm.outcome,
      call_count: conv?.call_count || 0,
      total_call_minutes: conv?.total_call_minutes || null,
      avg_call_duration_minutes: conv?.avg_call_duration_minutes || null,
      unique_external_participants: conv?.unique_external_participants || 0,
      avg_external_per_call: conv?.avg_external_per_call || null,
      avg_talk_ratio_rep: conv?.avg_talk_ratio_rep || null,
      avg_talk_ratio_buyer: conv?.avg_talk_ratio_buyer || null,
      avg_questions_per_call: conv?.avg_questions_per_call || null,
      avg_action_items_per_call: conv?.avg_action_items_per_call || null,
      first_call_days_from_creation: firstCallDaysFromCreation,
      days_between_calls_avg: daysBetweenCallsAvg,
      sales_cycle_days: crm.sales_cycle_days,
      stage_regression_count: crm.stage_regression_count,
      contact_count: crm.contact_count,
    });
  }

  return combined;
}

/**
 * Filter deals for a specific segment
 */
function filterDealsForSegment(metrics: DealMetrics[], segment: DealSegment): DealMetrics[] {
  return metrics.filter(d => {
    if (segment.size_band_min != null && d.amount < segment.size_band_min) return false;
    if (segment.size_band_max != null && d.amount > segment.size_band_max) return false;
    // Pipeline filtering not implemented yet (would need pipeline field in metrics)
    return true;
  });
}

/**
 * Get list of dimensions to test
 */
function getDimensionsToTest(): string[] {
  return [
    'call_count',
    'unique_external_participants',
    'avg_external_per_call',
    'total_call_minutes',
    'avg_call_duration_minutes',
    'avg_talk_ratio_rep',
    'avg_talk_ratio_buyer',
    'avg_questions_per_call',
    'avg_action_items_per_call',
    'first_call_days_from_creation',
    'days_between_calls_avg',
    'sales_cycle_days',
    'stage_regression_count',
    'contact_count',
  ];
}

/**
 * Compute statistical separation between won and lost distributions
 */
function computeSeparation(
  wonValues: number[],
  lostValues: number[]
): { score: number; direction: 'higher_wins' | 'lower_wins' } | null {
  // Need minimum 5 non-null values in each group
  if (wonValues.length < 5 || lostValues.length < 5) return null;

  const wonMedian = median(wonValues);
  const lostMedian = median(lostValues);

  // Compute effect size using IQR
  const wonIQR = percentile(wonValues, 75) - percentile(wonValues, 25);
  const lostIQR = percentile(lostValues, 75) - percentile(lostValues, 25);
  const pooledSpread = (wonIQR + lostIQR) / 2;

  if (pooledSpread === 0) return null; // No variance

  const effectSize = Math.abs(wonMedian - lostMedian) / pooledSpread;

  // Normalize to 0-1 score
  const score = effectSize / (effectSize + 1);

  // Minimum separation threshold: 0.3
  if (score < 0.3) return null;

  return {
    score: Math.round(score * 100) / 100,
    direction: wonMedian > lostMedian ? 'higher_wins' : 'lower_wins',
  };
}

/**
 * Store discovered patterns, superseding old ones
 */
async function storePatterns(workspaceId: string, patterns: WinPattern[]): Promise<void> {
  if (patterns.length === 0) {
    console.log('[Coaching] No patterns to store');
    return;
  }

  // Supersede all previous patterns for this workspace
  await query(
    `UPDATE win_patterns
     SET superseded_at = NOW()
     WHERE workspace_id = $1 AND superseded_at IS NULL`,
    [workspaceId]
  );

  // Insert new patterns
  for (const p of patterns) {
    await query(
      `INSERT INTO win_patterns (
        workspace_id, dimension,
        segment_size_min, segment_size_max, segment_pipeline,
        won_median, won_p25, won_p75,
        lost_median, lost_p25, lost_p75,
        separation_score, direction,
        sample_size_won, sample_size_lost,
        relevant_stages
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        workspaceId, p.dimension,
        p.segment.size_band_min, p.segment.size_band_max, p.segment.pipeline,
        p.won_median, p.won_p25, p.won_p75,
        p.lost_median, p.lost_p25, p.lost_p75,
        p.separation_score, p.direction,
        p.sample_size_won, p.sample_size_lost,
        p.relevant_stages,
      ]
    );
  }

  console.log(`[Coaching] Stored ${patterns.length} patterns`);
}

// Helper functions

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

function median(values: number[]): number {
  return percentile(values, 50);
}

function daysBetween(date1: Date, date2: Date): number {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
