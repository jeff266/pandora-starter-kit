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
  analysisWindow: 'current_quarter' | 'current_month' | 'trailing_90d' | 'trailing_30d' | 'trailing_7d' | 'all_time';
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
    case 'trailing_7d':
      analysisRange = {
        start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
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

export function formatQuarterLabel(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
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
        SELECT COUNT(DISTINCT contact_id)
        FROM (
          -- Primary contact
          SELECT d.contact_id::text
          WHERE d.contact_id IS NOT NULL
          UNION
          -- Contacts from activities
          SELECT act.contact_id::text
          FROM activities act
          WHERE act.deal_id = d.id AND act.workspace_id = $1 AND act.contact_id IS NOT NULL
          UNION
          -- Contacts from HubSpot associations (source_data JSONB)
          SELECT (assoc->>'id')::text as contact_id
          FROM jsonb_array_elements(
            COALESCE(d.source_data->'associations'->'contacts'->'results', '[]'::jsonb)
          ) as assoc
          WHERE assoc->>'type' = 'deal_to_contact'
        ) all_contacts
        WHERE contact_id IS NOT NULL
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
    .filter(d => {
      const stage = d.stage ? d.stage.toLowerCase() : '';
      return criticalStages.includes(stage) || d.amount > avgDealSize;
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15);

  const warningDeals = singleThreaded
    .filter(d => {
      const stage = d.stage ? d.stage.toLowerCase() : '';
      return !criticalStages.includes(stage) && d.amount <= avgDealSize;
    })
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
        SELECT COUNT(DISTINCT contact_id)
        FROM (
          -- Primary contact
          SELECT d.contact_id::text
          WHERE d.contact_id IS NOT NULL
          UNION
          -- Contacts from activities
          SELECT act.contact_id::text
          FROM activities act
          WHERE act.deal_id = d.id AND act.workspace_id = $1 AND act.contact_id IS NOT NULL
          UNION
          -- Contacts from HubSpot associations (source_data JSONB)
          SELECT (assoc->>'id')::text as contact_id
          FROM jsonb_array_elements(
            COALESCE(d.source_data->'associations'->'contacts'->'results', '[]'::jsonb)
          ) as assoc
          WHERE assoc->>'type' = 'deal_to_contact'
        ) all_contacts
        WHERE contact_id IS NOT NULL
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
        SELECT act.activity_type
        FROM activities act
        WHERE act.deal_id = d.id AND act.workspace_id = $1
        ORDER BY act.timestamp DESC
        LIMIT 1
      ) as most_recent_activity_type,
      (
        SELECT act.timestamp
        FROM activities act
        WHERE act.deal_id = d.id AND act.workspace_id = $1
        ORDER BY act.timestamp DESC
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

// ============================================================================
// Data Quality Audit
// ============================================================================

interface FieldCompleteness {
  field: string;
  filled: number;
  total: number;
  fillRate: number;
  isCritical: boolean;
}

interface EntityQualityMetrics {
  total: number;
  fieldCompleteness: FieldCompleteness[];
  issues: Record<string, number>;
}

interface WorstOffender {
  entity: 'deal' | 'contact' | 'account';
  id: string;
  name: string;
  owner: string;
  missingFields: string[];
  completeness: number;
  impact: 'high' | 'medium' | 'low';
}

interface OwnerQualityBreakdown {
  owner: string;
  totalRecords: number;
  avgCompleteness: number;
  criticalIssues: number;
}

export interface DataQualityAudit {
  overall: {
    totalRecords: number;
    overallCompleteness: number;
    criticalFieldCompleteness: number;
  };
  byEntity: {
    deals: EntityQualityMetrics;
    contacts: EntityQualityMetrics;
    accounts: EntityQualityMetrics;
  };
  worstOffenders: WorstOffender[];
  ownerBreakdown: OwnerQualityBreakdown[];
}

export async function dataQualityAudit(workspaceId: string): Promise<DataQualityAudit> {
  // Critical fields defaults (TODO: check context layer for quality_critical_fields)
  const criticalFields = {
    deals: ['amount', 'stage', 'close_date', 'owner', 'account_id'],
    contacts: ['email', 'first_name', 'last_name', 'account_id'],
    accounts: ['name', 'domain'],
  };

  // ===== DEALS ANALYSIS =====
  const dealsFieldStats = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(amount) as amount_filled,
      COUNT(stage_normalized) as stage_filled,
      COUNT(close_date) as close_date_filled,
      COUNT(owner) as owner_filled,
      COUNT(account_id) as account_id_filled,
      COUNT(name) as name_filled
    FROM deals
    WHERE workspace_id = $1
  `, [workspaceId]);

  const dealsIssues = await query(`
    SELECT
      COUNT(*) FILTER (WHERE amount IS NULL) as missing_amount,
      COUNT(*) FILTER (WHERE close_date IS NULL) as missing_close_date,
      COUNT(*) FILTER (WHERE owner IS NULL) as missing_owner,
      COUNT(*) FILTER (WHERE stage_normalized IS NULL) as missing_stage,
      COUNT(*) FILTER (WHERE account_id IS NULL) as missing_account,
      COUNT(*) FILTER (WHERE amount = 0 OR amount IS NULL AND (stage_normalized IS NULL OR stage_normalized NOT IN ('closed_won', 'closed_lost'))) as zero_amount,
      COUNT(*) FILTER (WHERE close_date < CURRENT_DATE AND (stage_normalized IS NULL OR stage_normalized NOT IN ('closed_won', 'closed_lost'))) as close_date_in_past,
      (
        SELECT COUNT(*)
        FROM (
          SELECT LOWER(name), account_id, COUNT(*) as cnt
          FROM deals
          WHERE workspace_id = $1 AND account_id IS NOT NULL
          GROUP BY LOWER(name), account_id
          HAVING COUNT(*) > 1
        ) dupes
      ) as duplicate_suspects
    FROM deals
    WHERE workspace_id = $1
  `, [workspaceId]);

  const dealsTotal = parseInt(dealsFieldStats.rows[0].total, 10) || 0;
  const dealsFieldCompleteness: FieldCompleteness[] = [
    {
      field: 'amount',
      filled: parseInt(dealsFieldStats.rows[0].amount_filled, 10) || 0,
      total: dealsTotal,
      fillRate: dealsTotal > 0 ? Math.round(((parseInt(dealsFieldStats.rows[0].amount_filled, 10) || 0) / dealsTotal) * 100) : 0,
      isCritical: criticalFields.deals.includes('amount'),
    },
    {
      field: 'stage',
      filled: parseInt(dealsFieldStats.rows[0].stage_filled, 10) || 0,
      total: dealsTotal,
      fillRate: dealsTotal > 0 ? Math.round(((parseInt(dealsFieldStats.rows[0].stage_filled, 10) || 0) / dealsTotal) * 100) : 0,
      isCritical: criticalFields.deals.includes('stage'),
    },
    {
      field: 'close_date',
      filled: parseInt(dealsFieldStats.rows[0].close_date_filled, 10) || 0,
      total: dealsTotal,
      fillRate: dealsTotal > 0 ? Math.round(((parseInt(dealsFieldStats.rows[0].close_date_filled, 10) || 0) / dealsTotal) * 100) : 0,
      isCritical: criticalFields.deals.includes('close_date'),
    },
    {
      field: 'owner',
      filled: parseInt(dealsFieldStats.rows[0].owner_filled, 10) || 0,
      total: dealsTotal,
      fillRate: dealsTotal > 0 ? Math.round(((parseInt(dealsFieldStats.rows[0].owner_filled, 10) || 0) / dealsTotal) * 100) : 0,
      isCritical: criticalFields.deals.includes('owner'),
    },
    {
      field: 'account_id',
      filled: parseInt(dealsFieldStats.rows[0].account_id_filled, 10) || 0,
      total: dealsTotal,
      fillRate: dealsTotal > 0 ? Math.round(((parseInt(dealsFieldStats.rows[0].account_id_filled, 10) || 0) / dealsTotal) * 100) : 0,
      isCritical: criticalFields.deals.includes('account_id'),
    },
    {
      field: 'name',
      filled: parseInt(dealsFieldStats.rows[0].name_filled, 10) || 0,
      total: dealsTotal,
      fillRate: dealsTotal > 0 ? Math.round(((parseInt(dealsFieldStats.rows[0].name_filled, 10) || 0) / dealsTotal) * 100) : 0,
      isCritical: false,
    },
  ];

  // ===== CONTACTS ANALYSIS =====
  const contactsFieldStats = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(email) as email_filled,
      COUNT(first_name) as first_name_filled,
      COUNT(last_name) as last_name_filled,
      COUNT(title) as title_filled,
      COUNT(account_id) as account_id_filled
    FROM contacts
    WHERE workspace_id = $1
  `, [workspaceId]);

  const contactsIssues = await query(`
    SELECT
      COUNT(*) FILTER (WHERE email IS NULL) as missing_email,
      COUNT(*) FILTER (WHERE first_name IS NULL AND last_name IS NULL) as missing_name,
      COUNT(*) FILTER (WHERE title IS NULL) as missing_title,
      COUNT(*) FILTER (WHERE account_id IS NULL) as missing_account,
      (
        SELECT COUNT(*)
        FROM (
          SELECT email, COUNT(*) as cnt
          FROM contacts
          WHERE workspace_id = $1 AND email IS NOT NULL
          GROUP BY email
          HAVING COUNT(*) > 1
        ) dupes
      ) as duplicate_suspects
    FROM contacts
    WHERE workspace_id = $1
  `, [workspaceId]);

  const contactsTotal = parseInt(contactsFieldStats.rows[0].total, 10) || 0;
  const contactsFieldCompleteness: FieldCompleteness[] = [
    {
      field: 'email',
      filled: parseInt(contactsFieldStats.rows[0].email_filled, 10) || 0,
      total: contactsTotal,
      fillRate: contactsTotal > 0 ? Math.round(((parseInt(contactsFieldStats.rows[0].email_filled, 10) || 0) / contactsTotal) * 100) : 0,
      isCritical: criticalFields.contacts.includes('email'),
    },
    {
      field: 'first_name',
      filled: parseInt(contactsFieldStats.rows[0].first_name_filled, 10) || 0,
      total: contactsTotal,
      fillRate: contactsTotal > 0 ? Math.round(((parseInt(contactsFieldStats.rows[0].first_name_filled, 10) || 0) / contactsTotal) * 100) : 0,
      isCritical: criticalFields.contacts.includes('first_name'),
    },
    {
      field: 'last_name',
      filled: parseInt(contactsFieldStats.rows[0].last_name_filled, 10) || 0,
      total: contactsTotal,
      fillRate: contactsTotal > 0 ? Math.round(((parseInt(contactsFieldStats.rows[0].last_name_filled, 10) || 0) / contactsTotal) * 100) : 0,
      isCritical: criticalFields.contacts.includes('last_name'),
    },
    {
      field: 'title',
      filled: parseInt(contactsFieldStats.rows[0].title_filled, 10) || 0,
      total: contactsTotal,
      fillRate: contactsTotal > 0 ? Math.round(((parseInt(contactsFieldStats.rows[0].title_filled, 10) || 0) / contactsTotal) * 100) : 0,
      isCritical: false,
    },
    {
      field: 'account_id',
      filled: parseInt(contactsFieldStats.rows[0].account_id_filled, 10) || 0,
      total: contactsTotal,
      fillRate: contactsTotal > 0 ? Math.round(((parseInt(contactsFieldStats.rows[0].account_id_filled, 10) || 0) / contactsTotal) * 100) : 0,
      isCritical: criticalFields.contacts.includes('account_id'),
    },
  ];

  // ===== ACCOUNTS ANALYSIS =====
  const accountsFieldStats = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(name) as name_filled,
      COUNT(domain) as domain_filled,
      COUNT(industry) as industry_filled,
      COUNT(employee_count) as employee_count_filled,
      COUNT(owner) as owner_filled
    FROM accounts
    WHERE workspace_id = $1
  `, [workspaceId]);

  const accountsIssues = await query(`
    SELECT
      COUNT(*) FILTER (WHERE domain IS NULL) as missing_domain,
      COUNT(*) FILTER (WHERE industry IS NULL) as missing_industry,
      (
        SELECT COUNT(*)
        FROM accounts a
        WHERE a.workspace_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM deals d WHERE d.account_id = a.id AND d.workspace_id = $1
          )
      ) as no_deals,
      (
        SELECT COUNT(*)
        FROM accounts a
        WHERE a.workspace_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM contacts c WHERE c.account_id = a.id AND c.workspace_id = $1
          )
      ) as no_contacts
    FROM accounts
    WHERE workspace_id = $1
  `, [workspaceId]);

  const accountsTotal = parseInt(accountsFieldStats.rows[0].total, 10) || 0;
  const accountsFieldCompleteness: FieldCompleteness[] = [
    {
      field: 'name',
      filled: parseInt(accountsFieldStats.rows[0].name_filled, 10) || 0,
      total: accountsTotal,
      fillRate: accountsTotal > 0 ? Math.round(((parseInt(accountsFieldStats.rows[0].name_filled, 10) || 0) / accountsTotal) * 100) : 0,
      isCritical: criticalFields.accounts.includes('name'),
    },
    {
      field: 'domain',
      filled: parseInt(accountsFieldStats.rows[0].domain_filled, 10) || 0,
      total: accountsTotal,
      fillRate: accountsTotal > 0 ? Math.round(((parseInt(accountsFieldStats.rows[0].domain_filled, 10) || 0) / accountsTotal) * 100) : 0,
      isCritical: criticalFields.accounts.includes('domain'),
    },
    {
      field: 'industry',
      filled: parseInt(accountsFieldStats.rows[0].industry_filled, 10) || 0,
      total: accountsTotal,
      fillRate: accountsTotal > 0 ? Math.round(((parseInt(accountsFieldStats.rows[0].industry_filled, 10) || 0) / accountsTotal) * 100) : 0,
      isCritical: false,
    },
    {
      field: 'employee_count',
      filled: parseInt(accountsFieldStats.rows[0].employee_count_filled, 10) || 0,
      total: accountsTotal,
      fillRate: accountsTotal > 0 ? Math.round(((parseInt(accountsFieldStats.rows[0].employee_count_filled, 10) || 0) / accountsTotal) * 100) : 0,
      isCritical: false,
    },
    {
      field: 'owner',
      filled: parseInt(accountsFieldStats.rows[0].owner_filled, 10) || 0,
      total: accountsTotal,
      fillRate: accountsTotal > 0 ? Math.round(((parseInt(accountsFieldStats.rows[0].owner_filled, 10) || 0) / accountsTotal) * 100) : 0,
      isCritical: false,
    },
  ];

  // ===== WORST OFFENDERS =====
  const worstOffendersResult = await query(`
    SELECT * FROM (
      -- Deals with missing critical fields
      SELECT
        'deal' as entity,
        d.id::text,
        d.name as record_name,
        COALESCE(d.owner, 'Unassigned') as owner,
        d.amount,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN d.amount IS NULL THEN 'amount' END,
          CASE WHEN d.stage_normalized IS NULL THEN 'stage' END,
          CASE WHEN d.close_date IS NULL THEN 'close_date' END,
          CASE WHEN d.owner IS NULL THEN 'owner' END,
          CASE WHEN d.account_id IS NULL THEN 'account_id' END
        ], NULL) as missing_fields,
        (5 - (
          CASE WHEN d.amount IS NULL THEN 1 ELSE 0 END +
          CASE WHEN d.stage_normalized IS NULL THEN 1 ELSE 0 END +
          CASE WHEN d.close_date IS NULL THEN 1 ELSE 0 END +
          CASE WHEN d.owner IS NULL THEN 1 ELSE 0 END +
          CASE WHEN d.account_id IS NULL THEN 1 ELSE 0 END
        )) * 20 as completeness,
        CASE
          WHEN d.amount > 50000 THEN 'high'
          WHEN d.amount > 10000 THEN 'medium'
          ELSE 'low'
        END as impact
      FROM deals d
      WHERE d.workspace_id = $1
        AND (d.amount IS NULL OR d.stage_normalized IS NULL OR d.close_date IS NULL
             OR d.owner IS NULL OR d.account_id IS NULL)

      UNION ALL

      -- Contacts with missing critical fields
      SELECT
        'contact' as entity,
        c.id::text,
        COALESCE(c.email, c.first_name || ' ' || c.last_name, 'Unnamed') as record_name,
        'N/A' as owner,
        0 as amount,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN c.email IS NULL THEN 'email' END,
          CASE WHEN c.first_name IS NULL THEN 'first_name' END,
          CASE WHEN c.last_name IS NULL THEN 'last_name' END,
          CASE WHEN c.account_id IS NULL THEN 'account_id' END
        ], NULL) as missing_fields,
        (4 - (
          CASE WHEN c.email IS NULL THEN 1 ELSE 0 END +
          CASE WHEN c.first_name IS NULL THEN 1 ELSE 0 END +
          CASE WHEN c.last_name IS NULL THEN 1 ELSE 0 END +
          CASE WHEN c.account_id IS NULL THEN 1 ELSE 0 END
        )) * 25 as completeness,
        'medium' as impact
      FROM contacts c
      WHERE c.workspace_id = $1
        AND (c.email IS NULL OR c.first_name IS NULL OR c.last_name IS NULL OR c.account_id IS NULL)

      UNION ALL

      -- Accounts with missing critical fields
      SELECT
        'account' as entity,
        a.id::text,
        COALESCE(a.name, 'Unnamed') as record_name,
        'N/A' as owner,
        0 as amount,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN a.name IS NULL THEN 'name' END,
          CASE WHEN a.domain IS NULL THEN 'domain' END
        ], NULL) as missing_fields,
        (2 - (
          CASE WHEN a.name IS NULL THEN 1 ELSE 0 END +
          CASE WHEN a.domain IS NULL THEN 1 ELSE 0 END
        )) * 50 as completeness,
        'medium' as impact
      FROM accounts a
      WHERE a.workspace_id = $1
        AND (a.name IS NULL OR a.domain IS NULL)
    ) all_offenders
    ORDER BY
      CASE impact WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      completeness ASC,
      amount DESC
    LIMIT 20
  `, [workspaceId]);

  const worstOffenders: WorstOffender[] = worstOffendersResult.rows.map((row: any) => ({
    entity: row.entity,
    id: row.id,
    name: row.record_name || 'Unnamed',
    owner: row.owner || 'Unassigned',
    missingFields: row.missing_fields || [],
    completeness: parseInt(row.completeness, 10) || 0,
    impact: row.impact,
  }));

  // ===== OWNER BREAKDOWN =====
  const ownerBreakdownResult = await query(`
    SELECT
      owner,
      total_records,
      critical_issues,
      CASE
        WHEN total_records > 0 THEN ROUND(((total_records - critical_issues)::numeric / total_records) * 100)
        ELSE 100
      END as avg_completeness
    FROM (
      SELECT
        COALESCE(owner, 'Unassigned') as owner,
        COUNT(*) as total_records,
        SUM(
          CASE WHEN amount IS NULL THEN 1 ELSE 0 END +
          CASE WHEN stage_normalized IS NULL THEN 1 ELSE 0 END +
          CASE WHEN close_date IS NULL THEN 1 ELSE 0 END +
          CASE WHEN account_id IS NULL THEN 1 ELSE 0 END
        ) as critical_issues
      FROM deals
      WHERE workspace_id = $1
      GROUP BY owner
    ) owner_stats
    ORDER BY critical_issues DESC, total_records DESC
  `, [workspaceId]);

  const ownerBreakdown: OwnerQualityBreakdown[] = ownerBreakdownResult.rows.map((row: any) => ({
    owner: row.owner || 'Unassigned',
    totalRecords: parseInt(row.total_records, 10) || 0,
    avgCompleteness: parseInt(row.avg_completeness, 10) || 0,
    criticalIssues: parseInt(row.critical_issues, 10) || 0,
  }));

  // ===== OVERALL METRICS =====
  const totalRecords = dealsTotal + contactsTotal + accountsTotal;

  // Calculate overall completeness (weighted average across all fields)
  const dealsCriticalCompleteness = dealsFieldCompleteness
    .filter(f => f.isCritical)
    .reduce((sum, f) => sum + f.fillRate, 0) / dealsFieldCompleteness.filter(f => f.isCritical).length;

  const contactsCriticalCompleteness = contactsFieldCompleteness
    .filter(f => f.isCritical)
    .reduce((sum, f) => sum + f.fillRate, 0) / contactsFieldCompleteness.filter(f => f.isCritical).length;

  const accountsCriticalCompleteness = accountsFieldCompleteness
    .filter(f => f.isCritical)
    .reduce((sum, f) => sum + f.fillRate, 0) / accountsFieldCompleteness.filter(f => f.isCritical).length;

  const criticalFieldCompleteness = Math.round(
    (dealsCriticalCompleteness + contactsCriticalCompleteness + accountsCriticalCompleteness) / 3
  );

  const allFieldsCompleteness = [
    ...dealsFieldCompleteness,
    ...contactsFieldCompleteness,
    ...accountsFieldCompleteness,
  ];
  const overallCompleteness = Math.round(
    allFieldsCompleteness.reduce((sum, f) => sum + f.fillRate, 0) / allFieldsCompleteness.length
  );

  return {
    overall: {
      totalRecords,
      overallCompleteness,
      criticalFieldCompleteness,
    },
    byEntity: {
      deals: {
        total: dealsTotal,
        fieldCompleteness: dealsFieldCompleteness,
        issues: {
          missingAmount: parseInt(dealsIssues.rows[0].missing_amount, 10) || 0,
          missingCloseDate: parseInt(dealsIssues.rows[0].missing_close_date, 10) || 0,
          missingOwner: parseInt(dealsIssues.rows[0].missing_owner, 10) || 0,
          missingStage: parseInt(dealsIssues.rows[0].missing_stage, 10) || 0,
          missingAccount: parseInt(dealsIssues.rows[0].missing_account, 10) || 0,
          zeroAmount: parseInt(dealsIssues.rows[0].zero_amount, 10) || 0,
          closeDateInPast: parseInt(dealsIssues.rows[0].close_date_in_past, 10) || 0,
          duplicateSuspects: parseInt(dealsIssues.rows[0].duplicate_suspects, 10) || 0,
        },
      },
      contacts: {
        total: contactsTotal,
        fieldCompleteness: contactsFieldCompleteness,
        issues: {
          missingEmail: parseInt(contactsIssues.rows[0].missing_email, 10) || 0,
          missingName: parseInt(contactsIssues.rows[0].missing_name, 10) || 0,
          missingTitle: parseInt(contactsIssues.rows[0].missing_title, 10) || 0,
          missingAccount: parseInt(contactsIssues.rows[0].missing_account, 10) || 0,
          duplicateSuspects: parseInt(contactsIssues.rows[0].duplicate_suspects, 10) || 0,
        },
      },
      accounts: {
        total: accountsTotal,
        fieldCompleteness: accountsFieldCompleteness,
        issues: {
          missingDomain: parseInt(accountsIssues.rows[0].missing_domain, 10) || 0,
          missingIndustry: parseInt(accountsIssues.rows[0].missing_industry, 10) || 0,
          noDeals: parseInt(accountsIssues.rows[0].no_deals, 10) || 0,
          noContacts: parseInt(accountsIssues.rows[0].no_contacts, 10) || 0,
        },
      },
    },
    worstOffenders,
    ownerBreakdown,
  };
}

// ============================================================================
// Pipeline Coverage by Rep
// ============================================================================

interface RepCoverage {
  name: string;
  email: string;
  quota: number | null;
  pipeline: number;
  commit: number;
  bestCase: number;
  closedWon: number;
  remaining: number | null;
  coverageRatio: number | null;
  gap: number | null;
  dealCount: number;
  avgDealSize: number;
  staleDeals: number;
  staleDealValue: number;
  status: 'on_track' | 'at_risk' | 'behind' | 'unknown';
}

export interface CoverageByRep {
  team: {
    totalQuota: number | null;
    totalPipeline: number;
    totalCommit: number;
    totalBestCase: number;
    closedWon: number;
    coverageRatio: number | null;
    coverageTarget: number;
    gap: number | null;
    daysInQuarter: number;
    daysElapsed: number;
    daysRemaining: number;
    requiredWeeklyPipelineGen: number | null;
    dealCount: number;
    avgDealSize: number;
  };
  reps: RepCoverage[];
}

export async function coverageByRep(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date,
  quotas?: { team?: number; byRep?: Record<string, number> },
  coverageTarget: number = 3.0,
  excludedOwners?: string[]
): Promise<CoverageByRep> {
  const params: any[] = [workspaceId, quarterStart, quarterEnd];
  let excludeClause = '';
  if (excludedOwners && excludedOwners.length > 0) {
    const placeholders = excludedOwners.map((_, i) => `$${params.length + i + 1}`).join(', ');
    excludeClause = `AND (owner IS NULL OR owner NOT IN (${placeholders}))`;
    params.push(...excludedOwners);
  }

  const repsResult = await query(`
    SELECT
      COALESCE(owner, 'Unassigned') as rep_name,
      COALESCE(owner, 'unassigned') as rep_email,
      COUNT(*) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_deals,
      COALESCE(SUM(amount) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')), 0) as pipeline,
      COALESCE(SUM(amount) FILTER (WHERE forecast_category = 'commit' AND stage_normalized NOT IN ('closed_won', 'closed_lost')), 0) as commit_value,
      COALESCE(SUM(amount) FILTER (WHERE forecast_category = 'best_case' AND stage_normalized NOT IN ('closed_won', 'closed_lost')), 0) as best_case_value,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') as won_count,
      COALESCE(SUM(amount) FILTER (WHERE stage_normalized = 'closed_won'), 0) as closed_won,
      COUNT(*) FILTER (WHERE last_activity_date < NOW() - INTERVAL '14 days' AND stage_normalized NOT IN ('closed_won', 'closed_lost')) as stale_deals,
      COALESCE(SUM(amount) FILTER (WHERE last_activity_date < NOW() - INTERVAL '14 days' AND stage_normalized NOT IN ('closed_won', 'closed_lost')), 0) as stale_value
    FROM deals
    WHERE workspace_id = $1
      AND (
        (close_date BETWEEN $2 AND $3) OR
        (stage_normalized = 'closed_won' AND close_date BETWEEN $2 AND $3)
      )
      ${excludeClause}
    GROUP BY owner
    ORDER BY pipeline DESC
  `, params);

  // Build rep coverage objects
  const reps: RepCoverage[] = repsResult.rows.map((row: any) => {
    const repEmail = row.rep_email;
    const quota = quotas?.byRep?.[repEmail] ?? null;
    const pipeline = parseFloat(row.pipeline) || 0;
    const closedWon = parseFloat(row.closed_won) || 0;
    const dealCount = parseInt(row.open_deals, 10) || 0;
    const avgDealSize = dealCount > 0 ? Math.round(pipeline / dealCount) : 0;

    const remaining = quota !== null ? quota - closedWon : null;
    const coverageRatio = remaining !== null && remaining > 0 ? pipeline / remaining : null;

    // Calculate gap to hit coverage target
    const gap = quota !== null && remaining !== null && remaining > 0
      ? Math.max(0, (remaining * coverageTarget) - pipeline)
      : null;

    // Determine status
    let status: RepCoverage['status'];
    if (quota === null) {
      status = 'unknown';
    } else if (coverageRatio !== null) {
      if (coverageRatio >= coverageTarget) {
        status = 'on_track';
      } else if (coverageRatio >= coverageTarget * 0.6) {
        status = 'at_risk';
      } else {
        status = 'behind';
      }
    } else {
      status = 'unknown';
    }

    return {
      name: row.rep_name,
      email: repEmail,
      quota,
      pipeline,
      commit: parseFloat(row.commit_value) || 0,
      bestCase: parseFloat(row.best_case_value) || 0,
      closedWon,
      remaining,
      coverageRatio,
      gap,
      dealCount,
      avgDealSize,
      staleDeals: parseInt(row.stale_deals, 10) || 0,
      staleDealValue: parseFloat(row.stale_value) || 0,
      status,
    };
  });

  // Calculate team totals
  const totalPipeline = reps.reduce((sum, r) => sum + r.pipeline, 0);
  const totalCommit = reps.reduce((sum, r) => sum + r.commit, 0);
  const totalBestCase = reps.reduce((sum, r) => sum + r.bestCase, 0);
  const totalClosedWon = reps.reduce((sum, r) => sum + r.closedWon, 0);
  const totalDealCount = reps.reduce((sum, r) => sum + r.dealCount, 0);
  const avgDealSize = totalDealCount > 0 ? Math.round(totalPipeline / totalDealCount) : 0;

  const totalQuota = quotas?.team ?? null;
  const teamRemaining = totalQuota !== null ? totalQuota - totalClosedWon : null;
  const coverageRatio = teamRemaining !== null && teamRemaining > 0
    ? totalPipeline / teamRemaining
    : null;

  const gap = totalQuota !== null && teamRemaining !== null && teamRemaining > 0
    ? Math.max(0, (teamRemaining * coverageTarget) - totalPipeline)
    : null;

  // Calculate quarter timing
  const now = new Date();
  const qStart = quarterStart.getTime();
  const qEnd = quarterEnd.getTime();
  const nowTime = now.getTime();

  const daysInQuarter = Math.ceil((qEnd - qStart) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.ceil((nowTime - qStart) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, Math.ceil((qEnd - nowTime) / (1000 * 60 * 60 * 24)));

  const weeksRemaining = daysRemaining / 7;
  const requiredWeeklyPipelineGen = gap !== null && weeksRemaining > 0
    ? Math.round(gap / weeksRemaining)
    : null;

  return {
    team: {
      totalQuota,
      totalPipeline: Math.round(totalPipeline),
      totalCommit: Math.round(totalCommit),
      totalBestCase: Math.round(totalBestCase),
      closedWon: Math.round(totalClosedWon),
      coverageRatio,
      coverageTarget,
      gap: gap !== null ? Math.round(gap) : null,
      daysInQuarter,
      daysElapsed,
      daysRemaining,
      requiredWeeklyPipelineGen,
      dealCount: totalDealCount,
      avgDealSize,
    },
    reps,
  };
}

export interface CoverageTrendDelta {
  name: string;
  email: string;
  coverageChange: number | null;
  pipelineChange: number;
  statusChange: string | null;
}

export async function coverageTrend(
  workspaceId: string,
  currentReps: RepCoverage[],
  previousRunResult: any
): Promise<{ isFirstRun: boolean; repDeltas: CoverageTrendDelta[] }> {
  if (!previousRunResult?.coverage_data?.reps) {
    return { isFirstRun: true, repDeltas: [] };
  }

  const previousReps = previousRunResult.coverage_data.reps;
  const prevRepMap = new Map(previousReps.map((r: any) => [r.email, r]));

  const repDeltas: CoverageTrendDelta[] = currentReps.map(curr => {
    const prev = prevRepMap.get(curr.email);

    if (!prev) {
      return {
        name: curr.name,
        email: curr.email,
        coverageChange: null,
        pipelineChange: curr.pipeline,
        statusChange: null,
      };
    }

    const coverageChange = curr.coverageRatio !== null && prev.coverageRatio !== null
      ? curr.coverageRatio - prev.coverageRatio
      : null;

    const pipelineChange = curr.pipeline - (prev.pipeline || 0);

    const statusChange = prev.status !== curr.status
      ? `${prev.status} → ${curr.status}`
      : null;

    return {
      name: curr.name,
      email: curr.email,
      coverageChange,
      pipelineChange,
      statusChange,
    };
  });

  return {
    isFirstRun: false,
    repDeltas: repDeltas.filter(d => d.coverageChange !== null || d.pipelineChange !== 0),
  };
}

export interface RepPipelineQuality {
  email: string;
  earlyStageCount: number;
  lateStageCount: number;
  earlyStageValue: number;
  lateStageValue: number;
  earlyPct: number;
  qualityFlag: 'early_heavy' | 'balanced' | 'late_heavy';
}

export async function repPipelineQuality(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date,
  excludedOwners?: string[]
): Promise<RepPipelineQuality[]> {
  const params: any[] = [workspaceId, quarterStart, quarterEnd];
  let excludeClause = '';
  if (excludedOwners && excludedOwners.length > 0) {
    const placeholders = excludedOwners.map((_, i) => `$${params.length + i + 1}`).join(', ');
    excludeClause = `AND (owner IS NULL OR owner NOT IN (${placeholders}))`;
    params.push(...excludedOwners);
  }

  const result = await query(`
    SELECT
      COALESCE(owner, 'unassigned') as rep_email,
      COUNT(*) FILTER (WHERE stage_normalized IN ('awareness', 'qualification')) as early_stage,
      COUNT(*) FILTER (WHERE stage_normalized IN ('evaluation', 'decision', 'negotiation')) as late_stage,
      COALESCE(SUM(amount) FILTER (WHERE stage_normalized IN ('awareness', 'qualification')), 0) as early_value,
      COALESCE(SUM(amount) FILTER (WHERE stage_normalized IN ('evaluation', 'decision', 'negotiation')), 0) as late_value
    FROM deals
    WHERE workspace_id = $1
      AND stage_normalized NOT IN ('closed_won', 'closed_lost')
      AND close_date BETWEEN $2 AND $3
      ${excludeClause}
    GROUP BY owner
  `, params);

  return result.rows.map((row: any) => {
    const earlyValue = parseFloat(row.early_value) || 0;
    const lateValue = parseFloat(row.late_value) || 0;
    const totalValue = earlyValue + lateValue;
    const earlyPct = totalValue > 0 ? Math.round((earlyValue / totalValue) * 100) : 0;

    let qualityFlag: RepPipelineQuality['qualityFlag'];
    if (earlyPct > 70) {
      qualityFlag = 'early_heavy';
    } else if (earlyPct < 30) {
      qualityFlag = 'late_heavy';
    } else {
      qualityFlag = 'balanced';
    }

    return {
      email: row.rep_email,
      earlyStageCount: parseInt(row.early_stage, 10) || 0,
      lateStageCount: parseInt(row.late_stage, 10) || 0,
      earlyStageValue: Math.round(earlyValue),
      lateStageValue: Math.round(lateValue),
      earlyPct,
      qualityFlag,
    };
  });
}
