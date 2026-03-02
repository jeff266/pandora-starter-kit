import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

interface WorkspaceParams {
  id: string;
}

interface TTESeriesQuery {
  quarter: string;
  pipeline?: string;
}

interface WeekSeriesPoint {
  weekEnding: string;
  weekLabel: string;
  tteForecast: number;
  closedWon: number;
  isLive: boolean;
  isFuture: boolean;
}

interface StageParams {
  winRate: number;
  avgDaysToClose: number;
  medianDaysToClose: number;
  sampleSize: number;
}

interface DealSnapshot {
  id: string;
  amount: number;
  stage_normalized: string;
  close_date: Date;
  created_at: Date;
}

interface StageTransition {
  deal_id: string;
  stage_normalized: string;
  entered_at: Date;
}

// Parse quarter string
function parseQuarter(quarterStr: string): { start: Date; end: Date } {
  const [yearStr, quarterNum] = quarterStr.split('-Q');
  const year = parseInt(yearStr);
  const quarter = parseInt(quarterNum);

  if (!year || !quarter || quarter < 1 || quarter > 4) {
    throw new Error('Invalid quarter format. Expected: YYYY-Q[1-4]');
  }

  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);

  return { start, end };
}

// Generate quarter weeks
function generateQuarterWeeks(quarterStart: Date, quarterEnd: Date): Date[] {
  const weeks: Date[] = [];
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  let current = new Date(quarterStart);
  while (current.getDay() !== 6) {
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }

  for (let i = 0; i < 13; i++) {
    if (current > quarterEnd) break;
    weeks.push(new Date(current));
    current = new Date(current.getTime() + oneWeek);
  }

  return weeks;
}

// Format week label
function formatWeekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Check if current week
function isCurrentWeek(weekEnd: Date): boolean {
  const now = new Date();
  const weekStart = new Date(weekEnd.getTime() - 6 * 24 * 60 * 60 * 1000);
  return now >= weekStart && now <= weekEnd;
}

// Days between dates
function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

// Fit historical conversion parameters
async function fitStageParameters(workspaceId: string): Promise<{
  params: Record<string, StageParams>;
  closedDealsCount: number;
}> {
  // Query 1: Stage-specific win rates
  const winRateResult = await query(
    `WITH closed_deals AS (
      SELECT d.id, d.stage_normalized
      FROM deals d
      WHERE d.workspace_id = $1
        AND (d.stage_normalized = 'closed_won' OR d.stage_normalized = 'closed_lost')
        AND d.close_date > NOW() - INTERVAL '24 months'
    )
    SELECT
      dsh.stage_normalized as stage,
      COUNT(*) FILTER (WHERE cd.stage_normalized = 'closed_won') AS wins,
      COUNT(*) AS total_closed
    FROM deal_stage_history dsh
    JOIN closed_deals cd ON dsh.deal_id = cd.id
    WHERE dsh.workspace_id = $1
    GROUP BY dsh.stage_normalized`,
    [workspaceId]
  );

  // Query 2: Average days from each stage to close-won
  const velocityResult = await query(
    `WITH stage_entries AS (
      SELECT
        dsh.stage_normalized as stage,
        dsh.deal_id,
        dsh.entered_at as stage_entered_at,
        d.close_date
      FROM deal_stage_history dsh
      JOIN deals d ON dsh.deal_id = d.id
      WHERE d.workspace_id = $1
        AND d.stage_normalized = 'closed_won'
        AND d.close_date > NOW() - INTERVAL '24 months'
    )
    SELECT
      stage,
      AVG(EXTRACT(EPOCH FROM (close_date - stage_entered_at)) / 86400) as avg_days,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (close_date - stage_entered_at)) / 86400) as median_days,
      COUNT(*) as sample_size
    FROM stage_entries
    WHERE close_date > stage_entered_at
    GROUP BY stage`,
    [workspaceId]
  );

  const stageParams: Record<string, StageParams> = {};
  let totalClosedDeals = 0;

  // Build win rate parameters with Laplace smoothing
  for (const row of winRateResult.rows) {
    const wins = parseInt(row.wins) || 0;
    const total = parseInt(row.total_closed) || 0;
    totalClosedDeals = Math.max(totalClosedDeals, total);

    // Laplace smoothing: (wins + 1) / (total + 2)
    const winRate = (wins + 1) / (total + 2);

    stageParams[row.stage] = {
      winRate,
      avgDaysToClose: 0,
      medianDaysToClose: 0,
      sampleSize: total,
    };
  }

  // Add velocity parameters
  for (const row of velocityResult.rows) {
    if (stageParams[row.stage]) {
      stageParams[row.stage].avgDaysToClose = parseFloat(row.avg_days) || 0;
      stageParams[row.stage].medianDaysToClose = parseFloat(row.median_days) || 0;
    }
  }

  return { params: stageParams, closedDealsCount: totalClosedDeals };
}

// Compute TTE probability for a single deal
function computeDealTTE(
  deal: { amount: number; stageAtPoint: string; daysInStage: number },
  stageParams: Record<string, StageParams>,
  daysRemainingInQuarter: number
): number {
  const params = stageParams[deal.stageAtPoint];
  if (!params) return 0;  // Unknown stage → assume won't close

  const baseWinRate = params.winRate;

  // Time decay adjustment
  const expectedDaysToClose = Math.max(0, params.medianDaysToClose - deal.daysInStage);

  let timeAdjustment: number;
  if (expectedDaysToClose <= 0) {
    // Deal has been in stage longer than typical → overdue
    timeAdjustment = 0.7;
  } else if (expectedDaysToClose <= daysRemainingInQuarter) {
    // Expected to close within quarter → full probability
    timeAdjustment = 1.0;
  } else {
    // Partial probability based on time remaining
    timeAdjustment = Math.min(1.0, daysRemainingInQuarter / expectedDaysToClose);
  }

  return deal.amount * baseWinRate * timeAdjustment;
}

// Reconstruct deal state at a point in time
function reconstructDealState(
  deal: DealSnapshot,
  transitions: StageTransition[],
  weekEndDate: Date
): { stage: string; stageEnteredAt: Date; wasClosedWon: boolean } {
  const applicableTransitions = transitions.filter(
    t => t.deal_id === deal.id && t.entered_at <= weekEndDate
  );

  if (applicableTransitions.length === 0) {
    return {
      stage: deal.stage_normalized,
      stageEnteredAt: deal.created_at,
      wasClosedWon: deal.stage_normalized === 'closed_won'
    };
  }

  const lastTransition = applicableTransitions[applicableTransitions.length - 1];
  return {
    stage: lastTransition.stage_normalized,
    stageEnteredAt: lastTransition.entered_at,
    wasClosedWon: lastTransition.stage_normalized === 'closed_won'
  };
}

// Main endpoint
router.get('/:id/forecast/tte-series', async (
  req: Request<WorkspaceParams, any, any, TTESeriesQuery>,
  res: Response
) => {
  try {
    const workspaceId = req.params.id;
    const { quarter, pipeline } = req.query;

    if (!quarter) {
      res.status(400).json({ error: 'quarter parameter required (e.g., "2026-Q1")' });
      return;
    }

    // Parse quarter
    const { start: quarterStart, end: quarterEnd } = parseQuarter(quarter);

    // Generate weeks
    const weekEndings = generateQuarterWeeks(quarterStart, quarterEnd);

    // Fit historical conversion parameters
    const { params: stageParams, closedDealsCount } = await fitStageParameters(workspaceId);

    const isReliable = closedDealsCount >= 20;

    // Query deals in quarter
    const pipelineFilter = pipeline ? `AND scope_id = $4` : '';
    const dealsParams = pipeline ? [workspaceId, quarterStart, quarterEnd, pipeline] : [workspaceId, quarterStart, quarterEnd];

    const dealsResult = await query<DealSnapshot>(
      `SELECT id, amount, stage_normalized, close_date, created_at
       FROM deals
       WHERE workspace_id = $1
         AND close_date >= $2 AND close_date <= $3
         ${pipelineFilter}
       ORDER BY id`,
      dealsParams
    );

    const deals = dealsResult.rows;

    if (deals.length === 0) {
      const series = weekEndings.map(weekEnd => ({
        weekEnding: weekEnd.toISOString(),
        weekLabel: formatWeekLabel(weekEnd),
        tteForecast: 0,
        closedWon: 0,
        isLive: isCurrentWeek(weekEnd),
        isFuture: weekEnd > new Date(),
      }));

      res.json({
        series,
        metadata: {
          quarterStart: quarterStart.toISOString(),
          quarterEnd: quarterEnd.toISOString(),
          closedDealsUsedForFitting: closedDealsCount,
          stageConversionRates: stageParams,
          isReliable,
        },
      });
      return;
    }

    // Query stage transitions
    const dealIds = deals.map(d => d.id);
    const transitionsResult = await query<StageTransition>(
      `SELECT deal_id, stage_normalized, entered_at
       FROM deal_stage_history
       WHERE workspace_id = $1
         AND deal_id = ANY($2)
       ORDER BY deal_id, entered_at`,
      [workspaceId, dealIds]
    );

    const allTransitions = transitionsResult.rows;

    // Build series
    const series: WeekSeriesPoint[] = [];
    const now = new Date();

    for (const weekEnd of weekEndings) {
      const daysRemaining = Math.max(0, daysBetween(weekEnd, quarterEnd));

      let closedWon = 0;
      let expectedFromPipeline = 0;

      for (const deal of deals) {
        if (deal.created_at > weekEnd) continue;

        const state = reconstructDealState(deal, allTransitions, weekEnd);
        const amt = parseFloat(deal.amount as any) || 0;

        if (state.wasClosedWon && deal.close_date <= weekEnd) {
          closedWon += amt;
        } else {
          const daysInStage = daysBetween(state.stageEnteredAt, weekEnd);
          expectedFromPipeline += computeDealTTE(
            {
              amount: amt,
              stageAtPoint: state.stage,
              daysInStage
            },
            stageParams,
            daysRemaining
          );
        }
      }

      series.push({
        weekEnding: weekEnd.toISOString(),
        weekLabel: formatWeekLabel(weekEnd),
        tteForecast: closedWon + expectedFromPipeline,
        closedWon,
        isLive: isCurrentWeek(weekEnd),
        isFuture: weekEnd > now,
      });
    }

    res.json({
      series,
      metadata: {
        quarterStart: quarterStart.toISOString(),
        quarterEnd: quarterEnd.toISOString(),
        closedDealsUsedForFitting: closedDealsCount,
        stageConversionRates: stageParams,
        isReliable,
      },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[TTE Series] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
