/**
 * Lead Scoring v1 — Point-Based Scoring Engine
 *
 * Scores open deals and contacts using existing database features.
 * Integrates with custom field discovery to automatically weight
 * high-signal fields discovered in the workspace's data.
 *
 * No external APIs, no ICP model required — works day 1.
 */

import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('LeadScoring');

// ============================================================================
// Types
// ============================================================================

interface DealFeatures {
  id: string;
  name: string;
  amount: number | null;
  stageNormalized: string;
  closeDate: Date | null;
  probability: number | null;
  daysInStage: number | null;
  ownerEmail: string | null;
  ownerName: string | null;
  createdDate: Date;
  customFields: Record<string, any>;

  // Account context
  accountName: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;
  accountCustomFields: Record<string, any>;

  // Engagement signals
  totalActivities: number;
  emails: number;
  calls: number;
  meetings: number;
  tasks: number;
  lastActivity: Date | null;
  activeDays: number;
  recentActivities: number;

  // Threading signals
  totalContacts: number;
  uniqueRoles: number;
  powerContacts: number;
  champions: number;
  rolesPresent: string[];

  // Conversation signals (optional)
  totalCalls?: number;
  lastCall?: Date | null;
  avgDuration?: number;
  recentCalls?: number;

  // Velocity signals
  daysSinceCreation: number;
  daysUntilClose: number | null;
  daysSinceLastActivity: number | null;
}

interface ContactFeatures {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  title: string | null;
  phone: string | null;
  customFields: Record<string, any>;

  // Role context
  buyingRole: string | null;
  roleConfidence: number | null;
  tenureMonths: number | null;
  seniorityVerified: string | null;

  // Associated deals
  dealId: string;
  dealAmount: number | null;
  dealStage: string;
  dealScore?: number; // Will be populated after deal scoring
}

interface CustomFieldWeight {
  fieldKey: string;
  entityType: 'deal' | 'account' | 'contact';
  valueScores: Record<string, number>; // value → points (0-10)
  weight: number; // multiplier based on ICP relevance score
  maxPoints: number;
}

interface ScoreComponent {
  value: any;
  points: number;
  weight: number;
}

interface LeadScore {
  entityType: 'deal' | 'contact';
  entityId: string;
  totalScore: number;
  scoreBreakdown: Record<string, ScoreComponent>;
  scoreGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  scoringMethod: 'point_based';
  scoredAt: Date;
  previousScore?: number;
  scoreChange?: number;
}

interface ScoringResult {
  dealScores: LeadScore[];
  contactScores: LeadScore[];
  summaryStats: {
    totalDeals: number;
    totalContacts: number;
    gradeDistribution: Record<string, number>;
    avgDealScore: number;
    topDeals: Array<{ id: string; name: string; score: number; grade: string }>;
    bottomDeals: Array<{ id: string; name: string; score: number; grade: string }>;
    movers: Array<{ id: string; name: string; change: number; from: number; to: number }>;
    repScores: Record<string, { avgScore: number; dealCount: number }>;
  };
  customFieldContributions: Array<{
    fieldKey: string;
    avgPoints: number;
    topValue: string;
    topValueScore: number;
  }>;
}

// ============================================================================
// Default Weights
// ============================================================================

const DEFAULT_WEIGHTS = {
  deal: {
    // Engagement (max 25 points)
    has_recent_activity: 8,
    activity_volume: 7,
    multi_channel: 5,
    active_days: 5,

    // Threading (max 20 points)
    multi_threaded: 6,
    has_champion: 5,
    has_economic_buyer: 5,
    role_diversity: 4,

    // Deal quality (max 20 points)
    amount_present: 3,
    amount_tier: 7,
    probability: 5,
    stage_advanced: 5,

    // Velocity (max 15 points)
    close_date_set: 3,
    close_date_reasonable: 4,
    days_since_activity: -8, // NEGATIVE
    stage_velocity: 8,

    // Conversation (max 10 points)
    has_calls: 5,
    recent_call: 3,
    call_volume: 2,
    no_calls_late_stage: -5, // NEGATIVE
  },

  contact: {
    has_email: 10,
    has_phone: 5,
    has_title: 5,
    role_assigned: 10,
    is_power_role: 15,
    seniority_high: 10,
    activity_on_deals: 15,
    multi_deal_contact: 10,
    deal_quality: 20,
  },
};

// ============================================================================
// Feature Extraction
// ============================================================================

async function extractDealFeatures(workspaceId: string): Promise<DealFeatures[]> {
  const dealsResult = await query<any>(`
    SELECT
      d.id, d.name, d.amount, d.stage_normalized, d.close_date,
      d.probability, d.owner_email, d.owner_name, d.created_date,
      d.custom_fields,
      a.name as account_name, a.industry, a.employee_count,
      a.annual_revenue, a.custom_fields as account_custom_fields,
      EXTRACT(EPOCH FROM (NOW() - d.created_date)) / 86400 as days_since_creation,
      EXTRACT(EPOCH FROM (d.close_date - NOW())) / 86400 as days_until_close
    FROM deals d
    LEFT JOIN accounts a ON d.account_id = a.id AND a.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
    ORDER BY d.amount DESC NULLS LAST
  `, [workspaceId]);

  const deals: DealFeatures[] = [];

  for (const row of dealsResult.rows) {
    // Get engagement signals
    const activityResult = await query<any>(`
      SELECT
        COUNT(*) as total_activities,
        COUNT(*) FILTER (WHERE activity_type = 'email') as emails,
        COUNT(*) FILTER (WHERE activity_type = 'call') as calls,
        COUNT(*) FILTER (WHERE activity_type = 'meeting') as meetings,
        COUNT(*) FILTER (WHERE activity_type = 'task') as tasks,
        MAX(timestamp) as last_activity,
        COUNT(DISTINCT DATE(timestamp)) as active_days,
        COUNT(*) FILTER (
          WHERE timestamp >= NOW() - INTERVAL '14 days'
        ) as recent_activities
      FROM activities
      WHERE workspace_id = $1 AND deal_id = $2
    `, [workspaceId, row.id]);

    const activityRow = activityResult.rows[0] || {};

    // Get threading signals
    const threadingResult = await query<any>(`
      SELECT
        COUNT(*) as total_contacts,
        COUNT(DISTINCT buying_role) as unique_roles,
        COUNT(*) FILTER (
          WHERE buying_role IN ('champion', 'economic_buyer', 'decision_maker')
        ) as power_contacts,
        COUNT(*) FILTER (
          WHERE buying_role = 'champion'
        ) as champions,
        ARRAY_AGG(DISTINCT buying_role) FILTER (
          WHERE buying_role IS NOT NULL
        ) as roles_present
      FROM deal_contacts
      WHERE workspace_id = $1 AND deal_id = $2
    `, [workspaceId, row.id]);

    const threadingRow = threadingResult.rows[0] || {};

    // Get conversation signals (if available)
    let conversationRow: any = {};
    try {
      const conversationResult = await query<any>(`
        SELECT
          COUNT(*) as total_calls,
          MAX(started_at) as last_call,
          AVG(duration_seconds) as avg_duration,
          COUNT(*) FILTER (
            WHERE started_at >= NOW() - INTERVAL '14 days'
          ) as recent_calls
        FROM conversations
        WHERE workspace_id = $1 AND deal_id = $2
      `, [workspaceId, row.id]);

      conversationRow = conversationResult.rows[0] || {};
    } catch (error) {
      // Conversations table may not exist - skip
      logger.debug('[Lead Scoring] No conversations table, skipping conversation signals');
    }

    const lastActivity = activityRow.last_activity ? new Date(activityRow.last_activity) : null;
    const daysSinceLastActivity = lastActivity
      ? Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    deals.push({
      id: row.id,
      name: row.name,
      amount: row.amount,
      stageNormalized: row.stage_normalized,
      closeDate: row.close_date ? new Date(row.close_date) : null,
      probability: row.probability,
      daysInStage: null, // TODO: calculate from stage_history
      ownerEmail: row.owner_email,
      ownerName: row.owner_name,
      createdDate: new Date(row.created_date),
      customFields: row.custom_fields || {},
      accountName: row.account_name,
      industry: row.industry,
      employeeCount: row.employee_count,
      annualRevenue: row.annual_revenue,
      accountCustomFields: row.account_custom_fields || {},
      totalActivities: parseInt(activityRow.total_activities || '0', 10),
      emails: parseInt(activityRow.emails || '0', 10),
      calls: parseInt(activityRow.calls || '0', 10),
      meetings: parseInt(activityRow.meetings || '0', 10),
      tasks: parseInt(activityRow.tasks || '0', 10),
      lastActivity,
      activeDays: parseInt(activityRow.active_days || '0', 10),
      recentActivities: parseInt(activityRow.recent_activities || '0', 10),
      totalContacts: parseInt(threadingRow.total_contacts || '0', 10),
      uniqueRoles: parseInt(threadingRow.unique_roles || '0', 10),
      powerContacts: parseInt(threadingRow.power_contacts || '0', 10),
      champions: parseInt(threadingRow.champions || '0', 10),
      rolesPresent: threadingRow.roles_present || [],
      totalCalls: conversationRow.total_calls ? parseInt(conversationRow.total_calls, 10) : undefined,
      lastCall: conversationRow.last_call ? new Date(conversationRow.last_call) : undefined,
      avgDuration: conversationRow.avg_duration ? parseFloat(conversationRow.avg_duration) : undefined,
      recentCalls: conversationRow.recent_calls ? parseInt(conversationRow.recent_calls, 10) : undefined,
      daysSinceCreation: Math.floor(parseFloat(row.days_since_creation || '0')),
      daysUntilClose: row.days_until_close ? Math.floor(parseFloat(row.days_until_close)) : null,
      daysSinceLastActivity,
    });
  }

  logger.info('[Lead Scoring] Extracted deal features', {
    dealCount: deals.length,
    withActivities: deals.filter(d => d.totalActivities > 0).length,
    withContacts: deals.filter(d => d.totalContacts > 0).length,
    withCalls: deals.filter(d => (d.totalCalls || 0) > 0).length,
  });

  return deals;
}

async function extractContactFeatures(workspaceId: string): Promise<ContactFeatures[]> {
  const result = await query<any>(`
    SELECT
      c.id, c.first_name, c.last_name, c.email, c.title, c.phone,
      c.custom_fields,
      dc.buying_role, dc.role_confidence,
      dc.tenure_months, dc.seniority_verified,
      d.id as deal_id, d.amount as deal_amount, d.stage_normalized as deal_stage
    FROM contacts c
    JOIN deal_contacts dc ON dc.contact_id = c.id
      AND dc.workspace_id = c.workspace_id
    JOIN deals d ON dc.deal_id = d.id AND d.workspace_id = dc.workspace_id
    WHERE c.workspace_id = $1
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  `, [workspaceId]);

  return result.rows.map(row => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    title: row.title,
    phone: row.phone,
    customFields: row.custom_fields || {},
    buyingRole: row.buying_role,
    roleConfidence: row.role_confidence,
    tenureMonths: row.tenure_months,
    seniorityVerified: row.seniority_verified,
    dealId: row.deal_id,
    dealAmount: row.deal_amount,
    dealStage: row.deal_stage,
  }));
}

// ============================================================================
// Custom Field Weights
// ============================================================================

async function getCustomFieldWeights(workspaceId: string): Promise<CustomFieldWeight[]> {
  try {
    // Check if custom-field-discovery has run
    const lastRun = await query<{ output: any }>(`
      SELECT output FROM skill_runs
      WHERE workspace_id = $1 AND skill_id = 'custom-field-discovery'
        AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `, [workspaceId]);

    if (lastRun.rows.length === 0) {
      logger.info('[Lead Scoring] No custom field discovery results found, using default weights only');
      return [];
    }

    const discovery = lastRun.rows[0].output;
    const topFields = discovery.topFields || [];

    const weights: CustomFieldWeight[] = [];

    for (const field of topFields) {
      if (field.icpRelevanceScore < 50) continue;
      if (!field.winRateByValue || Object.keys(field.winRateByValue).length === 0) continue;
      if (field.entityType === 'lead') continue; // Skip lead fields for deal scoring

      // Find max win rate for normalization
      const winRates = Object.values(field.winRateByValue).map((v: any) => v.winRate);
      const maxWinRate = Math.max(...winRates);

      if (maxWinRate === 0) continue;

      // Normalize win rates to 0-10 point scale
      const valueScores: Record<string, number> = {};
      for (const [value, stats] of Object.entries(field.winRateByValue)) {
        valueScores[value] = Math.round(((stats as any).winRate / maxWinRate) * 10);
      }

      weights.push({
        fieldKey: field.fieldKey,
        entityType: field.entityType,
        valueScores,
        weight: Math.min(10, field.icpRelevanceScore / 10),
        maxPoints: 10,
      });
    }

    logger.info('[Lead Scoring] Loaded custom field weights', {
      totalFields: topFields.length,
      usableFields: weights.length,
    });

    return weights;
  } catch (error) {
    logger.warn('[Lead Scoring] Failed to load custom field weights', { error });
    return [];
  }
}

// ============================================================================
// Scoring Engine
// ============================================================================

function evaluateDealFeature(feature: string, deal: DealFeatures, maxWeight: number): { points: number; rawValue: any } {
  switch (feature) {
    case 'has_recent_activity':
      return { points: deal.recentActivities > 0 ? maxWeight : 0, rawValue: deal.recentActivities };

    case 'activity_volume':
      // 1pt per 5 activities, max 7
      return { points: Math.min(maxWeight, Math.floor(deal.totalActivities / 5)), rawValue: deal.totalActivities };

    case 'multi_channel': {
      const channels = [deal.emails > 0, deal.calls > 0, deal.meetings > 0].filter(Boolean).length;
      const points = channels >= 3 ? maxWeight : channels === 2 ? maxWeight * 0.6 : channels === 1 ? maxWeight * 0.2 : 0;
      return { points: Math.round(points), rawValue: channels };
    }

    case 'active_days':
      // 1pt per 3 active days, max 5
      return { points: Math.min(maxWeight, Math.floor(deal.activeDays / 3)), rawValue: deal.activeDays };

    case 'multi_threaded': {
      const contacts = deal.totalContacts;
      const points = contacts >= 3 ? maxWeight : contacts === 2 ? maxWeight * 0.5 : 0;
      return { points: Math.round(points), rawValue: contacts };
    }

    case 'has_champion':
      return { points: deal.champions > 0 ? maxWeight : 0, rawValue: deal.champions };

    case 'has_economic_buyer': {
      const hasEB = deal.rolesPresent.some(r => r === 'economic_buyer' || r === 'decision_maker');
      return { points: hasEB ? maxWeight : 0, rawValue: hasEB };
    }

    case 'role_diversity': {
      const roles = deal.uniqueRoles;
      const points = roles >= 3 ? maxWeight : roles === 2 ? maxWeight * 0.5 : 0;
      return { points: Math.round(points), rawValue: roles };
    }

    case 'amount_present':
      return { points: deal.amount && deal.amount > 0 ? maxWeight : 0, rawValue: deal.amount };

    case 'amount_tier':
      // TODO: compute workspace median, for now use simple tiers
      if (!deal.amount || deal.amount === 0) return { points: 0, rawValue: 0 };
      const points = deal.amount >= 100000 ? maxWeight : deal.amount >= 50000 ? maxWeight * 0.6 : maxWeight * 0.3;
      return { points: Math.round(points), rawValue: deal.amount };

    case 'probability':
      // probability / 20 (100% = 5pts)
      return { points: deal.probability ? Math.round((deal.probability / 100) * maxWeight) : 0, rawValue: deal.probability };

    case 'stage_advanced': {
      // Later stages get more points
      const stageOrder = ['awareness', 'qualification', 'evaluation', 'decision', 'negotiation'];
      const stageIndex = stageOrder.indexOf(deal.stageNormalized);
      const points = stageIndex >= 0 ? Math.round((stageIndex / 4) * maxWeight) : 0;
      return { points, rawValue: deal.stageNormalized };
    }

    case 'close_date_set':
      return { points: deal.closeDate ? maxWeight : 0, rawValue: deal.closeDate !== null };

    case 'close_date_reasonable': {
      if (!deal.daysUntilClose) return { points: 0, rawValue: false };
      const reasonable = deal.daysUntilClose > 0 && deal.daysUntilClose < 180;
      return { points: reasonable ? maxWeight : 0, rawValue: reasonable };
    }

    case 'days_since_activity': {
      // NEGATIVE: -2 per week of inactivity (max -8)
      if (deal.daysSinceLastActivity === null) return { points: maxWeight, rawValue: null }; // full penalty
      const weeks = Math.floor(deal.daysSinceLastActivity / 7);
      const penalty = Math.max(maxWeight, -2 * weeks);
      return { points: penalty, rawValue: deal.daysSinceLastActivity };
    }

    case 'stage_velocity':
      // TODO: compute actual velocity, for now use days since creation as proxy
      const points = deal.daysSinceCreation < 30 ? maxWeight : deal.daysSinceCreation < 60 ? maxWeight * 0.5 : 0;
      return { points: Math.round(points), rawValue: deal.daysSinceCreation };

    case 'has_calls':
      return { points: (deal.totalCalls || 0) > 0 ? maxWeight : 0, rawValue: deal.totalCalls || 0 };

    case 'recent_call': {
      const hasRecentCall = deal.lastCall && (Date.now() - deal.lastCall.getTime()) < 14 * 24 * 60 * 60 * 1000;
      return { points: hasRecentCall ? maxWeight : 0, rawValue: hasRecentCall };
    }

    case 'call_volume':
      return { points: (deal.totalCalls || 0) >= 3 ? maxWeight : 0, rawValue: deal.totalCalls || 0 };

    case 'no_calls_late_stage': {
      const isLateStage = ['decision', 'negotiation'].includes(deal.stageNormalized);
      const noCalls = (deal.totalCalls || 0) === 0;
      return { points: isLateStage && noCalls ? maxWeight : 0, rawValue: isLateStage && noCalls };
    }

    default:
      return { points: 0, rawValue: null };
  }
}

function scoreDeal(
  deal: DealFeatures,
  customFieldWeights: CustomFieldWeight[],
  workspaceMedianAmount: number
): LeadScore {
  const breakdown: Record<string, ScoreComponent> = {};
  let totalPoints = 0;
  let maxPossible = 0;

  // Score each default feature
  for (const [feature, maxWeight] of Object.entries(DEFAULT_WEIGHTS.deal)) {
    const { points, rawValue } = evaluateDealFeature(feature, deal, maxWeight);
    breakdown[feature] = { value: rawValue, points, weight: maxWeight };
    totalPoints += points;
    maxPossible += Math.abs(maxWeight);
  }

  // Score custom fields
  for (const cfw of customFieldWeights) {
    if (cfw.entityType !== 'deal' && cfw.entityType !== 'account') continue;

    const sourceFields = cfw.entityType === 'deal' ? deal.customFields : deal.accountCustomFields;
    const value = sourceFields?.[cfw.fieldKey];

    if (value !== null && value !== undefined) {
      const points = cfw.valueScores[String(value)] || 0;
      breakdown[`custom_${cfw.fieldKey}`] = {
        value,
        points,
        weight: cfw.maxPoints,
      };
      totalPoints += points;
      maxPossible += cfw.maxPoints;
    }
  }

  // Normalize to 0-100
  const normalizedScore = Math.max(0, Math.min(100,
    Math.round((totalPoints / maxPossible) * 100)
  ));

  // Assign grade
  const grade = normalizedScore >= 85 ? 'A' :
                normalizedScore >= 70 ? 'B' :
                normalizedScore >= 50 ? 'C' :
                normalizedScore >= 30 ? 'D' : 'F';

  return {
    entityType: 'deal',
    entityId: deal.id,
    totalScore: normalizedScore,
    scoreBreakdown: breakdown,
    scoreGrade: grade,
    scoringMethod: 'point_based',
    scoredAt: new Date(),
  };
}

function scoreContact(contact: ContactFeatures, dealScore: number | undefined): LeadScore {
  const breakdown: Record<string, ScoreComponent> = {};
  let totalPoints = 0;
  let maxPossible = 0;

  const weights = DEFAULT_WEIGHTS.contact;

  // has_email
  const hasEmail = !!contact.email;
  breakdown.has_email = { value: hasEmail, points: hasEmail ? weights.has_email : 0, weight: weights.has_email };
  totalPoints += hasEmail ? weights.has_email : 0;
  maxPossible += weights.has_email;

  // has_phone
  const hasPhone = !!contact.phone;
  breakdown.has_phone = { value: hasPhone, points: hasPhone ? weights.has_phone : 0, weight: weights.has_phone };
  totalPoints += hasPhone ? weights.has_phone : 0;
  maxPossible += weights.has_phone;

  // has_title
  const hasTitle = !!contact.title;
  breakdown.has_title = { value: hasTitle, points: hasTitle ? weights.has_title : 0, weight: weights.has_title };
  totalPoints += hasTitle ? weights.has_title : 0;
  maxPossible += weights.has_title;

  // role_assigned
  const roleAssigned = !!contact.buyingRole;
  breakdown.role_assigned = { value: roleAssigned, points: roleAssigned ? weights.role_assigned : 0, weight: weights.role_assigned };
  totalPoints += roleAssigned ? weights.role_assigned : 0;
  maxPossible += weights.role_assigned;

  // is_power_role
  const isPowerRole = ['champion', 'economic_buyer', 'decision_maker'].includes(contact.buyingRole || '');
  breakdown.is_power_role = { value: isPowerRole, points: isPowerRole ? weights.is_power_role : 0, weight: weights.is_power_role };
  totalPoints += isPowerRole ? weights.is_power_role : 0;
  maxPossible += weights.is_power_role;

  // seniority_high
  const seniorityHigh = contact.seniorityVerified && ['vp', 'c_level', 'director'].includes(contact.seniorityVerified);
  breakdown.seniority_high = { value: seniorityHigh, points: seniorityHigh ? weights.seniority_high : 0, weight: weights.seniority_high };
  totalPoints += seniorityHigh ? weights.seniority_high : 0;
  maxPossible += weights.seniority_high;

  // TODO: activity_on_deals, multi_deal_contact require additional queries

  // deal_quality (weighted average of associated deal scores)
  const dealQualityPoints = dealScore ? Math.round((dealScore / 100) * weights.deal_quality) : 0;
  breakdown.deal_quality = { value: dealScore, points: dealQualityPoints, weight: weights.deal_quality };
  totalPoints += dealQualityPoints;
  maxPossible += weights.deal_quality;

  // Normalize to 0-100
  const normalizedScore = Math.max(0, Math.min(100,
    Math.round((totalPoints / maxPossible) * 100)
  ));

  // Assign grade
  const grade = normalizedScore >= 85 ? 'A' :
                normalizedScore >= 70 ? 'B' :
                normalizedScore >= 50 ? 'C' :
                normalizedScore >= 30 ? 'D' : 'F';

  return {
    entityType: 'contact',
    entityId: contact.id,
    totalScore: normalizedScore,
    scoreBreakdown: breakdown,
    scoreGrade: grade,
    scoringMethod: 'point_based',
    scoredAt: new Date(),
  };
}

// ============================================================================
// Persistence
// ============================================================================

async function persistScore(workspaceId: string, score: LeadScore): Promise<void> {
  await query(`
    INSERT INTO lead_scores (
      workspace_id, entity_type, entity_id, total_score,
      score_breakdown, score_grade, scoring_method, scored_at,
      previous_score, score_change, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, NOW(),
      (SELECT total_score FROM lead_scores
       WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3),
      $4 - COALESCE(
        (SELECT total_score FROM lead_scores
         WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3),
        $4
      ),
      NOW(), NOW()
    )
    ON CONFLICT (workspace_id, entity_type, entity_id)
    DO UPDATE SET
      total_score = EXCLUDED.total_score,
      score_breakdown = EXCLUDED.score_breakdown,
      score_grade = EXCLUDED.score_grade,
      scoring_method = EXCLUDED.scoring_method,
      previous_score = lead_scores.total_score,
      score_change = EXCLUDED.total_score - lead_scores.total_score,
      scored_at = NOW(),
      updated_at = NOW()
  `, [
    workspaceId,
    score.entityType,
    score.entityId,
    score.totalScore,
    JSON.stringify(score.scoreBreakdown),
    score.scoreGrade,
    score.scoringMethod,
  ]);
}

// ============================================================================
// Main Scoring Function
// ============================================================================

export async function scoreLeads(workspaceId: string): Promise<ScoringResult> {
  logger.info('[Lead Scoring] Starting scoring run', { workspaceId });

  // 1. Extract features
  const [dealFeatures, contactFeatures, customFieldWeights] = await Promise.all([
    extractDealFeatures(workspaceId),
    extractContactFeatures(workspaceId),
    getCustomFieldWeights(workspaceId),
  ]);

  // 2. Compute workspace median amount (for amount_tier scoring)
  const amounts = dealFeatures.map(d => d.amount).filter((a): a is number => a !== null && a > 0);
  const workspaceMedianAmount = amounts.length > 0
    ? amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)]
    : 50000;

  // 3. Score all deals
  const dealScores: LeadScore[] = [];
  for (const deal of dealFeatures) {
    const score = scoreDeal(deal, customFieldWeights, workspaceMedianAmount);
    dealScores.push(score);
    await persistScore(workspaceId, score);
  }

  // 4. Score all contacts (using deal scores)
  const dealScoreMap = new Map(dealScores.map(s => [s.entityId, s.totalScore]));
  const contactScores: LeadScore[] = [];
  for (const contact of contactFeatures) {
    const dealScore = dealScoreMap.get(contact.dealId);
    const score = scoreContact(contact, dealScore);
    contactScores.push(score);
    await persistScore(workspaceId, score);
  }

  // 5. Compute summary stats
  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const score of dealScores) {
    gradeDistribution[score.scoreGrade]++;
  }

  const avgDealScore = dealScores.length > 0
    ? dealScores.reduce((sum, s) => sum + s.totalScore, 0) / dealScores.length
    : 0;

  const sortedDeals = dealScores
    .map(s => ({
      id: s.entityId,
      name: dealFeatures.find(d => d.id === s.entityId)?.name || '',
      score: s.totalScore,
      grade: s.scoreGrade,
    }))
    .sort((a, b) => b.score - a.score);

  const topDeals = sortedDeals.slice(0, 10);
  const bottomDeals = sortedDeals.filter(d => (dealFeatures.find(df => df.id === d.id)?.amount || 0) > 10000).slice(-5).reverse();

  // Movers
  const movers = dealScores
    .filter(s => Math.abs(s.scoreChange || 0) > 10)
    .map(s => ({
      id: s.entityId,
      name: dealFeatures.find(d => d.id === s.entityId)?.name || '',
      change: s.scoreChange || 0,
      from: (s.previousScore || 0),
      to: s.totalScore,
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 5);

  // Rep scores
  const repScores: Record<string, { avgScore: number; dealCount: number }> = {};
  for (const deal of dealFeatures) {
    const owner = deal.ownerEmail || deal.ownerName || 'Unknown';
    if (!repScores[owner]) {
      repScores[owner] = { avgScore: 0, dealCount: 0 };
    }
    const score = dealScores.find(s => s.entityId === deal.id);
    if (score) {
      repScores[owner].avgScore += score.totalScore;
      repScores[owner].dealCount++;
    }
  }
  for (const rep of Object.keys(repScores)) {
    repScores[rep].avgScore = Math.round(repScores[rep].avgScore / repScores[rep].dealCount);
  }

  // Custom field contributions
  const customFieldContributions: Array<{
    fieldKey: string;
    avgPoints: number;
    topValue: string;
    topValueScore: number;
  }> = [];

  for (const cfw of customFieldWeights) {
    const scores = dealScores
      .map(s => s.scoreBreakdown[`custom_${cfw.fieldKey}`])
      .filter(Boolean);

    if (scores.length === 0) continue;

    const avgPoints = scores.reduce((sum, s) => sum + s.points, 0) / scores.length;

    // Find top value
    const valueCounts = new Map<string, { count: number; totalPoints: number }>();
    for (const s of scores) {
      const value = String(s.value);
      const existing = valueCounts.get(value) || { count: 0, totalPoints: 0 };
      valueCounts.set(value, {
        count: existing.count + 1,
        totalPoints: existing.totalPoints + s.points,
      });
    }

    let topValue = '';
    let topValueScore = 0;
    for (const [value, stats] of valueCounts.entries()) {
      const avgScore = stats.totalPoints / stats.count;
      if (avgScore > topValueScore) {
        topValue = value;
        topValueScore = avgScore;
      }
    }

    customFieldContributions.push({
      fieldKey: cfw.fieldKey,
      avgPoints: Math.round(avgPoints * 10) / 10,
      topValue,
      topValueScore: Math.round(topValueScore * 10) / 10,
    });
  }

  logger.info('[Lead Scoring] Scoring complete', {
    dealsScored: dealScores.length,
    contactsScored: contactScores.length,
    avgScore: Math.round(avgDealScore),
    gradeDistribution,
  });

  return {
    dealScores,
    contactScores,
    summaryStats: {
      totalDeals: dealScores.length,
      totalContacts: contactScores.length,
      gradeDistribution,
      avgDealScore: Math.round(avgDealScore),
      topDeals,
      bottomDeals,
      movers,
      repScores,
    },
    customFieldContributions,
  };
}
