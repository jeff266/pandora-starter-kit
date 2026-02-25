import { query } from '../db.js';

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
  stage_changed_at?: string | null;
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

  // Calculate velocity penalty multiplier based on recent activity
  const daysSinceActivity = lastActivity
    ? daysBetween(lastActivity, new Date())
    : 999;
  const velocityPenaltyMultiplier = daysSinceActivity <= 7 ? 0.5 : 1.0;

  const daysInStage = deal.days_in_stage ?? 0;
  if (daysInStage > config.salesCycleDays * 0.5) {
    risk += 20 * velocityPenaltyMultiplier;
    factors.push(`Stuck in stage for ${daysInStage} days`);
  } else if (daysInStage > config.salesCycleDays * 0.25) {
    risk += 10 * velocityPenaltyMultiplier;
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

export async function computeConversationModifier(
  dealId: string,
  workspaceId: string
): Promise<number> {
  const result = await query(
    `SELECT summary, call_date, title
     FROM conversations
     WHERE (deal_id = $1 OR account_id = (
       SELECT account_id FROM deals WHERE id = $1 AND workspace_id = $2
     ))
     AND workspace_id = $2
     AND call_date >= NOW() - INTERVAL '30 days'
     ORDER BY call_date DESC
     LIMIT 3`,
    [dealId, workspaceId]
  );

  const positive = ['pilot', 'moving forward', 'next steps',
                    'onboarding', 'contract', 'confirmed', 'excited', 'sign'];
  const negative = ['paused', 'budget freeze', 'no response',
                    'lost contact', 'competitor', 'not a fit', 'declined'];

  let modifier = 0;
  for (const conv of result.rows) {
    const text = ((conv.summary ?? '') + ' ' + (conv.title ?? '')).toLowerCase();
    const hasPositive = positive.some(k => text.includes(k));
    const hasNegative = negative.some(k => text.includes(k));
    if (hasPositive && !hasNegative) modifier += 8;
    if (hasNegative) modifier -= 10;
  }

  return Math.max(-20, Math.min(20, modifier));
}

export interface CompositeScoreResult {
  score: number;
  grade: string;
  weights_used: { crm: number; findings: number; conversations: number };
  degradation_state: 'full' | 'no_conversations' | 'no_findings' | 'crm_only';
}

export function computeCompositeScore(
  crmScore: number | null,
  skillScore: number | null,
  conversationScore: number | null,
  weights: { crm: number; findings: number; conversations: number } = { crm: 0.40, findings: 0.35, conversations: 0.25 }
): CompositeScoreResult {
  // Determine which inputs are available
  const hasCrm = crmScore !== null;
  const hasFindings = skillScore !== null;
  const hasConversations = conversationScore !== null;

  // Determine degradation state
  let degradationState: 'full' | 'no_conversations' | 'no_findings' | 'crm_only';
  if (hasCrm && hasFindings && hasConversations) {
    degradationState = 'full';
  } else if (hasCrm && hasFindings && !hasConversations) {
    degradationState = 'no_conversations';
  } else if (hasCrm && !hasFindings && hasConversations) {
    degradationState = 'no_findings';
  } else {
    degradationState = 'crm_only';
  }

  // Calculate redistributed weights
  const availableInputs: Array<'crm' | 'findings' | 'conversations'> = [];
  if (hasCrm) availableInputs.push('crm');
  if (hasFindings) availableInputs.push('findings');
  if (hasConversations) availableInputs.push('conversations');

  if (availableInputs.length === 0) {
    // No data at all - return default
    return {
      score: 50,
      grade: 'C',
      weights_used: { crm: 0, findings: 0, conversations: 0 },
      degradation_state: 'crm_only',
    };
  }

  // Redistribute weights proportionally
  const originalWeights = { ...weights };
  const totalOriginalWeight = availableInputs.reduce((sum, key) => sum + originalWeights[key], 0);

  const weightsUsed = { crm: 0, findings: 0, conversations: 0 };
  for (const input of availableInputs) {
    weightsUsed[input] = originalWeights[input] / totalOriginalWeight;
  }

  // Calculate weighted score
  let compositeScore = 0;
  if (hasCrm) compositeScore += crmScore * weightsUsed.crm;
  if (hasFindings) compositeScore += skillScore * weightsUsed.findings;
  if (hasConversations) compositeScore += conversationScore * weightsUsed.conversations;

  compositeScore = Math.round(compositeScore * 100) / 100;
  compositeScore = clamp(compositeScore, 0, 100);

  const grade = scoreToGrade(compositeScore);

  return {
    score: compositeScore,
    grade,
    weights_used: weightsUsed,
    degradation_state: degradationState,
  };
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}
