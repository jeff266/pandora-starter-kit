import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AccountScorer');

export interface ScoreBreakdown {
  firmographic: {
    industry_match: number;
    employee_count: number;
    revenue_tier: number;
    domain_present: number;
  };
  engagement: {
    open_deals: number;
    deal_value: number;
    recent_activities: number;
    contact_count: number;
  };
  signals: {
    signal_count: number;
    signal_score_adj: number;
    positive_signals: number;
    risk_signals: number;
  };
  relationship: {
    conversation_count: number;
    multi_thread: number;
    recency: number;
  };
}

export interface AccountScore {
  accountId: string;
  totalScore: number;
  grade: string;
  firmographicScore: number;
  engagementScore: number;
  signalScore: number;
  relationshipScore: number;
  breakdown: ScoreBreakdown;
}

const WEIGHTS = {
  firmographic: { max: 25 },
  engagement: { max: 35 },
  signals: { max: 20 },
  relationship: { max: 20 },
};

function computeGrade(totalScore: number): string {
  if (totalScore >= 80) return 'A';
  if (totalScore >= 65) return 'B';
  if (totalScore >= 45) return 'C';
  if (totalScore >= 25) return 'D';
  return 'F';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function scoreAccount(
  workspaceId: string,
  accountId: string
): Promise<AccountScore> {
  const [accountData, dealData, signalData, activityData, conversationData, contactData] = await Promise.all([
    query<{
      name: string; domain: string | null; industry: string | null;
      employee_count: number | null; annual_revenue: string | null;
      apollo_data: any;
    }>(
      `SELECT name, domain, industry, employee_count, annual_revenue, apollo_data
       FROM accounts WHERE id = $1 AND workspace_id = $2`,
      [accountId, workspaceId]
    ),
    query<{ deal_count: string; total_value: string; max_amount: string }>(
      `SELECT
        COUNT(*) as deal_count,
        COALESCE(SUM(amount), 0) as total_value,
        COALESCE(MAX(amount), 0) as max_amount
       FROM deals
       WHERE account_id = $1 AND workspace_id = $2
         AND stage NOT IN ('closed_won', 'closed_lost', 'closedwon', 'closedlost')`,
      [accountId, workspaceId]
    ),
    query<{
      signal_score: string | null; signals: any[];
      data_quality: string | null; company_type: string | null;
    }>(
      `SELECT signal_score, signals, data_quality, company_type
       FROM account_signals
       WHERE account_id = $1 AND workspace_id = $2
       ORDER BY enriched_at DESC LIMIT 1`,
      [accountId, workspaceId]
    ),
    query<{ activity_count: string; recent_count: string }>(
      `SELECT
        COUNT(*) as activity_count,
        COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '30 days') as recent_count
       FROM activities
       WHERE account_id = $1 AND workspace_id = $2`,
      [accountId, workspaceId]
    ),
    query<{ conv_count: string; recent_conv: string }>(
      `SELECT
        COUNT(*) as conv_count,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '60 days') as recent_conv
       FROM conversations
       WHERE account_id = $1 AND workspace_id = $2`,
      [accountId, workspaceId]
    ),
    query<{ contact_count: string }>(
      `SELECT COUNT(*) as contact_count
       FROM contacts
       WHERE account_id = $1 AND workspace_id = $2`,
      [accountId, workspaceId]
    ),
  ]);

  const account = accountData.rows[0];
  if (!account) throw new Error(`Account ${accountId} not found`);

  const deals = dealData.rows[0];
  const signals = signalData.rows[0];
  const activities = activityData.rows[0];
  const conversations = conversationData.rows[0];
  const contacts = contactData.rows[0];

  const dealCount = parseInt(deals?.deal_count || '0');
  const totalDealValue = parseFloat(deals?.total_value || '0');
  const signalScoreRaw = parseFloat(signals?.signal_score || '0');
  const signalList = Array.isArray(signals?.signals) ? signals.signals : [];
  const recentActivities = parseInt(activities?.recent_count || '0');
  const totalActivities = parseInt(activities?.activity_count || '0');
  const convCount = parseInt(conversations?.conv_count || '0');
  const recentConv = parseInt(conversations?.recent_conv || '0');
  const contactCount = parseInt(contacts?.contact_count || '0');
  const annualRevenue = parseFloat(account.annual_revenue || '0');
  const employeeCount = account.employee_count || 0;

  const firmographic: ScoreBreakdown['firmographic'] = {
    industry_match: account.industry ? 5 : 0,
    employee_count: employeeCount > 500 ? 8 : employeeCount > 100 ? 6 : employeeCount > 20 ? 4 : employeeCount > 0 ? 2 : 0,
    revenue_tier: annualRevenue > 100_000_000 ? 8 : annualRevenue > 10_000_000 ? 6 : annualRevenue > 1_000_000 ? 4 : annualRevenue > 0 ? 2 : 0,
    domain_present: account.domain ? 4 : 0,
  };

  const engagement: ScoreBreakdown['engagement'] = {
    open_deals: dealCount >= 3 ? 10 : dealCount === 2 ? 8 : dealCount === 1 ? 5 : 0,
    deal_value: totalDealValue > 500_000 ? 10 : totalDealValue > 100_000 ? 8 : totalDealValue > 25_000 ? 5 : totalDealValue > 0 ? 2 : 0,
    recent_activities: recentActivities >= 10 ? 10 : recentActivities >= 5 ? 7 : recentActivities >= 1 ? 4 : 0,
    contact_count: contactCount >= 5 ? 5 : contactCount >= 3 ? 4 : contactCount >= 1 ? 2 : 0,
  };

  const positiveSignals = signalList.filter((s: any) =>
    ['funding', 'hiring', 'expansion', 'partnership', 'product_launch', 'award'].includes(s.type)
  ).length;
  const riskSignals = signalList.filter((s: any) =>
    ['layoff', 'negative_press', 'regulatory'].includes(s.type)
  ).length;

  const signalBreakdown: ScoreBreakdown['signals'] = {
    signal_count: clamp(signalList.length * 2, 0, 8),
    signal_score_adj: clamp(Math.round(signalScoreRaw * 5), -5, 5),
    positive_signals: clamp(positiveSignals * 3, 0, 9),
    risk_signals: clamp(-riskSignals * 3, -6, 0),
  };

  const relationship: ScoreBreakdown['relationship'] = {
    conversation_count: convCount >= 5 ? 8 : convCount >= 2 ? 5 : convCount >= 1 ? 3 : 0,
    multi_thread: contactCount >= 3 && convCount >= 2 ? 5 : 0,
    recency: recentConv >= 2 ? 7 : recentConv >= 1 ? 4 : 0,
  };

  const firmographicScore = clamp(
    firmographic.industry_match + firmographic.employee_count +
    firmographic.revenue_tier + firmographic.domain_present,
    0, WEIGHTS.firmographic.max
  );

  const engagementScore = clamp(
    engagement.open_deals + engagement.deal_value +
    engagement.recent_activities + engagement.contact_count,
    0, WEIGHTS.engagement.max
  );

  const signalScoreTotal = clamp(
    signalBreakdown.signal_count + signalBreakdown.signal_score_adj +
    signalBreakdown.positive_signals + signalBreakdown.risk_signals,
    0, WEIGHTS.signals.max
  );

  const relationshipScore = clamp(
    relationship.conversation_count + relationship.multi_thread +
    relationship.recency,
    0, WEIGHTS.relationship.max
  );

  const totalScore = clamp(
    firmographicScore + engagementScore + signalScoreTotal + relationshipScore,
    0, 100
  );

  const grade = computeGrade(totalScore);

  const breakdown: ScoreBreakdown = {
    firmographic,
    engagement,
    signals: signalBreakdown,
    relationship,
  };

  await query(
    `INSERT INTO account_scores (
      workspace_id, account_id, total_score, grade,
      firmographic_score, engagement_score, signal_score, relationship_score,
      breakdown, scored_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    ON CONFLICT (workspace_id, account_id)
    DO UPDATE SET
      total_score = $3, grade = $4,
      firmographic_score = $5, engagement_score = $6,
      signal_score = $7, relationship_score = $8,
      breakdown = $9, scored_at = NOW(), updated_at = NOW()`,
    [
      workspaceId, accountId, totalScore, grade,
      firmographicScore, engagementScore, signalScoreTotal, relationshipScore,
      JSON.stringify(breakdown),
    ]
  );

  logger.info('Scored account', {
    workspaceId, accountId, accountName: account.name,
    totalScore, grade, firmographicScore, engagementScore,
    signalScore: signalScoreTotal, relationshipScore,
  });

  return {
    accountId,
    totalScore,
    grade,
    firmographicScore,
    engagementScore,
    signalScore: signalScoreTotal,
    relationshipScore,
    breakdown,
  };
}

export async function scoreAccountsBatch(
  workspaceId: string,
  accountIds: string[]
): Promise<{ scored: number; failed: number; grades: Record<string, number> }> {
  let scored = 0;
  let failed = 0;
  const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };

  for (const accountId of accountIds) {
    try {
      const result = await scoreAccount(workspaceId, accountId);
      grades[result.grade] = (grades[result.grade] || 0) + 1;
      scored++;
    } catch (err) {
      logger.warn('Failed to score account', {
        accountId,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  logger.info('Batch scoring complete', { workspaceId, scored, failed, grades });
  return { scored, failed, grades };
}
