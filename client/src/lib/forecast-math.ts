/**
 * Forecast Math Library
 * Provides formula lines, breakdown data, and SQL queries for all forecast metrics.
 * This is the foundation of "Show the Math" - progressive disclosure from formula lines to full breakdowns.
 */

// ============================================================================
// Types
// ============================================================================

export interface FormulaContext {
  dealCount?: number;
  closedDealCount?: number;
  quota?: number;
  closedWon?: number;
  weeksLeft?: number;
  simulations?: number;
  weeklyAvg?: number;
  pipeline?: number;
  remainingQuota?: number;
  avgWinRate?: number;
  currentWeek?: number;
  totalWeeks?: number;
  pipeGenDealCount?: number;
}

export interface MathContext extends FormulaContext {
  period?: { start: string; end: string };
  periodLabel?: string;
  repEmail?: string;
  repName?: string;
  mcResults?: { p10: number; p25: number; p50: number; p75: number; p90: number };
  stageAvgDays?: Record<string, number>;
}

export interface SqlQueryContext {
  period?: { start: string; end: string };
  repEmail?: string;
  repName?: string;
}

export interface BreakdownData {
  title: string;
  explanation: string;
  inputs?: { label: string; value: string }[];
  distribution?: { label: string; value: string; highlight: boolean }[];
  categories?: { name: string; weight: number; count: number; pipeline: number; weighted: number }[];
  deals?: Deal[];
  dealsLabel?: string;
  notes?: string;
}

export interface Deal {
  id: string;
  name: string;
  amount: number;
  stage_normalized: string;
  probability: number;
  close_date?: string;
  owner_email?: string;
  owner_name: string;
  forecast_category?: string;
  days_in_current_stage?: number;
  created_date?: string;
  is_closed_won?: boolean;
  closed_at?: string;
  account_id?: string;
  contribution?: number;
  closeDate?: string;
  stage?: string;
  owner?: string;
}

// ============================================================================
// Currency Formatter & Deal Field Normalizers
// ============================================================================

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  if (n >= 10_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 100_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

/**
 * Normalize deal amount from various CRM field names
 * Handles HubSpot (amount, hs_amount, deal_amount) and Salesforce (Amount)
 */
function getDealAmount(deal: any): number {
  const amount = deal.amount ?? deal.deal_amount ?? deal.value ??
    deal.properties?.amount ?? deal.hs_amount ?? deal.Amount ?? 0;

  // Handle string amounts from HubSpot
  if (typeof amount === 'string') return parseFloat(amount) || 0;
  return Number(amount) || 0;
}

/**
 * Normalize deal creation date from various CRM field names
 */
function getDealCreatedDate(deal: any): Date | null {
  const raw = deal.created_date ?? deal.createdate ?? deal.created_at ??
    deal.hs_createdate ?? deal.CreatedDate ?? deal.properties?.createdate;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================================
// Level 1: Formula Lines (always visible, no click)
// ============================================================================

export function getFormulaLine(
  metric: string,
  value: number,
  ctx: FormulaContext
): string {
  switch (metric) {
    case 'mc_p50':
      return `Median of ${(ctx.simulations || 10000).toLocaleString()} simulations across ${ctx.dealCount || 0} open deals`;

    case 'closed_won':
      if (ctx.quota && ctx.quota > 0) {
        return `${ctx.closedDealCount || 0} deals closed this quarter · ${Math.round(value / ctx.quota * 100)}% of ${fmt(ctx.quota)} quota`;
      }
      return `${ctx.closedDealCount || 0} deals closed this quarter`;

    case 'gap_to_quota':
      return `${fmt(ctx.quota || 0)} quota − ${fmt(ctx.closedWon || 0)} closed = ${fmt(value)} remaining · ${ctx.weeksLeft || 0} weeks left`;

    case 'mc_range':
      return `P25 to P75 · 80% of simulated outcomes fall in this band`;

    case 'pipe_gen':
      if (ctx.weeklyAvg && ctx.weeklyAvg > 0) {
        return `${fmt(value)} created this quarter · trailing 8-week avg ${fmt(ctx.weeklyAvg)}/wk`;
      }
      return `${fmt(value)} created this quarter`;

    case 'stage_weighted':
      return `Σ(deal_amount × stage_probability) across ${ctx.dealCount || 0} deals`;

    case 'category_weighted':
      return `Commit×90% + BestCase×60% + Pipeline×30% + Omit×10%`;

    case 'attainment':
      return `${fmt(ctx.closedWon || 0)} closed ÷ ${fmt(ctx.quota || 0)} quota`;

    case 'coverage':
      if (ctx.pipeline && ctx.remainingQuota && ctx.remainingQuota > 0) {
        const ratio = ctx.pipeline / ctx.remainingQuota;
        return `${fmt(ctx.pipeline)} open pipeline ÷ ${fmt(ctx.remainingQuota)} remaining = ${ratio.toFixed(1)}x`;
      }
      return 'Open pipeline ÷ remaining quota';

    default:
      return '';
  }
}

// ============================================================================
// Level 2: Expandable Math Breakdown Data
// ============================================================================

export function getBreakdownData(
  metric: string,
  value: number,
  ctx: MathContext,
  deals: Deal[]
): BreakdownData {
  switch (metric) {

    case 'mc_p50':
      return {
        title: `MC P50 Forecast: ${fmt(value)}`,
        explanation: `For each of ${(ctx.simulations || 10000).toLocaleString()} simulations, every open deal is independently sampled for win/loss using its stage-specific win rate (adjusted for deal-level risk signals like days in stage, activity recency). Deals that "close" are summed. P50 is the median total across all simulations — the outcome you're most likely to land at.`,
        inputs: [
          { label: 'Open deals in window', value: String(ctx.dealCount || deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized)).length) },
          { label: 'Total pipeline value', value: fmt(deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized)).reduce((s, d) => s + getDealAmount(d), 0)) },
          { label: 'Avg historical win rate', value: `${((ctx.avgWinRate || 0.17) * 100).toFixed(1)}% (90-day trailing)` },
          { label: 'Simulations run', value: (ctx.simulations || 10000).toLocaleString() },
        ],
        distribution: ctx.mcResults ? [
          { label: 'P10 (10% chance below)', value: fmt(ctx.mcResults.p10), highlight: false },
          { label: 'P25 (bottom of likely range)', value: fmt(ctx.mcResults.p25), highlight: false },
          { label: 'P50 (most likely outcome)', value: fmt(ctx.mcResults.p50), highlight: true },
          { label: 'P75 (top of likely range)', value: fmt(ctx.mcResults.p75), highlight: false },
          { label: 'P90 (10% chance above)', value: fmt(ctx.mcResults.p90), highlight: false },
        ] : undefined,
        deals: deals
          .filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized))
          .map(d => {
            const amount = getDealAmount(d);
            return {
              ...d,
              amount,
              contribution: amount * (d.probability / 100),
              stage: d.stage_normalized,
              owner: d.owner_name,
            };
          })
          .sort((a, b) => (b.contribution || 0) - (a.contribution || 0)),
        dealsLabel: 'Top contributing deals (by expected value)',
      };

    case 'stage_weighted': {
      const swDeals = deals
        .filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized))
        .filter(d => ctx.repEmail ? d.owner_email === ctx.repEmail : true);
      return {
        title: ctx.repName
          ? `Stage Weighted: ${fmt(value)} (${ctx.repName})`
          : `Stage Weighted Forecast: ${fmt(value)}`,
        explanation: `Each open deal's amount is multiplied by its stage probability (from CRM or Pandora defaults). The stage-weighted forecast is the sum of all weighted values. This method treats every deal independently — it doesn't account for historical close patterns or deal-level risk signals.`,
        inputs: [
          { label: 'Open deals', value: String(swDeals.length) },
          { label: 'Total pipeline', value: fmt(swDeals.reduce((s, d) => s + getDealAmount(d), 0)) },
          { label: 'Result', value: `${swDeals.length} deals × probabilities = ${fmt(value)}` },
        ],
        deals: swDeals.map(d => {
          const amount = getDealAmount(d);
          return {
            ...d,
            amount,
            contribution: amount * (d.probability / 100),
            stage: d.stage_normalized,
            owner: d.owner_name,
          };
        }).sort((a, b) => (b.contribution || 0) - (a.contribution || 0)),
        dealsLabel: 'Deal breakdown (sorted by weighted value)',
        notes: 'Stage probabilities come from the CRM deal.probability field. If blank, Pandora applies default probabilities based on the normalized stage mapping (Prospecting 10%, Qualification 20%, Discovery 30%, Evaluation 50%, Proposal 60%, Negotiation 80%, Commit 90%).',
      };
    }

    case 'category_weighted': {
      const cwDeals = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized));
      const WEIGHTS: Record<string, number> = { 'Commit': 0.90, 'Best Case': 0.60, 'Pipeline': 0.30 };
      const grouped: Record<string, { count: number; pipeline: number }> = {};
      cwDeals.forEach(d => {
        const cat = d.forecast_category || 'Other';
        if (!grouped[cat]) grouped[cat] = { count: 0, pipeline: 0 };
        grouped[cat].count++;
        grouped[cat].pipeline += getDealAmount(d);
      });
      return {
        title: `Category Weighted Forecast: ${fmt(value)}`,
        explanation: `Deals are grouped by their CRM forecast_category field (Commit, Best Case, Pipeline, Other). Each category is multiplied by a fixed probability weight. This method is widely used because it aligns with how reps communicate confidence — but the weights are assumptions, not measured probabilities.`,
        categories: Object.entries(grouped).map(([name, data]) => ({
          name,
          weight: WEIGHTS[name] || 0.10,
          count: data.count,
          pipeline: data.pipeline,
          weighted: data.pipeline * (WEIGHTS[name] || 0.10),
        })).sort((a, b) => b.weighted - a.weighted),
        notes: `Default weights: Commit 90%, Best Case 60%, Pipeline 30%, Other 10%. Customize in Workspace Config → Forecast Settings. Your historical actual close rates by category may differ from these defaults — the Monte Carlo method uses measured rates instead of assumed weights.`,
      };
    }

    case 'closed_won': {
      const closedDeals = deals
        .filter(d => d.stage_normalized === 'closed_won' || d.is_closed_won)
        .filter(d => ctx.repEmail ? d.owner_email === ctx.repEmail : true);

      // Sort by amount descending using normalized amount
      const sortedDeals = closedDeals
        .map(d => ({ ...d, amount: getDealAmount(d) }))
        .sort((a, b) => b.amount - a.amount);

      return {
        title: ctx.repName
          ? `Closed Won: ${fmt(value)} (${ctx.repName})`
          : `Closed Won: ${fmt(value)}`,
        explanation: `Sum of all deals with stage = closed_won and close date within ${ctx.periodLabel || 'this quarter'}.${ctx.quota ? ` That's ${Math.round(value / ctx.quota * 100)}% of the ${fmt(ctx.quota)} quota.` : ''}`,
        inputs: [
          { label: 'Closed deals', value: String(closedDeals.length) },
          { label: 'Total closed value', value: fmt(value) },
          ...(ctx.quota ? [
            { label: 'Quota', value: fmt(ctx.quota) },
            { label: 'Attainment', value: `${Math.round(value / ctx.quota * 100)}%` }
          ] : []),
        ],
        deals: sortedDeals.map(d => ({
          ...d,
          stage: 'Closed Won',
          owner: d.owner_name,
          closeDate: d.closed_at,
        })),
        dealsLabel: 'Closed deals (sorted by amount)',
      };
    }

    case 'gap_to_quota':
      return {
        title: `Gap to Quota: ${fmt(value)}`,
        explanation: `Gap = Team Quota − Closed Won = ${fmt(ctx.quota || 0)} − ${fmt(ctx.closedWon || 0)} = ${fmt(value)} remaining.`,
        inputs: [
          { label: 'Team quota', value: fmt(ctx.quota || 0) },
          { label: 'Closed won', value: fmt(ctx.closedWon || 0) },
          { label: 'Remaining', value: fmt(value) },
          { label: 'Quarter progress', value: `Week ${ctx.currentWeek || '?'} of ${ctx.totalWeeks || 13}` },
          { label: 'Linear pace target', value: fmt((ctx.quota || 0) * ((ctx.currentWeek || 1) / (ctx.totalWeeks || 13))) },
          { label: 'Required run rate', value: `${fmt(value / (ctx.weeksLeft || 1))}/week for ${ctx.weeksLeft} weeks` },
        ],
      };

    case 'coverage': {
      const ratio = (ctx.pipeline || 0) / (ctx.remainingQuota || 1);
      return {
        title: `Coverage: ${ratio.toFixed(2)}x`,
        explanation: `Coverage = Open Pipeline ÷ Remaining Quota = ${fmt(ctx.pipeline || 0)} ÷ ${fmt(ctx.remainingQuota || 0)} = ${ratio.toFixed(2)}x`,
        inputs: [
          { label: 'Open pipeline', value: fmt(ctx.pipeline || 0) },
          { label: 'Remaining quota', value: fmt(ctx.remainingQuota || 0) },
          { label: 'Coverage ratio', value: `${ratio.toFixed(2)}x` },
          { label: 'Industry benchmark', value: '3.0x–4.0x' },
          { label: 'To reach 3.0x', value: fmt(Math.max(0, (ctx.remainingQuota || 0) * 3 - (ctx.pipeline || 0))) + ' more pipeline needed' },
        ],
      };
    }

    case 'pipe_gen': {
      // If context.deals is provided (specific week click), use those
      // Otherwise filter to deals created in the trailing 8 weeks
      let pipeGenDeals;
      if ((ctx as any).deals && Array.isArray((ctx as any).deals)) {
        pipeGenDeals = (ctx as any).deals
          .map((d: any) => {
            const created = getDealCreatedDate(d);
            const amount = getDealAmount(d);
            return { ...d, amount, created };
          })
          .sort((a: any, b: any) => b.amount - a.amount);
      } else {
        const eightWeeksAgo = new Date();
        eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

        pipeGenDeals = deals
          .map(d => {
            const created = getDealCreatedDate(d);
            const amount = getDealAmount(d);
            return { ...d, amount, created };
          })
          .filter(d => d.created && d.created >= eightWeeksAgo)
          .sort((a, b) => b.amount - a.amount);
      }

      const totalCreated = pipeGenDeals.reduce((s, d) => s + d.amount, 0);
      const weeklyAvg = pipeGenDeals.length > 0 ? totalCreated / 8 : 0;

      const isSpecificWeek = (ctx as any).week_label;
      const title = isSpecificWeek
        ? `Pipeline Generated: ${fmt(value)} (Week of ${(ctx as any).week_label})`
        : `Pipeline Generated: ${fmt(value)}`;
      const explanation = isSpecificWeek
        ? `Sum of amount for all deals created within the week ending ${(ctx as any).week_label}, regardless of current stage or status.`
        : 'Sum of amount for all deals created within the trailing 8-week window, regardless of current stage or status. This measures raw pipeline creation velocity.';
      const inputs = isSpecificWeek
        ? [
            { label: 'Week ending', value: (ctx as any).week_label },
            { label: 'Total created', value: fmt(totalCreated) },
            { label: 'Deals created', value: String(pipeGenDeals.length) },
          ]
        : [
            { label: 'Trailing period', value: '8 weeks' },
            { label: 'Total created', value: fmt(totalCreated) },
            { label: 'Weekly average', value: weeklyAvg > 0 ? `${fmt(weeklyAvg)}/wk` : 'N/A' },
            { label: 'Deals created', value: String(pipeGenDeals.length) },
          ];

      return {
        title,
        explanation,
        inputs,
        deals: pipeGenDeals.map(d => ({
          id: d.id,
          name: d.name || (d as any).dealname || (d as any).deal_name || 'Unnamed',
          amount: d.amount,
          stage: d.stage_normalized || (d as any).dealstage || '',
          stage_normalized: d.stage_normalized || '',
          probability: d.probability || 0,
          owner_name: d.owner_name || (d as any).hubspot_owner_id || '',
          owner_email: d.owner_email || '',
          created_date: d.created?.toISOString() || '',
          closeDate: d.close_date || (d as any).closedate || '',
          owner: d.owner_name || '',
        })),
        dealsLabel: 'Deals created (sorted by amount)',
      };
    }

    default:
      return { title: fmt(value), explanation: '' };
  }
}

// ============================================================================
// Level 3: SQL Queries (power user export)
// ============================================================================

export function getSqlQuery(
  metric: string,
  workspaceId: string,
  ctx: SqlQueryContext
): { sql: string; label: string } {
  const q = ctx.period || { start: '2026-01-01', end: '2026-03-31' };

  switch (metric) {
    case 'stage_weighted':
      return {
        label: ctx.repName
          ? `Stage Weighted — ${ctx.repName}`
          : 'Stage Weighted — All Reps',
        sql: `SELECT
  d.name AS deal_name,
  d.amount,
  d.stage_normalized AS stage,
  d.probability,
  ROUND(d.amount * d.probability / 100, 0) AS weighted_value,
  d.owner_name AS rep,
  d.days_in_current_stage
FROM deals d
WHERE d.workspace_id = '${workspaceId}'
  AND d.close_date >= '${q.start}'
  AND d.close_date <= '${q.end}'
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  AND d.is_deleted = false
  ${ctx.repEmail ? `AND d.owner_email = '${ctx.repEmail}'` : ''}
ORDER BY weighted_value DESC`,
      };

    case 'category_weighted':
      return {
        label: 'Category Weighted Forecast',
        sql: `SELECT
  d.forecast_category,
  COUNT(*) AS deal_count,
  SUM(d.amount) AS total_pipeline,
  CASE d.forecast_category
    WHEN 'Commit' THEN 0.90
    WHEN 'Best Case' THEN 0.60
    WHEN 'Pipeline' THEN 0.30
    ELSE 0.10
  END AS weight,
  ROUND(SUM(d.amount) * CASE d.forecast_category
    WHEN 'Commit' THEN 0.90
    WHEN 'Best Case' THEN 0.60
    WHEN 'Pipeline' THEN 0.30
    ELSE 0.10
  END, 0) AS weighted_value
FROM deals d
WHERE d.workspace_id = '${workspaceId}'
  AND d.close_date >= '${q.start}'
  AND d.close_date <= '${q.end}'
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  AND d.is_deleted = false
GROUP BY d.forecast_category
ORDER BY weighted_value DESC`,
      };

    case 'closed_won':
      return {
        label: `Closed Won Deals — ${q.start} to ${q.end}`,
        sql: `SELECT
  d.name AS deal_name,
  d.amount,
  d.closed_at::date AS close_date,
  d.owner_name AS rep,
  a.name AS account
FROM deals d
LEFT JOIN accounts a ON d.account_id = a.id
WHERE d.workspace_id = '${workspaceId}'
  AND d.stage_normalized = 'closed_won'
  AND d.closed_at >= '${q.start}'
  AND d.closed_at <= '${q.end}'
  AND d.is_deleted = false
ORDER BY d.amount DESC`,
      };

    case 'gap_to_quota':
      return {
        label: 'Quota vs Attainment by Rep',
        sql: `SELECT
  q.rep_email,
  q.quota_amount AS quota,
  COALESCE(SUM(d.amount), 0) AS closed_won,
  ROUND(COALESCE(SUM(d.amount), 0) / NULLIF(q.quota_amount, 0) * 100, 1) AS attainment_pct,
  q.quota_amount - COALESCE(SUM(d.amount), 0) AS gap
FROM quotas q
LEFT JOIN deals d ON d.owner_email = q.rep_email
  AND d.workspace_id = '${workspaceId}'
  AND d.stage_normalized = 'closed_won'
  AND d.closed_at >= '${q.start}'
  AND d.closed_at <= '${q.end}'
  AND d.is_deleted = false
WHERE q.workspace_id = '${workspaceId}'
  AND q.period_start <= '${q.end}'
  AND q.period_end >= '${q.start}'
GROUP BY q.rep_email, q.quota_amount
ORDER BY gap DESC`,
      };

    case 'coverage':
      return {
        label: 'Pipeline Coverage by Rep',
        sql: `SELECT
  d.owner_name AS rep,
  d.owner_email,
  COUNT(*) AS deal_count,
  SUM(d.amount) AS open_pipeline,
  q.quota_amount AS quota,
  COALESCE(w.closed_won, 0) AS closed_won,
  q.quota_amount - COALESCE(w.closed_won, 0) AS remaining_quota,
  ROUND(SUM(d.amount) / NULLIF(q.quota_amount - COALESCE(w.closed_won, 0), 0), 2) AS coverage_ratio
FROM deals d
LEFT JOIN quotas q ON q.rep_email = d.owner_email
  AND q.workspace_id = d.workspace_id
  AND q.period_start <= '${q.end}'
  AND q.period_end >= '${q.start}'
LEFT JOIN LATERAL (
  SELECT SUM(amount) AS closed_won
  FROM deals
  WHERE owner_email = d.owner_email
    AND workspace_id = '${workspaceId}'
    AND stage_normalized = 'closed_won'
    AND closed_at >= '${q.start}'
    AND closed_at <= '${q.end}'
) w ON true
WHERE d.workspace_id = '${workspaceId}'
  AND d.close_date >= '${q.start}'
  AND d.close_date <= '${q.end}'
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  AND d.is_deleted = false
GROUP BY d.owner_name, d.owner_email, q.quota_amount, w.closed_won
ORDER BY coverage_ratio ASC`,
      };

    case 'pipe_gen':
      return {
        label: 'Pipeline Generated by Week',
        sql: `SELECT
  DATE_TRUNC('week', d.created_date)::date AS week_start,
  COUNT(*) AS deals_created,
  SUM(d.amount) AS pipeline_created,
  AVG(d.amount) AS avg_deal_size
FROM deals d
WHERE d.workspace_id = '${workspaceId}'
  AND d.created_date >= NOW() - INTERVAL '8 weeks'
  AND d.is_deleted = false
GROUP BY DATE_TRUNC('week', d.created_date)
ORDER BY week_start DESC`,
      };

    case 'attainment':
      return {
        label: ctx.repName ? `Attainment — ${ctx.repName}` : 'Attainment by Rep',
        sql: `SELECT
  d.name AS deal_name,
  d.amount,
  d.closed_at::date AS close_date,
  d.owner_name AS rep
FROM deals d
WHERE d.workspace_id = '${workspaceId}'
  AND d.stage_normalized = 'closed_won'
  AND d.closed_at >= '${q.start}'
  AND d.closed_at <= '${q.end}'
  ${ctx.repEmail ? `AND d.owner_email = '${ctx.repEmail}'` : ''}
  AND d.is_deleted = false
ORDER BY d.closed_at DESC`,
      };

    default:
      return { label: 'Deals', sql: `SELECT * FROM deals WHERE workspace_id = '${workspaceId}' LIMIT 50` };
  }
}
