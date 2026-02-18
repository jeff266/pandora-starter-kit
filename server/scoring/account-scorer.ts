import { query as dbQuery } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getSlackWebhook, postBlocks } from '../connectors/slack/client.js';

const logger = createLogger('AccountScorer');

const DEFAULT_WEIGHTS = {
  // Firmographic fit (30 points max)
  industry_match: 10,
  company_size_match: 10,
  growth_stage_match: 10,
  // Signal score (20 points max)
  signal_score_strong_positive: 20,
  signal_score_positive: 12,
  signal_score_neutral: 5,
  // Engagement (20 points max)
  has_open_deal: 12,
  recent_activity_7d: 8,
  recent_activity_30d: 4,
  // Deal history (15 points max)
  won_deal_exists: 15,
  advanced_deal_exists: 8,
  // Specific signal bonuses (10 points max)
  hiring_signal: 5,
  funding_signal: 8,
  expansion_signal: 5,
  // Negative deductions
  no_activity_30d: -8,
  no_activity_60d: -15,
  layoff_signal: -12,
  negative_press_signal: -10,
  low_confidence_data: -5,
};

type Weights = typeof DEFAULT_WEIGHTS;

function scoreToGrade(score: number): string {
  if (score >= 75) return 'A';
  if (score >= 55) return 'B';
  if (score >= 35) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

async function loadScoringWeights(workspaceId: string): Promise<{ mode: string; weights: Weights }> {
  try {
    const icp = await dbQuery<{ scoring_weights: any }>(
      `SELECT scoring_weights FROM icp_profiles
       WHERE workspace_id = $1 AND status = 'active'
       LIMIT 1`,
      [workspaceId]
    );
    if (icp.rows.length && icp.rows[0].scoring_weights) {
      return {
        mode: 'icp_derived',
        weights: { ...DEFAULT_WEIGHTS, ...icp.rows[0].scoring_weights },
      };
    }
  } catch {
    // Fall through to default
  }
  return { mode: 'point_based', weights: DEFAULT_WEIGHTS };
}

interface AccountFeatures {
  // Firmographic
  industryMatch: boolean;
  companySizeMatch: boolean;
  growthStageMatch: boolean;
  // Signals
  signalScore: number;  // -1.0 to 1.0
  hasHiring: boolean;
  hasFunding: boolean;
  hasExpansion: boolean;
  hasLayoff: boolean;
  hasNegativePress: boolean;
  // Engagement
  hasOpenDeal: boolean;
  lastActivityDaysAgo: number | null;
  // Deal history
  hasWonDeal: boolean;
  hasAdvancedDeal: boolean;
  // Data quality
  classificationConfidence: number;
  icpFitDetails: Record<string, boolean>;
}

async function loadWorkspaceICPConfig(workspaceId: string): Promise<{ targetIndustries: string[]; targetSizes: string[]; targetStages: string[] }> {
  try {
    const cfg = await dbQuery<{ config: any }>(
      `SELECT config FROM workspace_configs WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );
    const c = cfg.rows[0]?.config || {};
    const goals = c.goals_and_targets || {};
    return {
      targetIndustries: Array.isArray(goals.target_industries) ? goals.target_industries : [],
      targetSizes: Array.isArray(goals.target_company_sizes) ? goals.target_company_sizes : [],
      targetStages: Array.isArray(goals.target_growth_stages) ? goals.target_growth_stages : [],
    };
  } catch {
    return { targetIndustries: [], targetSizes: [], targetStages: [] };
  }
}

function buildAccountFeatures(
  signals: any,
  deals: any[],
  lastActivity: { last_activity: string | null } | null,
  icpConfig: { targetIndustries: string[]; targetSizes: string[]; targetStages: string[] }
): AccountFeatures {
  const signalArr: Array<{ type: string }> = Array.isArray(signals?.signals) ? signals.signals : [];

  const hasHiring = signalArr.some(s => s.type === 'hiring');
  const hasFunding = signalArr.some(s => s.type === 'funding');
  const hasExpansion = signalArr.some(s => s.type === 'expansion');
  const hasLayoff = signalArr.some(s => s.type === 'layoff');
  const hasNegativePress = signalArr.some(s => s.type === 'negative_press');

  const industry = signals?.industry || '';
  const employeeRange = signals?.employee_range || '';
  const growthStage = signals?.growth_stage || '';

  const industryMatch = icpConfig.targetIndustries.length === 0 ||
    icpConfig.targetIndustries.some(i => industry.toLowerCase().includes(i.toLowerCase()));
  const companySizeMatch = icpConfig.targetSizes.length === 0 ||
    icpConfig.targetSizes.some(s => employeeRange.includes(s));
  const growthStageMatch = icpConfig.targetStages.length === 0 ||
    icpConfig.targetStages.some(s => growthStage.includes(s));

  const hasOpenDeal = deals.some(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized || ''));
  const hasWonDeal = deals.some(d => d.stage_normalized === 'closed_won');
  const hasAdvancedDeal = deals.some(d => {
    const n = d.stage_normalized || '';
    return !['lead', 'prospect', 'qualified', 'closed_won', 'closed_lost'].includes(n);
  });

  let lastActivityDaysAgo: number | null = null;
  if (lastActivity?.last_activity) {
    const ms = Date.now() - new Date(lastActivity.last_activity).getTime();
    lastActivityDaysAgo = Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  return {
    industryMatch,
    companySizeMatch,
    growthStageMatch,
    signalScore: typeof signals?.signal_score === 'number' ? signals.signal_score : 0,
    hasHiring,
    hasFunding,
    hasExpansion,
    hasLayoff,
    hasNegativePress,
    hasOpenDeal,
    lastActivityDaysAgo,
    hasWonDeal,
    hasAdvancedDeal,
    classificationConfidence: signals?.classification_confidence ?? 0,
    icpFitDetails: { industryMatch, companySizeMatch, growthStageMatch, hasWonDeal, hasOpenDeal },
  };
}

interface ScoreBreakdown {
  firmographic_fit: { score: number; max: number; details: Record<string, boolean> };
  signals: { score: number; max: number; details: Record<string, any> };
  engagement: { score: number; max: number; details: Record<string, any> };
  deal_history: { score: number; max: number; details: Record<string, boolean> };
  negative_signals: { deductions: number; details: Record<string, boolean> };
}

function computeBreakdown(features: AccountFeatures, weights: Weights): ScoreBreakdown {
  // Firmographic (30 max)
  const firmographicScore =
    (features.industryMatch ? weights.industry_match : 0) +
    (features.companySizeMatch ? weights.company_size_match : 0) +
    (features.growthStageMatch ? weights.growth_stage_match : 0);

  // Signals (20 max)
  let signalScore = 0;
  if (features.signalScore > 0.6) signalScore = weights.signal_score_strong_positive;
  else if (features.signalScore > 0.2) signalScore = weights.signal_score_positive;
  else if (features.signalScore >= -0.2) signalScore = weights.signal_score_neutral;
  // signal_score negative: 0 points

  // Bonus specific signals (capped at 10)
  const bonusSignals = Math.min(10,
    (features.hasHiring ? weights.hiring_signal : 0) +
    (features.hasFunding ? weights.funding_signal : 0) +
    (features.hasExpansion ? weights.expansion_signal : 0)
  );

  // Engagement (20 max)
  let engagementScore = features.hasOpenDeal ? weights.has_open_deal : 0;
  if (features.lastActivityDaysAgo !== null) {
    if (features.lastActivityDaysAgo <= 7) engagementScore += weights.recent_activity_7d;
    else if (features.lastActivityDaysAgo <= 30) engagementScore += weights.recent_activity_30d;
  }

  // Deal history (15 max)
  const dealScore = features.hasWonDeal ? weights.won_deal_exists :
    features.hasAdvancedDeal ? weights.advanced_deal_exists : 0;

  // Deductions
  let deductions = 0;
  if (features.hasOpenDeal && features.lastActivityDaysAgo !== null) {
    if (features.lastActivityDaysAgo >= 60) deductions += weights.no_activity_60d;
    else if (features.lastActivityDaysAgo >= 30) deductions += weights.no_activity_30d;
  }
  if (features.hasLayoff) deductions += weights.layoff_signal;
  if (features.hasNegativePress) deductions += weights.negative_press_signal;
  if (features.classificationConfidence < 40) deductions += weights.low_confidence_data;

  return {
    firmographic_fit: {
      score: firmographicScore, max: 30,
      details: { industryMatch: features.industryMatch, companySizeMatch: features.companySizeMatch, growthStageMatch: features.growthStageMatch },
    },
    signals: {
      score: signalScore + bonusSignals, max: 30,
      details: { signalScore: features.signalScore, hasHiring: features.hasHiring, hasFunding: features.hasFunding, hasExpansion: features.hasExpansion },
    },
    engagement: {
      score: engagementScore, max: 20,
      details: { hasOpenDeal: features.hasOpenDeal, lastActivityDaysAgo: features.lastActivityDaysAgo },
    },
    deal_history: {
      score: dealScore, max: 15,
      details: { hasWonDeal: features.hasWonDeal, hasAdvancedDeal: features.hasAdvancedDeal },
    },
    negative_signals: {
      deductions,
      details: { hasLayoff: features.hasLayoff, hasNegativePress: features.hasNegativePress, lowConfidence: features.classificationConfidence < 40 },
    },
  };
}

export interface AccountScore {
  accountId: string;
  totalScore: number;
  grade: string;
  breakdown: ScoreBreakdown;
  scoreDelta: number | null;
}

async function triggerAccountScoreAlert(
  workspaceId: string,
  accountName: string,
  accountId: string,
  totalScore: number,
  grade: string,
  scoreDelta: number,
  topSignal: string | null
): Promise<void> {
  try {
    const webhookUrl = await getSlackWebhook(workspaceId);
    if (!webhookUrl) return;

    const body = topSignal
      ? `${accountName}'s ICP fit score rose to ${totalScore} (${grade}) — ${topSignal}`
      : `${accountName}'s ICP fit score rose to ${totalScore} (${grade})`;

    await postBlocks(webhookUrl, [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📈 Account Score Jump: ${accountName}*\n${body}\n_Score: +${scoreDelta} points_`,
        },
      },
    ]);
  } catch (err) {
    logger.warn('Failed to send account score alert', { accountId, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function scoreAccount(workspaceId: string, accountId: string): Promise<AccountScore> {
  // Load enrichment signals
  const signalsResult = await dbQuery<any>(
    `SELECT * FROM account_signals WHERE workspace_id = $1 AND account_id = $2`,
    [workspaceId, accountId]
  );
  const signals = signalsResult.rows[0] || null;

  // Load deals
  const dealsResult = await dbQuery<any>(
    `SELECT stage_normalized, amount, close_date, created_at
     FROM deals
     WHERE workspace_id = $1 AND account_id = $2
     ORDER BY created_at DESC`,
    [workspaceId, accountId]
  );

  // Load recent activity
  const activityResult = await dbQuery<{ last_activity: string | null }>(
    `SELECT MAX(timestamp)::text AS last_activity
     FROM activities
     WHERE workspace_id = $1 AND account_id = $2`,
    [workspaceId, accountId]
  );

  // Load workspace ICP config + scoring weights
  const icpConfig = await loadWorkspaceICPConfig(workspaceId);
  const { mode, weights } = await loadScoringWeights(workspaceId);

  // Compute features and score
  const features = buildAccountFeatures(signals, dealsResult.rows, activityResult.rows[0] ?? null, icpConfig);
  const breakdown = computeBreakdown(features, weights);

  const rawScore =
    breakdown.firmographic_fit.score +
    breakdown.signals.score +
    breakdown.engagement.score +
    breakdown.deal_history.score +
    breakdown.negative_signals.deductions;

  const totalScore = Math.max(0, Math.min(100, rawScore));
  const grade = scoreToGrade(totalScore);

  // Load previous score for delta
  const prevResult = await dbQuery<{ total_score: number }>(
    `SELECT total_score FROM account_scores WHERE workspace_id = $1 AND account_id = $2`,
    [workspaceId, accountId]
  );
  const previousScore = prevResult.rows[0]?.total_score ?? null;
  const scoreDelta = previousScore !== null ? totalScore - previousScore : null;

  // Persist
  await dbQuery(
    `INSERT INTO account_scores (
       workspace_id, account_id, total_score, grade, score_breakdown, icp_fit_details,
       scoring_mode, data_confidence, scored_at, previous_score, score_delta, stale_after, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, NOW() + INTERVAL '7 days', NOW())
     ON CONFLICT (workspace_id, account_id) DO UPDATE SET
       total_score = EXCLUDED.total_score,
       grade = EXCLUDED.grade,
       score_breakdown = EXCLUDED.score_breakdown,
       icp_fit_details = EXCLUDED.icp_fit_details,
       scoring_mode = EXCLUDED.scoring_mode,
       data_confidence = EXCLUDED.data_confidence,
       scored_at = NOW(),
       previous_score = EXCLUDED.previous_score,
       score_delta = EXCLUDED.score_delta,
       stale_after = NOW() + INTERVAL '7 days',
       updated_at = NOW()`,
    [
      workspaceId, accountId, totalScore, grade,
      JSON.stringify(breakdown), JSON.stringify(features.icpFitDetails),
      mode, signals?.classification_confidence ?? 0,
      previousScore, scoreDelta,
    ]
  );

  // Push alert on significant score jump
  if (scoreDelta !== null && scoreDelta >= 15) {
    const accountResult = await dbQuery<{ name: string }>(
      `SELECT name FROM accounts WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, accountId]
    );
    const accountName = accountResult.rows[0]?.name || accountId;
    const topSignalArr: Array<{ type: string; signal: string }> = Array.isArray(signals?.signals) ? signals.signals : [];
    const topSignal = topSignalArr.sort((a, b) => (b as any).relevance - (a as any).relevance)[0]?.signal || null;
    await triggerAccountScoreAlert(workspaceId, accountName, accountId, totalScore, grade, scoreDelta, topSignal);
  }

  logger.info('Account scored', { workspaceId, accountId, totalScore, grade, mode });

  return { accountId, totalScore, grade, breakdown, scoreDelta };
}
