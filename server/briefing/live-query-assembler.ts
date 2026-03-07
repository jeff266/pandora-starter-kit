import { query } from '../db.js';
import { getCurrentQuota } from './brief-utils.js';
import { resolveDefaultPipeline } from '../chat/pipeline-resolver.js';

export interface LiveBriefData {
  the_number: {
    attainment_pct: number;
    closed_won_amount: number;
    quota_amount: number;
    gap_amount: number;
    coverage_ratio: number;
    open_pipeline_amount: number;
    open_pipeline_count: number;
    days_remaining: number;
    quarter_end: string;
    pipeline_label: string;
  };
  deals_to_watch: Array<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    owner_name: string;
    close_date: string;
    days_until_close: number;
    contact_count: number;
    days_since_activity: number | null;
    risk_flags: string[];
  }>;
  rep_summary: Array<{
    owner_id: string;
    owner_name: string;
    pipeline_amount: number;
    closed_won_amount: number;
    coverage_ratio: number;
    deal_count: number;
  }>;
  delta: {
    pipeline_change: number;
    new_closed_won: Array<{ name: string; amount: number }>;
    newly_at_risk: Array<{ name: string; reason: string }>;
  } | null;
  data_freshness: {
    queried_at: string;
    last_crm_sync_at: string | null;
    sync_lag_minutes: number | null;
  };
}

export async function assembleLiveBriefData(
  workspaceId: string
): Promise<LiveBriefData> {
  const now = new Date();

  const quota = await getCurrentQuota(workspaceId);

  const quarterStart = quota?.period_start || getDefaultQuarterStart(now);
  const quarterEnd = quota?.period_end || getDefaultQuarterEnd(now);
  const quotaAmount = quota?.target || 0;

  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(quarterEnd).getTime() - now.getTime()) / 86400000)
  );

  const pipelineResolution = await resolveDefaultPipeline(
    workspaceId,
    'attainment',
    'admin',
    ''
  );

  const scopeFilter = pipelineResolution.scope_ids && pipelineResolution.scope_ids.length > 0
    ? `AND d.scope_id = ANY(ARRAY[${pipelineResolution.scope_ids.map((_: string, i: number) => `$${i + 4}`).join(',')}]::uuid[])`
    : '';

  const closedWonParams: any[] = pipelineResolution.scope_ids && pipelineResolution.scope_ids.length > 0
    ? [workspaceId, quarterStart, quarterEnd, ...pipelineResolution.scope_ids]
    : [workspaceId, quarterStart, quarterEnd];

  const [closedWonResult, openPipelineResult] = await Promise.all([
    query<{ total_amount: string; deal_count: string }>(
      `SELECT
         COALESCE(SUM(d.amount), 0)::text as total_amount,
         COUNT(*)::text as deal_count
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.stage_normalized = 'closed_won'
         AND d.close_date >= $2
         AND d.close_date <= $3
         ${scopeFilter}`,
      closedWonParams
    ),
    query<{ total_amount: string; deal_count: string }>(
      `SELECT
         COALESCE(SUM(d.amount), 0)::text as total_amount,
         COUNT(*)::text as deal_count
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND d.close_date >= CURRENT_DATE
         AND d.close_date <= $2
         ${pipelineResolution.scope_ids && pipelineResolution.scope_ids.length > 0
           ? `AND d.scope_id = ANY(ARRAY[${pipelineResolution.scope_ids.map((_: string, i: number) => `$${i + 3}`).join(',')}]::uuid[])`
           : ''}`,
      pipelineResolution.scope_ids && pipelineResolution.scope_ids.length > 0
        ? [workspaceId, quarterEnd, ...pipelineResolution.scope_ids]
        : [workspaceId, quarterEnd]
    ),
  ]);

  const closedWonAmount = Number(closedWonResult.rows[0]?.total_amount || 0);
  const openPipelineAmount = Number(openPipelineResult.rows[0]?.total_amount || 0);
  const openPipelineCount = Number(openPipelineResult.rows[0]?.deal_count || 0);
  const remaining = Math.max(0, quotaAmount - closedWonAmount);
  const coverageRatio = remaining > 0
    ? Math.round((openPipelineAmount / remaining) * 10) / 10
    : 0;

  const [topDealsResult, repSummaryResult, lastSyncResult, riskFlags] = await Promise.all([
    query<any>(
      `SELECT
         d.id, d.name, d.amount, d.stage_normalized as stage,
         d.owner_name, d.close_date::text,
         DATE_PART('day', d.close_date - CURRENT_DATE)::int as days_until_close,
         COUNT(DISTINCT dc.contact_id) as contact_count,
         EXTRACT(EPOCH FROM (NOW() - MAX(a.occurred_at))) / 86400.0 as days_since_activity
       FROM deals d
       LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
       LEFT JOIN activities a ON a.deal_id = d.id AND a.workspace_id = d.workspace_id
       WHERE d.workspace_id = $1
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND d.close_date <= $2
         AND d.amount > 0
       GROUP BY d.id, d.name, d.amount, d.stage_normalized, d.owner_name, d.close_date
       ORDER BY d.amount DESC NULLS LAST
       LIMIT 15`,
      [workspaceId, quarterEnd]
    ),
    query<any>(
      `SELECT
         d.owner_id,
         d.owner_name,
         COALESCE(SUM(CASE WHEN d.stage_normalized NOT IN ('closed_won','closed_lost')
           AND d.close_date <= $2 THEN d.amount ELSE 0 END), 0)::text as pipeline_amount,
         COALESCE(SUM(CASE WHEN d.stage_normalized = 'closed_won'
           AND d.close_date >= $3 THEN d.amount ELSE 0 END), 0)::text as closed_won_amount,
         COUNT(DISTINCT CASE WHEN d.stage_normalized NOT IN ('closed_won','closed_lost')
           AND d.close_date <= $2 THEN d.id END)::text as deal_count
       FROM deals d
       WHERE d.workspace_id = $1
       GROUP BY d.owner_id, d.owner_name
       HAVING COALESCE(SUM(CASE WHEN d.stage_normalized NOT IN ('closed_won','closed_lost')
           AND d.close_date <= $2 THEN d.amount ELSE 0 END), 0) > 0
          OR COALESCE(SUM(CASE WHEN d.stage_normalized = 'closed_won'
           AND d.close_date >= $3 THEN d.amount ELSE 0 END), 0) > 0
       ORDER BY 3 DESC`,
      [workspaceId, quarterEnd, quarterStart]
    ),
    query<{ last_sync_at: string | null }>(
      `SELECT MAX(completed_at)::text as last_sync_at
       FROM sync_log
       WHERE workspace_id = $1 AND status = 'success'`,
      [workspaceId]
    ).catch(() => ({ rows: [{ last_sync_at: null }] })),
    loadRiskFlagsFromSkillRuns(workspaceId),
  ]);

  const lastSyncAt = lastSyncResult.rows[0]?.last_sync_at || null;
  const syncLagMinutes = lastSyncAt
    ? Math.round((now.getTime() - new Date(lastSyncAt).getTime()) / 60000)
    : null;

  const repCount = repSummaryResult.rows.length || 1;

  return {
    the_number: {
      attainment_pct: quotaAmount > 0
        ? Math.round((closedWonAmount / quotaAmount) * 100)
        : 0,
      closed_won_amount: closedWonAmount,
      quota_amount: quotaAmount,
      gap_amount: Math.max(0, quotaAmount - closedWonAmount),
      coverage_ratio: coverageRatio,
      open_pipeline_amount: openPipelineAmount,
      open_pipeline_count: openPipelineCount,
      days_remaining: daysRemaining,
      quarter_end: quarterEnd,
      pipeline_label: pipelineResolution.assumption_label,
    },
    deals_to_watch: topDealsResult.rows.map((d: any) => ({
      id: d.id,
      name: d.name,
      amount: Number(d.amount),
      stage: d.stage,
      owner_name: d.owner_name || '',
      close_date: d.close_date,
      days_until_close: Number(d.days_until_close) || 0,
      contact_count: Number(d.contact_count) || 0,
      days_since_activity: d.days_since_activity != null
        ? Math.round(Number(d.days_since_activity))
        : null,
      risk_flags: riskFlags[d.id] || [],
    })),
    rep_summary: repSummaryResult.rows.map((r: any) => {
      const pipeAmt = Number(r.pipeline_amount);
      const repQuota = quotaAmount / repCount;
      return {
        owner_id: r.owner_id,
        owner_name: r.owner_name || '',
        pipeline_amount: pipeAmt,
        closed_won_amount: Number(r.closed_won_amount),
        deal_count: Number(r.deal_count),
        coverage_ratio: repQuota > 0
          ? Math.round((pipeAmt / repQuota) * 10) / 10
          : 0,
      };
    }),
    delta: null,
    data_freshness: {
      queried_at: now.toISOString(),
      last_crm_sync_at: lastSyncAt,
      sync_lag_minutes: syncLagMinutes,
    },
  };
}

async function loadRiskFlagsFromSkillRuns(
  workspaceId: string
): Promise<Record<string, string[]>> {
  try {
    const result = await query<{ result_data: any }>(
      `SELECT sr.result_data
       FROM skill_runs sr
       WHERE sr.workspace_id = $1
         AND sr.skill_id IN ('pipeline-hygiene', 'single-thread-alert', 'deal-risk-review')
         AND sr.status = 'completed'
         AND sr.completed_at >= NOW() - INTERVAL '48 hours'
       ORDER BY sr.completed_at DESC`,
      [workspaceId]
    );

    const flags: Record<string, string[]> = {};
    for (const row of result.rows) {
      const claims = row.result_data?.claims || [];
      for (const claim of claims) {
        if (claim.entity_id) {
          if (!flags[claim.entity_id]) flags[claim.entity_id] = [];
          if (!flags[claim.entity_id].includes(claim.message)) {
            flags[claim.entity_id].push(claim.message);
          }
        }
      }
    }
    return flags;
  } catch {
    return {};
  }
}

export function getDefaultQuarterStart(now: Date): string {
  const month = now.getMonth();
  const year = now.getFullYear();
  const qMonth = Math.floor(month / 3) * 3;
  return `${year}-${String(qMonth + 1).padStart(2, '0')}-01`;
}

export function getDefaultQuarterEnd(now: Date): string {
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
