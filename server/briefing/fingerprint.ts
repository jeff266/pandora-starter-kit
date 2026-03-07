import { createHash } from 'crypto';
import { query } from '../db.js';

export interface FingerprintInputs {
  closed_won_qtd_amount: number;
  closed_won_qtd_count: number;
  open_pipeline_amount: number;
  open_pipeline_count: number;
  coverage_ratio: number;
  top_deals: Array<{ id: string; amount: number; stage: string; close_date: string }>;
  rep_pipeline: Array<{ owner_id: string; pipeline_amount: number; closed_amount: number }>;
  quarter_end: string;
  quota_amount: number;
}

export async function computeBriefFingerprint(
  workspaceId: string
): Promise<{ fingerprint: string; inputs: FingerprintInputs }> {

  const targetResult = await query<{
    period_start: string;
    period_end: string;
    amount: string;
  }>(
    `SELECT period_start::text, period_end::text, amount::text
     FROM targets
     WHERE workspace_id = $1
       AND is_active = true
       AND period_start <= CURRENT_DATE
       AND period_end >= CURRENT_DATE
     ORDER BY period_start DESC LIMIT 1`,
    [workspaceId]
  );

  const now = new Date();
  const defaultQStart = getDefaultQuarterStart(now);
  const defaultQEnd = getDefaultQuarterEnd(now);

  const quarterStart = targetResult.rows[0]?.period_start || defaultQStart;
  const quarterEnd = targetResult.rows[0]?.period_end || defaultQEnd;
  const quotaAmount = Number(targetResult.rows[0]?.amount || 0);

  const [closedWonResult, openPipelineResult, topDealsResult, repPipelineResult] =
    await Promise.all([
      query<{ amount: string; count: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text as amount, COUNT(*)::text as count
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized = 'closed_won'
           AND close_date >= $2 AND close_date <= $3`,
        [workspaceId, quarterStart, quarterEnd]
      ),
      query<{ amount: string; count: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text as amount, COUNT(*)::text as count
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND close_date >= CURRENT_DATE`,
        [workspaceId]
      ),
      query<{ id: string; amount: string; stage: string; close_date: string }>(
        `SELECT id, amount::text, stage_normalized as stage, close_date::text
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND close_date >= CURRENT_DATE
         ORDER BY amount DESC NULLS LAST
         LIMIT 10`,
        [workspaceId]
      ),
      query<{ owner_id: string; pipeline_amount: string; closed_amount: string }>(
        `SELECT
           owner_id,
           COALESCE(SUM(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost')
             AND close_date >= CURRENT_DATE THEN amount ELSE 0 END), 0)::text as pipeline_amount,
           COALESCE(SUM(CASE WHEN stage_normalized = 'closed_won'
             AND close_date >= $2 THEN amount ELSE 0 END), 0)::text as closed_amount
         FROM deals
         WHERE workspace_id = $1
         GROUP BY owner_id
         ORDER BY owner_id`,
        [workspaceId, quarterStart]
      ),
    ]);

  const closedWonAmount = Number(closedWonResult.rows[0]?.amount || 0);
  const openPipelineAmount = Number(openPipelineResult.rows[0]?.amount || 0);

  const inputs: FingerprintInputs = {
    closed_won_qtd_amount: closedWonAmount,
    closed_won_qtd_count: Number(closedWonResult.rows[0]?.count || 0),
    open_pipeline_amount: openPipelineAmount,
    open_pipeline_count: Number(openPipelineResult.rows[0]?.count || 0),
    coverage_ratio: quotaAmount > 0
      ? Math.round((openPipelineAmount / quotaAmount) * 100) / 100
      : 0,
    top_deals: topDealsResult.rows.map(d => ({
      id: d.id,
      amount: Math.round(Number(d.amount)),
      stage: d.stage,
      close_date: d.close_date,
    })),
    rep_pipeline: repPipelineResult.rows.map(r => ({
      owner_id: r.owner_id,
      pipeline_amount: Math.round(Number(r.pipeline_amount)),
      closed_amount: Math.round(Number(r.closed_amount)),
    })),
    quarter_end: quarterEnd,
    quota_amount: Math.round(quotaAmount),
  };

  const stableString = JSON.stringify(inputs, (key, value) =>
    typeof value === 'number' ? Math.round(value) : value
  );

  const fingerprint = createHash('sha256')
    .update(stableString)
    .digest('hex')
    .slice(0, 16);

  return { fingerprint, inputs };
}

export async function getLastBriefFingerprint(
  workspaceId: string
): Promise<string | null> {
  const result = await query<{ fingerprint: string | null }>(
    `SELECT fingerprint FROM weekly_briefs
     WHERE workspace_id = $1
     ORDER BY generated_at DESC
     LIMIT 1`,
    [workspaceId]
  );
  return result.rows[0]?.fingerprint || null;
}

function getDefaultQuarterStart(now: Date): string {
  const month = now.getMonth();
  const year = now.getFullYear();
  const qMonth = Math.floor(month / 3) * 3;
  return `${year}-${String(qMonth + 1).padStart(2, '0')}-01`;
}

function getDefaultQuarterEnd(now: Date): string {
  const month = now.getMonth();
  const year = now.getFullYear();
  const qEndMonth = Math.floor(month / 3) * 3 + 3;
  if (qEndMonth === 12) {
    const lastDay = new Date(year, 12, 0).getDate();
    return `${year}-12-${lastDay}`;
  }
  const lastDay = new Date(year, qEndMonth, 0).getDate();
  return `${year}-${String(qEndMonth).padStart(2, '0')}-${lastDay}`;
}
