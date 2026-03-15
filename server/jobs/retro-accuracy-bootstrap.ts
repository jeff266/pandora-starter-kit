import { query } from '../db.js';
import { reconstructQuarterSnapshot, computeMethodPrediction, upsertAccuracyLog } from '../analysis/retro-accuracy.js';
import type { ForecastMethod } from '../analysis/retro-accuracy.js';

interface CompletedQuarter {
  label: string;
  start: Date;
  end: Date;
}

async function findCompletedQuarters(workspaceId: string): Promise<CompletedQuarter[]> {
  const result = await query<{ quarter_start: string; quarter_end: string; deal_count: number }>(
    `SELECT
       DATE_TRUNC('quarter', close_date)::date AS quarter_start,
       (DATE_TRUNC('quarter', close_date) + INTERVAL '3 months - 1 day')::date AS quarter_end,
       COUNT(*) AS deal_count
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('closed_won', 'closed_lost')
       AND close_date < DATE_TRUNC('quarter', NOW())
     GROUP BY 1, 2
     HAVING COUNT(*) >= 10
     ORDER BY 1 ASC`,
    [workspaceId]
  );

  return result.rows.map(r => {
    // pg may return Date objects or strings for date columns
    const startRaw = r.quarter_start instanceof Date ? r.quarter_start : new Date(String(r.quarter_start) + 'T00:00:00Z');
    const endRaw = r.quarter_end instanceof Date ? r.quarter_end : new Date(String(r.quarter_end) + 'T00:00:00Z');
    const qNum = Math.floor(startRaw.getUTCMonth() / 3) + 1;
    return {
      label: `Q${qNum} ${startRaw.getUTCFullYear()}`,
      start: startRaw,
      end: new Date(endRaw.getTime() + 86399999), // end of day UTC
    };
  });
}

export async function retroAccuracyBootstrap(workspaceId: string): Promise<{
  quartersProcessed: number;
  methodsWritten: number;
  skipped: number;
  errors: number;
}> {
  console.log(`[RetroAccuracy] Starting bootstrap for workspace ${workspaceId}`);

  const completedQuarters = await findCompletedQuarters(workspaceId);
  let quartersProcessed = 0;
  let methodsWritten = 0;
  let skipped = 0;
  let errors = 0;

  for (const quarter of completedQuarters) {
    try {
      const snapshot = await reconstructQuarterSnapshot(workspaceId, quarter.start, quarter.end);

      if (snapshot.dataCompleteness.completenessScore < 0.2) {
        console.log(`[RetroAccuracy] Skipping ${quarter.label} — completeness too low (${snapshot.dataCompleteness.completenessScore})`);
        skipped++;
        continue;
      }

      if (snapshot.actualOutcome.closedWonValue === 0 && snapshot.openPipelineOnDay21.totalValue === 0) {
        skipped++;
        continue;
      }

      const methods: ForecastMethod[] = [
        'week3_conversion_rate',
        'stage_weighted_ev',
        snapshot.dataCompleteness.hasForecastCategoryHistory ? 'category_weighted_ev' : null,
        'win_rate_inverted',
      ].filter(Boolean) as ForecastMethod[];

      for (const method of methods) {
        try {
          const predicted = computeMethodPrediction(method, snapshot);
          await upsertAccuracyLog({
            workspaceId,
            quarterLabel: quarter.label,
            quarterStart: quarter.start,
            quarterEnd: quarter.end,
            method,
            snapshotDate: snapshot.week3SnapshotDate,
            predictedARR: predicted,
            actualARR: snapshot.actualOutcome.closedWonValue,
            source: 'retro',
          });
          methodsWritten++;
        } catch (err: any) {
          console.error(`[RetroAccuracy] Failed method ${method} for ${quarter.label}:`, err?.message);
          errors++;
        }
      }

      quartersProcessed++;
      console.log(`[RetroAccuracy] Bootstrapped ${quarter.label} — ${methods.length} methods`);
    } catch (err: any) {
      console.error(`[RetroAccuracy] Failed quarter ${quarter.label}:`, err?.message);
      errors++;
    }
  }

  const result = { quartersProcessed, methodsWritten, skipped, errors };
  console.log(`[RetroAccuracy] Bootstrap complete:`, result);
  return result;
}
