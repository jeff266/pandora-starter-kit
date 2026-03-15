import { query } from '../db.js';

export type ForecastMethod =
  | 'week3_conversion_rate'
  | 'stage_weighted_ev'
  | 'category_weighted_ev'
  | 'win_rate_inverted'
  | 'behavioral_adjusted_ev'
  | 'manager_rollup'
  | 'capacity_model';

export type BearingWeight = 'primary' | 'secondary' | 'reference' | 'unavailable';
// primary   = lowest avg error, lead the narrative
// secondary = reliable, include in triangulation
// reference = available but unreliable, mention with caveat
// unavailable = no data yet, omit

export interface BearingCalibration {
  method: ForecastMethod;
  weight: BearingWeight;
  avgErrorPct: number | null;
  quartersOfData: number;
  biasDirection: 'over' | 'under' | 'neutral' | null;
  biasMagnitude: number | null;
  caveat: string | null;
  isStartupNoise: boolean;
}

export interface WorkspaceBearingCalibration {
  workspaceId: string;
  computedAt: string;
  minQuartersForReliability: number;
  calibrations: BearingCalibration[];
  primaryBearing: ForecastMethod | null;
  narrativeGuidance: string;
}

const ALL_METHODS: ForecastMethod[] = [
  'week3_conversion_rate',
  'stage_weighted_ev',
  'category_weighted_ev',
  'win_rate_inverted',
  'behavioral_adjusted_ev',
  'manager_rollup',
  'capacity_model',
];

const WEIGHT_ORDER: Record<BearingWeight, number> = {
  primary: 0,
  secondary: 1,
  reference: 2,
  unavailable: 3,
};

export async function computeBearingCalibration(
  workspaceId: string
): Promise<WorkspaceBearingCalibration> {
  const MIN_QUARTERS = 4;

  // Pull accuracy log — exclude quarters where actual_arr < $50K (startup noise)
  const rows = await query<{
    method: string;
    quarters: string;
    avg_error_pct: string;
    avg_signed_error: string;
    over_count: string;
    under_count: string;
  }>(
    `SELECT
       method,
       COUNT(*) AS quarters,
       ROUND(AVG(error_pct), 1) AS avg_error_pct,
       ROUND(AVG(
         CASE WHEN error_direction = 'over' THEN error_pct ELSE -error_pct END
       ), 1) AS avg_signed_error,
       COUNT(*) FILTER (WHERE error_direction = 'over') AS over_count,
       COUNT(*) FILTER (WHERE error_direction = 'under') AS under_count
     FROM forecast_accuracy_log
     WHERE workspace_id = $1
       AND actual_arr > 50000
       AND source IN ('live', 'retro')
     GROUP BY method
     ORDER BY avg_error_pct ASC`,
    [workspaceId]
  );

  // Detect startup noise pattern
  const totalRow = await query<{ total_quarters: string; noisy_quarters: string }>(
    `SELECT
       COUNT(DISTINCT quarter_label) AS total_quarters,
       COUNT(DISTINCT quarter_label) FILTER (WHERE actual_arr <= 50000) AS noisy_quarters
     FROM forecast_accuracy_log
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const totalQuarters = parseInt(totalRow.rows[0]?.total_quarters ?? '0', 10);
  const noisyQuarters = parseInt(totalRow.rows[0]?.noisy_quarters ?? '0', 10);
  const isStartupNoise = noisyQuarters > 0 && noisyQuarters >= totalQuarters * 0.3;

  const dataByMethod = new Map(rows.rows.map((r) => [r.method, r]));

  const calibrations: BearingCalibration[] = ALL_METHODS.map((method) => {
    const data = dataByMethod.get(method);

    if (!data || parseInt(data.quarters, 10) === 0) {
      return {
        method,
        weight: 'unavailable' as BearingWeight,
        avgErrorPct: null,
        quartersOfData: 0,
        biasDirection: null,
        biasMagnitude: null,
        caveat: null,
        isStartupNoise: false,
      };
    }

    const quarters = parseInt(data.quarters, 10);
    const avgError = parseFloat(data.avg_error_pct);
    const avgSigned = parseFloat(data.avg_signed_error);
    const overCount = parseInt(data.over_count, 10);
    const underCount = parseInt(data.under_count, 10);

    // Weight classification
    let weight: BearingWeight;
    if (quarters < MIN_QUARTERS || avgError > 50) {
      weight = quarters > 0 ? 'reference' : 'unavailable';
    } else if (avgError <= 15) {
      weight = 'primary';
    } else if (avgError <= 30) {
      weight = 'secondary';
    } else {
      weight = 'reference';
    }

    // Bias detection
    let biasDirection: 'over' | 'under' | 'neutral' = 'neutral';
    if (overCount > underCount * 2) biasDirection = 'over';
    else if (underCount > overCount * 2) biasDirection = 'under';

    // Build caveat
    let caveat: string | null = null;
    if (quarters < MIN_QUARTERS) {
      caveat = `Based on ${quarters} quarter${quarters === 1 ? '' : 's'} — treat as directional only`;
    } else if (isStartupNoise) {
      caveat = `Early quarters excluded (startup ramp) — based on ${quarters} mature quarters`;
    } else if (avgError > 30) {
      caveat = `High average error (${avgError}%) — use as cross-check only`;
    }
    if (biasDirection !== 'neutral') {
      const biasNote = `Consistently ${biasDirection}-predicts by ~${Math.abs(avgSigned)}%`;
      caveat = caveat ? `${caveat}. ${biasNote}` : biasNote;
    }

    return {
      method,
      weight,
      avgErrorPct: avgError,
      quartersOfData: quarters,
      biasDirection,
      biasMagnitude: avgSigned,
      caveat,
      isStartupNoise,
    };
  });

  // Sort: primary → secondary → reference → unavailable, then by avgErrorPct ASC within tier
  calibrations.sort(
    (a, b) =>
      WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight] ||
      (a.avgErrorPct ?? 999) - (b.avgErrorPct ?? 999)
  );

  const primaryBearing = calibrations.find((c) => c.weight === 'primary')?.method ?? null;

  const primaryCalib = calibrations.find((c) => c.weight === 'primary');
  const secondaryCalib = calibrations.filter((c) => c.weight === 'secondary');
  const referenceCalib = calibrations.filter(
    (c) => c.weight === 'reference' && c.avgErrorPct !== null
  );
  const unavailableCalib = calibrations.filter((c) => c.weight === 'unavailable');

  const parts: string[] = [];

  if (primaryCalib) {
    parts.push(
      `Lead your forecast narrative with ${primaryCalib.method} ` +
      `(avg error ${primaryCalib.avgErrorPct}% across ${primaryCalib.quartersOfData} quarters — most accurate for this workspace).`
    );
  } else {
    parts.push(
      `No bearing has sufficient history (${MIN_QUARTERS}+ quarters at ≤15% error) to be designated primary. ` +
      `Present all available bearings with equal weight.`
    );
  }

  if (secondaryCalib.length > 0) {
    parts.push(
      `Use ${secondaryCalib.map((c) => c.method).join(' and ')} as supporting bearings.`
    );
  }

  for (const c of referenceCalib) {
    parts.push(`Mention ${c.method} with caveat: "${c.caveat}".`);
  }

  if (unavailableCalib.length > 0) {
    parts.push(
      `Do not mention: ${unavailableCalib.map((c) => c.method).join(', ')} — no data available yet.`
    );
  }

  if (isStartupNoise) {
    parts.push(
      `Note: accuracy data excludes early quarters where actual ARR was below $50K (startup ramp period).`
    );
  }

  const narrativeGuidance = parts.join(' ');

  return {
    workspaceId,
    computedAt: new Date().toISOString(),
    minQuartersForReliability: MIN_QUARTERS,
    calibrations,
    primaryBearing,
    narrativeGuidance,
  };
}
