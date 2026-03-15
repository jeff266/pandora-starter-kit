import { query } from '../db.js';

export type CoverageStatus = 'above_target' | 'on_track' | 'at_risk' | 'critical';

export interface QuarterPipelineState {
  quarterLabel: string;
  quarterStart: string;
  quarterEnd: string;
  pipelineValue: number;
  dealCount: number;
  coverageRatio: number;
  coverageTarget: number;
  coverageStatus: CoverageStatus;
  commitValue: number;
  bestCaseValue: number;
  closedWonValue: number;
  remainingQuota: number;
}

export interface PipelineProgressionSnapshot {
  snapshotDate: string;
  quarters: {
    current: QuarterPipelineState;
    next: QuarterPipelineState;
    nPlus2: QuarterPipelineState;
  };
  teamQuota: { current: number; next: number; nPlus2: number };
}

export interface EarlyWarning {
  quarterLabel: string;
  weeksOut: number;
  currentCoverage: number;
  projectedCoverage: number;
  gapToCover: number;
  urgent: boolean;
}

export interface PipelineProgressionHistory {
  snapshots: PipelineProgressionSnapshot[];
  trendLines: {
    current: number[];
    next: number[];
    nPlus2: number[];
  };
  earlyWarnings: EarlyWarning[];
}

function getQuarterBounds(date: Date, offset: number): { start: Date; end: Date; label: string } {
  const q = Math.floor(date.getMonth() / 3);
  const qStart = new Date(date.getFullYear(), (q + offset) * 3, 1);
  const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0, 23, 59, 59);
  const qNum = Math.floor(qStart.getMonth() / 3) + 1;
  return {
    start: qStart,
    end: qEnd,
    label: `Q${qNum} ${qStart.getFullYear()}`,
  };
}

function coverageStatus(ratio: number, target: number): CoverageStatus {
  if (ratio >= target * 1.05) return 'above_target';
  if (ratio >= target * 0.9) return 'on_track';
  if (ratio >= target * 0.7) return 'at_risk';
  return 'critical';
}

export async function pipelineProgressionSnapshot(
  workspaceId: string,
  snapshotDate: Date = new Date()
): Promise<PipelineProgressionSnapshot> {
  const quarters = [0, 1, 2].map(offset => getQuarterBounds(snapshotDate, offset));

  const quotaResult = await query<{ period_quota: number }>(
    `SELECT COALESCE(SUM(period_quota), 0) AS period_quota
     FROM rep_quotas
     WHERE workspace_id = $1
       AND period_start <= $2 AND period_end >= $2`,
    [workspaceId, snapshotDate.toISOString()]
  );
  const currentQuota = Number(quotaResult.rows[0]?.period_quota ?? 0);
  const nextQuota = currentQuota;
  const nPlus2Quota = currentQuota;

  const quarterStates: QuarterPipelineState[] = [];

  for (let i = 0; i < 3; i++) {
    const { start, end, label } = quarters[i];
    const quota = i === 0 ? currentQuota : i === 1 ? nextQuota : nPlus2Quota;
    const coverageTarget = 3.0;

    const pipelineResult = await query<{
      pipeline_value: number;
      deal_count: number;
      commit_value: number;
      best_case_value: number;
      closed_won_value: number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost') THEN amount ELSE 0 END), 0) AS pipeline_value,
         COUNT(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost') THEN 1 END)::int AS deal_count,
         COALESCE(SUM(CASE WHEN forecast_category = 'commit' AND stage_normalized NOT IN ('closed_won','closed_lost') THEN amount ELSE 0 END), 0) AS commit_value,
         COALESCE(SUM(CASE WHEN forecast_category IN ('best_case','best case') AND stage_normalized NOT IN ('closed_won','closed_lost') THEN amount ELSE 0 END), 0) AS best_case_value,
         COALESCE(SUM(CASE WHEN stage_normalized = 'closed_won' THEN amount ELSE 0 END), 0) AS closed_won_value
       FROM deals
       WHERE workspace_id = $1
         AND close_date >= $2
         AND close_date <= $3`,
      [workspaceId, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
    );

    const row = pipelineResult.rows[0];
    const pipelineValue = Number(row?.pipeline_value ?? 0);
    const closedWon = Number(row?.closed_won_value ?? 0);
    const remainingQuota = Math.max(0, quota - closedWon);
    const ratio = remainingQuota > 0 ? pipelineValue / remainingQuota : pipelineValue > 0 ? 999 : 0;

    quarterStates.push({
      quarterLabel: label,
      quarterStart: start.toISOString().split('T')[0],
      quarterEnd: end.toISOString().split('T')[0],
      pipelineValue,
      dealCount: Number(row?.deal_count ?? 0),
      coverageRatio: Math.round(ratio * 100) / 100,
      coverageTarget,
      coverageStatus: coverageStatus(ratio, coverageTarget),
      commitValue: Number(row?.commit_value ?? 0),
      bestCaseValue: Number(row?.best_case_value ?? 0),
      closedWonValue: closedWon,
      remainingQuota,
    });
  }

  return {
    snapshotDate: snapshotDate.toISOString().split('T')[0],
    quarters: {
      current: quarterStates[0],
      next: quarterStates[1],
      nPlus2: quarterStates[2],
    },
    teamQuota: { current: currentQuota, next: nextQuota, nPlus2: nPlus2Quota },
  };
}

export async function pipelineProgressionHistory(
  workspaceId: string,
  weeksBack: number = 12
): Promise<PipelineProgressionHistory> {
  const historyResult = await query<{ output: any; started_at: string }>(
    `SELECT output, started_at
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = 'pipeline-progression'
       AND status = 'completed'
       AND started_at >= NOW() - INTERVAL '${weeksBack} weeks'
     ORDER BY started_at ASC`,
    [workspaceId]
  );

  const snapshots: PipelineProgressionSnapshot[] = historyResult.rows
    .map(r => r.output?.snapshot as PipelineProgressionSnapshot | undefined)
    .filter((s): s is PipelineProgressionSnapshot => !!s);

  const trendLines = {
    current: snapshots.map(s => s.quarters.current.coverageRatio),
    next: snapshots.map(s => s.quarters.next.coverageRatio),
    nPlus2: snapshots.map(s => s.quarters.nPlus2.coverageRatio),
  };

  const earlyWarnings: EarlyWarning[] = [];

  if (snapshots.length >= 3) {
    for (const qKey of ['next', 'nPlus2'] as const) {
      const values = trendLines[qKey === 'next' ? 'next' : 'nPlus2'];
      const recent = values.slice(-3);
      const trend = recent[2] - recent[0];
      const latest = snapshots[snapshots.length - 1];
      const q = latest.quarters[qKey];
      const projectedCoverage = Math.max(0, q.coverageRatio + trend);

      const quarterStart = new Date(q.quarterStart);
      const weeksOut = Math.round((quarterStart.getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000));

      if (projectedCoverage < q.coverageTarget) {
        const gapToCover = (q.coverageTarget - projectedCoverage) * q.remainingQuota;
        earlyWarnings.push({
          quarterLabel: q.quarterLabel,
          weeksOut,
          currentCoverage: q.coverageRatio,
          projectedCoverage: Math.round(projectedCoverage * 100) / 100,
          gapToCover: Math.max(0, gapToCover),
          urgent: weeksOut <= 8 && projectedCoverage < q.coverageTarget,
        });
      }
    }
  }

  return { snapshots, trendLines, earlyWarnings };
}
