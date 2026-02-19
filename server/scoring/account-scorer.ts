import { query as dbQuery } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getSlackWebhook, postBlocks } from '../connectors/slack/client.js';

const logger = createLogger('AccountScorer');

const DEFAULT_WEIGHTS = {
  // Firmographic fit (30 points max)
  industry_match: 10,
  company_size_match: 10,
  growth_stage_match: 10,
  // Signal score (20 points max base)
  signal_score_strong_positive: 20,
  signal_score_positive: 12,
  signal_score_neutral: 5,
  // Engagement (20 points max) — only scored for active accounts
  has_open_deal: 12,
  recent_activity_7d: 8,
  recent_activity_30d: 4,
  // Deal history (15 points max) — only scored for active accounts
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

// Max achievable points per context (used for normalization)
const PROSPECTING_MAX = 60;  // firmographic (30) + signals (20 base + 10 bonus)
const ACTIVE_MAX = 95;       // all four dimensions

// 'prospecting' = cold account with no CRM history; score based on fit + signals only
// 'active' = account with open deals or past activity; score all four dimensions
type ScoringContext = 'prospecting' | 'active';

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
  // Firmographic (continuous lift values: 0.0–3.0)
  industryLift: number;
  sizeLift: number;
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
  icpFitDetails: Record<string, boolean | number>;
}

interface IndustryEntry { name: string; win_rate: number }
interface SizeEntry { range: string; win_rate: number }

interface ICPFirmographicWeights {
  industries: IndustryEntry[];       // from icp_profiles company_profile.industries
  sizeRanges: SizeEntry[];           // from icp_profiles company_profile.size_ranges
  baselineWinRate: number;           // average win rate across all industries for lift denominator
  // Fallback: binary lists from workspace_configs
  targetIndustries: string[];
  targetSizes: string[];
  targetStages: string[];
  source: 'icp_profile' | 'workspace_config';
}

async function loadICPFirmographicWeights(workspaceId: string): Promise<ICPFirmographicWeights> {
  // Try to load from active icp_profiles first
  try {
    const icpResult = await dbQuery<{ company_profile: any }>(
      `SELECT company_profile FROM icp_profiles
       WHERE workspace_id = $1 AND status = 'active'
       LIMIT 1`,
      [workspaceId]
    );

    const profile = icpResult.rows[0]?.company_profile;

    if (profile) {
      const industries: IndustryEntry[] = Array.isArray(profile.industries)
        ? (profile.industries as IndustryEntry[]).filter(
            (i: IndustryEntry) => i && typeof i.name === 'string' && typeof i.win_rate === 'number'
          )
        : [];

      const sizeRanges: SizeEntry[] = Array.isArray(profile.size_ranges)
        ? (profile.size_ranges as SizeEntry[]).filter(
            (s: SizeEntry) => s && typeof s.range === 'string' && typeof s.win_rate === 'number'
          )
        : [];

      // Compute baseline win rate as average of industry win rates (or 0.5 if empty)
      const baselineWinRate =
        industries.length > 0
          ? industries.reduce((sum: number, i: IndustryEntry) => sum + i.win_rate, 0) / industries.length
          : 0.5;

      if (industries.length > 0 || sizeRanges.length > 0) {
        return {
          industries,
          sizeRanges,
          baselineWinRate,
          targetIndustries: [],
          targetSizes: [],
          targetStages: [],
          source: 'icp_profile',
        };
      }
    }
  } catch {
    // Fall through to workspace config
  }

  // Fallback to workspace_configs.goals_and_targets
  try {
    const cfg = await dbQuery<{ config: any }>(
      `SELECT config FROM workspace_configs WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );
    const c = cfg.rows[0]?.config || {};
    const goals = c.goals_and_targets || {};
    return {
      industries: [],
      sizeRanges: [],
      baselineWinRate: 0.5,
      targetIndustries: Array.isArray(goals.target_industries) ? goals.target_industries : [],
      targetSizes: Array.isArray(goals.target_company_sizes) ? goals.target_company_sizes : [],
      targetStages: Array.isArray(goals.target_growth_stages) ? goals.target_growth_stages : [],
      source: 'workspace_config',
    };
  } catch {
    return {
      industries: [],
      sizeRanges: [],
      baselineWinRate: 0.5,
      targetIndustries: [],
      targetSizes: [],
      targetStages: [],
      source: 'workspace_config',
    };
  }
}

function buildAccountFeatures(
  signals: any,
  deals: any[],
  lastActivity: { last_activity: string | null } | null,
  icpWeights: ICPFirmographicWeights
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

  // Compute continuous industryLift (0.0–3.0)
  let industryLift: number;
  if (icpWeights.source === 'icp_profile' && icpWeights.industries.length > 0) {
    // Find matching industry entry by name (case-insensitive)
    const matched = icpWeights.industries.find(
      (i: IndustryEntry) => industry.toLowerCase().includes(i.name.toLowerCase())
    );
    if (matched && icpWeights.baselineWinRate > 0) {
      industryLift = Math.min(3.0, matched.win_rate / icpWeights.baselineWinRate);
    } else if (matched) {
      industryLift = matched.win_rate > 0 ? 1.0 : 0.0;
    } else {
      // No match found — neutral lift (not in ICP target set)
      industryLift = 0.0;
    }
  } else {
    // Fallback: binary — 1.0 if matches target list, 0.0 if not
    const industryMatch =
      icpWeights.targetIndustries.length === 0 ||
      icpWeights.targetIndustries.some(i => industry.toLowerCase().includes(i.toLowerCase()));
    industryLift = industryMatch ? 1.0 : 0.0;
  }

  // Compute continuous sizeLift (0.0–3.0)
  let sizeLift: number;
  if (icpWeights.source === 'icp_profile' && icpWeights.sizeRanges.length > 0) {
    const matched = icpWeights.sizeRanges.find(
      (s: SizeEntry) => employeeRange.includes(s.range)
    );
    if (matched && icpWeights.baselineWinRate > 0) {
      sizeLift = Math.min(3.0, matched.win_rate / icpWeights.baselineWinRate);
    } else if (matched) {
      sizeLift = matched.win_rate > 0 ? 1.0 : 0.0;
    } else {
      sizeLift = 0.0;
    }
  } else {
    const companySizeMatch =
      icpWeights.targetSizes.length === 0 ||
      icpWeights.targetSizes.some(s => employeeRange.includes(s));
    sizeLift = companySizeMatch ? 1.0 : 0.0;
  }

  const growthStageMatch =
    icpWeights.targetStages.length === 0 ||
    icpWeights.targetStages.some(s => growthStage.includes(s));

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
    industryLift,
    sizeLift,
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
    icpFitDetails: { industryLift, sizeLift, growthStageMatch, hasWonDeal, hasOpenDeal },
  };
}

interface ScoreBreakdown {
  firmographic_fit: { score: number; max: number; details: Record<string, boolean | number> };
  signals: { score: number; max: number; details: Record<string, any> };
  engagement: { score: number; max: number; details: Record<string, any> };
  deal_history: { score: number; max: number; details: Record<string, boolean> };
  negative_signals: { deductions: number; details: Record<string, boolean> };
  scoring_context: ScoringContext;
}

function computeBreakdown(
  features: AccountFeatures,
  weights: Weights,
  scoringContext: ScoringContext
): ScoreBreakdown {
  // Firmographic (30 max) — continuous lift-based scoring
  // industryLift and sizeLift are 0.0–3.0; each contributes up to 10 points
  // growthStageMatch is still binary (10 points)
  const industryScore = Math.min(10, features.industryLift * 10);
  const sizeScore = Math.min(10, features.sizeLift * 10);
  const firmographicScore = Math.min(30,
    industryScore +
    sizeScore +
    (features.growthStageMatch ? weights.growth_stage_match : 0)
  );

  // Signals (30 max: 20 base + 10 bonus)
  let baseSignalScore = 0;
  if (features.signalScore > 0.6) baseSignalScore = weights.signal_score_strong_positive;
  else if (features.signalScore > 0.2) baseSignalScore = weights.signal_score_positive;
  else if (features.signalScore >= -0.2) baseSignalScore = weights.signal_score_neutral;

  const bonusSignals = Math.min(10,
    (features.hasHiring ? weights.hiring_signal : 0) +
    (features.hasFunding ? weights.funding_signal : 0) +
    (features.hasExpansion ? weights.expansion_signal : 0)
  );

  // Engagement (20 max) — zero for prospecting accounts; not penalized
  let engagementScore = 0;
  if (scoringContext === 'active') {
    engagementScore = features.hasOpenDeal ? weights.has_open_deal : 0;
    if (features.lastActivityDaysAgo !== null) {
      if (features.lastActivityDaysAgo <= 7) engagementScore += weights.recent_activity_7d;
      else if (features.lastActivityDaysAgo <= 30) engagementScore += weights.recent_activity_30d;
    }
  }

  // Deal history (15 max) — zero for prospecting accounts; not penalized
  let dealScore = 0;
  if (scoringContext === 'active') {
    dealScore = features.hasWonDeal ? weights.won_deal_exists :
      features.hasAdvancedDeal ? weights.advanced_deal_exists : 0;
  }

  // Deductions
  let deductions = 0;
  // Stale-engagement deduction only applies to active accounts with open deals
  if (scoringContext === 'active' && features.hasOpenDeal && features.lastActivityDaysAgo !== null) {
    if (features.lastActivityDaysAgo >= 60) deductions += weights.no_activity_60d;
    else if (features.lastActivityDaysAgo >= 30) deductions += weights.no_activity_30d;
  }
  // These apply regardless of context — negative signals are meaningful either way
  if (features.hasLayoff) deductions += weights.layoff_signal;
  if (features.hasNegativePress) deductions += weights.negative_press_signal;
  if (features.classificationConfidence < 40) deductions += weights.low_confidence_data;

  return {
    firmographic_fit: {
      score: firmographicScore, max: 30,
      details: { industryLift: features.industryLift, sizeLift: features.sizeLift, growthStageMatch: features.growthStageMatch },
    },
    signals: {
      score: baseSignalScore + bonusSignals, max: 30,
      details: { signalScore: features.signalScore, hasHiring: features.hasHiring, hasFunding: features.hasFunding, hasExpansion: features.hasExpansion },
    },
    engagement: {
      // max = 0 for prospecting so the UI doesn't render this dimension
      score: engagementScore,
      max: scoringContext === 'prospecting' ? 0 : 20,
      details: { hasOpenDeal: features.hasOpenDeal, lastActivityDaysAgo: features.lastActivityDaysAgo },
    },
    deal_history: {
      // max = 0 for prospecting so the UI doesn't render this dimension
      score: dealScore,
      max: scoringContext === 'prospecting' ? 0 : 15,
      details: { hasWonDeal: features.hasWonDeal, hasAdvancedDeal: features.hasAdvancedDeal },
    },
    negative_signals: {
      deductions,
      details: { hasLayoff: features.hasLayoff, hasNegativePress: features.hasNegativePress, lowConfidence: features.classificationConfidence < 40 },
    },
    scoring_context: scoringContext,
  };
}

export interface AccountScore {
  accountId: string;
  totalScore: number;
  grade: string;
  breakdown: ScoreBreakdown;
  scoreDelta: number | null;
  scoringContext: ScoringContext;
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

  // Load ICP firmographic weights + scoring weights
  const icpWeights = await loadICPFirmographicWeights(workspaceId);
  const { mode, weights } = await loadScoringWeights(workspaceId);

  // Compute features
  const features = buildAccountFeatures(signals, dealsResult.rows, activityResult.rows[0] ?? null, icpWeights);

  // Determine scoring context:
  // 'prospecting' = no CRM history (no deals, no activity) — score on ICP fit + signals only
  // 'active' = account has deals or recorded activity — score all four dimensions
  const isProspecting =
    !features.hasOpenDeal &&
    !features.hasWonDeal &&
    !features.hasAdvancedDeal &&
    features.lastActivityDaysAgo === null;
  const scoringContext: ScoringContext = isProspecting ? 'prospecting' : 'active';

  const breakdown = computeBreakdown(features, weights, scoringContext);

  // For prospecting accounts, normalize firmographic + signals to 100.
  // For active accounts, sum all four dimensions (max ~95).
  const rawScore =
    breakdown.firmographic_fit.score +
    breakdown.signals.score +
    (scoringContext === 'active' ? breakdown.engagement.score + breakdown.deal_history.score : 0) +
    breakdown.negative_signals.deductions;

  let totalScore: number;
  if (scoringContext === 'prospecting') {
    // Normalize: 60 is the max for prospecting (30 firmo + 30 signals)
    totalScore = Math.max(0, Math.min(100, Math.round(rawScore / PROSPECTING_MAX * 100)));
  } else {
    totalScore = Math.max(0, Math.min(100, rawScore));
  }

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

  logger.info('Account scored', { workspaceId, accountId, totalScore, grade, mode, scoringContext });

  return { accountId, totalScore, grade, breakdown, scoreDelta, scoringContext };
}

export async function scoreAccountsBatch(
  workspaceId: string,
  accountIds: string[]
): Promise<{ scored: number; grades: Record<string, number> }> {
  const grades: Record<string, number> = {};
  let scored = 0;
  for (const accountId of accountIds) {
    try {
      const result = await scoreAccount(workspaceId, accountId);
      grades[result.grade] = (grades[result.grade] ?? 0) + 1;
      scored++;
    } catch (err: any) {
      logger.warn('scoreAccountsBatch: failed to score account', { workspaceId, accountId, error: err.message });
    }
  }
  return { scored, grades };
}
