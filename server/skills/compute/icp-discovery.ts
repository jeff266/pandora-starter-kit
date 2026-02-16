/**
 * ICP Discovery — Descriptive Mode
 *
 * Analyzes closed deal data to discover:
 * - Winning persona patterns (seniority × department clustering)
 * - Ideal buying committee compositions
 * - Company sweet spots (industry, size, custom field segments)
 * - Lead source funnel performance
 * - Custom field segmentation
 *
 * Adapted for no-API-enrichment reality: uses CRM contact roles, activity patterns,
 * and discovered custom fields instead of Apollo/LinkedIn data.
 *
 * Mode selection:
 * - DESCRIPTIVE: 30+ closed deals with contact roles (no validated weights)
 * - POINT_BASED: 100+ enriched deals (validated heuristic weights) [future]
 * - REGRESSION: 200+ enriched deals (ML model) [future]
 */

import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ICPDiscovery');

const INDUSTRY_NORMALIZATION: Record<string, string> = {
  'hospital_health_care': 'Hospital & Health Care',
  'health_wellness_and_fitness': 'Health, Wellness & Fitness',
  'mental_health_care': 'Mental Health Care',
  'individual_family_services': 'Individual & Family Services',
  'education_management': 'Education Management',
  'primary_secondary_education': 'Primary/Secondary Education',
  'e_learning': 'E-Learning',
  'higher_education': 'Higher Education',
  'transportation_trucking_railroad': 'Transportation/Trucking/Railroad',
  'management_consulting': 'Management Consulting',
  'information_services': 'Information Services',
  'information_technology_and_services': 'Information Technology & Services',
  'computer_software': 'Computer Software',
  'financial_services': 'Financial Services',
  'insurance': 'Insurance',
  'nonprofit_organization_management': 'Nonprofit Organization Management',
  'medical_practice': 'Medical Practice',
  'professional_training_coaching': 'Professional Training & Coaching',
  'sports': 'Sports',
  'government_administration': 'Government Administration',
};

function normalizeIndustry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const key = trimmed.toLowerCase().replace(/[\s&,]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (INDUSTRY_NORMALIZATION[key]) return INDUSTRY_NORMALIZATION[key];

  const lc = trimmed.toLowerCase();
  for (const [, normalized] of Object.entries(INDUSTRY_NORMALIZATION)) {
    if (normalized.toLowerCase() === lc) return normalized;
  }

  if (/^[A-Z_]+$/.test(trimmed)) {
    return trimmed
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
      .replace(/ And /g, ' & ');
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// ============================================================================
// Types
// ============================================================================

export interface DataReadiness {
  mode: 'abort' | 'descriptive' | 'point_based' | 'regression';
  wonCount: number;
  lostCount: number;
  totalClosed: number;
  dealsWithContacts: number;
  totalContactRoles: number;
  uniqueContacts: number;
  customFieldsAvailable: number;
  hasConversations: boolean;
  hasEnrichment: boolean;
  reasons: string[];
}

export interface FeatureVector {
  dealId: string;
  dealName: string;
  outcome: 'won' | 'lost';
  amount: number;
  salesCycleDays: number;
  ownerEmail: string;
  ownerName: string;
  closeDate: Date;

  // Account
  accountId: string;
  accountName: string;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;

  // Committee
  committeeSize: number;
  hasChampion: boolean;
  hasEconomicBuyer: boolean;
  hasDecisionMaker: boolean;
  hasTechnicalEvaluator: boolean;
  uniqueRoles: string[];
  maxSeniority: string;
  titles: string[];
  parsedSeniorities: string[];
  parsedDepartments: string[];
  buyingRoles: string[];

  // Activity
  totalActivities: number;
  emails: number;
  calls: number;
  meetings: number;
  engagementVelocity: number;
  activeDays: number;

  // Custom fields
  customFields: Record<string, any>;
  accountCustomFields: Record<string, any>;

  // Conversation features (optional - graceful degradation if not available)
  has_conversation_data: boolean;
  total_call_minutes: number | null;
  call_count_with_transcript: number | null;
  avg_call_duration_minutes: number | null;
  unique_customer_speakers: number | null;
  unique_rep_speakers: number | null;
  days_between_calls_avg: number | null;
  first_call_timing: number | null;
  last_call_to_close: number | null;
  call_density: number | null;
  talk_ratio_avg: number | null;
  longest_monologue_avg: number | null;
  question_rate_avg: number | null;
  interactivity_avg: number | null;
  action_items_total: number | null;
  action_items_per_call: number | null;

  // Conversation content signals (from DeepSeek)
  competitor_mentions_count: number | null;
  pricing_discussed: boolean | null;
  budget_mentioned: boolean | null;
  timeline_discussed: boolean | null;
  objection_count: number | null;
  champion_language: boolean | null;
  technical_depth: number | null;
  sentiment_overall: 'positive' | 'neutral' | 'negative' | null;
  sentiment_trajectory: 'improving' | 'stable' | 'declining' | null;
  next_steps_explicit: boolean | null;
  decision_criteria_count: number | null;

  // Enrichment features (optional - graceful degradation if not available)
  has_enrichment_data: boolean;
  buying_committee_complete: boolean | null;
  roles_identified: number | null;
  decision_maker_count: number | null;
  seniority_c_level_present: boolean | null;
  signal_score: number | null;
  has_funding_signal: boolean | null;
  has_hiring_signal: boolean | null;
  has_expansion_signal: boolean | null;
  has_risk_signal: boolean | null;
}

export interface PersonaPattern {
  name: string;
  seniority: string;
  department: string;
  topTitles: string[];
  topBuyingRoles: string[];
  frequency_in_won: number;
  frequency_in_lost: number;
  lift: number;
  dealCount: number;
  avgDealSizeWon: number;
  avgDealSizeLost: number;
  dealSizeLift: number;
  confidence: number;

  // Conversation participation metrics (optional - only when conversation data available)
  speaker_participation_rate?: number; // % of deals where this persona spoke on calls
  avg_talk_percentage?: number; // average % of talk time for this persona
  appears_in_first_call?: number; // % of deals where persona appeared in first call
  appears_in_closing_call?: number; // % of deals where persona appeared in last call before close
  first_call_appearance_lift?: number; // win rate lift when persona appears in first call
  closing_call_appearance_lift?: number; // win rate lift when persona appears in closing call
}

export interface CommitteeCombo {
  personas: string[];
  personaNames: string[];
  wonCount: number;
  lostCount: number;
  totalCount: number;
  winRate: number;
  avgDealSize: number;
  lift: number;
}

export interface CompanyProfile {
  industryWinRates: Array<{ industry: string; winRate: number; avgDeal: number; count: number; }>;
  sizeWinRates: Array<{ bucket: string; winRate: number; avgDeal: number; count: number; }>;
  customFieldSegments: Array<{
    fieldKey: string;
    fieldLabel: string;
    segments: Array<{ value: string; winRate: number; avgDeal: number; count: number; }>;
  }>;
  leadSourceFunnel: Array<{
    source: string;
    leads: number;
    converted: number;
    conversionRate: number;
    wonDeals: number;
    lostDeals: number;
    fullFunnelRate: number;
    avgWonAmount: number;
  }>;
  sweetSpots: Array<{
    description: string;
    winRate: number;
    avgDeal: number;
    count: number;
    lift: number;
  }>;
  conversation_benchmarks?: {
    call_volume_buckets: Array<{
      size_bucket: string;
      avg_calls: number;
      median_calls: number;
      min_calls: number;
      max_calls: number;
      win_rate: number;
      count: number;
    }>;
    industry_content_patterns: Array<{
      industry: string;
      avg_technical_depth: number;
      avg_sentiment_score: number; // positive=1, neutral=0, negative=-1
      competitor_mention_rate: number;
      pricing_discussion_rate: number;
      budget_mention_rate: number;
      timeline_discussion_rate: number;
      count: number;
    }>;
    sentiment_predictor: {
      positive_win_rate: number;
      neutral_win_rate: number;
      negative_win_rate: number;
      improving_trajectory_win_rate: number;
      declining_trajectory_win_rate: number;
    };
    calls_to_close_by_size: Array<{
      size_bucket: string;
      avg_calls_to_close: number;
      median_calls_to_close: number;
      avg_days_to_close: number;
      win_rate: number;
      count: number;
    }>;
  };
  signal_analysis?: {
    funding_lift: number;
    hiring_lift: number;
    expansion_lift: number;
    risk_lift: number;
    signal_types: Array<{
      type: 'funding' | 'hiring' | 'expansion' | 'risk';
      won_rate: number;
      lost_rate: number;
      lift: number;
      avg_signal_score_won: number;
      avg_signal_score_lost: number;
      count_won: number;
      count_lost: number;
    }>;
  };
}

export interface ScoringWeights {
  method: string;
  personas: Record<string, number>;
  customFields: Record<string, Record<string, number>>;
  industries: Record<string, number>;
  conversation?: Record<string, number>; // Optional conversation weights (when data available)
  enrichment?: Record<string, number>; // Optional enrichment weights (when data available)
  note: string;
}

export interface ICPDiscoveryResult {
  profileId: string | null;
  mode: string;
  dataReadiness: DataReadiness;
  personas: PersonaPattern[];
  committees: CommitteeCombo[];
  companyProfile: CompanyProfile;
  scoringWeights: ScoringWeights;
  customFieldContributions: any[];
  metadata: {
    dealsAnalyzed: number;
    wonCount: number;
    lostCount: number;
    contactRolesUsed: number;
    customFieldsUsed: number;
    executionMs: number;
  };
  // Conversation intelligence (Step 2.5)
  conversationCoverage?: ConversationCoverage | null;
  conversationExcerpts?: any[] | null; // For DeepSeek classification in separate step
}

// ============================================================================
// Helper Functions
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

function countFrequencies<T>(arr: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const key = String(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseSeniority(title: string | null): string {
  if (!title) return 'unknown';
  const t = title.toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cio|chief|founder|president)\b/.test(t)) return 'c_level';
  if (/\b(svp|senior vice president|evp|executive vice)\b/.test(t)) return 'svp';
  if (/\b(vp|vice president)\b/.test(t)) return 'vp';
  if (/\b(director|head of)\b/.test(t)) return 'director';
  if (/\b(senior manager|sr\. manager|sr manager)\b/.test(t)) return 'senior_manager';
  if (/\b(manager|lead|team lead)\b/.test(t)) return 'manager';
  if (/\b(senior|sr\.|sr |principal|staff)\b/.test(t)) return 'senior_ic';
  if (/\b(engineer|analyst|specialist|coordinator|associate)\b/.test(t)) return 'ic';
  return 'unknown';
}

function parseDepartment(title: string | null, customPatterns?: Record<string, string[]>): string {
  if (!title) return 'unknown';
  const t = title.toLowerCase();

  // Check custom patterns first (if provided)
  if (customPatterns) {
    for (const [deptName, keywords] of Object.entries(customPatterns)) {
      for (const keyword of keywords) {
        const pattern = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'i');
        if (pattern.test(t)) {
          return deptName;
        }
      }
    }
  }

  // Default patterns
  if (/\b(engineer|technical|architect|developer|devops|it |cto|technology)\b/.test(t)) return 'engineering';
  if (/\b(process|operations|plant|refinery|manufacturing|production)\b/.test(t)) return 'operations';
  if (/\b(sales|account exec|business develop|commercial)\b/.test(t)) return 'sales';
  if (/\b(marketing|growth|demand gen|content)\b/.test(t)) return 'marketing';
  if (/\b(finance|cfo|controller|accounting|procurement|purchasing)\b/.test(t)) return 'finance';
  if (/\b(product|pm |product manag)\b/.test(t)) return 'product';
  if (/\b(hr|human resources|people|talent)\b/.test(t)) return 'hr';
  if (/\b(legal|compliance|counsel)\b/.test(t)) return 'legal';
  if (/\b(ceo|president|founder|general manager|managing director|coo)\b/.test(t)) return 'executive';
  if (/\b(data|analytics|scientist|intelligence)\b/.test(t)) return 'data';
  return 'unknown';
}

// ============================================================================
// Step 1: Check Data Readiness
// ============================================================================

async function checkDataReadiness(workspaceId: string): Promise<DataReadiness> {
  logger.info('[Step 1] Checking data readiness');

  // Closed deals by outcome
  const closedDealsResult = await query<{
    stage_normalized: string;
    deal_count: number;
    contact_roles: number;
    unique_contacts: number;
  }>(`
    SELECT
      d.stage_normalized,
      COUNT(DISTINCT d.id) as deal_count,
      COUNT(DISTINCT dc.id) as contact_roles,
      COUNT(DISTINCT dc.contact_id) as unique_contacts
    FROM deals d
    LEFT JOIN deal_contacts dc ON d.id = dc.deal_id AND dc.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
    GROUP BY d.stage_normalized
  `, [workspaceId]);

  const wonRow = closedDealsResult.rows.find(r => r.stage_normalized === 'closed_won');
  const lostRow = closedDealsResult.rows.find(r => r.stage_normalized === 'closed_lost');

  const wonCount = Number(wonRow?.deal_count || 0);
  const lostCount = Number(lostRow?.deal_count || 0);
  const totalClosed = wonCount + lostCount;
  const totalContactRoles = Number(wonRow?.contact_roles || 0) + Number(lostRow?.contact_roles || 0);
  const uniqueContacts = Number(wonRow?.unique_contacts || 0) + Number(lostRow?.unique_contacts || 0);

  // Deals with at least one contact role
  const dealsWithContactsResult = await query<{ count: number }>(`
    SELECT COUNT(DISTINCT d.id) as count
    FROM deals d
    JOIN deal_contacts dc ON d.id = dc.deal_id AND dc.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
      AND dc.buying_role IS NOT NULL
  `, [workspaceId]);

  const dealsWithContacts = Number(dealsWithContactsResult.rows[0]?.count || 0);

  // Custom field discovery results
  const customFieldResult = await query<{ output: any }>(`
    SELECT output FROM skill_runs
    WHERE workspace_id = $1 AND skill_id = 'custom-field-discovery'
      AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 1
  `, [workspaceId]);

  const topFields = customFieldResult.rows[0]?.output?.topFields || [];
  const customFieldsAvailable = topFields.filter((f: any) =>
    f.entityType === 'deal' || f.entityType === 'account'
  ).length;

  // Conversation connector check
  const conversationResult = await query<{ count: number }>(`
    SELECT COUNT(*) as count FROM connections
    WHERE workspace_id = $1
      AND connector_name IN ('gong', 'fireflies')
      AND status = 'active'
  `, [workspaceId]);

  const hasConversations = Number(conversationResult.rows[0]?.count || 0) > 0;

  // Enrichment check
  const enrichmentResult = await query<{ count: number }>(`
    SELECT COUNT(*) as count FROM deal_contacts
    WHERE workspace_id = $1
      AND enrichment_status = 'enriched'
  `, [workspaceId]);

  const hasEnrichment = Number(enrichmentResult.rows[0]?.count || 0) > 0;

  // Determine mode
  const reasons: string[] = [];
  let mode: 'abort' | 'descriptive' | 'point_based' | 'regression' = 'abort';

  if (totalClosed < 30) {
    reasons.push(`Insufficient closed deals (${totalClosed} < 30 required)`);
    mode = 'abort';
  } else if (hasEnrichment && dealsWithContacts >= 200) {
    reasons.push(`Sufficient enriched deals for regression (${dealsWithContacts})`);
    mode = 'regression';
  } else if (hasEnrichment && dealsWithContacts >= 100) {
    reasons.push(`Sufficient enriched deals for point-based scoring (${dealsWithContacts})`);
    mode = 'point_based';
  } else if (dealsWithContacts >= 20) {
    reasons.push(`Using descriptive mode: ${totalClosed} closed deals, ${totalContactRoles} contact roles`);
    reasons.push(`No API enrichment - using CRM roles + custom fields + activity patterns`);
    mode = 'descriptive';
  } else {
    reasons.push(`Insufficient contact role coverage (${dealsWithContacts} deals with contacts < 20 required)`);
    mode = 'abort';
  }

  logger.info(`[Step 1] Mode: ${mode.toUpperCase()}`, {
    totalClosed,
    wonCount,
    lostCount,
    dealsWithContacts,
    totalContactRoles,
    uniqueContacts,
    customFieldsAvailable,
    hasConversations,
    hasEnrichment,
  });

  return {
    mode,
    wonCount,
    lostCount,
    totalClosed,
    dealsWithContacts,
    totalContactRoles,
    uniqueContacts,
    customFieldsAvailable,
    hasConversations,
    hasEnrichment,
    reasons,
  };
}

// ============================================================================
// Step 2: Build Feature Matrix
// ============================================================================

async function buildFeatureMatrix(workspaceId: string): Promise<FeatureVector[]> {
  logger.info('[Step 2] Building feature matrix');

  // Load custom department patterns from workspace config
  const { getDepartmentPatterns } = await import('../../config/index.js');
  const customDepartmentPatterns = await getDepartmentPatterns(workspaceId);
  const customPatternsCount = Object.keys(customDepartmentPatterns).length;
  if (customPatternsCount > 0) {
    logger.info(`[Step 2] Using ${customPatternsCount} custom department patterns`);
  }

  // Get all closed deals
  const dealsResult = await query<{
    id: string;
    name: string;
    amount: number;
    stage_normalized: string;
    close_date: Date;
    created_at: Date;
    owner_email: string;
    owner: string;
    custom_fields: any;
    account_id: string;
    account_name: string;
    industry: string;
    employee_count: number;
    annual_revenue: number;
    account_custom_fields: any;
  }>(`
    SELECT
      d.id, d.name, d.amount, d.stage_normalized,
      d.close_date, d.created_at,
      d.owner as owner_email, d.owner,
      d.custom_fields,
      a.id as account_id, a.name as account_name,
      a.industry, a.employee_count, a.annual_revenue,
      a.custom_fields as account_custom_fields
    FROM deals d
    LEFT JOIN accounts a ON d.account_id = a.id AND a.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
    ORDER BY d.close_date DESC
  `, [workspaceId]);

  const featureMatrix: FeatureVector[] = [];

  for (const deal of dealsResult.rows) {
    const salesCycleDays = deal.close_date && deal.created_at
      ? Math.round((new Date(deal.close_date).getTime() - new Date(deal.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    // Get contact roles for this deal
    const contactsResult = await query<{
      buying_role: string;
      role_confidence: number;
      title: string;
      seniority_verified: string;
      department_verified: string;
    }>(`
      SELECT
        dc.buying_role,
        dc.role_confidence,
        c.title,
        dc.seniority_verified,
        dc.department_verified
      FROM deal_contacts dc
      JOIN contacts c ON dc.contact_id = c.id AND c.workspace_id = dc.workspace_id
      WHERE dc.workspace_id = $1 AND dc.deal_id = $2
    `, [workspaceId, deal.id]);

    const titles: string[] = [];
    const buyingRoles: string[] = [];
    const parsedSeniorities: string[] = [];
    const parsedDepartments: string[] = [];
    const uniqueRoles = new Set<string>();

    for (const contact of contactsResult.rows) {
      if (contact.title) titles.push(contact.title);
      if (contact.buying_role) {
        buyingRoles.push(contact.buying_role);
        uniqueRoles.add(contact.buying_role);
      }

      const seniority = contact.seniority_verified || parseSeniority(contact.title);
      const department = contact.department_verified || parseDepartment(contact.title, customDepartmentPatterns);

      parsedSeniorities.push(seniority);
      parsedDepartments.push(department);
    }

    const hasChampion = buyingRoles.includes('champion');
    const hasEconomicBuyer = buyingRoles.includes('economic_buyer') || buyingRoles.includes('executive_sponsor');
    const hasDecisionMaker = buyingRoles.includes('decision_maker');
    const hasTechnicalEvaluator = buyingRoles.includes('technical_evaluator');

    const maxSeniority = parsedSeniorities.includes('c_level') ? 'c_level' :
      parsedSeniorities.includes('svp') ? 'svp' :
      parsedSeniorities.includes('vp') ? 'vp' :
      parsedSeniorities.includes('director') ? 'director' :
      parsedSeniorities.includes('manager') ? 'manager' : 'ic';

    // Get enrichment metrics from deal_contacts
    const enrichmentResult = await query<{
      enriched_count: number;
      roles_with_buying_role: number;
      has_champion: boolean;
      has_economic_buyer: boolean;
      decision_maker_count: number;
      c_level_count: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE dc.enrichment_status = 'enriched') as enriched_count,
        COUNT(*) FILTER (WHERE dc.buying_role IS NOT NULL) as roles_with_buying_role,
        bool_or(dc.buying_role = 'champion') as has_champion,
        bool_or(dc.buying_role IN ('economic_buyer', 'executive_sponsor')) as has_economic_buyer,
        COUNT(*) FILTER (WHERE dc.buying_role = 'decision_maker') as decision_maker_count,
        COUNT(*) FILTER (
          WHERE dc.seniority_verified = 'c_level'
          OR (dc.seniority_verified IS NULL AND c.title ~* '\\b(chief|ceo|cto|cfo|coo|cmo|cio|ciso|cpo|cro)\\b')
        ) as c_level_count
      FROM deal_contacts dc
      JOIN contacts c ON dc.contact_id = c.id AND c.workspace_id = dc.workspace_id
      WHERE dc.workspace_id = $1 AND dc.deal_id = $2
    `, [workspaceId, deal.id]);

    const enrichmentRow = enrichmentResult.rows[0];
    const enrichedContactCount = Number(enrichmentRow?.enriched_count || 0);
    const hasEnrichmentData = enrichedContactCount > 0;
    const rolesIdentified = Number(enrichmentRow?.roles_with_buying_role || 0);
    const buyingCommitteeComplete = contactsResult.rows.length >= 3 && rolesIdentified >= 3;

    // Get account signals
    const signalsResult = await query<{
      signal_score: number;
      signals: any;
    }>(`
      SELECT signal_score, signals
      FROM account_signals
      WHERE workspace_id = $1 AND account_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [workspaceId, deal.account_id]);

    const signalsRow = signalsResult.rows[0];
    const signalScore = signalsRow?.signal_score ?? null;
    const signals = signalsRow?.signals || [];

    // Extract signal types from classified signals array
    const hasFundingSignal = Array.isArray(signals) && signals.some((s: any) => s.type === 'funding');
    const hasHiringSignal = Array.isArray(signals) && signals.some((s: any) => s.type === 'hiring');
    const hasExpansionSignal = Array.isArray(signals) && signals.some((s: any) => s.type === 'expansion');
    const hasRiskSignal = Array.isArray(signals) && signals.some((s: any) => s.type === 'risk');

    // Get activity features
    const activityResult = await query<{
      total_activities: number;
      emails: number;
      calls: number;
      meetings: number;
      active_days: number;
    }>(`
      SELECT
        COUNT(*) as total_activities,
        COUNT(*) FILTER (WHERE activity_type = 'email') as emails,
        COUNT(*) FILTER (WHERE activity_type = 'call') as calls,
        COUNT(*) FILTER (WHERE activity_type = 'meeting') as meetings,
        COUNT(DISTINCT DATE(timestamp)) as active_days
      FROM activities
      WHERE workspace_id = $1 AND deal_id = $2
    `, [workspaceId, deal.id]);

    const activityRow = activityResult.rows[0];
    const totalActivities = Number(activityRow?.total_activities || 0);
    const activeDays = Number(activityRow?.active_days || 0);
    const engagementVelocity = salesCycleDays > 0 ? totalActivities / (salesCycleDays / 7) : 0;

    featureMatrix.push({
      dealId: deal.id,
      dealName: deal.name,
      outcome: deal.stage_normalized === 'closed_won' ? 'won' : 'lost',
      amount: Number(deal.amount || 0),
      salesCycleDays,
      ownerEmail: deal.owner_email,
      ownerName: deal.owner,
      closeDate: deal.close_date,
      accountId: deal.account_id,
      accountName: deal.account_name,
      industry: normalizeIndustry(deal.industry),
      employeeCount: deal.employee_count ? Number(deal.employee_count) : null,
      annualRevenue: deal.annual_revenue ? Number(deal.annual_revenue) : null,
      committeeSize: titles.length,
      hasChampion,
      hasEconomicBuyer,
      hasDecisionMaker,
      hasTechnicalEvaluator,
      uniqueRoles: Array.from(uniqueRoles),
      maxSeniority,
      titles,
      parsedSeniorities,
      parsedDepartments,
      buyingRoles,
      totalActivities,
      emails: Number(activityRow?.emails || 0),
      calls: Number(activityRow?.calls || 0),
      meetings: Number(activityRow?.meetings || 0),
      engagementVelocity,
      activeDays,
      customFields: deal.custom_fields || {},
      accountCustomFields: deal.account_custom_fields || {},
      // Conversation features - will be populated in Step 2.5
      has_conversation_data: false,
      total_call_minutes: null,
      call_count_with_transcript: null,
      avg_call_duration_minutes: null,
      unique_customer_speakers: null,
      unique_rep_speakers: null,
      days_between_calls_avg: null,
      first_call_timing: null,
      last_call_to_close: null,
      call_density: null,
      talk_ratio_avg: null,
      longest_monologue_avg: null,
      question_rate_avg: null,
      interactivity_avg: null,
      action_items_total: null,
      action_items_per_call: null,
      competitor_mentions_count: null,
      pricing_discussed: null,
      budget_mentioned: null,
      timeline_discussed: null,
      objection_count: null,
      champion_language: null,
      technical_depth: null,
      sentiment_overall: null,
      sentiment_trajectory: null,
      next_steps_explicit: null,
      decision_criteria_count: null,
      // Enrichment features
      has_enrichment_data: hasEnrichmentData,
      buying_committee_complete: buyingCommitteeComplete,
      roles_identified: rolesIdentified,
      decision_maker_count: Number(enrichmentRow?.decision_maker_count || 0),
      seniority_c_level_present: Number(enrichmentRow?.c_level_count || 0) > 0,
      signal_score: signalScore,
      has_funding_signal: hasFundingSignal,
      has_hiring_signal: hasHiringSignal,
      has_expansion_signal: hasExpansionSignal,
      has_risk_signal: hasRiskSignal,
    });
  }

  logger.info(`[Step 2] Feature matrix built: ${featureMatrix.length} deals`, {
    wonCount: featureMatrix.filter(d => d.outcome === 'won').length,
    lostCount: featureMatrix.filter(d => d.outcome === 'lost').length,
    withContacts: featureMatrix.filter(d => d.committeeSize > 0).length,
  });

  return featureMatrix;
}

// ============================================================================
// Step 3: Discover Persona Patterns
// ============================================================================

async function discoverPersonaPatterns(workspaceId: string, featureMatrix: FeatureVector[]): Promise<PersonaPattern[]> {
  logger.info('[Step 3] Discovering persona patterns');

  const totalWonDeals = featureMatrix.filter(d => d.outcome === 'won').length;
  const totalLostDeals = featureMatrix.filter(d => d.outcome === 'lost').length;

  interface PersonaCluster {
    seniority: string;
    department: string;
    titles: string[];
    buyingRoles: string[];
    wonDeals: Set<string>;
    lostDeals: Set<string>;
    totalDeals: Set<string>;
    dealAmountsWon: number[];
    dealAmountsLost: number[];
    // Conversation participation tracking
    dealsWithConversations: Set<string>;
    participatedInConversations: Set<string>; // deals where persona spoke
    talkPercentages: number[]; // talk % across all conversations
    appearsInFirstCall: Set<string>; // deals where persona was in first call
    appearsInClosingCall: Set<string>; // deals where persona was in closing call
    appearsInFirstCall_won: Set<string>;
    appearsInFirstCall_lost: Set<string>;
    appearsInClosingCall_won: Set<string>;
    appearsInClosingCall_lost: Set<string>;
  }

  const clusters = new Map<string, PersonaCluster>();

  // Cluster contacts by seniority × department
  for (const deal of featureMatrix) {
    for (let i = 0; i < deal.parsedSeniorities.length; i++) {
      const seniority = deal.parsedSeniorities[i];
      const department = deal.parsedDepartments[i];
      const title = deal.titles[i];
      const buyingRole = deal.buyingRoles[i];

      const key = `${seniority}__${department}`;

      if (!clusters.has(key)) {
        clusters.set(key, {
          seniority,
          department,
          titles: [],
          buyingRoles: [],
          wonDeals: new Set(),
          lostDeals: new Set(),
          totalDeals: new Set(),
          dealAmountsWon: [],
          dealAmountsLost: [],
          dealsWithConversations: new Set(),
          participatedInConversations: new Set(),
          talkPercentages: [],
          appearsInFirstCall: new Set(),
          appearsInClosingCall: new Set(),
          appearsInFirstCall_won: new Set(),
          appearsInFirstCall_lost: new Set(),
          appearsInClosingCall_won: new Set(),
          appearsInClosingCall_lost: new Set(),
        });
      }

      const cluster = clusters.get(key)!;
      cluster.titles.push(title);
      cluster.buyingRoles.push(buyingRole);
      cluster.totalDeals.add(deal.dealId);

      if (deal.outcome === 'won') {
        cluster.wonDeals.add(deal.dealId);
        cluster.dealAmountsWon.push(deal.amount);
      } else {
        cluster.lostDeals.add(deal.dealId);
        cluster.dealAmountsLost.push(deal.amount);
      }
    }
  }

  // ============================================================================
  // Enrich clusters with conversation participation data (if available)
  // ============================================================================

  const hasConversationData = featureMatrix.some(d => d.has_conversation_data);

  if (hasConversationData) {
    logger.info('[Step 3] Enriching persona patterns with conversation participation data');

    // Get all deal IDs
    const dealIds = featureMatrix.map(d => d.dealId);

    // Query conversations with participants for these deals
    const conversationResult = await query<{
      id: string;
      deal_id: string;
      call_date: string;
      participants: any;
      outcome: string;
    }>(`
      SELECT c.id, c.deal_id, c.call_date, c.participants, d.outcome
      FROM conversations c
      JOIN deals d ON d.id = c.deal_id AND d.workspace_id = c.workspace_id
      WHERE c.workspace_id = $1
        AND c.deal_id = ANY($2::uuid[])
        AND c.participants IS NOT NULL
        AND jsonb_array_length(c.participants) > 0
      ORDER BY c.deal_id, c.call_date
    `, [workspaceId, dealIds]);

    // Query deal contacts to build email → persona mapping
    const contactResult = await query<{
      deal_id: string;
      email: string;
      seniority: string;
      department: string;
    }>(`
      SELECT dc.deal_id, dc.email, dc.seniority, dc.department
      FROM deal_contacts dc
      WHERE dc.workspace_id = $1
        AND dc.deal_id = ANY($2::uuid[])
        AND dc.email IS NOT NULL
    `, [workspaceId, dealIds]);

    // Build email → persona key map
    const emailToPersonaKey = new Map<string, { dealId: string; personaKey: string }[]>();
    for (const contact of contactResult.rows) {
      const email = contact.email.toLowerCase().trim();
      const personaKey = `${contact.seniority}__${contact.department}`;

      if (!emailToPersonaKey.has(email)) {
        emailToPersonaKey.set(email, []);
      }
      emailToPersonaKey.get(email)!.push({
        dealId: contact.deal_id,
        personaKey,
      });
    }

    // Group conversations by deal to identify first/closing calls
    const conversationsByDeal = new Map<string, Array<{
      id: string;
      call_date: string;
      participants: any;
      outcome: string;
    }>>();

    for (const conv of conversationResult.rows) {
      if (!conversationsByDeal.has(conv.deal_id)) {
        conversationsByDeal.set(conv.deal_id, []);
      }
      conversationsByDeal.get(conv.deal_id)!.push({
        id: conv.id,
        call_date: conv.call_date,
        participants: conv.participants,
        outcome: conv.outcome,
      });
    }

    // Process each deal's conversations
    for (const [dealId, conversations] of conversationsByDeal) {
      if (conversations.length === 0) continue;

      const firstConversation = conversations[0];
      const closingConversation = conversations[conversations.length - 1];
      const outcome = conversations[0].outcome;

      // Track which personas have conversation data for this deal
      const personasInDeal = new Set<string>();

      for (const conv of conversations) {
        const participants = Array.isArray(conv.participants) ? conv.participants : [];
        const isFirstCall = conv.id === firstConversation.id;
        const isClosingCall = conv.id === closingConversation.id;

        for (const participant of participants) {
          const email = participant.email?.toLowerCase().trim();
          if (!email) continue;

          // Skip reps (only track customer participants)
          if (participant.type === 'rep' || participant.type === 'internal') continue;

          // Find persona for this participant
          const personaMappings = emailToPersonaKey.get(email);
          if (!personaMappings) continue;

          // Find mapping for this specific deal
          const mapping = personaMappings.find(m => m.dealId === dealId);
          if (!mapping) continue;

          const cluster = clusters.get(mapping.personaKey);
          if (!cluster) continue;

          personasInDeal.add(mapping.personaKey);

          // Track participation
          cluster.participatedInConversations.add(dealId);

          // Track talk percentage if available
          if (typeof participant.talk_percentage === 'number') {
            cluster.talkPercentages.push(participant.talk_percentage);
          }

          // Track first call appearance
          if (isFirstCall) {
            cluster.appearsInFirstCall.add(dealId);
            if (outcome === 'won') {
              cluster.appearsInFirstCall_won.add(dealId);
            } else {
              cluster.appearsInFirstCall_lost.add(dealId);
            }
          }

          // Track closing call appearance
          if (isClosingCall) {
            cluster.appearsInClosingCall.add(dealId);
            if (outcome === 'won') {
              cluster.appearsInClosingCall_won.add(dealId);
            } else {
              cluster.appearsInClosingCall_lost.add(dealId);
            }
          }
        }
      }

      // Mark all personas in this deal as having conversation coverage
      for (const personaKey of personasInDeal) {
        const cluster = clusters.get(personaKey);
        if (cluster) {
          cluster.dealsWithConversations.add(dealId);
        }
      }
    }

    logger.info('[Step 3] Conversation participation data enriched', {
      conversationsProcessed: conversationResult.rows.length,
      dealsWithConversations: conversationsByDeal.size,
    });
  }

  // Compute persona metrics
  const personas: PersonaPattern[] = [];

  for (const [key, cluster] of clusters) {
    const freqWon = cluster.wonDeals.size / totalWonDeals;
    const freqLost = cluster.lostDeals.size / totalLostDeals;
    const lift = freqLost > 0 ? freqWon / freqLost : freqWon > 0 ? 10 : 0;

    const n = cluster.totalDeals.size;
    const confidence = n >= 30 ? 0.9 : n >= 15 ? 0.7 : n >= 5 ? 0.5 : 0.3;

    const name = `${capitalize(cluster.seniority)} ${capitalize(cluster.department)}`;

    const titleCounts = countFrequencies(cluster.titles);
    const topTitles = Object.entries(titleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    const roleCounts = countFrequencies(cluster.buyingRoles);
    const topBuyingRoles = Object.entries(roleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r]) => r);

    const avgDealSizeWon = cluster.dealAmountsWon.length > 0
      ? cluster.dealAmountsWon.reduce((a, b) => a + b, 0) / cluster.dealAmountsWon.length
      : 0;

    const avgDealSizeLost = cluster.dealAmountsLost.length > 0
      ? cluster.dealAmountsLost.reduce((a, b) => a + b, 0) / cluster.dealAmountsLost.length
      : 0;

    const dealSizeLift = avgDealSizeLost > 0 ? avgDealSizeWon / avgDealSizeLost : avgDealSizeWon > 0 ? 10 : 0;

    // Calculate conversation participation metrics (if available)
    let conversationMetrics: {
      speaker_participation_rate?: number;
      avg_talk_percentage?: number;
      appears_in_first_call?: number;
      appears_in_closing_call?: number;
      first_call_appearance_lift?: number;
      closing_call_appearance_lift?: number;
    } = {};

    if (hasConversationData && cluster.dealsWithConversations.size > 0) {
      // Speaker participation rate: % of deals where persona spoke
      const speakerParticipationRate = cluster.participatedInConversations.size / cluster.dealsWithConversations.size;

      // Average talk percentage
      const avgTalkPercentage = cluster.talkPercentages.length > 0
        ? cluster.talkPercentages.reduce((a, b) => a + b, 0) / cluster.talkPercentages.length
        : 0;

      // First call appearance rate
      const appearsInFirstCallRate = cluster.appearsInFirstCall.size / cluster.dealsWithConversations.size;

      // Closing call appearance rate
      const appearsInClosingCallRate = cluster.appearsInClosingCall.size / cluster.dealsWithConversations.size;

      // First call appearance lift (win rate when persona appears in first call vs when they don't)
      let firstCallAppearanceLift = 0;
      if (cluster.appearsInFirstCall.size > 0) {
        const winRateWithFirstCall = cluster.appearsInFirstCall_won.size / cluster.appearsInFirstCall.size;
        const dealsWithoutFirstCall = cluster.dealsWithConversations.size - cluster.appearsInFirstCall.size;
        if (dealsWithoutFirstCall > 0) {
          const wonWithoutFirstCall = cluster.wonDeals.size - cluster.appearsInFirstCall_won.size;
          const winRateWithoutFirstCall = wonWithoutFirstCall / dealsWithoutFirstCall;
          firstCallAppearanceLift = winRateWithoutFirstCall > 0
            ? winRateWithFirstCall / winRateWithoutFirstCall
            : winRateWithFirstCall > 0 ? 10 : 1;
        } else {
          firstCallAppearanceLift = winRateWithFirstCall > 0 ? 10 : 1;
        }
      }

      // Closing call appearance lift (win rate when persona appears in closing call vs when they don't)
      let closingCallAppearanceLift = 0;
      if (cluster.appearsInClosingCall.size > 0) {
        const winRateWithClosingCall = cluster.appearsInClosingCall_won.size / cluster.appearsInClosingCall.size;
        const dealsWithoutClosingCall = cluster.dealsWithConversations.size - cluster.appearsInClosingCall.size;
        if (dealsWithoutClosingCall > 0) {
          const wonWithoutClosingCall = cluster.wonDeals.size - cluster.appearsInClosingCall_won.size;
          const winRateWithoutClosingCall = wonWithoutClosingCall / dealsWithoutClosingCall;
          closingCallAppearanceLift = winRateWithoutClosingCall > 0
            ? winRateWithClosingCall / winRateWithoutClosingCall
            : winRateWithClosingCall > 0 ? 10 : 1;
        } else {
          closingCallAppearanceLift = winRateWithClosingCall > 0 ? 10 : 1;
        }
      }

      conversationMetrics = {
        speaker_participation_rate: speakerParticipationRate,
        avg_talk_percentage: avgTalkPercentage,
        appears_in_first_call: appearsInFirstCallRate,
        appears_in_closing_call: appearsInClosingCallRate,
        first_call_appearance_lift: firstCallAppearanceLift,
        closing_call_appearance_lift: closingCallAppearanceLift,
      };
    }

    personas.push({
      name,
      seniority: cluster.seniority,
      department: cluster.department,
      topTitles,
      topBuyingRoles,
      frequency_in_won: freqWon,
      frequency_in_lost: freqLost,
      lift,
      dealCount: n,
      avgDealSizeWon,
      avgDealSizeLost,
      dealSizeLift,
      confidence,
      ...conversationMetrics,
    });
  }

  // Sort by lift (strongest positive signal first)
  personas.sort((a, b) => b.lift - a.lift);

  // Filter to significant personas (at least 5 deals)
  const significantPersonas = personas.filter(p => p.dealCount >= 5);

  logger.info(`[Step 3] Discovered ${significantPersonas.length} significant personas (from ${personas.length} total)`);

  return significantPersonas;
}

// ============================================================================
// Step 3B: Discover Buying Committee Combinations
// ============================================================================

function discoverCommitteeCombos(featureMatrix: FeatureVector[], personas: PersonaPattern[]): CommitteeCombo[] {
  logger.info('[Step 3B] Discovering buying committee combinations');

  // Build persona lookup
  const personaLookup = new Map<string, PersonaPattern>();
  for (const persona of personas) {
    const key = `${persona.seniority}__${persona.department}`;
    personaLookup.set(key, persona);
  }

  // For each deal, get the set of personas present
  const dealPersonaSets = new Map<string, { outcome: string; amount: number; personas: string[] }>();

  for (const deal of featureMatrix) {
    const dealPersonas = new Set<string>();
    for (let i = 0; i < deal.parsedSeniorities.length; i++) {
      const key = `${deal.parsedSeniorities[i]}__${deal.parsedDepartments[i]}`;
      if (personaLookup.has(key)) {
        dealPersonas.add(key);
      }
    }

    dealPersonaSets.set(deal.dealId, {
      outcome: deal.outcome,
      amount: deal.amount,
      personas: Array.from(dealPersonas),
    });
  }

  // Find persona pairs that co-occur in at least 5 deals
  const pairCounts = new Map<string, { won: number; lost: number; amounts: number[] }>();

  for (const [dealId, dealData] of dealPersonaSets) {
    const personas = dealData.personas;

    // Generate all pairs
    for (let i = 0; i < personas.length; i++) {
      for (let j = i + 1; j < personas.length; j++) {
        const pair = [personas[i], personas[j]].sort().join('|');

        if (!pairCounts.has(pair)) {
          pairCounts.set(pair, { won: 0, lost: 0, amounts: [] });
        }

        const counts = pairCounts.get(pair)!;
        if (dealData.outcome === 'won') {
          counts.won++;
        } else {
          counts.lost++;
        }
        counts.amounts.push(dealData.amount);
      }
    }
  }

  // Compute combo metrics
  const combos: CommitteeCombo[] = [];
  const baselineWinRate = featureMatrix.filter(d => d.outcome === 'won').length / featureMatrix.length;

  for (const [pair, counts] of pairCounts) {
    const totalCount = counts.won + counts.lost;
    if (totalCount < 5) continue;

    const personas = pair.split('|');
    const personaNames = personas.map(p => {
      const persona = personaLookup.get(p);
      return persona ? persona.name : p;
    });

    const winRate = counts.won / totalCount;
    const avgDealSize = counts.amounts.reduce((a, b) => a + b, 0) / counts.amounts.length;
    const lift = winRate / baselineWinRate;

    combos.push({
      personas,
      personaNames,
      wonCount: counts.won,
      lostCount: counts.lost,
      totalCount,
      winRate,
      avgDealSize,
      lift,
    });
  }

  // Sort by win rate DESC, then total count DESC
  combos.sort((a, b) => {
    if (Math.abs(b.winRate - a.winRate) > 0.05) return b.winRate - a.winRate;
    return b.totalCount - a.totalCount;
  });

  logger.info(`[Step 3B] Discovered ${combos.length} committee combinations`);

  return combos.slice(0, 10); // Top 10
}

// ============================================================================
// Step 4: Discover Company Patterns
// ============================================================================

async function discoverCompanyPatterns(
  workspaceId: string,
  featureMatrix: FeatureVector[],
  topFields: any[]
): Promise<CompanyProfile> {
  logger.info('[Step 4] Discovering company patterns');

  // Industry analysis
  const industryResult = await query<{
    industry: string;
    deals: number;
    won: number;
    lost: number;
    avg_won_amount: number;
  }>(`
    SELECT
      a.industry,
      COUNT(DISTINCT d.id) as deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.stage_normalized = 'closed_won') as won,
      COUNT(DISTINCT d.id) FILTER (WHERE d.stage_normalized = 'closed_lost') as lost,
      AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won') as avg_won_amount
    FROM deals d
    JOIN accounts a ON d.account_id = a.id AND a.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
      AND a.industry IS NOT NULL
    GROUP BY a.industry
    HAVING COUNT(DISTINCT d.id) >= 3
    ORDER BY won DESC
  `, [workspaceId]);

  const industryMap = new Map<string, { won: number; deals: number; totalAmount: number }>();
  for (const row of industryResult.rows) {
    const normalized = normalizeIndustry(row.industry) || row.industry;
    const existing = industryMap.get(normalized) || { won: 0, deals: 0, totalAmount: 0 };
    existing.won += Number(row.won);
    existing.deals += Number(row.deals);
    existing.totalAmount += Number(row.avg_won_amount || 0) * Number(row.won);
    industryMap.set(normalized, existing);
  }

  const industryWinRates = Array.from(industryMap.entries())
    .map(([industry, data]) => ({
      industry,
      winRate: data.won / data.deals,
      avgDeal: data.won > 0 ? data.totalAmount / data.won : 0,
      count: data.deals,
    }))
    .filter(i => i.count >= 3)
    .sort((a, b) => b.winRate - a.winRate);

  // Company size analysis
  const sizeResult = await query<{
    size_bucket: string;
    deals: number;
    won: number;
    avg_won_amount: number;
  }>(`
    SELECT
      CASE
        WHEN a.employee_count <= 50 THEN '1-50'
        WHEN a.employee_count <= 200 THEN '51-200'
        WHEN a.employee_count <= 1000 THEN '201-1000'
        WHEN a.employee_count <= 5000 THEN '1001-5000'
        ELSE '5000+'
      END as size_bucket,
      COUNT(DISTINCT d.id) as deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.stage_normalized = 'closed_won') as won,
      AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won') as avg_won_amount
    FROM deals d
    JOIN accounts a ON d.account_id = a.id AND a.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
      AND a.employee_count IS NOT NULL
    GROUP BY size_bucket
    ORDER BY won DESC
  `, [workspaceId]);

  const sizeWinRates = sizeResult.rows.map(row => ({
    bucket: row.size_bucket,
    winRate: Number(row.won) / Number(row.deals),
    avgDeal: Number(row.avg_won_amount || 0),
    count: Number(row.deals),
  }));

  // Custom field segmentation
  const customFieldSegments: CompanyProfile['customFieldSegments'] = [];

  const dealFields = topFields.filter((f: any) =>
    f.entityType === 'deal' && f.icpRelevanceScore >= 60
  );

  for (const field of dealFields) {
    const fieldResult = await query<{
      value: string;
      deals: number;
      won: number;
      lost: number;
      avg_won_amount: number;
    }>(`
      SELECT
        cf.value,
        COUNT(*) as deals,
        COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won') as won,
        COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_lost') as lost,
        AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won') as avg_won_amount
      FROM deals d
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(d.custom_fields, '{}')) AS cf(key, value)
      WHERE d.workspace_id = $1
        AND d.stage_normalized IN ('closed_won', 'closed_lost')
        AND cf.key = $2
      GROUP BY cf.value
      HAVING COUNT(*) >= 3
      ORDER BY won DESC
    `, [workspaceId, field.fieldKey]);

    if (fieldResult.rows.length > 0) {
      customFieldSegments.push({
        fieldKey: field.fieldKey,
        fieldLabel: field.fieldKey,
        segments: fieldResult.rows.map(row => ({
          value: row.value,
          winRate: Number(row.won) / Number(row.deals),
          avgDeal: Number(row.avg_won_amount || 0),
          count: Number(row.deals),
        })),
      });
    }
  }

  // Lead source funnel
  const leadSourceResult = await query<{
    lead_source: string;
    total_leads: number;
    converted: number;
    won_deals: number;
    lost_deals: number;
    avg_won_amount: number;
  }>(`
    SELECT
      l.lead_source,
      COUNT(DISTINCT l.id) as total_leads,
      COUNT(DISTINCT l.id) FILTER (WHERE l.is_converted) as converted,
      COUNT(DISTINCT d.id) FILTER (WHERE d.stage_normalized = 'closed_won') as won_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.stage_normalized = 'closed_lost') as lost_deals,
      AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won') as avg_won_amount
    FROM leads l
    LEFT JOIN deals d ON l.converted_deal_id = d.id AND d.workspace_id = l.workspace_id
    WHERE l.workspace_id = $1
    GROUP BY l.lead_source
    HAVING COUNT(DISTINCT l.id) >= 5
    ORDER BY total_leads DESC
  `, [workspaceId]);

  const leadSourceFunnel = leadSourceResult.rows.map(row => ({
    source: row.lead_source || 'Unknown',
    leads: Number(row.total_leads),
    converted: Number(row.converted),
    conversionRate: Number(row.converted) / Number(row.total_leads),
    wonDeals: Number(row.won_deals),
    lostDeals: Number(row.lost_deals),
    fullFunnelRate: Number(row.won_deals) / Number(row.total_leads),
    avgWonAmount: Number(row.avg_won_amount || 0),
  }));

  // Sweet spots (industry × size combinations with high win rates)
  const sweetSpots: CompanyProfile['sweetSpots'] = [];
  const baselineWinRate = featureMatrix.filter(d => d.outcome === 'won').length / featureMatrix.length;

  for (const industry of industryWinRates) {
    if (industry.winRate > baselineWinRate * 1.2 && industry.count >= 5) {
      sweetSpots.push({
        description: `${industry.industry} industry`,
        winRate: industry.winRate,
        avgDeal: industry.avgDeal,
        count: industry.count,
        lift: industry.winRate / baselineWinRate,
      });
    }
  }

  for (const segment of customFieldSegments) {
    for (const s of segment.segments) {
      if (s.winRate > baselineWinRate * 1.2 && s.count >= 5) {
        sweetSpots.push({
          description: `${segment.fieldLabel} = ${s.value}`,
          winRate: s.winRate,
          avgDeal: s.avgDeal,
          count: s.count,
          lift: s.winRate / baselineWinRate,
        });
      }
    }
  }

  sweetSpots.sort((a, b) => b.lift - a.lift);

  // ============================================================================
  // Conversation Benchmarks (if conversation data available)
  // ============================================================================

  let conversation_benchmarks: CompanyProfile['conversation_benchmarks'];

  const hasConversationData = featureMatrix.some(d => d.has_conversation_data);

  if (hasConversationData) {
    logger.info('[Step 4] Calculating conversation benchmarks');

    // Helper to convert employee count to size bucket
    const getSizeBucket = (employeeCount: number | null): string | null => {
      if (employeeCount === null) return null;
      if (employeeCount <= 50) return '1-50';
      if (employeeCount <= 200) return '51-200';
      if (employeeCount <= 1000) return '201-1000';
      if (employeeCount <= 5000) return '1001-5000';
      return '5000+';
    };

    // Call volume buckets by company size
    const callVolumeBuckets: NonNullable<CompanyProfile['conversation_benchmarks']>['call_volume_buckets'] = [];
    const sizeBuckets = ['1-50', '51-200', '201-1000', '1001-5000', '5000+'];

    for (const sizeBucket of sizeBuckets) {
      const dealsInBucket = featureMatrix.filter(d =>
        getSizeBucket(d.employeeCount) === sizeBucket && d.has_conversation_data && d.call_count_with_transcript !== null
      );

      if (dealsInBucket.length >= 3) {
        const callCounts = dealsInBucket.map(d => d.call_count_with_transcript!);
        const avgCalls = callCounts.reduce((a, b) => a + b, 0) / callCounts.length;
        const sortedCalls = [...callCounts].sort((a, b) => a - b);
        const medianCalls = sortedCalls[Math.floor(sortedCalls.length / 2)];
        const minCalls = Math.min(...callCounts);
        const maxCalls = Math.max(...callCounts);
        const wonDeals = dealsInBucket.filter(d => d.outcome === 'won').length;
        const winRate = wonDeals / dealsInBucket.length;

        callVolumeBuckets.push({
          size_bucket: sizeBucket,
          avg_calls: avgCalls,
          median_calls: medianCalls,
          min_calls: minCalls,
          max_calls: maxCalls,
          win_rate: winRate,
          count: dealsInBucket.length,
        });
      }
    }

    // Industry content patterns
    const industryContentPatterns: NonNullable<CompanyProfile['conversation_benchmarks']>['industry_content_patterns'] = [];
    const industries = [...new Set(featureMatrix.map(d => d.industry).filter((i): i is string => i !== null))];

    for (const industry of industries) {
      const dealsInIndustry = featureMatrix.filter(d =>
        d.industry === industry && d.has_conversation_data
      );

      if (dealsInIndustry.length >= 3) {
        // Technical depth (average across deals)
        const technicalDepths = dealsInIndustry
          .map(d => d.technical_depth)
          .filter((v): v is number => v !== null);
        const avgTechnicalDepth = technicalDepths.length > 0
          ? technicalDepths.reduce((a, b) => a + b, 0) / technicalDepths.length
          : 0;

        // Sentiment score (positive=1, neutral=0, negative=-1)
        const sentiments: number[] = dealsInIndustry
          .map(d => d.sentiment_overall === 'positive' ? 1 : d.sentiment_overall === 'negative' ? -1 : 0);
        const avgSentimentScore = sentiments.length > 0
          ? sentiments.reduce((a: number, b: number) => a + b, 0) / sentiments.length
          : 0;

        // Competitor mention rate
        const competitorMentionRate = dealsInIndustry.filter(d =>
          d.competitor_mentions_count !== null && d.competitor_mentions_count > 0
        ).length / dealsInIndustry.length;

        // Pricing discussion rate
        const pricingDiscussionRate = dealsInIndustry.filter(d =>
          d.pricing_discussed === true
        ).length / dealsInIndustry.length;

        // Budget mention rate
        const budgetMentionRate = dealsInIndustry.filter(d =>
          d.budget_mentioned === true
        ).length / dealsInIndustry.length;

        // Timeline discussion rate
        const timelineDiscussionRate = dealsInIndustry.filter(d =>
          d.timeline_discussed === true
        ).length / dealsInIndustry.length;

        industryContentPatterns.push({
          industry,
          avg_technical_depth: avgTechnicalDepth,
          avg_sentiment_score: avgSentimentScore,
          competitor_mention_rate: competitorMentionRate,
          pricing_discussion_rate: pricingDiscussionRate,
          budget_mention_rate: budgetMentionRate,
          timeline_discussion_rate: timelineDiscussionRate,
          count: dealsInIndustry.length,
        });
      }
    }

    // Sentiment predictor
    const dealsWithSentiment = featureMatrix.filter(d => d.sentiment_overall !== null);
    const positiveDeals = dealsWithSentiment.filter(d => d.sentiment_overall === 'positive');
    const neutralDeals = dealsWithSentiment.filter(d => d.sentiment_overall === 'neutral');
    const negativeDeals = dealsWithSentiment.filter(d => d.sentiment_overall === 'negative');

    const dealsWithTrajectory = featureMatrix.filter(d => d.sentiment_trajectory !== null);
    const improvingDeals = dealsWithTrajectory.filter(d => d.sentiment_trajectory === 'improving');
    const decliningDeals = dealsWithTrajectory.filter(d => d.sentiment_trajectory === 'declining');

    const sentiment_predictor = {
      positive_win_rate: positiveDeals.length > 0
        ? positiveDeals.filter(d => d.outcome === 'won').length / positiveDeals.length
        : 0,
      neutral_win_rate: neutralDeals.length > 0
        ? neutralDeals.filter(d => d.outcome === 'won').length / neutralDeals.length
        : 0,
      negative_win_rate: negativeDeals.length > 0
        ? negativeDeals.filter(d => d.outcome === 'won').length / negativeDeals.length
        : 0,
      improving_trajectory_win_rate: improvingDeals.length > 0
        ? improvingDeals.filter(d => d.outcome === 'won').length / improvingDeals.length
        : 0,
      declining_trajectory_win_rate: decliningDeals.length > 0
        ? decliningDeals.filter(d => d.outcome === 'won').length / decliningDeals.length
        : 0,
    };

    // Calls to close by size
    const callsToCloseBySize: NonNullable<CompanyProfile['conversation_benchmarks']>['calls_to_close_by_size'] = [];

    for (const sizeBucket of sizeBuckets) {
      const dealsInBucket = featureMatrix.filter(d =>
        getSizeBucket(d.employeeCount) === sizeBucket &&
        d.has_conversation_data &&
        d.call_count_with_transcript !== null &&
        d.outcome === 'won' // Only closed-won deals have meaningful "calls to close"
      );

      if (dealsInBucket.length >= 3) {
        const callCounts = dealsInBucket.map(d => d.call_count_with_transcript!);
        const avgCallsToClose = callCounts.reduce((a, b) => a + b, 0) / callCounts.length;
        const sortedCalls = [...callCounts].sort((a, b) => a - b);
        const medianCallsToClose = sortedCalls[Math.floor(sortedCalls.length / 2)];

        // Calculate avg days to close from last_call_to_close and call_density
        const daysToClose = dealsInBucket
          .map(d => d.last_call_to_close)
          .filter((v): v is number => v !== null && v >= 0);
        const avgDaysToClose = daysToClose.length > 0
          ? daysToClose.reduce((a, b) => a + b, 0) / daysToClose.length
          : 0;

        // Include all deals in size bucket for win rate (not just won)
        const allDealsInBucket = featureMatrix.filter(d =>
          getSizeBucket(d.employeeCount) === sizeBucket && d.has_conversation_data
        );
        const winRate = allDealsInBucket.length > 0
          ? allDealsInBucket.filter(d => d.outcome === 'won').length / allDealsInBucket.length
          : 0;

        callsToCloseBySize.push({
          size_bucket: sizeBucket,
          avg_calls_to_close: avgCallsToClose,
          median_calls_to_close: medianCallsToClose,
          avg_days_to_close: avgDaysToClose,
          win_rate: winRate,
          count: dealsInBucket.length,
        });
      }
    }

    conversation_benchmarks = {
      call_volume_buckets: callVolumeBuckets,
      industry_content_patterns: industryContentPatterns,
      sentiment_predictor,
      calls_to_close_by_size: callsToCloseBySize,
    };

    logger.info('[Step 4] Conversation benchmarks calculated', {
      callVolumeBuckets: callVolumeBuckets.length,
      industryPatterns: industryContentPatterns.length,
      callsToCloseBuckets: callsToCloseBySize.length,
    });
  }

  // ============================================================================
  // Signal-Based Lift Analysis (if enrichment data available)
  // ============================================================================

  let signal_analysis: CompanyProfile['signal_analysis'];

  const hasEnrichmentData = featureMatrix.some(d => d.has_enrichment_data);

  if (hasEnrichmentData) {
    logger.info('[Step 4] Calculating signal-based lift analysis');

    const wonDeals = featureMatrix.filter(d => d.outcome === 'won');
    const lostDeals = featureMatrix.filter(d => d.outcome === 'lost');

    const signalTypes: Array<'funding' | 'hiring' | 'expansion' | 'risk'> = [
      'funding',
      'hiring',
      'expansion',
      'risk',
    ];

    const signalTypeAnalysis = signalTypes.map(signalType => {
      const signalField = `has_${signalType}_signal` as keyof FeatureVector;

      const wonWithSignal = wonDeals.filter(d => d[signalField] === true);
      const lostWithSignal = lostDeals.filter(d => d[signalField] === true);

      const wonRate = wonDeals.length > 0 ? wonWithSignal.length / wonDeals.length : 0;
      const lostRate = lostDeals.length > 0 ? lostWithSignal.length / lostDeals.length : 0;
      const lift = lostRate > 0 ? wonRate / lostRate : 0;

      // Calculate average signal scores (where signal is present)
      const avgSignalScoreWon =
        wonWithSignal.length > 0
          ? wonWithSignal.reduce((sum, d) => sum + (d.signal_score || 0), 0) / wonWithSignal.length
          : 0;

      const avgSignalScoreLost =
        lostWithSignal.length > 0
          ? lostWithSignal.reduce((sum, d) => sum + (d.signal_score || 0), 0) / lostWithSignal.length
          : 0;

      return {
        type: signalType,
        won_rate: wonRate,
        lost_rate: lostRate,
        lift,
        avg_signal_score_won: avgSignalScoreWon,
        avg_signal_score_lost: avgSignalScoreLost,
        count_won: wonWithSignal.length,
        count_lost: lostWithSignal.length,
      };
    });

    signal_analysis = {
      funding_lift: signalTypeAnalysis.find(s => s.type === 'funding')?.lift || 0,
      hiring_lift: signalTypeAnalysis.find(s => s.type === 'hiring')?.lift || 0,
      expansion_lift: signalTypeAnalysis.find(s => s.type === 'expansion')?.lift || 0,
      risk_lift: signalTypeAnalysis.find(s => s.type === 'risk')?.lift || 0,
      signal_types: signalTypeAnalysis,
    };

    logger.info('[Step 4] Signal analysis complete', {
      fundingLift: signal_analysis.funding_lift.toFixed(2),
      hiringLift: signal_analysis.hiring_lift.toFixed(2),
      expansionLift: signal_analysis.expansion_lift.toFixed(2),
      riskLift: signal_analysis.risk_lift.toFixed(2),
    });
  } else {
    logger.info('[Step 4] No enrichment data available, skipping signal analysis');
  }

  logger.info('[Step 4] Company patterns discovered', {
    industries: industryWinRates.length,
    sizeBuckets: sizeWinRates.length,
    customFieldSegments: customFieldSegments.length,
    leadSources: leadSourceFunnel.length,
    sweetSpots: sweetSpots.length,
    conversationBenchmarks: conversation_benchmarks ? 'yes' : 'no',
    signalAnalysis: signal_analysis ? 'yes' : 'no',
  });

  return {
    industryWinRates,
    sizeWinRates,
    customFieldSegments,
    leadSourceFunnel,
    sweetSpots,
    conversation_benchmarks,
    signal_analysis,
  };
}

// ============================================================================
// Step 5: Build Scoring Weights (Descriptive Mode)
// ============================================================================

function buildScoringWeights(
  personas: PersonaPattern[],
  companyProfile: CompanyProfile
): ScoringWeights {
  logger.info('[Step 5] Building scoring weights (descriptive mode)');

  // Persona weights
  const personaWeights: Record<string, number> = {};
  for (const persona of personas) {
    const key = `persona_${persona.seniority}_${persona.department}`;
    personaWeights[key] = Math.min(10, Math.round(persona.lift * 3));
  }

  // Custom field weights
  const customFieldWeights: Record<string, Record<string, number>> = {};
  for (const segment of companyProfile.customFieldSegments) {
    const maxWinRate = Math.max(...segment.segments.map(s => s.winRate));
    if (maxWinRate === 0) continue;

    customFieldWeights[segment.fieldKey] = {};
    for (const s of segment.segments) {
      customFieldWeights[segment.fieldKey][s.value] = Math.round((s.winRate / maxWinRate) * 10);
    }
  }

  // Industry weights
  const industryWeights: Record<string, number> = {};
  const maxIndustryWR = Math.max(...companyProfile.industryWinRates.map(i => i.winRate), 0);
  if (maxIndustryWR > 0) {
    for (const ind of companyProfile.industryWinRates) {
      industryWeights[ind.industry] = Math.round((ind.winRate / maxIndustryWR) * 10);
    }
  }

  // Conversation weights (if available)
  let conversationWeights: Record<string, number> | undefined;
  if (companyProfile.conversation_benchmarks) {
    conversationWeights = {};
    const benchmarks = companyProfile.conversation_benchmarks;

    // Sentiment predictor weights
    if (benchmarks.sentiment_predictor) {
      const { positive_win_rate, neutral_win_rate, negative_win_rate, improving_trajectory_win_rate, declining_trajectory_win_rate } = benchmarks.sentiment_predictor;
      const maxSentimentWR = Math.max(positive_win_rate, neutral_win_rate, negative_win_rate);

      if (maxSentimentWR > 0) {
        conversationWeights['sentiment_positive'] = Math.round((positive_win_rate / maxSentimentWR) * 10);
        conversationWeights['sentiment_neutral'] = Math.round((neutral_win_rate / maxSentimentWR) * 10);
        conversationWeights['sentiment_negative'] = Math.round((negative_win_rate / maxSentimentWR) * 10);
      }

      // Trajectory weights (relative to baseline)
      const avgTrajectoryWR = (improving_trajectory_win_rate + declining_trajectory_win_rate) / 2;
      if (avgTrajectoryWR > 0) {
        conversationWeights['trajectory_improving'] = Math.round((improving_trajectory_win_rate / avgTrajectoryWR) * 5);
        conversationWeights['trajectory_declining'] = Math.round((declining_trajectory_win_rate / avgTrajectoryWR) * 5);
      }
    }

    // Call volume weights (normalized by size bucket)
    if (benchmarks.call_volume_buckets && benchmarks.call_volume_buckets.length > 0) {
      const maxCallVolumeWR = Math.max(...benchmarks.call_volume_buckets.map(b => b.win_rate));
      if (maxCallVolumeWR > 0) {
        for (const bucket of benchmarks.call_volume_buckets) {
          conversationWeights[`call_volume_${bucket.size_bucket}`] = Math.round((bucket.win_rate / maxCallVolumeWR) * 5);
        }
      }
    }

    // Champion language (binary - high weight if present)
    conversationWeights['champion_language_detected'] = 8;

    logger.info('[Step 5] Conversation weights added', {
      conversationWeights: Object.keys(conversationWeights).length,
    });
  }

  // Enrichment weights (if signal analysis available)
  let enrichmentWeights: Record<string, number> | undefined;
  if (companyProfile.signal_analysis) {
    enrichmentWeights = {};
    const signals = companyProfile.signal_analysis;

    // Signal lift-based weights (normalize by max lift)
    const maxLift = Math.max(
      signals.funding_lift,
      signals.hiring_lift,
      signals.expansion_lift,
      Math.abs(signals.risk_lift)
    );

    if (maxLift > 0) {
      enrichmentWeights['signal_funding'] = Math.min(10, Math.round((signals.funding_lift / maxLift) * 10));
      enrichmentWeights['signal_hiring'] = Math.min(10, Math.round((signals.hiring_lift / maxLift) * 10));
      enrichmentWeights['signal_expansion'] = Math.min(10, Math.round((signals.expansion_lift / maxLift) * 10));
      // Risk is negative (inverse weight)
      enrichmentWeights['signal_risk'] = Math.max(-10, Math.round((signals.risk_lift / maxLift) * -10));
    }

    // Buying committee completeness weight (fixed high value if correlated with wins)
    enrichmentWeights['buying_committee_complete'] = 5;
    enrichmentWeights['has_champion_identified'] = 3;
    enrichmentWeights['seniority_c_level_present'] = 4;
    enrichmentWeights['decision_maker_count'] = 2; // Per decision maker

    logger.info('[Step 5] Enrichment weights added', {
      enrichmentWeights: Object.keys(enrichmentWeights).length,
      fundingLift: signals.funding_lift.toFixed(2),
      hiringLift: signals.hiring_lift.toFixed(2),
    });
  }

  logger.info('[Step 5] Scoring weights built', {
    personas: Object.keys(personaWeights).length,
    customFields: Object.keys(customFieldWeights).length,
    industries: Object.keys(industryWeights).length,
    conversation: conversationWeights ? Object.keys(conversationWeights).length : 0,
    enrichment: enrichmentWeights ? Object.keys(enrichmentWeights).length : 0,
  });

  const result: ScoringWeights = {
    method: 'descriptive_heuristic',
    personas: personaWeights,
    customFields: customFieldWeights,
    industries: industryWeights,
    note: 'Heuristic weights from descriptive analysis. Not validated by regression. Upgrade to point_based mode with 100+ deals or regression mode with 200+ deals for validated weights.',
  };

  if (conversationWeights) {
    result.conversation = conversationWeights;
  }

  if (enrichmentWeights) {
    result.enrichment = enrichmentWeights;
  }

  return result;
}

// TODO: Implement buildPointBasedScoringWeights() for point_based mode
// - Include call_density, champion_language, sentiment_trajectory lifts as weights
// - Only use conversation features if coverage > 30%
// - Use statistical validation for weight selection

// TODO: Implement buildRegressionScoringWeights() for regression mode
// - Add conversation variables with feature selection
// - Apply coverage-based regularization (penalty if coverage < 50%)
// - Track which conversation features survive selection in feature_importance

// ============================================================================
// Step 10: Persist Results
// ============================================================================

async function persistICPProfile(
  workspaceId: string,
  personas: PersonaPattern[],
  committees: CommitteeCombo[],
  companyProfile: CompanyProfile,
  scoringWeights: ScoringWeights,
  metadata: any
): Promise<string> {
  logger.info('[Step 10] Persisting ICP profile');

  await query(`
    UPDATE icp_profiles SET status = 'superseded'
    WHERE workspace_id = $1 AND status = 'active'
  `, [workspaceId]);

  const result = await query<{ id: string }>(`
    INSERT INTO icp_profiles (
      workspace_id, version, status,
      personas, buying_committees, company_profile,
      scoring_weights, scoring_method,
      model_metadata,
      deals_analyzed, won_deals, lost_deals, contacts_enriched,
      generated_by
    ) VALUES (
      $1,
      COALESCE((SELECT MAX(version) FROM icp_profiles WHERE workspace_id = $1), 0) + 1,
      'active',
      $2::jsonb,
      $3::jsonb,
      $4::jsonb,
      $5::jsonb,
      $6,
      $7::jsonb,
      $8, $9, $10, $11,
      'icp-discovery'
    )
    RETURNING id
  `, [
    workspaceId,
    JSON.stringify(personas),
    JSON.stringify(committees),
    JSON.stringify(companyProfile),
    JSON.stringify(scoringWeights),
    scoringWeights.method,
    JSON.stringify(metadata),
    metadata.dealsAnalyzed,
    metadata.wonCount,
    metadata.lostCount,
    metadata.contactRolesUsed,
  ]);

  const profileId = result.rows[0].id;

  logger.info('[Step 10] ICP profile persisted', { profileId });

  return profileId;
}

// ============================================================================
// Step 2.5: Extract Conversation Signals (NEW)
// ============================================================================

import {
  linkConversationsToDeals,
  aggregateConversationMetadata,
  extractTranscriptExcerpts,
  computeConversationCoverage,
  type ConversationCoverage,
  type ConversationMetadata,
  type ConversationLinkage,
} from './conversation-features.js';

import {
  batchExcerptsForDeepSeek,
  buildConversationClassificationPrompt,
  parseConversationClassifications,
  conversationClassificationSchema,
  type ConversationSignal,
} from './conversation-classification.js';

/**
 * Extract conversation metadata and prepare for DeepSeek classification
 * Phase A+B: Link conversations + aggregate metadata
 * Phase C: Prepare excerpts for DeepSeek (will be called separately in skill step)
 *
 * Graceful degradation: If no conversations exist, returns null
 */
async function extractConversationMetadata(
  workspaceId: string,
  featureMatrix: FeatureVector[]
): Promise<{
  metadataMap: Map<string, ConversationMetadata>;
  linkages: ConversationLinkage[];
  coverage: ConversationCoverage;
  excerpts: any[]; // Prepared for DeepSeek
} | null> {
  logger.info('[Step 2.5A-B] Extracting conversation metadata', { workspaceId });

  const dealIds = featureMatrix.map(f => f.dealId);

  // Sub-step A: Link conversations to deals
  const linkages = await linkConversationsToDeals(workspaceId, dealIds);

  if (linkages.length === 0) {
    logger.info('[Step 2.5] No conversations linked - Tier 0 (graceful degradation)');
    return null;
  }

  // Sub-step B: Aggregate metadata
  const metadataMap = await aggregateConversationMetadata(workspaceId, linkages);

  // Prepare excerpts for DeepSeek classification (done in separate skill step)
  const excerpts = await extractTranscriptExcerpts(workspaceId, linkages);

  // Compute coverage and tier
  const coverage = computeConversationCoverage(featureMatrix.length, linkages, metadataMap);

  logger.info('[Step 2.5A-B] Conversation metadata extracted', {
    coverage: `${coverage.conversationCoverage.toFixed(1)}%`,
    tier: coverage.tier,
    dealsWithConversations: coverage.dealsWithConversations,
  });

  return {
    metadataMap,
    linkages,
    coverage,
    excerpts,
  };
}

/**
 * Merge conversation metadata into feature matrix
 * Called during buildFeatureMatrix to add conversation features
 */
function mergeConversationMetadataIntoFeatures(
  featureMatrix: FeatureVector[],
  metadataMap: Map<string, ConversationMetadata> | null
): FeatureVector[] {
  if (!metadataMap) {
    // No conversation data - set all to null
    return featureMatrix.map(feature => ({
      ...feature,
      has_conversation_data: false,
      total_call_minutes: null,
      call_count_with_transcript: null,
      avg_call_duration_minutes: null,
      unique_customer_speakers: null,
      unique_rep_speakers: null,
      days_between_calls_avg: null,
      first_call_timing: null,
      last_call_to_close: null,
      call_density: null,
      talk_ratio_avg: null,
      longest_monologue_avg: null,
      question_rate_avg: null,
      interactivity_avg: null,
      action_items_total: null,
      action_items_per_call: null,
      competitor_mentions_count: null,
      pricing_discussed: null,
      budget_mentioned: null,
      timeline_discussed: null,
      objection_count: null,
      champion_language: null,
      technical_depth: null,
      sentiment_overall: null,
      sentiment_trajectory: null,
      next_steps_explicit: null,
      decision_criteria_count: null,
    }));
  }

  return featureMatrix.map(feature => {
    const metadata = metadataMap.get(feature.dealId);

    if (!metadata) {
      return {
        ...feature,
        has_conversation_data: false,
        total_call_minutes: null,
        call_count_with_transcript: null,
        avg_call_duration_minutes: null,
        unique_customer_speakers: null,
        unique_rep_speakers: null,
        days_between_calls_avg: null,
        first_call_timing: null,
        last_call_to_close: null,
        call_density: null,
        talk_ratio_avg: null,
        longest_monologue_avg: null,
        question_rate_avg: null,
        interactivity_avg: null,
        action_items_total: null,
        action_items_per_call: null,
        // Content signals will be null until DeepSeek classification
        competitor_mentions_count: null,
        pricing_discussed: null,
        budget_mentioned: null,
        timeline_discussed: null,
        objection_count: null,
        champion_language: null,
        technical_depth: null,
        sentiment_overall: null,
        sentiment_trajectory: null,
        next_steps_explicit: null,
        decision_criteria_count: null,
      };
    }

    return {
      ...feature,
      has_conversation_data: true,
      ...metadata,
      // Content signals will be added later via DeepSeek
      competitor_mentions_count: null,
      pricing_discussed: null,
      budget_mentioned: null,
      timeline_discussed: null,
      objection_count: null,
      champion_language: null,
      technical_depth: null,
      sentiment_overall: null,
      sentiment_trajectory: null,
      next_steps_explicit: null,
      decision_criteria_count: null,
    };
  });
}

// ============================================================================
// Main Function
// ============================================================================

export async function discoverICP(workspaceId: string): Promise<ICPDiscoveryResult> {
  const startTime = Date.now();

  logger.info('[ICP Discovery] Starting', { workspaceId });

  // Step 1: Check data readiness
  const dataReadiness = await checkDataReadiness(workspaceId);

  if (dataReadiness.mode === 'abort') {
    throw new Error(`Insufficient data for ICP Discovery: ${dataReadiness.reasons.join(', ')}`);
  }

  // Step 1.5: Load custom field discovery
  const customFieldResult = await query<{ output: any }>(`
    SELECT output FROM skill_runs
    WHERE workspace_id = $1 AND skill_id = 'custom-field-discovery'
      AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 1
  `, [workspaceId]);

  const topFields = customFieldResult.rows[0]?.output?.topFields || [];

  // Step 2: Build feature matrix
  let featureMatrix = await buildFeatureMatrix(workspaceId);

  // Step 2.5: Extract conversation metadata (NEW)
  let conversationData: Awaited<ReturnType<typeof extractConversationMetadata>> = null;
  try {
    conversationData = await extractConversationMetadata(workspaceId, featureMatrix);
  } catch (convErr) {
    logger.warn('[Step 2.5] Conversation metadata extraction failed (non-fatal)', {
      error: convErr instanceof Error ? convErr.message : String(convErr),
    });
  }

  if (conversationData) {
    featureMatrix = mergeConversationMetadataIntoFeatures(featureMatrix, conversationData.metadataMap);
    logger.info('[Step 2.5] Conversation metadata merged', {
      tier: conversationData.coverage.tier,
      coverage: `${conversationData.coverage.conversationCoverage.toFixed(1)}%`,
    });
  } else {
    featureMatrix = mergeConversationMetadataIntoFeatures(featureMatrix, null);
    logger.info('[Step 2.5] No conversation data - Tier 0 degradation');
  }

  // Step 3: Discover persona patterns
  const personas = await discoverPersonaPatterns(workspaceId, featureMatrix);

  // Step 3B: Discover committee combinations
  const committees = discoverCommitteeCombos(featureMatrix, personas);

  // Step 4: Discover company patterns
  const companyProfile = await discoverCompanyPatterns(workspaceId, featureMatrix, topFields);

  // Step 5: Build scoring weights
  const scoringWeights = buildScoringWeights(personas, companyProfile);

  // Metadata
  const metadata = {
    dealsAnalyzed: featureMatrix.length,
    wonCount: dataReadiness.wonCount,
    lostCount: dataReadiness.lostCount,
    contactRolesUsed: dataReadiness.totalContactRoles,
    customFieldsUsed: dataReadiness.customFieldsAvailable,
    executionMs: Date.now() - startTime,
  };

  // Step 10: Persist
  const profileId = await persistICPProfile(
    workspaceId,
    personas,
    committees,
    companyProfile,
    scoringWeights,
    metadata
  );

  logger.info('[ICP Discovery] Complete', {
    profileId,
    executionMs: metadata.executionMs,
    conversationTier: conversationData?.coverage.tier || 0,
  });

  return {
    profileId,
    mode: dataReadiness.mode,
    dataReadiness,
    personas,
    committees,
    companyProfile,
    scoringWeights,
    customFieldContributions: topFields,
    metadata,
    conversationCoverage: conversationData?.coverage || null,
    conversationExcerpts: conversationData?.excerpts || null,
  };
}
