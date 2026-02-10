import { query } from '../db.js';

interface GroupStats {
  count: number;
  totalValue: number;
  avgValue: number;
}

export function aggregateBy<T>(
  items: T[],
  groupBy: (item: T) => string,
  valueOf: (item: T) => number
): Record<string, GroupStats> {
  const groups: Record<string, { count: number; total: number }> = {};

  for (const item of items) {
    const key = groupBy(item) || 'Unknown';
    if (!groups[key]) groups[key] = { count: 0, total: 0 };
    groups[key].count++;
    groups[key].total += valueOf(item) || 0;
  }

  const result: Record<string, GroupStats> = {};
  for (const [key, g] of Object.entries(groups)) {
    result[key] = {
      count: g.count,
      totalValue: Math.round(g.total),
      avgValue: g.count > 0 ? Math.round(g.total / g.count) : 0,
    };
  }
  return result;
}

interface BucketStats {
  count: number;
  totalValue: number;
}

export function bucketByThreshold<T>(
  items: T[],
  valueOf: (item: T) => number,
  amountOf: (item: T) => number,
  thresholds: number[],
  labels?: string[]
): Record<string, BucketStats> {
  const sorted = [...thresholds].sort((a, b) => a - b);
  const result: Record<string, BucketStats> = {};

  const bucketLabels: string[] = [];
  for (let i = 0; i <= sorted.length; i++) {
    if (labels && labels[i]) {
      bucketLabels.push(labels[i]);
    } else if (i === 0) {
      bucketLabels.push(`0-${sorted[0]}`);
    } else if (i === sorted.length) {
      bucketLabels.push(`${sorted[i - 1]}+`);
    } else {
      bucketLabels.push(`${sorted[i - 1]}-${sorted[i]}`);
    }
    result[bucketLabels[i]] = { count: 0, totalValue: 0 };
  }

  for (const item of items) {
    const val = valueOf(item);
    const amt = amountOf(item) || 0;
    let placed = false;
    for (let i = 0; i < sorted.length; i++) {
      if (val < sorted[i]) {
        result[bucketLabels[i]].count++;
        result[bucketLabels[i]].totalValue += amt;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const lastLabel = bucketLabels[bucketLabels.length - 1];
      result[lastLabel].count++;
      result[lastLabel].totalValue += amt;
    }
  }

  for (const key of Object.keys(result)) {
    result[key].totalValue = Math.round(result[key].totalValue);
  }

  return result;
}

interface TopNResult<T> {
  topItems: T[];
  remaining: { count: number; totalValue: number };
}

export function topNWithSummary<T>(
  items: T[],
  n: number,
  sortBy: (item: T) => number,
  amountOf: (item: T) => number,
  descending: boolean = true
): TopNResult<T> {
  const sorted = [...items].sort((a, b) =>
    descending ? sortBy(b) - sortBy(a) : sortBy(a) - sortBy(b)
  );

  const topItems = sorted.slice(0, n);
  const rest = sorted.slice(n);

  return {
    topItems,
    remaining: {
      count: rest.length,
      totalValue: Math.round(rest.reduce((sum, item) => sum + (amountOf(item) || 0), 0)),
    },
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export interface DealSummary {
  total: number;
  totalValue: number;
  avgValue: number;
  medianValue: number;
  byStage: Record<string, { count: number; value: number }>;
  byOwner: Record<string, { count: number; value: number }>;
}

export function summarizeDeals(deals: any[]): DealSummary {
  const amounts = deals.map(d => parseFloat(d.amount) || 0);
  const totalValue = amounts.reduce((s, v) => s + v, 0);

  const byStage: Record<string, { count: number; value: number }> = {};
  const byOwner: Record<string, { count: number; value: number }> = {};

  for (const deal of deals) {
    const stage = deal.stage_normalized || deal.stage || 'Unknown';
    const owner = deal.owner || 'Unassigned';
    const amt = parseFloat(deal.amount) || 0;

    if (!byStage[stage]) byStage[stage] = { count: 0, value: 0 };
    byStage[stage].count++;
    byStage[stage].value += amt;

    if (!byOwner[owner]) byOwner[owner] = { count: 0, value: 0 };
    byOwner[owner].count++;
    byOwner[owner].value += amt;
  }

  for (const v of Object.values(byStage)) v.value = Math.round(v.value);
  for (const v of Object.values(byOwner)) v.value = Math.round(v.value);

  return {
    total: deals.length,
    totalValue: Math.round(totalValue),
    avgValue: deals.length > 0 ? Math.round(totalValue / deals.length) : 0,
    medianValue: median(amounts),
    byStage,
    byOwner,
  };
}

export interface StaleDealItem {
  name: string;
  amount: number;
  stage: string;
  daysStale: number;
  owner: string;
  lastActivityType: string | null;
  contactCount: number | null;
}

export function pickStaleDealFields(deal: any): StaleDealItem {
  const lastActivity = deal.last_activity_date ? new Date(deal.last_activity_date) : null;
  const daysStale = lastActivity
    ? Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  return {
    name: deal.deal_name || deal.name || 'Unnamed',
    amount: parseFloat(deal.amount) || 0,
    stage: deal.stage_normalized || deal.stage || 'Unknown',
    daysStale,
    owner: deal.owner || 'Unassigned',
    lastActivityType: deal.last_activity_type || null,
    contactCount: deal.contact_count != null ? parseInt(deal.contact_count, 10) : null,
  };
}

export interface ClosingSoonItem {
  name: string;
  amount: number;
  stage: string;
  closeDate: string;
  owner: string;
  healthScore: number | null;
  dealRisk: number | null;
}

export function pickClosingSoonFields(deal: any): ClosingSoonItem {
  return {
    name: deal.deal_name || deal.name || 'Unnamed',
    amount: parseFloat(deal.amount) || 0,
    stage: deal.stage_normalized || deal.stage || 'Unknown',
    closeDate: deal.close_date || 'Unknown',
    owner: deal.owner || 'Unassigned',
    healthScore: deal.health_score != null ? parseFloat(deal.health_score) : null,
    dealRisk: deal.deal_risk != null ? parseFloat(deal.deal_risk) : null,
  };
}

// ============================================================================
// Time Window Resolution
// ============================================================================

export interface TimeWindows {
  analysisRange: { start: Date; end: Date };
  changeRange: { start: Date; end: Date };
  previousPeriodRange: { start: Date; end: Date } | null;
  lastRunAt: Date | null;
}

export interface TimeConfig {
  analysisWindow: 'current_quarter' | 'current_month' | 'trailing_90d' | 'trailing_30d' | 'all_time';
  changeWindow: 'since_last_run' | 'last_7d' | 'last_14d' | 'last_30d';
  trendComparison: 'previous_period' | 'same_period_last_quarter' | 'none';
}

function getQuarterBounds(date: Date): { start: Date; end: Date } {
  const month = date.getMonth();
  const year = date.getFullYear();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  const start = new Date(year, quarterStartMonth, 1);
  const end = new Date(year, quarterStartMonth + 3, 0, 23, 59, 59);
  return { start, end };
}

function getMonthBounds(date: Date): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59);
  return { start, end };
}

export function resolveTimeWindows(
  config: TimeConfig,
  lastRunAt: Date | null,
  now: Date = new Date()
): TimeWindows {
  // Resolve analysis range
  let analysisRange: { start: Date; end: Date };
  switch (config.analysisWindow) {
    case 'current_quarter':
      analysisRange = getQuarterBounds(now);
      break;
    case 'current_month':
      analysisRange = getMonthBounds(now);
      break;
    case 'trailing_90d':
      analysisRange = {
        start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
        end: now,
      };
      break;
    case 'trailing_30d':
      analysisRange = {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        end: now,
      };
      break;
    case 'all_time':
    default:
      analysisRange = {
        start: new Date('2000-01-01'),
        end: now,
      };
  }

  // Resolve change range
  let changeRange: { start: Date; end: Date };
  if (config.changeWindow === 'since_last_run' && lastRunAt) {
    changeRange = { start: lastRunAt, end: now };
  } else {
    const days =
      config.changeWindow === 'last_30d' ? 30 :
      config.changeWindow === 'last_14d' ? 14 : 7;
    changeRange = {
      start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
      end: now,
    };
  }

  // Resolve previous period range
  let previousPeriodRange: { start: Date; end: Date } | null = null;
  if (config.trendComparison === 'previous_period') {
    const duration = analysisRange.end.getTime() - analysisRange.start.getTime();
    previousPeriodRange = {
      start: new Date(analysisRange.start.getTime() - duration),
      end: new Date(analysisRange.start.getTime() - 1),
    };
  } else if (config.trendComparison === 'same_period_last_quarter') {
    const startDate = new Date(analysisRange.start);
    startDate.setMonth(startDate.getMonth() - 3);
    const endDate = new Date(analysisRange.end);
    endDate.setMonth(endDate.getMonth() - 3);
    previousPeriodRange = { start: startDate, end: endDate };
  }

  return {
    analysisRange,
    changeRange,
    previousPeriodRange,
    lastRunAt,
  };
}

// ============================================================================
// Period Comparison
// ============================================================================

export interface PeriodComparison {
  current: DealSummary;
  previous: DealSummary | null;
  deltas: Array<{
    field: string;
    current: number;
    previous: number;
    delta: number;
    percentChange: number;
    direction: 'up' | 'down' | 'flat';
  }>;
}

export function comparePeriods(
  current: DealSummary,
  previous: DealSummary | null
): PeriodComparison {
  if (!previous) {
    return { current, previous: null, deltas: [] };
  }

  const calculateDelta = (field: string, curr: number, prev: number) => {
    const delta = curr - prev;
    const percentChange = prev !== 0 ? (delta / prev) * 100 : 0;
    return {
      field,
      current: curr,
      previous: prev,
      delta,
      percentChange: Math.round(percentChange * 10) / 10,
      direction: delta > 0 ? 'up' as const : delta < 0 ? 'down' as const : 'flat' as const,
    };
  };

  return {
    current,
    previous,
    deltas: [
      calculateDelta('totalValue', current.totalValue, previous.totalValue),
      calculateDelta('total', current.total, previous.total),
      calculateDelta('avgValue', current.avgValue, previous.avgValue),
      calculateDelta('medianValue', current.medianValue, previous.medianValue),
    ],
  };
}

// ============================================================================
// Deal Threading Analysis
// ============================================================================

export interface ThreadingDeal {
  dealId: string;
  dealName: string;
  amount: number;
  stage: string;
  owner: string;
  contactCount: number;
  contactNames: string[];
  primaryContactName: string | null;
  primaryContactTitle: string | null;
  primaryContactSeniority: string | null;
  daysInStage: number;
  lastActivityDate: string | null;
  accountName: string | null;
  accountId: string | null;
}

export interface ThreadingAnalysis {
  summary: {
    totalOpenDeals: number;
    singleThreaded: { count: number; value: number };
    doubleThreaded: { count: number; value: number };
    multiThreaded: { count: number; value: number };
    singleThreadedPctOfPipeline: number;
    avgDealSize: number;
  };
  byStage: Record<string, { count: number; value: number }>;
  byOwner: Record<string, { totalDeals: number; singleThreaded: number; pct: number }>;
  criticalDeals: ThreadingDeal[];
  warningDeals: ThreadingDeal[];
}

export interface EnrichedDeal extends ThreadingDeal {
  totalContactsAtAccount: number;
  otherOpenDealsAtAccount: number;
  mostRecentActivityType: string | null;
  mostRecentActivityDate: string | null;
}

// ============================================================================
// Deal Threading Analysis Implementation
// ============================================================================

export async function dealThreadingAnalysis(workspaceId: string): Promise<ThreadingAnalysis> {
  // Get all open deals with contact counts
  const dealsResult = await query(`
    SELECT 
      d.id as deal_id,
      d.name as deal_name,
      d.amount,
      d.stage_normalized as stage,
      d.owner,
      d.days_in_stage,
      d.last_activity_date,
      d.account_id,
      COALESCE(a.name, '') as account_name,
      COALESCE(pc.email, '') as primary_contact_email,
      COALESCE(pc.first_name || ' ' || pc.last_name, '') as primary_contact_name,
      pc.title as primary_contact_title,
      pc.seniority as primary_contact_seniority,
      (
        SELECT COUNT(DISTINCT contact_email)
        FROM (
          SELECT COALESCE(c1.email, '') as contact_email
          FROM contacts c1
          WHERE c1.id = d.contact_id AND c1.workspace_id = $1
          UNION
          SELECT COALESCE(c2.email, '') as contact_email
          FROM activities act
          INNER JOIN contacts c2 ON act.contact_id = c2.id AND act.workspace_id = $1
          WHERE act.deal_id = d.id AND act.workspace_id = $1 AND c2.email IS NOT NULL AND c2.email != ''
        ) contacts
        WHERE contact_email != ''
      ) as contact_count,
      (
        SELECT STRING_AGG(DISTINCT COALESCE(c3.first_name || ' ' || c3.last_name, ''), ', ')
        FROM (
          SELECT c1.first_name, c1.last_name
          FROM contacts c1
          WHERE c1.id = d.contact_id AND c1.workspace_id = $1
          UNION
          SELECT c2.first_name, c2.last_name
          FROM activities act
          INNER JOIN contacts c2 ON act.contact_id = c2.id AND act.workspace_id = $1
          WHERE act.deal_id = d.id AND act.workspace_id = $1
          LIMIT 5
        ) c3
      ) as contact_names
    FROM deals d
    LEFT JOIN accounts a ON d.account_id = a.id AND a.workspace_id = $1
    LEFT JOIN contacts pc ON d.contact_id = pc.id AND pc.workspace_id = $1
    WHERE d.workspace_id = $1
      AND (d.stage_normalized IS NULL
           OR d.stage_normalized NOT IN ('closed_won', 'closed_lost'))
    ORDER BY d.amount DESC
  `, [workspaceId]);

  const deals: ThreadingDeal[] = dealsResult.rows.map((row: any) => ({
    dealId: row.deal_id,
    dealName: row.deal_name || 'Unnamed Deal',
    amount: parseFloat(row.amount) || 0,
    stage: row.stage || 'Unknown',
    owner: row.owner || 'Unassigned',
    contactCount: parseInt(row.contact_count, 10) || 0,
    contactNames: (row.contact_names || '').split(', ').filter((n: string) => n),
    primaryContactName: row.primary_contact_name || null,
    primaryContactTitle: row.primary_contact_title || null,
    primaryContactSeniority: row.primary_contact_seniority || null,
    daysInStage: parseInt(row.days_in_stage, 10) || 0,
    lastActivityDate: row.last_activity_date || null,
    accountName: row.account_name || null,
    accountId: row.account_id || null,
  }));

  // Calculate summary stats
  const totalOpenDeals = deals.length;
  const avgDealSize = totalOpenDeals > 0 
    ? Math.round(deals.reduce((sum, d) => sum + d.amount, 0) / totalOpenDeals)
    : 0;

  const singleThreaded = deals.filter(d => d.contactCount <= 1);
  const doubleThreaded = deals.filter(d => d.contactCount === 2);
  const multiThreaded = deals.filter(d => d.contactCount >= 3);

  const singleThreadedValue = singleThreaded.reduce((sum, d) => sum + d.amount, 0);
  const totalPipelineValue = deals.reduce((sum, d) => sum + d.amount, 0);
  const singleThreadedPct = totalPipelineValue > 0 
    ? Math.round((singleThreadedValue / totalPipelineValue) * 100)
    : 0;

  // Group by stage
  const byStage: Record<string, { count: number; value: number }> = {};
  for (const deal of singleThreaded) {
    if (!byStage[deal.stage]) {
      byStage[deal.stage] = { count: 0, value: 0 };
    }
    byStage[deal.stage].count++;
    byStage[deal.stage].value += deal.amount;
  }

  // Round stage values
  for (const stage of Object.keys(byStage)) {
    byStage[stage].value = Math.round(byStage[stage].value);
  }

  // Group by owner
  const ownerStats: Record<string, { totalDeals: number; singleThreaded: number }> = {};
  for (const deal of deals) {
    if (!ownerStats[deal.owner]) {
      ownerStats[deal.owner] = { totalDeals: 0, singleThreaded: 0 };
    }
    ownerStats[deal.owner].totalDeals++;
    if (deal.contactCount <= 1) {
      ownerStats[deal.owner].singleThreaded++;
    }
  }

  const byOwner: Record<string, { totalDeals: number; singleThreaded: number; pct: number }> = {};
  for (const [owner, stats] of Object.entries(ownerStats)) {
    byOwner[owner] = {
      totalDeals: stats.totalDeals,
      singleThreaded: stats.singleThreaded,
      pct: stats.totalDeals > 0 ? Math.round((stats.singleThreaded / stats.totalDeals) * 100) : 0,
    };
  }

  // Identify critical and warning deals
  const criticalStages = ['evaluation', 'decision', 'proposal', 'negotiation'];
  const criticalDeals = singleThreaded
    .filter(d => criticalStages.includes(d.stage.toLowerCase()) || d.amount > avgDealSize)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15);

  const warningDeals = singleThreaded
    .filter(d => !criticalStages.includes(d.stage.toLowerCase()) && d.amount <= avgDealSize)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15);

  return {
    summary: {
      totalOpenDeals,
      singleThreaded: {
        count: singleThreaded.length,
        value: Math.round(singleThreadedValue),
      },
      doubleThreaded: {
        count: doubleThreaded.length,
        value: Math.round(doubleThreaded.reduce((sum, d) => sum + d.amount, 0)),
      },
      multiThreaded: {
        count: multiThreaded.length,
        value: Math.round(multiThreaded.reduce((sum, d) => sum + d.amount, 0)),
      },
      singleThreadedPctOfPipeline: singleThreadedPct,
      avgDealSize,
    },
    byStage,
    byOwner,
    criticalDeals,
    warningDeals,
  };
}

export async function enrichCriticalDeals(
  workspaceId: string,
  dealIds: string[]
): Promise<EnrichedDeal[]> {
  if (dealIds.length === 0) {
    return [];
  }

  const result = await query(`
    SELECT 
      d.id as deal_id,
      d.name as deal_name,
      d.amount,
      d.stage_normalized as stage,
      d.owner,
      d.days_in_stage,
      d.last_activity_date,
      d.account_id,
      COALESCE(a.name, '') as account_name,
      COALESCE(pc.first_name || ' ' || pc.last_name, '') as primary_contact_name,
      pc.title as primary_contact_title,
      pc.seniority as primary_contact_seniority,
      (
        SELECT COUNT(DISTINCT contact_email)
        FROM (
          SELECT COALESCE(c1.email, '') as contact_email
          FROM contacts c1
          WHERE c1.id = d.contact_id AND c1.workspace_id = $1
          UNION
          SELECT COALESCE(c2.email, '') as contact_email
          FROM activities act
          INNER JOIN contacts c2 ON act.contact_id = c2.id AND act.workspace_id = $1
          WHERE act.deal_id = d.id AND act.workspace_id = $1
        ) contacts
        WHERE contact_email != ''
      ) as contact_count,
      (
        SELECT STRING_AGG(DISTINCT COALESCE(c3.first_name || ' ' || c3.last_name, ''), ', ')
        FROM (
          SELECT c1.first_name, c1.last_name
          FROM contacts c1
          WHERE c1.id = d.contact_id AND c1.workspace_id = $1
          UNION
          SELECT c2.first_name, c2.last_name
          FROM activities act
          INNER JOIN contacts c2 ON act.contact_id = c2.id AND act.workspace_id = $1
          WHERE act.deal_id = d.id AND act.workspace_id = $1
          LIMIT 5
        ) c3
      ) as contact_names,
      (
        SELECT COUNT(*)
        FROM contacts c
        WHERE c.account_id = d.account_id AND c.workspace_id = $1
      ) as total_contacts_at_account,
      (
        SELECT COUNT(*)
        FROM deals d2
        WHERE d2.account_id = d.account_id 
          AND d2.workspace_id = $1
          AND d2.id != d.id
          AND (d2.stage_normalized IS NULL
               OR d2.stage_normalized NOT IN ('closed_won', 'closed_lost'))
      ) as other_open_deals_at_account,
      (
        SELECT act.type
        FROM activities act
        WHERE act.deal_id = d.id AND act.workspace_id = $1
        ORDER BY act.date DESC
        LIMIT 1
      ) as most_recent_activity_type,
      (
        SELECT act.date
        FROM activities act
        WHERE act.deal_id = d.id AND act.workspace_id = $1
        ORDER BY act.date DESC
        LIMIT 1
      ) as most_recent_activity_date
    FROM deals d
    LEFT JOIN accounts a ON d.account_id = a.id AND a.workspace_id = $1
    LEFT JOIN contacts pc ON d.contact_id = pc.id AND pc.workspace_id = $1
    WHERE d.workspace_id = $1 AND d.id = ANY($2)
  `, [workspaceId, dealIds]);

  return result.rows.map((row: any) => ({
    dealId: row.deal_id,
    dealName: row.deal_name || 'Unnamed Deal',
    amount: parseFloat(row.amount) || 0,
    stage: row.stage || 'Unknown',
    owner: row.owner || 'Unassigned',
    contactCount: parseInt(row.contact_count, 10) || 0,
    contactNames: (row.contact_names || '').split(', ').filter((n: string) => n),
    primaryContactName: row.primary_contact_name || null,
    primaryContactTitle: row.primary_contact_title || null,
    primaryContactSeniority: row.primary_contact_seniority || null,
    daysInStage: parseInt(row.days_in_stage, 10) || 0,
    lastActivityDate: row.last_activity_date || null,
    accountName: row.account_name || null,
    accountId: row.account_id || null,
    totalContactsAtAccount: parseInt(row.total_contacts_at_account, 10) || 0,
    otherOpenDealsAtAccount: parseInt(row.other_open_deals_at_account, 10) || 0,
    mostRecentActivityType: row.most_recent_activity_type || null,
    mostRecentActivityDate: row.most_recent_activity_date || null,
  }));
}
