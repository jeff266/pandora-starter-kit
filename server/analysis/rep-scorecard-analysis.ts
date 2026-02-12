/**
 * Rep Scorecard Analysis
 *
 * Composite performance scoring for reps with graceful degradation
 * when data sources are missing.
 */

import { query } from '../db.js';
import { getAverageTimeInStage, getRepStageMetrics } from './stage-history-queries.js';

export interface RepMetrics {
  repName: string;
  repEmail: string | null;

  // Results (lagging)
  closedWon: number;
  closedWonCount: number;
  closedLost: number;
  closedLostCount: number;
  winRate: number | null;
  avgDealSize: number | null;
  avgSalesCycle: number | null;

  // Quota
  quota: number | null;
  quotaAttainment: number | null;

  // Pipeline (current)
  openPipeline: number;
  openDealCount: number;
  weightedPipeline: number | null;
  coverageRatio: number | null;

  // Velocity (from stage history)
  avgDaysPerStage: number | null;
  velocityIndex: number | null;  // rep_avg / team_avg
  stageConversionRate: number | null;

  // Activity (optional)
  totalActivities: number | null;
  emailsSent: number | null;
  callsMade: number | null;
  meetingsHeld: number | null;
  activitiesPerDeal: number | null;
  activityTrend: 'increasing' | 'declining' | 'stable' | null;

  // Conversations (optional)
  callCount: number | null;
  avgCallDuration: number | null;
  avgTalkRatio: number | null;

  // Pipeline generation
  newDealsCreated: number | null;
  newDealValue: number | null;

  // Deal health
  staleDeals: number;
  staleDealValue: number;
}

export interface TeamAverages {
  avgClosedWon: number;
  avgWinRate: number;
  avgCoverageRatio: number;
  avgVelocityIndex: number;
  avgActivities: number;
  avgCallCount: number;
  avgTalkRatio: number;
  avgNewDeals: number;
}

export interface DataAvailability {
  hasQuotas: boolean;
  hasActivities: boolean;
  hasConversations: boolean;
  hasStageHistory: boolean;
  quotaCount: number;
  activityCount: number;
  conversationCount: number;
  stageHistoryCount: number;
}

export interface ScorecardWeights {
  quotaAttainment: number;
  coverageRatio: number;
  activity: number;
  winRate: number;
  pipelineGen: number;
  conversationQuality: number;
}

export interface ScoreBreakdown {
  [key: string]: {
    score: number;
    weight: number;
    contribution: number;
  };
}

export interface RepScorecard extends RepMetrics {
  overallScore: number;
  scoreBreakdown: ScoreBreakdown;
  rank: number | null;
  rankChange: number | null;
}

export interface RepScorecardResult {
  reps: RepScorecard[];
  teamAverages: TeamAverages;
  dataAvailability: DataAvailability;
  top3: RepScorecard[];
  bottom3: RepScorecard[];
  generatedAt: Date;
}

/**
 * Check data availability for workspace
 */
export async function checkDataAvailability(workspaceId: string): Promise<DataAvailability> {
  const [quotas, activities, conversations, stageHistory] = await Promise.all([
    query('SELECT COUNT(*) as count FROM rep_quotas rq JOIN quota_periods qp ON qp.id = rq.period_id WHERE qp.workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*) as count FROM activities WHERE workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*) as count FROM conversations WHERE workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*) as count FROM deal_stage_history WHERE workspace_id = $1', [workspaceId]),
  ]);

  return {
    hasQuotas: Number(quotas.rows[0]?.count || 0) > 0,
    hasActivities: Number(activities.rows[0]?.count || 0) > 0,
    hasConversations: Number(conversations.rows[0]?.count || 0) > 0,
    hasStageHistory: Number(stageHistory.rows[0]?.count || 0) > 0,
    quotaCount: Number(quotas.rows[0]?.count || 0),
    activityCount: Number(activities.rows[0]?.count || 0),
    conversationCount: Number(conversations.rows[0]?.count || 0),
    stageHistoryCount: Number(stageHistory.rows[0]?.count || 0),
  };
}

/**
 * Main rep scorecard computation
 */
export async function repScorecard(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date,
  changeWindowStart: Date,
  changeWindowEnd: Date,
  dataAvailability: DataAvailability
): Promise<RepScorecardResult> {
  // Get all reps from deals table
  const repsResult = await query<{ owner: string }>(
    `SELECT DISTINCT owner
     FROM deals
     WHERE workspace_id = $1
       AND owner IS NOT NULL
       AND owner != ''`,
    [workspaceId]
  );

  const repList = repsResult.rows.map(r => ({
    name: r.owner,
    email: null as string | null,
  }));

  // Initialize metrics for each rep
  const repMetrics: RepMetrics[] = [];

  for (const rep of repList) {
    const metrics = await gatherRepMetrics(
      workspaceId,
      rep.name,
      rep.email,
      periodStart,
      periodEnd,
      changeWindowStart,
      changeWindowEnd,
      dataAvailability
    );
    repMetrics.push(metrics);
  }

  // Calculate team averages
  const teamAverages = calculateTeamAverages(repMetrics);

  // Compute composite scores
  const scoredReps = repMetrics.map(rep => {
    const { overallScore, breakdown } = computeCompositeScore(
      rep,
      teamAverages,
      dataAvailability
    );

    return {
      ...rep,
      overallScore,
      scoreBreakdown: breakdown,
      rank: null,
      rankChange: null,
    };
  });

  // Rank reps
  scoredReps.sort((a, b) => b.overallScore - a.overallScore);
  scoredReps.forEach((rep, index) => {
    rep.rank = index + 1;
  });

  return {
    reps: scoredReps,
    teamAverages,
    dataAvailability,
    top3: scoredReps.slice(0, 3),
    bottom3: scoredReps.slice(-3).reverse(),
    generatedAt: new Date(),
  };
}

/**
 * Gather all metrics for a single rep
 */
async function gatherRepMetrics(
  workspaceId: string,
  repName: string,
  repEmail: string | null,
  periodStart: Date,
  periodEnd: Date,
  changeWindowStart: Date,
  changeWindowEnd: Date,
  dataAvailability: DataAvailability
): Promise<RepMetrics> {
  // Results metrics
  const resultsResult = await query<{
    closed_won: number;
    closed_won_count: number;
    closed_lost: number;
    closed_lost_count: number;
    avg_deal_size: number;
    avg_sales_cycle: number;
  }>(
    `SELECT
      COALESCE(SUM(CASE WHEN stage_normalized = 'closed_won' THEN amount ELSE 0 END), 0) as closed_won,
      COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END) as closed_won_count,
      COUNT(CASE WHEN stage_normalized = 'closed_lost' THEN 1 END) as closed_lost_count,
      COALESCE(SUM(CASE WHEN stage_normalized = 'closed_lost' THEN amount ELSE 0 END), 0) as closed_lost,
      AVG(CASE WHEN stage_normalized = 'closed_won' THEN amount END) as avg_deal_size,
      AVG(CASE WHEN stage_normalized = 'closed_won' AND close_date IS NOT NULL AND created_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (close_date - created_at)) / 86400 END) as avg_sales_cycle
    FROM deals
    WHERE workspace_id = $1
      AND owner = $2
      AND close_date BETWEEN $3 AND $4`,
    [workspaceId, repName, periodStart, periodEnd]
  );

  const results = resultsResult.rows[0] || {};
  const closedWonCount = Number(results.closed_won_count || 0);
  const closedLostCount = Number(results.closed_lost_count || 0);
  const totalClosed = closedWonCount + closedLostCount;

  // Pipeline metrics
  const pipelineResult = await query<{
    open_pipeline: number;
    open_deal_count: number;
    weighted_pipeline: number;
  }>(
    `SELECT
      COALESCE(SUM(amount), 0) as open_pipeline,
      COUNT(*) as open_deal_count,
      COALESCE(SUM(amount * COALESCE(probability, 0) / 100.0), 0) as weighted_pipeline
    FROM deals
    WHERE workspace_id = $1
      AND owner = $2
      AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId, repName]
  );

  const pipeline = pipelineResult.rows[0] || {};

  // Quota (if available)
  let quota = null;
  let quotaAttainment = null;
  let coverageRatio = null;

  if (dataAvailability.hasQuotas) {
    const quotaResult = await query<{ quota_amount: number }>(
      `SELECT rq.quota_amount
       FROM rep_quotas rq
       JOIN quota_periods qp ON qp.id = rq.period_id
       WHERE qp.workspace_id = $1
         AND (rq.rep_email = $2 OR rq.rep_name = $3)
         AND qp.start_date <= $4
         AND qp.end_date >= $5
       LIMIT 1`,
      [workspaceId, repEmail, repName, periodEnd, periodStart]
    );

    if (quotaResult.rows.length > 0) {
      quota = Number(quotaResult.rows[0].quota_amount);
      const closedWon = Number(results.closed_won || 0);
      quotaAttainment = quota > 0 ? closedWon / quota : null;

      const remainingQuota = Math.max(0, quota - closedWon);
      const openPipeline = Number(pipeline.open_pipeline || 0);
      coverageRatio = remainingQuota > 0 ? openPipeline / remainingQuota : null;
    }
  }

  // Velocity (if stage history available)
  let avgDaysPerStage = null;
  let velocityIndex = null;
  let stageConversionRate = null;

  if (dataAvailability.hasStageHistory) {
    const velocityResult = await query<{ avg_duration_days: number }>(
      `SELECT AVG(duration_in_previous_stage_ms / 86400000.0) as avg_duration_days
       FROM deal_stage_history dsh
       JOIN deals d ON d.id = dsh.deal_id
       WHERE dsh.workspace_id = $1
         AND d.owner = $2
         AND dsh.duration_in_previous_stage_ms IS NOT NULL`,
      [workspaceId, repName]
    );

    if (velocityResult.rows.length > 0 && velocityResult.rows[0].avg_duration_days) {
      avgDaysPerStage = Number(velocityResult.rows[0].avg_duration_days);

      // Get team average for comparison
      const teamAvgResult = await getAverageTimeInStage(workspaceId);
      const teamOverallAvg = teamAvgResult.reduce((sum, s) => sum + s.avgDays, 0) / teamAvgResult.length;
      velocityIndex = teamOverallAvg > 0 ? avgDaysPerStage / teamOverallAvg : null;
    }
  }

  // Activities (if available)
  let totalActivities = null;
  let emailsSent = null;
  let callsMade = null;
  let meetingsHeld = null;
  let activitiesPerDeal = null;
  let activityTrend = null;

  if (dataAvailability.hasActivities) {
    const activityResult = await query<{
      total: number;
      emails: number;
      calls: number;
      meetings: number;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN activity_type = 'email' THEN 1 END) as emails,
        COUNT(CASE WHEN activity_type = 'call' THEN 1 END) as calls,
        COUNT(CASE WHEN activity_type = 'meeting' THEN 1 END) as meetings
       FROM activities
       WHERE workspace_id = $1
         AND actor = $2
         AND created_at BETWEEN $3 AND $4`,
      [workspaceId, repName, changeWindowStart, changeWindowEnd]
    );

    if (activityResult.rows.length > 0) {
      totalActivities = Number(activityResult.rows[0].total);
      emailsSent = Number(activityResult.rows[0].emails);
      callsMade = Number(activityResult.rows[0].calls);
      meetingsHeld = Number(activityResult.rows[0].meetings);

      const openDealCount = Number(pipeline.open_deal_count || 0);
      activitiesPerDeal = openDealCount > 0 ? totalActivities / openDealCount : null;
    }
  }

  // Conversations (if available)
  let callCount = null;
  let avgCallDuration = null;
  let avgTalkRatio = null;

  if (dataAvailability.hasConversations) {
    const convResult = await query<{
      call_count: number;
      avg_duration: number;
      avg_talk_ratio: number;
    }>(
      `SELECT
        COUNT(*) as call_count,
        AVG(duration_seconds) as avg_duration,
        AVG(talk_listen_ratio) as avg_talk_ratio
       FROM conversations
       WHERE workspace_id = $1
         AND $2 = ANY(participants)
         AND created_at BETWEEN $3 AND $4`,
      [workspaceId, repEmail, changeWindowStart, changeWindowEnd]
    );

    if (convResult.rows.length > 0 && Number(convResult.rows[0].call_count) > 0) {
      callCount = Number(convResult.rows[0].call_count);
      avgCallDuration = Number(convResult.rows[0].avg_duration) || null;
      avgTalkRatio = Number(convResult.rows[0].avg_talk_ratio) || null;
    }
  }

  // Pipeline generation
  const newDealsResult = await query<{ count: number; value: number }>(
    `SELECT
      COUNT(*) as count,
      COALESCE(SUM(amount), 0) as value
     FROM deals
     WHERE workspace_id = $1
       AND owner = $2
       AND created_at BETWEEN $3 AND $4`,
    [workspaceId, repName, changeWindowStart, changeWindowEnd]
  );

  const newDeals = newDealsResult.rows[0] || {};

  // Stale deals
  const staleResult = await query<{ count: number; value: number }>(
    `SELECT
      COUNT(*) as count,
      COALESCE(SUM(amount), 0) as value
     FROM deals
     WHERE workspace_id = $1
       AND owner = $2
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND last_activity_date < NOW() - INTERVAL '14 days'`,
    [workspaceId, repName]
  );

  const stale = staleResult.rows[0] || {};

  return {
    repName,
    repEmail,
    closedWon: Number(results.closed_won || 0),
    closedWonCount,
    closedLost: Number(results.closed_lost || 0),
    closedLostCount,
    winRate: totalClosed >= 3 ? closedWonCount / totalClosed : null,
    avgDealSize: results.avg_deal_size ? Number(results.avg_deal_size) : null,
    avgSalesCycle: results.avg_sales_cycle ? Number(results.avg_sales_cycle) : null,
    quota,
    quotaAttainment,
    openPipeline: Number(pipeline.open_pipeline || 0),
    openDealCount: Number(pipeline.open_deal_count || 0),
    weightedPipeline: Number(pipeline.weighted_pipeline || 0),
    coverageRatio,
    avgDaysPerStage,
    velocityIndex,
    stageConversionRate,
    totalActivities,
    emailsSent,
    callsMade,
    meetingsHeld,
    activitiesPerDeal,
    activityTrend,
    callCount,
    avgCallDuration,
    avgTalkRatio,
    newDealsCreated: Number(newDeals.count || 0),
    newDealValue: Number(newDeals.value || 0),
    staleDeals: Number(stale.count || 0),
    staleDealValue: Number(stale.value || 0),
  };
}

/**
 * Calculate team averages for normalization
 */
function calculateTeamAverages(reps: RepMetrics[]): TeamAverages {
  const count = reps.length || 1;

  return {
    avgClosedWon: reps.reduce((sum, r) => sum + r.closedWon, 0) / count,
    avgWinRate: reps.filter(r => r.winRate !== null).reduce((sum, r) => sum + (r.winRate || 0), 0) / count,
    avgCoverageRatio: reps.filter(r => r.coverageRatio !== null).reduce((sum, r) => sum + (r.coverageRatio || 0), 0) / count,
    avgVelocityIndex: reps.filter(r => r.velocityIndex !== null).reduce((sum, r) => sum + (r.velocityIndex || 0), 0) / count,
    avgActivities: reps.filter(r => r.totalActivities !== null).reduce((sum, r) => sum + (r.totalActivities || 0), 0) / count,
    avgCallCount: reps.filter(r => r.callCount !== null).reduce((sum, r) => sum + (r.callCount || 0), 0) / count,
    avgTalkRatio: reps.filter(r => r.avgTalkRatio !== null).reduce((sum, r) => sum + (r.avgTalkRatio || 0), 0) / count,
    avgNewDeals: reps.reduce((sum, r) => sum + (r.newDealsCreated || 0), 0) / count,
  };
}

/**
 * Compute composite score with adaptive weighting
 */
export function computeCompositeScore(
  rep: RepMetrics,
  teamAverages: TeamAverages,
  dataAvailability: DataAvailability,
  weights?: ScorecardWeights
): { overallScore: number; breakdown: ScoreBreakdown } {
  const defaultWeights: ScorecardWeights = {
    quotaAttainment: 0.30,
    coverageRatio: 0.20,
    activity: 0.15,
    winRate: 0.15,
    pipelineGen: 0.10,
    conversationQuality: 0.10,
  };

  const w = weights ?? defaultWeights;
  let activeWeights = { ...w };

  // Zero out unavailable categories
  if (!dataAvailability.hasActivities) activeWeights.activity = 0;
  if (!dataAvailability.hasConversations) activeWeights.conversationQuality = 0;
  if (!dataAvailability.hasQuotas || rep.quota === null) activeWeights.quotaAttainment = 0;

  // Normalize weights
  let totalActiveWeight = Object.values(activeWeights).reduce((a, b) => a + b, 0);
  if (totalActiveWeight > 0) {
    for (const key of Object.keys(activeWeights) as Array<keyof ScorecardWeights>) {
      activeWeights[key] /= totalActiveWeight;
    }
  }

  // Score each component (0-100 scale)
  const attainmentScore = rep.quotaAttainment !== null
    ? Math.min(100, rep.quotaAttainment * 75)
    : 50;

  const coverageScore = rep.coverageRatio !== null
    ? Math.min(100, (rep.coverageRatio / 5) * 100)
    : 50;

  const activityScore = rep.totalActivities !== null && teamAverages.avgActivities > 0
    ? Math.min(100, (rep.totalActivities / teamAverages.avgActivities) * 60)
    : null;

  const winRateScore = rep.winRate !== null && (rep.closedWonCount + rep.closedLostCount) >= 3
    ? Math.min(100, (rep.winRate / Math.max(teamAverages.avgWinRate, 0.01)) * 60)
    : null;

  const pipelineGenScore = rep.newDealsCreated !== null && teamAverages.avgNewDeals > 0
    ? Math.min(100, (rep.newDealsCreated / teamAverages.avgNewDeals) * 60)
    : null;

  const conversationScore = rep.callCount !== null && rep.callCount > 0
    ? Math.min(100, (
        (rep.callCount / Math.max(teamAverages.avgCallCount, 1)) * 30 +
        ((1 - (rep.avgTalkRatio || 0.5)) / (1 - Math.max(teamAverages.avgTalkRatio, 0.01))) * 30
      ))
    : null;

  // Weighted composite
  let compositeNumerator = 0;
  let compositeWeightUsed = 0;

  const components = [
    { score: attainmentScore, weight: activeWeights.quotaAttainment, label: 'quotaAttainment' },
    { score: coverageScore, weight: activeWeights.coverageRatio, label: 'coverageRatio' },
    { score: activityScore, weight: activeWeights.activity, label: 'activity' },
    { score: winRateScore, weight: activeWeights.winRate, label: 'winRate' },
    { score: pipelineGenScore, weight: activeWeights.pipelineGen, label: 'pipelineGen' },
    { score: conversationScore, weight: activeWeights.conversationQuality, label: 'conversationQuality' },
  ];

  const breakdown: ScoreBreakdown = {};
  for (const c of components) {
    if (c.score !== null && c.weight > 0) {
      compositeNumerator += c.score * c.weight;
      compositeWeightUsed += c.weight;
      breakdown[c.label] = {
        score: Math.round(c.score),
        weight: Math.round(c.weight * 100) / 100,
        contribution: Math.round(c.score * c.weight),
      };
    }
  }

  const overallScore = compositeWeightUsed > 0
    ? Math.round(compositeNumerator / compositeWeightUsed)
    : 0;

  return { overallScore, breakdown };
}
