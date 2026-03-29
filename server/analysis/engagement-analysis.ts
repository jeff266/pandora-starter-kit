/**
 * Engagement Drop-Off Analysis
 *
 * Analyzes closed deals to find stage-specific engagement thresholds.
 * Bifurcates by outcome (won vs lost) to detect the silence point that
 * correlates with losses.
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
 * Analyze historical engagement thresholds from closed deals.
 *
 * Uses corrected column names:
 * - conversations.call_date (not started_at)
 * - conversations.resolved_participants (not participants)
 * - activities.timestamp (not occurred_at)
 * - stage_normalized IN ('closed_won', 'closed_lost') for outcome
 */
export async function analyzeEngagementThresholds(
  workspaceId: string,
  lookbackMonths: number = 18,
  minDealsPerCell: number = 5
): Promise<ThresholdAnalysisResult> {
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - lookbackMonths);

  // Check if activity_signals has sufficient data
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
  const useEmailTrack = signalCount >= 100; // Threshold for email track inclusion

  const dataSources: string[] = ['call_engagement'];
  if (useEmailTrack) {
    dataSources.push('email_engagement');
  }

  // Build two-way engagement CTE with workspace-specific tracks
  let twoWayTouchesCTE = `
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
    twoWayTouchesCTE += `
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

  twoWayTouchesCTE += `
    ),
    last_two_way AS (
      SELECT deal_id, MAX(touch_at) as last_two_way_at
      FROM two_way_touches
      GROUP BY deal_id
    ),
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
        EXTRACT(EPOCH FROM (d.close_date - lt.last_two_way_at)) / 86400
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

  const result = await query(twoWayTouchesCTE, [
    workspaceId,
    lookbackDate.toISOString(),
    minDealsPerCell,
  ]);

  // Group by stage and compute thresholds
  const stageData: Record<string, { won?: any; lost?: any }> = {};

  for (const row of result.rows) {
    const stage = row.stage;
    if (!stageData[stage]) {
      stageData[stage] = {};
    }

    if (row.outcome === 'won') {
      stageData[stage].won = row;
    } else if (row.outcome === 'lost') {
      stageData[stage].lost = row;
    }
  }

  // Compute thresholds for stages with both won and lost data
  const stages: Record<string, EngagementThreshold> = {};
  let totalClosedDeals = 0;

  for (const [stage, data] of Object.entries(stageData)) {
    if (data.won && data.lost) {
      const wonMedian = parseFloat(data.won.median_silence_days);
      const lostMedian = parseFloat(data.lost.median_silence_days);
      const wonCount = parseInt(data.won.deal_count, 10);
      const lostCount = parseInt(data.lost.deal_count, 10);

      totalClosedDeals += wonCount + lostCount;

      const thresholdDays = Math.round(lostMedian);
      const warningDays = Math.round(lostMedian * 0.75);

      // Determine confidence based on sample size
      let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      if (wonCount >= 10 && lostCount >= 10) {
        confidence = 'HIGH';
      } else if (wonCount >= 5 && lostCount >= 5) {
        confidence = 'MEDIUM';
      } else {
        confidence = 'LOW';
      }

      // Cap confidence at MEDIUM if email track unavailable
      if (!useEmailTrack && confidence === 'HIGH') {
        confidence = 'MEDIUM';
      }

      stages[stage] = {
        stage,
        won_median_days: Math.round(wonMedian),
        lost_median_days: Math.round(lostMedian),
        threshold_days: thresholdDays,
        warning_days: warningDays,
        won_deal_count: wonCount,
        lost_deal_count: lostCount,
        confidence,
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
 */
export async function computeOpenDealRisk(
  workspaceId: string,
  thresholds: Record<string, EngagementThreshold>,
  maxCriticalDeals: number = 20
): Promise<OpenDealRiskResult> {
  // Check signal availability
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
  const useEmailTrack = signalCount >= 100;

  // Build two-way engagement CTE for open deals
  let twoWayTouchesCTE = `
    WITH two_way_touches AS (
      SELECT c.deal_id, MAX(c.call_date) as touch_at
      FROM conversations c
      WHERE c.workspace_id = $1
        AND c.deal_id IS NOT NULL
        AND c.resolved_participants @> '[{"role":"external"}]'
      GROUP BY c.deal_id
  `;

  if (useEmailTrack) {
    twoWayTouchesCTE += `
      UNION ALL

      SELECT a.deal_id, MAX(a.timestamp) as touch_at
      FROM activities a
      WHERE a.workspace_id = $1
        AND a.deal_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM activity_signals s
          WHERE s.activity_id = a.id AND s.speaker_type = 'prospect'
        )
      GROUP BY a.deal_id
    `;
  }

  twoWayTouchesCTE += `
    ),
    last_two_way AS (
      SELECT deal_id, MAX(touch_at) as last_two_way_at
      FROM two_way_touches
      GROUP BY deal_id
    ),
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

  const result = await query(twoWayTouchesCTE, [workspaceId]);

  const critical: DealAtRisk[] = [];
  const warning: DealAtRisk[] = [];
  let noSignalCount = 0;
  let noSignalValue = 0;
  let healthyCount = 0;
  let healthyValue = 0;

  for (const row of result.rows) {
    const stage = row.stage;
    const threshold = thresholds[stage];

    // No engagement signal
    if (row.days_since_two_way === null) {
      noSignalCount++;
      noSignalValue += parseFloat(row.amount || '0');
      continue;
    }

    // No threshold for this stage
    if (!threshold) {
      healthyCount++;
      healthyValue += parseFloat(row.amount || '0');
      continue;
    }

    const daysSinceEngagement = parseFloat(row.days_since_two_way);

    // Critical: past threshold
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
    }
    // Warning: approaching threshold
    else if (daysSinceEngagement >= threshold.warning_days) {
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
    }
    // Healthy
    else {
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
    const questionId = `stale_threshold_${stage.toLowerCase().replace(/\s+/g, '_')}`;

    // Map confidence level to numeric score
    const confidenceScore =
      threshold.confidence === 'HIGH' ? 0.9 : threshold.confidence === 'MEDIUM' ? 0.7 : 0.5;

    const answer = {
      stage: stage,
      threshold_days: threshold.threshold_days,
      warning_days: threshold.warning_days,
      based_on_deals: threshold.won_deal_count + threshold.lost_deal_count,
    };

    await query(
      `INSERT INTO calibration_checklist
        (workspace_id, question_id, domain, question, status, answer, answer_source, confidence, updated_at, created_at)
       VALUES ($1, $2, 'pipeline', $3, 'INFERRED', $4, 'COMPUTED', $5, NOW(), NOW())
       ON CONFLICT (workspace_id, question_id)
       DO UPDATE SET
         answer = EXCLUDED.answer,
         status = 'INFERRED',
         answer_source = 'COMPUTED',
         confidence = EXCLUDED.confidence,
         updated_at = NOW()`,
      [
        workspaceId,
        questionId,
        `Engagement threshold for ${stage}`,
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
