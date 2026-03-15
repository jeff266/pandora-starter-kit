import { query } from '../db.js';

export interface WinRateQuarterlyTrend {
  quarter: string;
  rate: number;
}

export interface WinRateResult {
  narrow: {
    rate: number;
    wins: number;
    losses: number;
    quarterlyTrend: WinRateQuarterlyTrend[];
  };
  broad: {
    rate: number;
    wins: number;
    losses: number;
    derails: number;
    quarterlyTrend: WinRateQuarterlyTrend[];
  };
  derailRate: number;
  narrowToBroadGap: number;
  derailTrend: 'rising' | 'stable' | 'falling';
  lossReasons: { reason: string; count: number; pct: number }[];
  interpretation: {
    primaryPressure: 'competitive' | 'status_quo' | 'mixed' | 'insufficient_data';
  };
}

const DERAIL_KEYWORDS = [
  'no decision',
  'no-decision',
  'status quo',
  'status-quo',
  'budget',
  'freeze',
  'cancelled',
  'canceled',
  'postponed',
  'deferred',
  'delay',
];

export async function computeWinRates(
  workspaceId: string,
  lookbackQuarters: number = 6
): Promise<WinRateResult> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - lookbackQuarters * 3);

  const dealsResult = await query<{
    stage_normalized: string;
    close_reason: string | null;
    close_date: string | null;
    amount: number;
    quarter_label: string;
  }>(
    `SELECT
       d.stage_normalized,
       d.close_reason,
       d.close_date,
       COALESCE(d.amount, 0) AS amount,
       TO_CHAR(DATE_TRUNC('quarter', d.close_date), 'Q YYYY') AS quarter_label
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
       AND d.close_date >= $2
       AND d.close_date IS NOT NULL
     ORDER BY d.close_date`,
    [workspaceId, cutoff.toISOString()]
  );

  const deals = dealsResult.rows;

  if (deals.length === 0) {
    return emptyWinRateResult();
  }

  let totalWins = 0;
  let totalLosses = 0;
  let totalDerails = 0;
  const reasonCounts: Record<string, number> = {};

  const quarterMap = new Map<string, { wins: number; losses: number; derails: number }>();

  for (const deal of deals) {
    const reason = (deal.close_reason ?? '').toLowerCase();
    const isDerail = DERAIL_KEYWORDS.some(k => reason.includes(k));
    const qLabel = deal.quarter_label ?? 'Unknown';

    if (!quarterMap.has(qLabel)) quarterMap.set(qLabel, { wins: 0, losses: 0, derails: 0 });
    const q = quarterMap.get(qLabel)!;

    if (deal.stage_normalized === 'closed_won') {
      totalWins++;
      q.wins++;
    } else {
      if (isDerail) {
        totalDerails++;
        q.derails++;
      } else {
        totalLosses++;
        q.losses++;
      }
      const r = deal.close_reason ?? 'unclassified';
      reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    }
  }

  const narrowDenominator = totalWins + totalLosses;
  const broadDenominator = totalWins + totalLosses + totalDerails;

  const narrowRate = narrowDenominator > 0 ? totalWins / narrowDenominator : 0;
  const broadRate = broadDenominator > 0 ? totalWins / broadDenominator : 0;
  const derailRate = broadDenominator > 0 ? totalDerails / broadDenominator : 0;

  const sortedQuarters = [...quarterMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  const narrowTrend: WinRateQuarterlyTrend[] = sortedQuarters.map(([quarter, d]) => ({
    quarter,
    rate: d.wins + d.losses > 0 ? d.wins / (d.wins + d.losses) : 0,
  }));
  const broadTrend: WinRateQuarterlyTrend[] = sortedQuarters.map(([quarter, d]) => ({
    quarter,
    rate: d.wins + d.losses + d.derails > 0 ? d.wins / (d.wins + d.losses + d.derails) : 0,
  }));

  const derailTrend = computeTrend(sortedQuarters.map(([, d]) => d.derails / Math.max(1, d.wins + d.losses + d.derails)));

  const totalReasoned = Object.values(reasonCounts).reduce((a, b) => a + b, 0);
  const lossReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count, pct: totalReasoned > 0 ? count / totalReasoned : 0 }))
    .sort((a, b) => b.count - a.count);

  const recentN = Math.min(3, sortedQuarters.length);
  const recent = sortedQuarters.slice(-recentN);
  const recentLossGrowth = recent.reduce((sum, [, d]) => sum + d.losses, 0);
  const recentDerailGrowth = recent.reduce((sum, [, d]) => sum + d.derails, 0);

  let primaryPressure: WinRateResult['interpretation']['primaryPressure'] = 'mixed';
  if (totalWins + totalLosses + totalDerails < 10) {
    primaryPressure = 'insufficient_data';
  } else if (recentDerailGrowth > recentLossGrowth * 1.5) {
    primaryPressure = 'status_quo';
  } else if (recentLossGrowth > recentDerailGrowth * 1.5) {
    primaryPressure = 'competitive';
  }

  return {
    narrow: { rate: narrowRate, wins: totalWins, losses: totalLosses, quarterlyTrend: narrowTrend },
    broad: { rate: broadRate, wins: totalWins, losses: totalLosses, derails: totalDerails, quarterlyTrend: broadTrend },
    derailRate,
    narrowToBroadGap: narrowRate - broadRate,
    derailTrend,
    lossReasons,
    interpretation: { primaryPressure },
  };
}

function computeTrend(values: number[]): 'rising' | 'stable' | 'falling' {
  if (values.length < 2) return 'stable';
  const first = values.slice(0, Math.floor(values.length / 2));
  const last = values.slice(Math.floor(values.length / 2));
  const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
  const lastAvg = last.reduce((a, b) => a + b, 0) / last.length;
  const delta = lastAvg - firstAvg;
  if (delta > 0.03) return 'rising';
  if (delta < -0.03) return 'falling';
  return 'stable';
}

function emptyWinRateResult(): WinRateResult {
  return {
    narrow: { rate: 0, wins: 0, losses: 0, quarterlyTrend: [] },
    broad: { rate: 0, wins: 0, losses: 0, derails: 0, quarterlyTrend: [] },
    derailRate: 0,
    narrowToBroadGap: 0,
    derailTrend: 'stable',
    lossReasons: [],
    interpretation: { primaryPressure: 'insufficient_data' },
  };
}
