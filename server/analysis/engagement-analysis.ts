/**
 * Engagement Drop-Off Analysis
 *
 * Analyzes closed deals to find stage-specific engagement thresholds.
 * Bifurcates by outcome (won vs lost) to detect the silence point that
 * correlates with losses.
 *
 * Stage grouping strategy:
 * - First attempt: group by raw d.stage name (works when multiple pipeline stages
 *   appear as the closing stage, e.g. won at "Proposal" and lost at "Proposal").
 * - Fallback: when all won deals are in "Closed Won" and all lost are in "Closed Lost"
 *   (the common case), compute a single GLOBAL threshold comparing all won vs all lost
 *   silence durations. Stored as stages['global'].
 */

import { query } from '../db.js';
import { invalidateWorkspaceIntelligence } from '../lib/workspace-intelligence.js';

interface EngagementThreshold {
  stage: string;
  won_median_days: number;
  lost_median_days: number;
  threshold_days: number;
  warning_days: number;
  won_deal_count: number;
  lost_deal_count: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface ThresholdAnalysisResult {
  stages: Record<string, EngagementThreshold>;
  total_closed_deals_analyzed: number;
  date_range_months: number;
  data_sources: string[];
}

interface DealAtRisk {
  deal_id: string;
  name: string;
  stage: string;
  amount: number;
  owner: string | null;
  days_since_two_way: number;
  threshold_days: number;
  close_date: string | null;
}

interface OpenDealRiskResult {
  critical: DealAtRisk[];
  warning: DealAtRisk[];
  no_signal: { count: number; total_value: number };
  healthy: { count: number; total_value: number };
  summary: {
    critical_count: number;
    critical_value: number;
    warning_count: number;
    warning_value: number;
    pct_pipeline_at_risk: number;
  };
}

/**
 * Build the two-way touches CTE fragment (shared between analysis and risk queries).
 */
function buildTwoWayCTE(useEmailTrack: boolean): string {
  let cte = `
    WITH two_way_touches AS (
      -- Call-based engagement (conversations with external participants)
      SELECT c.deal_id, MAX(c.call_date) as touch_at, 'call' as touch_type
      FROM conversations c
      WHERE c.workspace_id = $1
        AND c.deal_id IS NOT NULL
        AND c.resolved_participants @> '[{"role":"external"}]'
      GROUP BY c.deal_id
  `;

  if (useEmailTrack) {
    cte += `
      UNION ALL

      -- Email-based engagement (activities with prospect signals)
      SELECT a.deal_id, MAX(a.timestamp) as touch_at, 'email' as touch_type
      FROM activities a
      WHERE a.workspace_id = $1
        AND a.deal_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM activity_signals s
          WHERE s.activity_id = a.id
            AND s.speaker_type = 'prospect'
        )
      GROUP BY a.deal_id
    `;
  }

  cte += `
    ),
    last_two_way AS (
      SELECT deal_id, MAX(touch_at) as last_two_way_at
      FROM two_way_touches
      GROUP BY deal_id
    )
  `;

  return cte;
}

/**
 * Check if activity_signals has sufficient data for email track inclusion.
 */
async function checkEmailTrackAvailability(workspaceId: string): Promise<boolean> {
  const signalCountResult = await query(
    `SELECT COUNT(*) as signal_count
     FROM activity_signals asig
     WHERE asig.activity_id IN (
       SELECT id FROM activities WHERE workspace_id = $1
     )
     AND asig.speaker_type IN ('prospect', 'rep')`,
    [workspaceId]
  );
  const signalCount = parseInt(signalCountResult.rows[0]?.signal_count || '0', 10);
  return signalCount >= 100;
}

/**
 * Compute confidence level based on sample sizes.
 */
function computeConfidence(
  wonCount: number,
  lostCount: number,
  useEmailTrack: boolean
): 'HIGH' | 'MEDIUM' | 'LOW' {
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (wonCount >= 10 && lostCount >= 10) {
    confidence = 'HIGH';
  } else if (wonCount >= 5 && lostCount >= 5) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }
  // Cap at MEDIUM when email track is unavailable (call-only data is less complete)
  if (!useEmailTrack && confidence === 'HIGH') {
    confidence = 'MEDIUM';
  }
  return confidence;
}

/**
 * Analyze historical engagement thresholds from closed deals.
 *
 * Uses corrected column names:
 * - conversations.call_date (not started_at)
 * - conversations.resolved_participants with role:'external' (not participants.affiliation)
 * - activities.timestamp (not occurred_at)
 * - stage_normalized IN ('closed_won', 'closed_lost') for outcome
 *
 * Stage grouping:
 * - Primary: group by raw d.stage (works for workspaces where deals close at various stages)
 * - Fallback global: when raw stage grouping yields no won/lost overlap (because all
 *   won deals have stage='Closed Won' and all lost have stage='Closed Lost'), compute
 *   one global threshold comparing ALL won vs ALL lost silence durations.
 *   Stored under the key 'global' in the returned stages map.
 */
export async function analyzeEngagementThresholds(
  workspaceId: string,
  lookbackMonths: number = 18,
  minDealsPerCell: number = 5
): Promise<ThresholdAnalysisResult> {
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - lookbackMonths);

  const useEmailTrack = await checkEmailTrackAvailability(workspaceId);
  const dataSources: string[] = ['call_engagement'];
  if (useEmailTrack) dataSources.push('email_engagement');

  const cteBase = buildTwoWayCTE(useEmailTrack);

  // ── Primary: per-raw-stage analysis ──────────────────────────────────────
  const stageQuery = cteBase + `,
    closed_deals AS (
      SELECT
        d.id,
        d.stage,
        d.stage_normalized,
        d.amount,
        d.close_date,
        CASE
          WHEN d.stage_normalized = 'closed_won' THEN 'won'
          WHEN d.stage_normalized = 'closed_lost' THEN 'lost'
          ELSE NULL
        END as outcome,
        lt.last_two_way_at,
        EXTRACT(EPOCH FROM (d.close_date::timestamp - lt.last_two_way_at)) / 86400
          AS days_silence_before_close
      FROM deals d
      LEFT JOIN last_two_way lt ON lt.deal_id = d.id
      WHERE d.workspace_id = $1
        AND d.stage_normalized IN ('closed_won', 'closed_lost')
        AND d.close_date >= $2
        AND lt.last_two_way_at IS NOT NULL
    )
    SELECT
      stage,
      outcome,
      COUNT(*) as deal_count,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_silence_before_close)
        AS median_silence_days,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY days_silence_before_close)
        AS p25_silence_days,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_silence_before_close)
        AS p75_silence_days,
      AVG(amount) AS avg_deal_size
    FROM closed_deals
    WHERE outcome IS NOT NULL
    GROUP BY stage, outcome
    HAVING COUNT(*) >= $3
    ORDER BY stage, outcome
  `;

  const stageResult = await query(stageQuery, [
    workspaceId,
    lookbackDate.toISOString(),
    minDealsPerCell,
  ]);

  // Group by stage and find buckets with both won + lost
  const stageData: Record<string, { won?: any; lost?: any }> = {};
  for (const row of stageResult.rows) {
    if (!stageData[row.stage]) stageData[row.stage] = {};
    if (row.outcome === 'won') stageData[row.stage].won = row;
    else if (row.outcome === 'lost') stageData[row.stage].lost = row;
  }

  const stages: Record<string, EngagementThreshold> = {};
  let totalClosedDeals = 0;

  for (const [stage, data] of Object.entries(stageData)) {
    if (data.won && data.lost) {
      const wonMedian = parseFloat(data.won.median_silence_days);
      const lostMedian = parseFloat(data.lost.median_silence_days);
      const wonCount = parseInt(data.won.deal_count, 10);
      const lostCount = parseInt(data.lost.deal_count, 10);

      totalClosedDeals += wonCount + lostCount;

      stages[stage] = {
        stage,
        won_median_days: Math.round(wonMedian),
        lost_median_days: Math.round(lostMedian),
        threshold_days: Math.round(lostMedian),
        warning_days: Math.round(lostMedian * 0.75),
        won_deal_count: wonCount,
        lost_deal_count: lostCount,
        confidence: computeConfidence(wonCount, lostCount, useEmailTrack),
      };
    }
  }

  // ── Fallback: global threshold when no stage-level won/lost overlap ──────
  // This happens when all won deals carry stage='Closed Won' and all lost
  // carry stage='Closed Lost' — the final CRM stage, not an intermediate stage.
  // In this case we compare ALL won silence vs ALL lost silence globally.
  if (Object.keys(stages).length === 0) {
    const globalQuery = cteBase + `,
      closed_deals AS (
        SELECT
          d.id,
          d.stage_normalized,
          d.amount,
          d.close_date,
          CASE
            WHEN d.stage_normalized = 'closed_won' THEN 'won'
            WHEN d.stage_normalized = 'closed_lost' THEN 'lost'
            ELSE NULL
          END as outcome,
          EXTRACT(EPOCH FROM (d.close_date::timestamp - lt.last_two_way_at)) / 86400
            AS days_silence_before_close
        FROM deals d
        LEFT JOIN last_two_way lt ON lt.deal_id = d.id
        WHERE d.workspace_id = $1
          AND d.stage_normalized IN ('closed_won', 'closed_lost')
          AND d.close_date >= $2
          AND lt.last_two_way_at IS NOT NULL
      )
      SELECT
        outcome,
        COUNT(*) as deal_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_silence_before_close)
          AS median_silence_days,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY days_silence_before_close)
          AS p25_silence_days,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_silence_before_close)
          AS p75_silence_days,
        AVG(amount) AS avg_deal_size
      FROM closed_deals
      WHERE outcome IS NOT NULL
        AND days_silence_before_close >= 0
      GROUP BY outcome
      HAVING COUNT(*) >= $3
      ORDER BY outcome
    `;

    const globalResult = await query(globalQuery, [
      workspaceId,
      lookbackDate.toISOString(),
      Math.max(3, Math.floor(minDealsPerCell / 2)),
    ]);

    const globalData: { won?: any; lost?: any } = {};
    for (const row of globalResult.rows) {
      if (row.outcome === 'won') globalData.won = row;
      else if (row.outcome === 'lost') globalData.lost = row;
    }

    if (globalData.won && globalData.lost) {
      const wonMedian = parseFloat(globalData.won.median_silence_days);
      const lostMedian = parseFloat(globalData.lost.median_silence_days);
      const wonCount = parseInt(globalData.won.deal_count, 10);
      const lostCount = parseInt(globalData.lost.deal_count, 10);

      totalClosedDeals = wonCount + lostCount;

      stages['global'] = {
        stage: 'global',
        won_median_days: Math.round(wonMedian),
        lost_median_days: Math.round(lostMedian),
        threshold_days: Math.round(lostMedian),
        warning_days: Math.round(lostMedian * 0.75),
        won_deal_count: wonCount,
        lost_deal_count: lostCount,
        confidence: computeConfidence(wonCount, lostCount, useEmailTrack),
      };
    }
  }

  return {
    stages,
    total_closed_deals_analyzed: totalClosedDeals,
    date_range_months: lookbackMonths,
    data_sources: dataSources,
  };
}

/**
 * Compute open deal risk against computed thresholds.
 *
 * Threshold lookup order:
 * 1. Exact match on deal's raw stage name (stage-specific threshold)
 * 2. 'global' key (fallback global threshold for all stages)
 * 3. No threshold → counted as healthy (no signal to assess)
 */
export async function computeOpenDealRisk(
  workspaceId: string,
  thresholds: Record<string, EngagementThreshold>,
  maxCriticalDeals: number = 20
): Promise<OpenDealRiskResult> {
  const useEmailTrack = await checkEmailTrackAvailability(workspaceId);
  const globalThreshold = thresholds['global'] ?? null;

  const cteBase = buildTwoWayCTE(useEmailTrack);

  const openQuery = cteBase + `,
    open_deals AS (
      SELECT
        d.id,
        d.name,
        d.stage,
        d.amount,
        d.owner,
        d.close_date,
        lt.last_two_way_at,
        CASE
          WHEN lt.last_two_way_at IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM (NOW() - lt.last_two_way_at)) / 86400
        END as days_since_two_way
      FROM deals d
      LEFT JOIN last_two_way lt ON lt.deal_id = d.id
      WHERE d.workspace_id = $1
        AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
    )
    SELECT * FROM open_deals
    ORDER BY amount DESC NULLS LAST
  `;

  const result = await query(openQuery, [workspaceId]);

  const critical: DealAtRisk[] = [];
  const warning: DealAtRisk[] = [];
  let noSignalCount = 0;
  let noSignalValue = 0;
  let healthyCount = 0;
  let healthyValue = 0;

  for (const row of result.rows) {
    // No engagement signal at all
    if (row.days_since_two_way === null) {
      noSignalCount++;
      noSignalValue += parseFloat(row.amount || '0');
      continue;
    }

    // Threshold lookup: stage-specific → global → none
    const threshold = thresholds[row.stage] ?? globalThreshold;

    if (!threshold) {
      healthyCount++;
      healthyValue += parseFloat(row.amount || '0');
      continue;
    }

    const daysSinceEngagement = parseFloat(row.days_since_two_way);

    if (daysSinceEngagement >= threshold.threshold_days) {
      if (critical.length < maxCriticalDeals) {
        critical.push({
          deal_id: row.id,
          name: row.name,
          stage: row.stage,
          amount: parseFloat(row.amount || '0'),
          owner: row.owner,
          days_since_two_way: Math.round(daysSinceEngagement),
          threshold_days: threshold.threshold_days,
          close_date: row.close_date,
        });
      }
    } else if (daysSinceEngagement >= threshold.warning_days) {
      warning.push({
        deal_id: row.id,
        name: row.name,
        stage: row.stage,
        amount: parseFloat(row.amount || '0'),
        owner: row.owner,
        days_since_two_way: Math.round(daysSinceEngagement),
        threshold_days: threshold.threshold_days,
        close_date: row.close_date,
      });
    } else {
      healthyCount++;
      healthyValue += parseFloat(row.amount || '0');
    }
  }

  const criticalValue = critical.reduce((sum, d) => sum + d.amount, 0);
  const warningValue = warning.reduce((sum, d) => sum + d.amount, 0);
  const totalPipeline = criticalValue + warningValue + healthyValue + noSignalValue;
  const atRiskValue = criticalValue + warningValue;
  const pctAtRisk = totalPipeline > 0 ? Math.round((atRiskValue / totalPipeline) * 100) : 0;

  return {
    critical,
    warning,
    no_signal: { count: noSignalCount, total_value: Math.round(noSignalValue) },
    healthy: { count: healthyCount, total_value: Math.round(healthyValue) },
    summary: {
      critical_count: critical.length,
      critical_value: Math.round(criticalValue),
      warning_count: warning.length,
      warning_value: Math.round(warningValue),
      pct_pipeline_at_risk: pctAtRisk,
    },
  };
}

/**
 * Write computed thresholds to calibration_checklist.
 *
 * This makes thresholds immediately available to other skills and agents
 * without waiting for the full skill to complete.
 */
export async function writeThresholdsToSystem(
  workspaceId: string,
  thresholds: Record<string, EngagementThreshold>
): Promise<{ written: number; stages: string[] }> {
  const stagesWritten: string[] = [];

  for (const [stage, threshold] of Object.entries(thresholds)) {
    const questionId = `stale_threshold_${stage.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

    const confidenceScore =
      threshold.confidence === 'HIGH' ? 0.9 : threshold.confidence === 'MEDIUM' ? 0.7 : 0.5;

    const answer = {
      stage,
      threshold_days: threshold.threshold_days,
      warning_days: threshold.warning_days,
      won_median_days: threshold.won_median_days,
      lost_median_days: threshold.lost_median_days,
      based_on_deals: threshold.won_deal_count + threshold.lost_deal_count,
      confidence: threshold.confidence,
    };

    await query(
      `INSERT INTO calibration_checklist
        (workspace_id, question_id, domain, question, status, answer, answer_source, confidence, updated_at, created_at)
       VALUES ($1, $2, 'pipeline', $3, 'INFERRED', $4, 'CRM_SCAN', $5, NOW(), NOW())
       ON CONFLICT (workspace_id, question_id)
       DO UPDATE SET
         answer = EXCLUDED.answer,
         status = 'INFERRED',
         answer_source = 'CRM_SCAN',
         confidence = EXCLUDED.confidence,
         updated_at = NOW()`,
      [
        workspaceId,
        questionId,
        `Engagement silence threshold for ${stage} (${threshold.threshold_days}d)`,
        JSON.stringify(answer),
        confidenceScore,
      ]
    );

    stagesWritten.push(stage);
  }

  // Invalidate WorkspaceIntelligence cache so thresholds are immediately available
  invalidateWorkspaceIntelligence(workspaceId);

  return {
    written: stagesWritten.length,
    stages: stagesWritten,
  };
}
