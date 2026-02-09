export interface DealRow {
  id: string;
  amount: string | null;
  stage: string | null;
  close_date: string | null;
  probability: string | null;
  days_in_stage: number | null;
  last_activity_date: string | null;
  created_at: string;
  pipeline: string | null;
}

interface DealActivity {
  count: number;
  lastActivity: Date | null;
}

interface DealConfig {
  staleDealDays: number;
  salesCycleDays: number;
  avgDealSize: number;
}

interface DealScores {
  velocityScore: number;
  dealRisk: number;
  riskFactors: string[];
}

export function computeDealScores(
  deal: DealRow,
  config: DealConfig,
  activity?: DealActivity
): DealScores {
  const velocity = calculateVelocity(deal, config);
  const { risk, factors } = calculateRisk(deal, config, activity);

  return {
    velocityScore: clamp(Math.round(velocity * 100) / 100, 0, 100),
    dealRisk: clamp(Math.round(risk * 100) / 100, 0, 100),
    riskFactors: factors,
  };
}

function calculateVelocity(deal: DealRow, config: DealConfig): number {
  const amount = parseFloat(deal.amount ?? '0') || 0;
  const probability = parseFloat(deal.probability ?? '50') || 50;
  const daysInStage = deal.days_in_stage ?? 0;
  const createdAt = new Date(deal.created_at);
  const now = new Date();
  const dealAgeDays = Math.max(1, daysBetween(createdAt, now));

  const amountScore = Math.min(amount / config.avgDealSize, 2) * 25;

  const probabilityScore = (probability / 100) * 25;

  const paceRatio = config.salesCycleDays / Math.max(dealAgeDays, 1);
  const paceScore = Math.min(paceRatio, 2) * 15;

  const stageFreshness = daysInStage <= 7 ? 10 : daysInStage <= 14 ? 7 : daysInStage <= 30 ? 4 : 1;

  const closeDate = deal.close_date ? new Date(deal.close_date) : null;
  let closeProximityScore = 5;
  if (closeDate) {
    const daysToClose = daysBetween(now, closeDate);
    if (daysToClose > 0 && daysToClose <= 30) {
      closeProximityScore = 20;
    } else if (daysToClose > 30 && daysToClose <= 60) {
      closeProximityScore = 12;
    } else if (daysToClose <= 0) {
      closeProximityScore = 2;
    }
  }

  return amountScore + probabilityScore + paceScore + stageFreshness + closeProximityScore;
}

function calculateRisk(
  deal: DealRow,
  config: DealConfig,
  activity?: DealActivity
): { risk: number; factors: string[] } {
  let risk = 0;
  const factors: string[] = [];

  const lastActivity = deal.last_activity_date
    ? new Date(deal.last_activity_date)
    : activity?.lastActivity ?? null;

  if (lastActivity) {
    const daysSince = daysBetween(lastActivity, new Date());
    if (daysSince >= config.staleDealDays * 2) {
      risk += 30;
      factors.push(`No activity in ${daysSince} days (very stale)`);
    } else if (daysSince >= config.staleDealDays) {
      risk += 20;
      factors.push(`No activity in ${daysSince} days (stale)`);
    }
  } else {
    risk += 15;
    factors.push('No recorded activity');
  }

  const closeDate = deal.close_date ? new Date(deal.close_date) : null;
  if (closeDate) {
    const daysToClose = daysBetween(new Date(), closeDate);
    if (daysToClose < 0) {
      risk += 25;
      factors.push(`Close date passed ${Math.abs(daysToClose)} days ago`);
    } else if (daysToClose < 7) {
      risk += 10;
      factors.push(`Closing in ${daysToClose} days`);
    }
  }

  const daysInStage = deal.days_in_stage ?? 0;
  if (daysInStage > config.salesCycleDays * 0.5) {
    risk += 20;
    factors.push(`Stuck in stage for ${daysInStage} days`);
  } else if (daysInStage > config.salesCycleDays * 0.25) {
    risk += 10;
    factors.push(`${daysInStage} days in current stage`);
  }

  const probability = parseFloat(deal.probability ?? '50') || 50;
  if (probability < 20) {
    risk += 15;
    factors.push(`Low probability (${probability}%)`);
  } else if (probability < 40) {
    risk += 5;
    factors.push(`Below-average probability (${probability}%)`);
  }

  if (activity && activity.count < 3) {
    risk += 10;
    factors.push(`Low activity count (${activity.count})`);
  }

  return { risk: Math.min(risk, 100), factors };
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
