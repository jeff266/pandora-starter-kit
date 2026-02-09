export interface AccountRow {
  id: string;
  open_deal_count: number | null;
  annual_revenue: string | null;
}

interface AccountMetrics {
  contactCount: number;
  avgEngagement: number;
  dealCount: number;
  totalDealValue: number;
  lastActivity: Date | null;
}

export function computeAccountHealth(
  account: AccountRow,
  metrics?: AccountMetrics
): number {
  if (!metrics) {
    return 0;
  }

  const engagementScore = calculateEngagementComponent(metrics.avgEngagement);
  const relationshipScore = calculateRelationshipDepth(metrics.contactCount, metrics.dealCount);
  const recencyScore = calculateAccountRecency(metrics.lastActivity);
  const revenueScore = calculateRevenueSignal(metrics.totalDealValue, account.annual_revenue);

  const raw = engagementScore + relationshipScore + recencyScore + revenueScore;
  return clamp(Math.round(raw * 100) / 100, 0, 100);
}

function calculateEngagementComponent(avgEngagement: number): number {
  return Math.min((avgEngagement / 100) * 30, 30);
}

function calculateRelationshipDepth(contactCount: number, dealCount: number): number {
  const contactScore = contactCount >= 5 ? 15
    : contactCount >= 3 ? 12
    : contactCount >= 1 ? 7
    : 0;

  const dealScore = dealCount >= 3 ? 10
    : dealCount >= 2 ? 7
    : dealCount >= 1 ? 4
    : 0;

  return contactScore + dealScore;
}

function calculateAccountRecency(lastActivity: Date | null): number {
  if (!lastActivity) return 0;

  const daysSince = daysBetween(lastActivity, new Date());

  if (daysSince <= 7) return 25;
  if (daysSince <= 14) return 20;
  if (daysSince <= 30) return 14;
  if (daysSince <= 60) return 7;
  return 2;
}

function calculateRevenueSignal(totalDealValue: number, annualRevenue: string | null): number {
  const revenue = parseFloat(annualRevenue ?? '0') || 0;
  const totalValue = totalDealValue + revenue;

  if (totalValue > 500000) return 20;
  if (totalValue > 100000) return 15;
  if (totalValue > 50000) return 10;
  if (totalValue > 10000) return 5;
  return 1;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
