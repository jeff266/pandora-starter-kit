/**
 * Data Assembler
 *
 * Pulls evidence directly from the database to populate PipelineReviewData
 * and ForecastData objects for document rendering.
 *
 * This is the "direct DB" render path — separate from the template-driven
 * deliverable pipeline that uses deliverable_results/agent_runs.
 */

import { query } from '../db.js';

// ============================================================================
// Types
// ============================================================================

export interface FindingSummary {
  message: string;
  severity: string;
  skill_name: string;
  deal_name?: string;
  owner?: string;
  impact_amount?: number;
}

export interface PipelineReviewData {
  workspace: { id: string; name: string; crm_type: string | null };
  generated_at: string;
  period_label: string;
  pipeline: {
    total_value: number;
    deal_count: number;
    weighted_value: number;
    by_stage: {
      stage: string;
      deal_count: number;
      total_value: number;
      weighted_value: number;
      avg_age_days: number;
    }[];
  };
  metrics: {
    win_rate_period: number | null;
    avg_deal_size: number;
    avg_cycle_days: number;
    deals_won_period: number;
    deals_lost_period: number;
    pipeline_created_period: number;
  };
  findings: {
    critical: FindingSummary[];
    warning: FindingSummary[];
    info: FindingSummary[];
  };
  risk_deals: {
    deal_name: string;
    account_name: string;
    owner: string;
    amount: number;
    stage: string;
    age_days: number;
    risk_reasons: string[];
    close_date: string | null;
  }[];
  all_deals: {
    deal_name: string;
    account_name: string;
    owner: string;
    amount: number;
    stage: string;
    age_days: number;
    close_date: string | null;
    last_activity: string | null;
    contact_count: number;
    has_recent_conversation: boolean;
    risk_flags: string[];
  }[];
  data_quality: {
    total_issues: number;
    missing_close_dates: number;
    missing_amounts: number;
    missing_contacts: number;
    stale_deals: number;
  };
  actions: { open: number; resolved_this_week: number; critical_open: number };
}

export interface ForecastData {
  workspace: { id: string; name: string; crm_type: string | null };
  generated_at: string;
  period_label: string;
  forecast_by_stage: {
    stage: string;
    deal_count: number;
    total_value: number;
    weighted_value: number;
    default_probability: number;
    avg_days_in_stage: number;
    deals: {
      name: string;
      account: string;
      owner: string;
      amount: number;
      close_date: string | null;
      days_in_stage: number;
      risk_flags: string[];
    }[];
  }[];
  totals: {
    total_pipeline: number;
    weighted_forecast: number;
    best_case: number;
    worst_case: number;
    committed: number;
  };
  close_date_distribution: {
    month: string;
    deal_count: number;
    total_value: number;
    weighted_value: number;
  }[];
  slip_risk_deals: {
    deal_name: string;
    account: string;
    owner: string;
    amount: number;
    close_date: string;
    days_past_close: number;
    stage: string;
    risk_reason: string;
  }[];
  coverage: {
    quota: number | null;
    pipeline_total: number;
    coverage_ratio: number | null;
    weighted_coverage: number | null;
  } | null;
  recent_outcomes: {
    won: { count: number; value: number };
    lost: { count: number; value: number };
  };
}

// ============================================================================
// Helpers
// ============================================================================

const STAGE_PROBS: Record<string, number> = {
  discovery: 0.10,
  qualification: 0.25,
  proposal: 0.50,
  demo: 0.40,
  negotiation: 0.75,
  verbal: 0.90,
  commit: 0.90,
};

function getStageProbability(stage: string, dbProb: number | null): number {
  if (dbProb != null && dbProb > 0) return dbProb / 100;
  const key = stage.toLowerCase();
  for (const [pat, prob] of Object.entries(STAGE_PROBS)) {
    if (key.includes(pat)) return prob;
  }
  return 0.30;
}

function fmtPeriodLabel(start: Date, end: Date): string {
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `Week of ${s}–${e}`;
}

// ============================================================================
// Pipeline Review Assembler
// ============================================================================

export async function assemblePipelineReview(
  workspaceId: string,
  options: { period_days?: number } = {}
): Promise<PipelineReviewData> {
  const periodDays = options.period_days ?? 7;
  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 86400000);

  // 1. Workspace info
  const wsResult = await query<{ id: string; name: string }>(
    'SELECT id, name FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  if (wsResult.rows.length === 0) throw new Error(`Workspace ${workspaceId} not found`);
  const ws = wsResult.rows[0];

  const crmResult = await query<{ connector_name: string }>(
    `SELECT connector_name FROM connections
     WHERE workspace_id = $1 AND connector_name IN ('hubspot','salesforce') AND status = 'connected'
     LIMIT 1`,
    [workspaceId]
  );
  const crm_type = crmResult.rows[0]?.connector_name || null;

  // 2. Pipeline by stage
  const stageRows = await query<{
    stage: string;
    deal_count: string;
    total_value: string;
    weighted_value: string;
    avg_age_days: string;
  }>(
    `SELECT COALESCE(stage, 'Unknown') as stage,
            COUNT(*) as deal_count,
            COALESCE(SUM(amount), 0) as total_value,
            COALESCE(SUM(amount * COALESCE(probability, 30) / 100.0), 0) as weighted_value,
            COALESCE(AVG(EXTRACT(EPOCH FROM NOW() - created_at) / 86400.0), 0) as avg_age_days
     FROM deals
     WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
     GROUP BY stage
     ORDER BY SUM(amount) DESC NULLS LAST`,
    [workspaceId]
  );
  const by_stage = stageRows.rows.map(r => ({
    stage: r.stage,
    deal_count: parseInt(r.deal_count),
    total_value: parseFloat(r.total_value),
    weighted_value: parseFloat(r.weighted_value),
    avg_age_days: Math.round(parseFloat(r.avg_age_days)),
  }));

  // 3. Key metrics
  const [wonRows, lostRows, createdRows, avgRows] = await Promise.all([
    query<{ cnt: string; total: string }>(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM deals
       WHERE workspace_id=$1 AND stage_normalized='closed_won' AND updated_at>=$2`,
      [workspaceId, periodStart]
    ),
    query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM deals
       WHERE workspace_id=$1 AND stage_normalized='closed_lost' AND updated_at>=$2`,
      [workspaceId, periodStart]
    ),
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount),0) as total FROM deals WHERE workspace_id=$1 AND created_at>=$2`,
      [workspaceId, periodStart]
    ),
    query<{ avg_size: string; avg_cycle: string }>(
      `SELECT COALESCE(AVG(amount),0) as avg_size,
              COALESCE(AVG(EXTRACT(EPOCH FROM updated_at-created_at)/86400.0),0) as avg_cycle
       FROM deals WHERE workspace_id=$1 AND stage_normalized='closed_won'`,
      [workspaceId]
    ),
  ]);

  const deals_won = parseInt(wonRows.rows[0]?.cnt || '0');
  const deals_lost = parseInt(lostRows.rows[0]?.cnt || '0');
  const total_closed = deals_won + deals_lost;

  // 4. Findings
  const findingRows = await query<{
    message: string;
    severity: string;
    skill_id: string;
    deal_id: string | null;
    owner_email: string | null;
    metadata: any;
  }>(
    `SELECT message, severity, skill_id, deal_id, owner_email, metadata
     FROM findings WHERE workspace_id=$1 AND resolved_at IS NULL
     ORDER BY CASE severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END, created_at DESC
     LIMIT 100`,
    [workspaceId]
  );

  const dealIds = [...new Set(findingRows.rows.filter(f => f.deal_id).map(f => f.deal_id!))];
  const dealNames = new Map<string, string>();
  if (dealIds.length > 0) {
    const dr = await query<{ id: string; name: string }>(
      'SELECT id, name FROM deals WHERE id = ANY($1::uuid[])',
      [dealIds]
    );
    dr.rows.forEach(r => dealNames.set(r.id, r.name || 'Unnamed'));
  }

  const toSummary = (f: (typeof findingRows.rows)[0]): FindingSummary => ({
    message: f.message,
    severity: f.severity,
    skill_name: f.skill_id,
    deal_name: f.deal_id ? dealNames.get(f.deal_id) : undefined,
    owner: f.owner_email || undefined,
    impact_amount: f.metadata?.amount || f.metadata?.impact_amount || undefined,
  });

  const findings = {
    critical: findingRows.rows.filter(f => f.severity === 'act').map(toSummary),
    warning: findingRows.rows.filter(f => f.severity === 'watch').map(toSummary),
    info: findingRows.rows.filter(f => f.severity !== 'act' && f.severity !== 'watch').map(toSummary),
  };

  // 5. Risk deals (deals with act/watch findings)
  const riskDealIds = new Map<string, string[]>();
  for (const f of findingRows.rows.filter(f => f.severity === 'act' || f.severity === 'watch')) {
    if (f.deal_id) {
      if (!riskDealIds.has(f.deal_id)) riskDealIds.set(f.deal_id, []);
      riskDealIds.get(f.deal_id)!.push(f.message.substring(0, 80));
    }
  }

  let risk_deals: PipelineReviewData['risk_deals'] = [];
  if (riskDealIds.size > 0) {
    const rr = await query<{
      id: string; name: string; account_name: string | null; owner: string | null;
      amount: string | null; stage: string | null; close_date: string | null; created_at: string;
    }>(
      `SELECT d.id, d.name, a.name as account_name, d.owner, d.amount, d.stage, d.close_date, d.created_at
       FROM deals d LEFT JOIN accounts a ON a.id = d.account_id
       WHERE d.id = ANY($1::uuid[]) ORDER BY d.amount DESC NULLS LAST`,
      [[...riskDealIds.keys()]]
    );
    risk_deals = rr.rows.map(r => ({
      deal_name: r.name || 'Unnamed',
      account_name: r.account_name || '',
      owner: r.owner || '',
      amount: parseFloat(r.amount || '0'),
      stage: r.stage || 'Unknown',
      age_days: Math.round((now.getTime() - new Date(r.created_at).getTime()) / 86400000),
      risk_reasons: riskDealIds.get(r.id) || [],
      close_date: r.close_date || null,
    }));
  }

  // 6. All deals
  const allRows = await query<{
    id: string; name: string; account_name: string | null; owner: string | null;
    amount: string | null; stage: string | null; created_at: string;
    close_date: string | null; last_activity_date: string | null;
    contact_count: string; has_recent_convo: boolean;
  }>(
    `SELECT d.id, d.name, a.name as account_name, d.owner, d.amount, d.stage, d.created_at,
            d.close_date, d.last_activity_date,
            COALESCE(dc.cnt, 0) as contact_count,
            COALESCE(cv.has_recent, false) as has_recent_convo
     FROM deals d
     LEFT JOIN accounts a ON a.id = d.account_id
     LEFT JOIN (SELECT deal_id, COUNT(*) as cnt FROM deal_contacts GROUP BY deal_id) dc ON dc.deal_id = d.id
     LEFT JOIN (
       SELECT deal_id, true as has_recent FROM conversations
       WHERE call_date >= NOW() - INTERVAL '14 days' AND deal_id IS NOT NULL GROUP BY deal_id
     ) cv ON cv.deal_id = d.id
     WHERE d.workspace_id = $1 AND d.stage_normalized NOT IN ('closed_won','closed_lost')
     ORDER BY d.amount DESC NULLS LAST LIMIT 500`,
    [workspaceId]
  );

  const all_deals = allRows.rows.map(r => ({
    deal_name: r.name || 'Unnamed',
    account_name: r.account_name || '',
    owner: r.owner || '',
    amount: parseFloat(r.amount || '0'),
    stage: r.stage || 'Unknown',
    age_days: Math.round((now.getTime() - new Date(r.created_at).getTime()) / 86400000),
    close_date: r.close_date || null,
    last_activity: r.last_activity_date || null,
    contact_count: parseInt(r.contact_count),
    has_recent_conversation: r.has_recent_convo,
    risk_flags: riskDealIds.get(r.id) || [],
  }));

  // 7. Data quality
  const dqRows = await query<{
    missing_close: string; missing_amount: string; missing_contacts: string; stale: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE close_date IS NULL) as missing_close,
       COUNT(*) FILTER (WHERE amount IS NULL OR amount = 0) as missing_amount,
       COUNT(*) FILTER (WHERE id NOT IN (
         SELECT DISTINCT deal_id FROM deal_contacts WHERE deal_id IS NOT NULL
       )) as missing_contacts,
       COUNT(*) FILTER (WHERE last_activity_date < NOW() - INTERVAL '14 days' OR last_activity_date IS NULL) as stale
     FROM deals WHERE workspace_id=$1 AND stage_normalized NOT IN ('closed_won','closed_lost')`,
    [workspaceId]
  );
  const dq = dqRows.rows[0];

  // 8. Actions
  const actRows = await query<{ open: string; critical: string; resolved: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE execution_status IN ('pending','snoozed')) as open,
       COUNT(*) FILTER (WHERE execution_status IN ('pending','snoozed') AND severity IN ('critical','high')) as critical,
       COUNT(*) FILTER (WHERE execution_status = 'executed' AND created_at >= NOW() - INTERVAL '7 days') as resolved
     FROM actions WHERE workspace_id=$1`,
    [workspaceId]
  );
  const act = actRows.rows[0];

  return {
    workspace: { id: ws.id, name: ws.name, crm_type },
    generated_at: now.toISOString(),
    period_label: fmtPeriodLabel(periodStart, now),
    pipeline: {
      total_value: by_stage.reduce((s, r) => s + r.total_value, 0),
      deal_count: by_stage.reduce((s, r) => s + r.deal_count, 0),
      weighted_value: by_stage.reduce((s, r) => s + r.weighted_value, 0),
      by_stage,
    },
    metrics: {
      win_rate_period: total_closed > 0 ? deals_won / total_closed : null,
      avg_deal_size: parseFloat(avgRows.rows[0]?.avg_size || '0'),
      avg_cycle_days: Math.round(parseFloat(avgRows.rows[0]?.avg_cycle || '0')),
      deals_won_period: deals_won,
      deals_lost_period: deals_lost,
      pipeline_created_period: parseFloat(createdRows.rows[0]?.total || '0'),
    },
    findings,
    risk_deals,
    all_deals,
    data_quality: {
      total_issues: parseInt(dq.missing_close) + parseInt(dq.missing_amount) + parseInt(dq.missing_contacts),
      missing_close_dates: parseInt(dq.missing_close),
      missing_amounts: parseInt(dq.missing_amount),
      missing_contacts: parseInt(dq.missing_contacts),
      stale_deals: parseInt(dq.stale),
    },
    actions: {
      open: parseInt(act?.open || '0'),
      critical_open: parseInt(act?.critical || '0'),
      resolved_this_week: parseInt(act?.resolved || '0'),
    },
  };
}

// ============================================================================
// Forecast Assembler
// ============================================================================

export async function assembleForecast(
  workspaceId: string,
  options: { quarter?: string } = {}
): Promise<ForecastData> {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  const quarterLabel = options.quarter || `Q${q} ${now.getFullYear()}`;
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const periodLabel = `${quarterLabel} Forecast — as of ${dateStr}`;

  const wsResult = await query<{ id: string; name: string }>(
    'SELECT id, name FROM workspaces WHERE id=$1',
    [workspaceId]
  );
  if (wsResult.rows.length === 0) throw new Error(`Workspace ${workspaceId} not found`);
  const ws = wsResult.rows[0];

  const crmResult = await query<{ connector_name: string }>(
    `SELECT connector_name FROM connections
     WHERE workspace_id=$1 AND connector_name IN ('hubspot','salesforce') AND status='connected' LIMIT 1`,
    [workspaceId]
  );
  const crm_type = crmResult.rows[0]?.connector_name || null;

  // Open deals with stage grouping
  const dealsRows = await query<{
    id: string; name: string; account_name: string | null; owner: string | null;
    amount: string | null; stage: string | null; close_date: string | null;
    days_in_stage: string | null; probability: string | null;
  }>(
    `SELECT d.id, d.name, a.name as account_name, d.owner, d.amount,
            d.stage, d.close_date, d.days_in_stage, d.probability
     FROM deals d LEFT JOIN accounts a ON a.id = d.account_id
     WHERE d.workspace_id=$1 AND d.stage_normalized NOT IN ('closed_won','closed_lost')
     ORDER BY d.stage, d.amount DESC NULLS LAST`,
    [workspaceId]
  );

  const riskRows = await query<{ deal_id: string; message: string }>(
    `SELECT deal_id, message FROM findings
     WHERE workspace_id=$1 AND resolved_at IS NULL AND severity IN ('act','watch') AND deal_id IS NOT NULL`,
    [workspaceId]
  );
  const dealRisk = new Map<string, string[]>();
  for (const f of riskRows.rows) {
    if (!dealRisk.has(f.deal_id)) dealRisk.set(f.deal_id, []);
    dealRisk.get(f.deal_id)!.push(f.message.substring(0, 60));
  }

  const stageGroups = new Map<string, typeof dealsRows.rows>();
  for (const d of dealsRows.rows) {
    const s = d.stage || 'Unknown';
    if (!stageGroups.has(s)) stageGroups.set(s, []);
    stageGroups.get(s)!.push(d);
  }

  const forecast_by_stage = Array.from(stageGroups.entries()).map(([stage, deals]) => ({
    stage,
    deal_count: deals.length,
    total_value: deals.reduce((s, d) => s + parseFloat(d.amount || '0'), 0),
    weighted_value: deals.reduce(
      (s, d) => s + parseFloat(d.amount || '0') * getStageProbability(stage, parseFloat(d.probability || '0') || null),
      0
    ),
    default_probability: getStageProbability(stage, null),
    avg_days_in_stage:
      deals.length > 0
        ? Math.round(deals.reduce((s, d) => s + parseInt(d.days_in_stage || '0'), 0) / deals.length)
        : 0,
    deals: deals.map(d => ({
      name: d.name || 'Unnamed',
      account: d.account_name || '',
      owner: d.owner || '',
      amount: parseFloat(d.amount || '0'),
      close_date: d.close_date || null,
      days_in_stage: parseInt(d.days_in_stage || '0'),
      risk_flags: dealRisk.get(d.id) || [],
    })),
  }));

  const total_pipeline = forecast_by_stage.reduce((s, r) => s + r.total_value, 0);
  const weighted_forecast = forecast_by_stage.reduce((s, r) => s + r.weighted_value, 0);
  const committed_keywords = ['negotiation', 'verbal', 'commit'];
  const committed = forecast_by_stage
    .filter(s => committed_keywords.some(k => s.stage.toLowerCase().includes(k)))
    .reduce((s, r) => s + r.total_value, 0);

  // Close date distribution
  const cdRows = await query<{
    month: string; deal_count: string; total_value: string; weighted_value: string;
  }>(
    `SELECT TO_CHAR(close_date, 'Mon YYYY') as month,
            COUNT(*) as deal_count,
            COALESCE(SUM(amount), 0) as total_value,
            COALESCE(SUM(amount * COALESCE(probability,30)/100.0), 0) as weighted_value
     FROM deals
     WHERE workspace_id=$1 AND stage_normalized NOT IN ('closed_won','closed_lost') AND close_date IS NOT NULL
     GROUP BY TO_CHAR(close_date,'Mon YYYY'), DATE_TRUNC('month', close_date)
     ORDER BY DATE_TRUNC('month', close_date)`,
    [workspaceId]
  );

  // Slip risk
  const slipRows = await query<{
    id: string; name: string; account_name: string | null; owner: string | null;
    amount: string | null; close_date: string; stage: string | null;
  }>(
    `SELECT d.id, d.name, a.name as account_name, d.owner, d.amount, d.close_date, d.stage
     FROM deals d LEFT JOIN accounts a ON a.id = d.account_id
     WHERE d.workspace_id=$1 AND d.stage_normalized NOT IN ('closed_won','closed_lost')
       AND d.close_date IS NOT NULL AND d.close_date < NOW() + INTERVAL '14 days'
     ORDER BY d.close_date ASC, d.amount DESC NULLS LAST LIMIT 50`,
    [workspaceId]
  );

  const slip_risk_deals = slipRows.rows
    .filter(d => {
      const diff = Math.round((new Date(d.close_date).getTime() - now.getTime()) / 86400000);
      return diff < 0 || dealRisk.has(d.id);
    })
    .map(d => {
      const diff = Math.round((new Date(d.close_date).getTime() - now.getTime()) / 86400000);
      return {
        deal_name: d.name || 'Unnamed',
        account: d.account_name || '',
        owner: d.owner || '',
        amount: parseFloat(d.amount || '0'),
        close_date: d.close_date,
        days_past_close: -diff,
        stage: d.stage || 'Unknown',
        risk_reason: diff < 0 ? `Overdue by ${-diff} days` : (dealRisk.get(d.id) || ['Closing soon'])[0],
      };
    })
    .sort((a, b) => b.days_past_close - a.days_past_close);

  // Recent outcomes
  const outcomeRows = await query<{ outcome: string; cnt: string; total: string }>(
    `SELECT stage_normalized as outcome, COUNT(*) as cnt, COALESCE(SUM(amount),0) as total
     FROM deals WHERE workspace_id=$1 AND stage_normalized IN ('closed_won','closed_lost')
       AND updated_at >= NOW() - INTERVAL '30 days'
     GROUP BY stage_normalized`,
    [workspaceId]
  );
  const wonRow = outcomeRows.rows.find(r => r.outcome === 'closed_won');
  const lostRow = outcomeRows.rows.find(r => r.outcome === 'closed_lost');

  return {
    workspace: { id: ws.id, name: ws.name, crm_type },
    generated_at: now.toISOString(),
    period_label: periodLabel,
    forecast_by_stage,
    totals: {
      total_pipeline,
      weighted_forecast,
      best_case: total_pipeline,
      worst_case: committed,
      committed,
    },
    close_date_distribution: cdRows.rows.map(r => ({
      month: r.month,
      deal_count: parseInt(r.deal_count),
      total_value: parseFloat(r.total_value),
      weighted_value: parseFloat(r.weighted_value),
    })),
    slip_risk_deals,
    coverage: null,
    recent_outcomes: {
      won: { count: parseInt(wonRow?.cnt || '0'), value: parseFloat(wonRow?.total || '0') },
      lost: { count: parseInt(lostRow?.cnt || '0'), value: parseFloat(lostRow?.total || '0') },
    },
  };
}
