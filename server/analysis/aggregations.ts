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
