import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

interface WorkspaceParams {
  id: string;
}

interface CategoryWeightedSeriesQuery {
  quarter: string;
  pipeline?: string;
}

interface WeekSeriesPoint {
  weekEnding: string;
  weekLabel: string;
  categoryWeighted: number | null;
  closedWon: number;
  snapshotSource: 'skill_run' | 'live' | null;
}

interface ForecastSnapshot {
  completed_at: Date;
  team_forecast: any;
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
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);

  return { start, end };
}

// Generate 13 week-ending dates for a quarter
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

// Map snapshots to week endings
function mapSnapshotsToWeeks(
  snapshots: ForecastSnapshot[],
  quarterWeekEndings: Date[]
): Map<string, ForecastSnapshot> {
  const weekMap = new Map<string, ForecastSnapshot>();

  for (const snap of snapshots) {
    const snapDate = new Date(snap.completed_at);

    // Find which week this snapshot belongs to
    const weekEnd = quarterWeekEndings.find(week => {
      const weekStart = new Date(week.getTime() - 6 * 24 * 60 * 60 * 1000);
      return snapDate >= weekStart && snapDate <= week;
    });

    if (weekEnd) {
      const weekKey = weekEnd.toISOString();
      // If multiple snapshots in one week, keep the most recent
      const existing = weekMap.get(weekKey);
      if (!existing || snapDate > new Date(existing.completed_at)) {
        weekMap.set(weekKey, snap);
      }
    }
  }

  return weekMap;
}

// Compute category-weighted from snapshot
function computeCategoryWeighted(teamForecast: any): { categoryWeighted: number; closedWon: number } {
  const closedWon = teamForecast?.closed?.amount ?? 0;
  const commit = teamForecast?.commit?.amount ?? 0;
  const bestCase = teamForecast?.best_case?.amount ?? 0;
  const pipeline = teamForecast?.pipeline?.amount ?? 0;

  // Standard weighting formula
  const categoryWeighted = closedWon + commit + (bestCase * 0.5) + (pipeline * 0.2);

  return { categoryWeighted, closedWon };
}

// Compute live category-weighted from current deals
async function computeLiveCategoryWeighted(
  workspaceId: string,
  quarterEnd: Date
): Promise<{ categoryWeighted: number; closedWon: number }> {
  const result = await query(
    `SELECT
      forecast_category,
      COALESCE(SUM(amount), 0) AS total_amount
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_lost')
       AND close_date <= $2
     GROUP BY forecast_category`,
    [workspaceId, quarterEnd]
  );

  let closedWon = 0;
  let commit = 0;
  let bestCase = 0;
  let pipeline = 0;

  for (const row of result.rows) {
    const amount = parseFloat(row.total_amount) || 0;
    switch (row.forecast_category) {
      case 'closed':
      case 'closed_won':
        closedWon += amount;
        break;
      case 'commit':
        commit += amount;
        break;
      case 'best_case':
      case 'bestcase':
        bestCase += amount;
        break;
      case 'pipeline':
      case 'omitted':
      default:
        pipeline += amount;
        break;
    }
  }

  const categoryWeighted = closedWon + commit + (bestCase * 0.5) + (pipeline * 0.2);

  return { categoryWeighted, closedWon };
}

// Main endpoint
router.get('/:id/forecast/category-weighted-series', async (
  req: Request<WorkspaceParams, any, any, CategoryWeightedSeriesQuery>,
  res: Response
) => {
  try {
    const workspaceId = req.params.id;
    const { quarter } = req.query;

    if (!quarter) {
      res.status(400).json({ error: 'quarter parameter required (e.g., "2026-Q1")' });
      return;
    }

    // Parse quarter
    const { start: quarterStart, end: quarterEnd } = parseQuarter(quarter);

    // Generate 13 week-ending dates
    const weekEndings = generateQuarterWeeks(quarterStart, quarterEnd);

    // Load forecast-rollup snapshots
    const snapshotsResult = await query<ForecastSnapshot>(
      `SELECT
        completed_at,
        result->'step_results'->'forecast_data'->'team' as team_forecast
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'forecast-rollup'
         AND status = 'completed'
         AND completed_at >= $2
         AND completed_at <= $3
       ORDER BY completed_at`,
      [workspaceId, quarterStart, quarterEnd]
    );

    const snapshots = snapshotsResult.rows;

    // Map snapshots to weeks
    const weekSnapshotMap = mapSnapshotsToWeeks(snapshots, weekEndings);

    // Build series
    const series: WeekSeriesPoint[] = [];
    const now = new Date();

    for (const weekEnd of weekEndings) {
      const weekKey = weekEnd.toISOString();
      const snapshot = weekSnapshotMap.get(weekKey);

      const isCurrentWeek = now >= new Date(weekEnd.getTime() - 6 * 24 * 60 * 60 * 1000) && now <= weekEnd;

      if (isCurrentWeek) {
        // For current week, compute live
        const live = await computeLiveCategoryWeighted(workspaceId, quarterEnd);
        series.push({
          weekEnding: weekEnd.toISOString(),
          weekLabel: formatWeekLabel(weekEnd),
          categoryWeighted: live.categoryWeighted,
          closedWon: live.closedWon,
          snapshotSource: 'live',
        });
      } else if (snapshot) {
        // Use snapshot data
        const computed = computeCategoryWeighted(snapshot.team_forecast);
        series.push({
          weekEnding: weekEnd.toISOString(),
          weekLabel: formatWeekLabel(weekEnd),
          categoryWeighted: computed.categoryWeighted,
          closedWon: computed.closedWon,
          snapshotSource: 'skill_run',
        });
      } else {
        // No snapshot for this week
        series.push({
          weekEnding: weekEnd.toISOString(),
          weekLabel: formatWeekLabel(weekEnd),
          categoryWeighted: null,
          closedWon: 0,
          snapshotSource: null,
        });
      }
    }

    const weeksCovered = series.filter(s => s.categoryWeighted !== null).length;

    res.json({
      series,
      metadata: {
        quarterStart: quarterStart.toISOString(),
        quarterEnd: quarterEnd.toISOString(),
        snapshotsFound: snapshots.length,
        weeksCovered,
        totalWeeks: weekEndings.length,
      },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Category-Weighted Series] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
