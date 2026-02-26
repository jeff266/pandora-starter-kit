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
  activity?: DealActivity,
  closeDateSuspect?: boolean
): DealScores {
  const velocity = calculateVelocity(deal, config);
  const { risk, factors } = calculateRisk(deal, config, activity, closeDateSuspect);

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
  activity?: DealActivity,
  closeDateSuspect?: boolean
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

  // Skip close date penalty if recent conversation mentions timeline (suggests stale close date)
  if (!closeDateSuspect) {
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

export interface ConversationSignal {
  keyword: string;
  call_title: string;
  call_date: string;
  points: number;
}

export interface ConversationModifierResult {
  modifier: number;
  signals: ConversationSignal[];
  close_date_suspect: boolean;
}

export interface PhaseSignal {
  keyword: string;
  phase: string;
  count: number;
}

export interface PhaseInferenceResult {
  phase: 'discovery' | 'evaluation' | 'pilot' | 'negotiation' | 'decision' | 'stalled';
  confidence: number; // 0.0–1.0
  signals: PhaseSignal[];
}

export type InferredPhase = 'discovery' | 'evaluation' | 'pilot' | 'negotiation' | 'decision' | 'stalled';

const PHASE_KEYWORDS: Record<InferredPhase, string[]> = {
  discovery: ['tell me more', 'how does it work', 'what is included', 'intro call', 'first call', 'learn about'],
  evaluation: ['demo', 'trial', 'proof of concept', 'poc', 'evaluation', 'testing', 'comparing'],
  pilot: ['pilot', 'onboarding', 'implementation', 'kicked off', 'going live', 'first week', 'launch'],
  negotiation: ['contract', 'legal', 'procurement', 'redlines', 'terms', 'msa', 'sow', 'pricing review'],
  decision: ['board approval', 'final decision', 'sign off', 'executive sign', 'approvals', 'last step'],
  stalled: ['paused', 'budget freeze', 'revisit', 'not a priority', 'put on hold', 'delayed'],
};

export async function computeConversationModifier(
  dealId: string,
  workspaceId: string
): Promise<ConversationModifierResult> {
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
  const signals: ConversationSignal[] = [];

  for (const conv of result.rows) {
    const text = ((conv.summary ?? '') + ' ' + (conv.title ?? '')).toLowerCase();
    const callTitle = conv.title || 'Untitled call';
    const callDate = conv.call_date ? new Date(conv.call_date).toISOString() : '';

    // Check for positive keywords
    for (const keyword of positive) {
      if (text.includes(keyword)) {
        signals.push({
          keyword,
          call_title: callTitle,
          call_date: callDate,
          points: 8,
        });
        modifier += 8;
        break; // Only count one positive keyword per conversation
      }
    }

    // Check for negative keywords
    for (const keyword of negative) {
      if (text.includes(keyword)) {
        signals.push({
          keyword,
          call_title: callTitle,
          call_date: callDate,
          points: -10,
        });
        modifier -= 10;
        break; // Only count one negative keyword per conversation
      }
    }
  }

  const cappedModifier = Math.max(-20, Math.min(20, modifier));

  // Detect timeline patterns in recent conversations
  const timelinePatterns = [
    'onboarding in',
    'starting in',
    'first two weeks',
    'end of',
    'by january', 'by february', 'by march', 'by april', 'by may', 'by june',
    'by july', 'by august', 'by september', 'by october', 'by november', 'by december',
    'next month',
    'this quarter',
    'beginning of',
  ];

  let close_date_suspect = false;
  const now = Date.now();
  const fourteenDaysAgo = now - (14 * 24 * 60 * 60 * 1000);

  for (const conv of result.rows) {
    const callDate = conv.call_date ? new Date(conv.call_date).getTime() : 0;
    if (callDate >= fourteenDaysAgo) {
      const text = ((conv.summary ?? '') + ' ' + (conv.title ?? '')).toLowerCase();
      for (const pattern of timelinePatterns) {
        if (text.includes(pattern)) {
          close_date_suspect = true;
          break;
        }
      }
      if (close_date_suspect) break;
    }
  }

  return {
    modifier: cappedModifier,
    signals,
    close_date_suspect,
  };
}

/**
 * Infer deal phase from conversation keywords
 * Uses same 30-day conversation window as conversation modifier
 *
 * @param summaries - Array of conversation summary strings from last 30 days
 * @returns Phase inference result with confidence and signals, or null if insufficient data
 */
export function computeInferredPhase(summaries: string[]): PhaseInferenceResult | null {
  if (!summaries || summaries.length === 0) {
    return null;
  }

  // Combine all summaries into single text for scanning
  const combinedText = summaries.join(' ').toLowerCase();

  // Track hits per phase
  const phaseHits = new Map<InferredPhase, PhaseSignal[]>();
  let totalHits = 0;

  // Scan for all keywords across all phases
  for (const [phase, keywords] of Object.entries(PHASE_KEYWORDS)) {
    const signals: PhaseSignal[] = [];

    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      const matches = combinedText.match(regex);
      const count = matches ? matches.length : 0;

      if (count > 0) {
        signals.push({ keyword, phase: phase as InferredPhase, count });
        totalHits += count;
      }
    }

    if (signals.length > 0) {
      phaseHits.set(phase as InferredPhase, signals);
    }
  }

  // Require at least 2 keyword hits to infer phase
  if (totalHits < 2) {
    return null;
  }

  // Find phase with highest hit count
  let winningPhase: InferredPhase | null = null;
  let winningCount = 0;
  let winningSignals: PhaseSignal[] = [];

  for (const [phase, signals] of Array.from(phaseHits.entries())) {
    const phaseCount = signals.reduce((sum, s) => sum + s.count, 0);
    if (phaseCount > winningCount) {
      winningPhase = phase;
      winningCount = phaseCount;
      winningSignals = signals;
    }
  }

  if (!winningPhase) {
    return null;
  }

  // Confidence = hits for winning phase / total hits across all phases
  const confidence = Number((winningCount / totalHits).toFixed(2));

  return {
    phase: winningPhase,
    confidence,
    signals: winningSignals,
  };
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
  weights: { crm: number; findings: number; conversations: number } = { crm: 0.40, findings: 0.35, conversations: 0.25 },
  hasConversations: boolean = false
): CompositeScoreResult {
  const hasCrm = crmScore !== null;
  const hasFindings = skillScore !== null;
  const hasConvScore = conversationScore !== null && conversationScore !== 0;

  let degradationState: 'full' | 'no_conversations' | 'no_findings' | 'crm_only';
  if (hasFindings && hasConversations) {
    degradationState = 'full';
  } else if (hasFindings && !hasConversations) {
    degradationState = 'no_conversations';
  } else if (!hasFindings && hasConversations) {
    degradationState = 'no_findings';
  } else {
    degradationState = 'crm_only';
  }

  const originalWeights = { ...weights };

  let effectiveConvWeight = 0;
  if (hasConversations && hasConvScore) {
    effectiveConvWeight = originalWeights.conversations;
  } else if (hasConversations && !hasConvScore) {
    effectiveConvWeight = originalWeights.conversations * 0.5;
  }

  const availableInputs: Array<'crm' | 'findings'> = [];
  if (hasCrm) availableInputs.push('crm');
  if (hasFindings) availableInputs.push('findings');

  if (availableInputs.length === 0 && effectiveConvWeight === 0) {
    return {
      score: 50,
      grade: 'C',
      weights_used: { crm: 0, findings: 0, conversations: 0 },
      degradation_state: 'crm_only',
    };
  }

  const remainingWeight = 1 - effectiveConvWeight;
  const totalCrmFindings = availableInputs.reduce((sum, key) => sum + originalWeights[key], 0);

  const weightsUsed = { crm: 0, findings: 0, conversations: effectiveConvWeight };
  if (totalCrmFindings > 0) {
    for (const input of availableInputs) {
      weightsUsed[input] = (originalWeights[input] / totalCrmFindings) * remainingWeight;
    }
  } else if (effectiveConvWeight > 0) {
    weightsUsed.conversations = 1;
  }

  let compositeScore = 0;
  if (hasCrm) compositeScore += crmScore * weightsUsed.crm;
  if (hasFindings) compositeScore += skillScore * weightsUsed.findings;
  if (effectiveConvWeight > 0 && conversationScore !== null) {
    compositeScore += conversationScore * weightsUsed.conversations;
  } else if (effectiveConvWeight > 0 && hasConversations && !hasConvScore) {
    compositeScore += 50 * weightsUsed.conversations;
  }

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
