import { query } from '../db.js';
import { reconstructDealStateAtDate } from './field-history-queries.js';

export type ForecastMethod =
  | 'week3_conversion_rate'
  | 'stage_weighted_ev'
  | 'category_weighted_ev'
  | 'win_rate_inverted'
  | 'capacity_model'
  | 'manager_rollup';

export interface DataCompleteness {
  hasStageHistory: boolean;
  hasForecastCategoryHistory: boolean;
  hasAmountHistory: boolean;
  hasCloseDateHistory: boolean;
  completenessScore: number;
  caveat: string | null;
}

export interface QuarterSnapshot {
  quarterLabel: string;
  quarterStart: Date;
  quarterEnd: Date;
  week3SnapshotDate: Date;
  openPipelineOnDay21: {
    deals: Awaited<ReturnType<typeof reconstructDealStateAtDate>> extends Map<string, infer V> ? V[] : never;
    totalValue: number;
    dealCount: number;
    byStage: Record<string, { count: number; value: number }>;
    byForecastCategory: Record<string, { count: number; value: number }>;
  };
  actualOutcome: {
    closedWonValue: number;
    closedWonCount: number;
    closedLostCount: number;
    derailCount: number;
    stillOpenCount: number;
  };
  dataCompleteness: DataCompleteness;
}

export interface MethodAccuracy {
  method: ForecastMethod;
  quarterLabel: string;
  snapshotDate: Date;
  predictedARR: number;
  actualARR: number;
  errorAbs: number;
  errorPct: number;
  errorDirection: 'over' | 'under';
  source: 'live' | 'retro';
}

const DEFAULT_STAGE_WEIGHTS: Record<string, number> = {
  prospecting: 0.05,
  qualification: 0.10,
  needs_analysis: 0.20,
  value_proposition: 0.30,
  id_decision_makers: 0.40,
  perception_analysis: 0.50,
  proposal: 0.60,
  negotiation: 0.75,
  commit: 0.85,
  closed_won: 1.0,
  closed_lost: 0.0,
};

const DEFAULT_CATEGORY_WEIGHTS: Record<string, number> = {
  commit: 0.90,
  forecast: 0.60,
  best_case: 0.30,
  'best case': 0.30,
  pipeline: 0.10,
  omitted: 0.05,
};

export async function reconstructQuarterSnapshot(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date
): Promise<QuarterSnapshot> {
  const week3Date = new Date(quarterStart);
  week3Date.setDate(week3Date.getDate() + 20);

  const quarterLabel = `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${quarterStart.getFullYear()}`;

  const dealsResult = await query<{ id: string }>(
    `SELECT DISTINCT id FROM deals
     WHERE workspace_id = $1
       AND created_at <= $2
       AND (close_date >= $3 OR stage_normalized = 'closed_won')`,
    [workspaceId, week3Date.toISOString(), quarterStart.toISOString().split('T')[0]]
  );

  const dealIds = dealsResult.rows.map(r => r.id);
  const stateMap = await reconstructDealStateAtDate(workspaceId, dealIds, week3Date);

  const day21Deals = [...stateMap.values()].filter(d => {
    if (!d.wasOpenOnDate) return false;
    if (!d.closeDate) return false;
    return d.closeDate >= quarterStart && d.closeDate <= quarterEnd;
  });

  let totalValue = 0;
  const byStage: Record<string, { count: number; value: number }> = {};
  const byCategory: Record<string, { count: number; value: number }> = {};

  for (const d of day21Deals) {
    const amt = d.amount ?? 0;
    totalValue += amt;
    const stage = d.stageNormalized ?? 'unknown';
    byStage[stage] = byStage[stage] ?? { count: 0, value: 0 };
    byStage[stage].count++;
    byStage[stage].value += amt;
    const cat = d.forecastCategory ?? 'pipeline';
    byCategory[cat] = byCategory[cat] ?? { count: 0, value: 0 };
    byCategory[cat].count++;
    byCategory[cat].value += amt;
  }

  const outcomeResult = await query<{
    stage_normalized: string;
    count: number;
    value: number;
    close_reason: string | null;
  }>(
    `SELECT stage_normalized,
            COUNT(*)::int AS count,
            COALESCE(SUM(amount), 0) AS value,
            COALESCE(
              source_data->'properties'->>'closed_lost_reason',
              source_data->'properties'->>'closed_won_reason',
              custom_fields->>'close_reason',
              custom_fields->>'closed_lost_reason',
              ''
            ) AS close_reason
     FROM deals
     WHERE workspace_id = $1
       AND close_date >= $2
       AND close_date <= $3
     GROUP BY stage_normalized, COALESCE(
              source_data->'properties'->>'closed_lost_reason',
              source_data->'properties'->>'closed_won_reason',
              custom_fields->>'close_reason',
              custom_fields->>'closed_lost_reason',
              ''
            )`,
    [workspaceId, quarterStart.toISOString().split('T')[0], quarterEnd.toISOString().split('T')[0]]
  );

  let closedWonValue = 0; let closedWonCount = 0;
  let closedLostCount = 0; let derailCount = 0; let stillOpenCount = 0;
  const derailKeywords = ['no decision', 'status quo', 'budget', 'cancelled', 'deferred'];
  for (const row of outcomeResult.rows) {
    if (row.stage_normalized === 'closed_won') { closedWonValue += Number(row.value); closedWonCount += Number(row.count); }
    else if (row.stage_normalized === 'closed_lost') {
      const r = (row.close_reason ?? '').toLowerCase();
      if (derailKeywords.some(k => r.includes(k))) derailCount += Number(row.count);
      else closedLostCount += Number(row.count);
    } else { stillOpenCount += Number(row.count); }
  }

  const hasFieldHistory = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM deal_field_history WHERE workspace_id = $1 AND changed_at >= $2 AND changed_at <= $3 LIMIT 1`,
    [workspaceId, quarterStart.toISOString(), week3Date.toISOString()]
  );
  const hasFH = (hasFieldHistory.rows[0]?.c ?? 0) > 0;

  const hasStageHist = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM deal_stage_history WHERE workspace_id = $1 AND changed_at <= $2 LIMIT 1`,
    [workspaceId, week3Date.toISOString()]
  );
  const hasStageHistory = (hasStageHist.rows[0]?.c ?? 0) > 0;

  const completenessScore = hasStageHistory ? (hasFH ? 0.9 : 0.5) : 0.2;

  return {
    quarterLabel,
    quarterStart,
    quarterEnd,
    week3SnapshotDate: week3Date,
    openPipelineOnDay21: {
      deals: day21Deals as any,
      totalValue,
      dealCount: day21Deals.length,
      byStage,
      byForecastCategory: byCategory,
    },
    actualOutcome: { closedWonValue, closedWonCount, closedLostCount, derailCount, stillOpenCount },
    dataCompleteness: {
      hasStageHistory,
      hasForecastCategoryHistory: hasFH,
      hasAmountHistory: hasFH,
      hasCloseDateHistory: hasFH,
      completenessScore,
      caveat: completenessScore < 0.5 ? 'Insufficient field history — results are approximations' : null,
    },
  };
}

export function computeMethodPrediction(
  method: ForecastMethod,
  snapshot: QuarterSnapshot,
  historicalConversionRate?: number
): number {
  const { openPipelineOnDay21: pipe } = snapshot;

  switch (method) {
    case 'week3_conversion_rate': {
      const rate = historicalConversionRate ?? 0.3;
      return pipe.totalValue * rate;
    }
    case 'stage_weighted_ev': {
      let ev = 0;
      for (const [stage, data] of Object.entries(pipe.byStage)) {
        const weight = DEFAULT_STAGE_WEIGHTS[stage] ?? 0.25;
        ev += data.value * weight;
      }
      return ev;
    }
    case 'category_weighted_ev': {
      let ev = 0;
      for (const [cat, data] of Object.entries(pipe.byForecastCategory)) {
        const weight = DEFAULT_CATEGORY_WEIGHTS[cat] ?? 0.10;
        ev += data.value * weight;
      }
      return ev;
    }
    case 'win_rate_inverted': {
      return pipe.totalValue * 0.25;
    }
    default:
      return 0;
  }
}

export async function upsertAccuracyLog(row: {
  workspaceId: string;
  quarterLabel: string;
  quarterStart: Date;
  quarterEnd: Date;
  method: ForecastMethod;
  snapshotDate: Date;
  predictedARR: number;
  actualARR: number;
  source: 'live' | 'retro';
}): Promise<void> {
  const errorAbs = Math.abs(row.predictedARR - row.actualARR);
  const errorPct = row.actualARR > 0 ? (errorAbs / row.actualARR) * 100 : 0;
  const errorDirection: 'over' | 'under' = row.predictedARR >= row.actualARR ? 'over' : 'under';

  await query(
    `INSERT INTO forecast_accuracy_log
       (workspace_id, quarter_label, quarter_start, quarter_end, method, snapshot_date,
        predicted_arr, actual_arr, error_abs, error_pct, error_direction, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (workspace_id, quarter_label, method)
     DO UPDATE SET
       predicted_arr = EXCLUDED.predicted_arr,
       actual_arr = EXCLUDED.actual_arr,
       error_abs = EXCLUDED.error_abs,
       error_pct = EXCLUDED.error_pct,
       error_direction = EXCLUDED.error_direction,
       source = EXCLUDED.source`,
    [
      row.workspaceId, row.quarterLabel,
      row.quarterStart.toISOString().split('T')[0],
      row.quarterEnd.toISOString().split('T')[0],
      row.method, row.snapshotDate.toISOString().split('T')[0],
      row.predictedARR, row.actualARR,
      errorAbs, errorPct, errorDirection, row.source,
    ]
  );
}
