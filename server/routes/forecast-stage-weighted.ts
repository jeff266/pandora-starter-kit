import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { WorkspaceConfigLoader } from '../config/workspace-config-loader.js';

const router = Router();
const configLoader = new WorkspaceConfigLoader();

interface WorkspaceParams {
  id: string;
}

interface StageWeightedSeriesQuery {
  quarter: string;  // e.g., "2026-Q1"
  pipeline?: string;
}

interface WeekSeriesPoint {
  weekEnding: string;
  weekLabel: string;
  stageWeighted: number;
  closedWon: number;
  isLive: boolean;
  isFuture: boolean;
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

// Parse quarter string to start/end dates
function parseQuarter(quarterStr: string): { start: Date; end: Date } {
  const [yearStr, quarterNum] = quarterStr.split('-Q');
  const year = parseInt(yearStr);
  const quarter = parseInt(quarterNum);

  if (!year || !quarter || quarter < 1 || quarter > 4) {
    throw new Error('Invalid quarter format. Expected: YYYY-Q[1-4]');
  }

  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);  // Last day of quarter

  return { start, end };
}

// Generate 13 week-ending dates for a quarter
function generateQuarterWeeks(quarterStart: Date, quarterEnd: Date): Date[] {
  const weeks: Date[] = [];
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  // Find the first Saturday after quarter start
  let current = new Date(quarterStart);
  while (current.getDay() !== 6) {  // 6 = Saturday
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }

  // Add up to 13 weeks
  for (let i = 0; i < 13; i++) {
    if (current > quarterEnd) break;
    weeks.push(new Date(current));
    current = new Date(current.getTime() + oneWeek);
  }

  return weeks;
}

// Format week label (e.g., "1/4" for Jan 4)
function formatWeekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Check if a date is the current week
function isCurrentWeek(weekEnd: Date): boolean {
  const now = new Date();
  const weekStart = new Date(weekEnd.getTime() - 6 * 24 * 60 * 60 * 1000);
  return now >= weekStart && now <= weekEnd;
}

// Get stage probabilities from workspace config
async function getStageProbabilities(workspaceId: string): Promise<Record<string, number>> {
  const config = await configLoader.getConfig(workspaceId);

  // Try pipeline config first
  if (config?.pipelines?.[0]?.stage_probabilities) {
    return config.pipelines[0].stage_probabilities;
  }

  // Fallback to defaults
  return {
    'awareness': 0.05,
    'qualification': 0.10,
    'discovery': 0.20,
    'evaluation': 0.30,
    'demo': 0.40,
    'proposal': 0.50,
    'negotiation': 0.70,
    'contract_sent': 0.80,
    'closed_won': 1.00,
    'closed_lost': 0.00,
  };
}

// Reconstruct deal state at a specific point in time
function reconstructDealState(
  deal: DealSnapshot,
  transitions: StageTransition[],
  weekEndDate: Date
): { stage: string; wasClosedWon: boolean } {
  // Filter transitions for this deal that happened before weekEnd
  const applicableTransitions = transitions.filter(
    t => t.deal_id === deal.id && t.entered_at <= weekEndDate
  );

  if (applicableTransitions.length === 0) {
    // No history → use current stage
    return {
      stage: deal.stage_normalized,
      wasClosedWon: deal.stage_normalized === 'closed_won'
    };
  }

  // Most recent transition before weekEnd
  const lastTransition = applicableTransitions[applicableTransitions.length - 1];
  return {
    stage: lastTransition.stage_normalized,
    wasClosedWon: lastTransition.stage_normalized === 'closed_won'
  };
}

// Main endpoint
router.get('/:id/forecast/stage-weighted-series', async (
  req: Request<WorkspaceParams, any, any, StageWeightedSeriesQuery>,
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

    // Generate 13 week-ending dates
    const weekEndings = generateQuarterWeeks(quarterStart, quarterEnd);

    // Query 1: Get all deals with close_date in this quarter
    const pipelineFilter = pipeline ? `AND pipeline = $4` : '';
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
      // No deals in quarter
      const series = weekEndings.map(weekEnd => ({
        weekEnding: weekEnd.toISOString(),
        weekLabel: formatWeekLabel(weekEnd),
        stageWeighted: 0,
        closedWon: 0,
        isLive: isCurrentWeek(weekEnd),
        isFuture: weekEnd > new Date(),
      }));

      res.json({
        series,
        metadata: {
          quarterStart: quarterStart.toISOString(),
          quarterEnd: quarterEnd.toISOString(),
          totalWeeks: weekEndings.length,
          stageHistoryAvailable: false,
          dealCount: 0,
        },
      });
      return;
    }

    // Query 2: Get ALL stage transitions for these deals
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

    // Check if stage history is available
    const stageHistoryAvailable = allTransitions.length > 0;

    // Get stage probabilities
    const stageProbabilities = await getStageProbabilities(workspaceId);

    // Build series for each week
    const series: WeekSeriesPoint[] = [];
    const now = new Date();

    for (const weekEnd of weekEndings) {
      let closedWon = 0;
      let weightedPipeline = 0;

      for (const deal of deals) {
        // Skip deals that didn't exist yet at this point
        if (deal.created_at > weekEnd) continue;

        const state = reconstructDealState(deal, allTransitions, weekEnd);
        const amt = parseFloat(deal.amount as any) || 0;

        // Check if deal was closed-won by this week
        if (state.wasClosedWon && deal.close_date <= weekEnd) {
          closedWon += amt;
        } else {
          // Open deal → weight by stage probability
          const probability = stageProbabilities[state.stage] ?? 0.30;
          weightedPipeline += amt * probability;
        }
      }

      series.push({
        weekEnding: weekEnd.toISOString(),
        weekLabel: formatWeekLabel(weekEnd),
        stageWeighted: closedWon + weightedPipeline,
        closedWon,
        isLive: isCurrentWeek(weekEnd),
        isFuture: weekEnd > now,
      });
    }

    // Graceful degradation if no stage history
    if (!stageHistoryAvailable) {
      // Return null for past weeks, keep current week only
      const degradedSeries = series.map(week => ({
        ...week,
        stageWeighted: week.isLive ? week.stageWeighted : null
      }));

      res.json({
        series: degradedSeries,
        metadata: {
          quarterStart: quarterStart.toISOString(),
          quarterEnd: quarterEnd.toISOString(),
          totalWeeks: weekEndings.length,
          stageHistoryAvailable: false,
          dealCount: deals.length,
        },
      });
      return;
    }

    // Return full series
    res.json({
      series,
      metadata: {
        quarterStart: quarterStart.toISOString(),
        quarterEnd: quarterEnd.toISOString(),
        totalWeeks: weekEndings.length,
        stageHistoryAvailable: true,
        dealCount: deals.length,
      },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stage-Weighted Series] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
