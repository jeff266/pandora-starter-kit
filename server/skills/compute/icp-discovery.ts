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
}

export interface ScoringWeights {
  method: string;
  personas: Record<string, number>;
  customFields: Record<string, Record<string, number>>;
  industries: Record<string, number>;
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
      d.owner as owner_email, d.owner as owner_name,
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
      ownerName: deal.owner_name,
      closeDate: deal.close_date,
      accountId: deal.account_id,
      accountName: deal.account_name,
      industry: deal.industry,
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

function discoverPersonaPatterns(featureMatrix: FeatureVector[]): PersonaPattern[] {
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

  const industryWinRates = industryResult.rows.map(row => ({
    industry: row.industry,
    winRate: Number(row.won) / Number(row.deals),
    avgDeal: Number(row.avg_won_amount || 0),
    count: Number(row.deals),
  }));

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

  logger.info('[Step 4] Company patterns discovered', {
    industries: industryWinRates.length,
    sizeBuckets: sizeWinRates.length,
    customFieldSegments: customFieldSegments.length,
    leadSources: leadSourceFunnel.length,
    sweetSpots: sweetSpots.length,
  });

  return {
    industryWinRates,
    sizeWinRates,
    customFieldSegments,
    leadSourceFunnel,
    sweetSpots,
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

  logger.info('[Step 5] Scoring weights built', {
    personas: Object.keys(personaWeights).length,
    customFields: Object.keys(customFieldWeights).length,
    industries: Object.keys(industryWeights).length,
  });

  return {
    method: 'descriptive_heuristic',
    personas: personaWeights,
    customFields: customFieldWeights,
    industries: industryWeights,
    note: 'Heuristic weights from descriptive analysis. Not validated by regression. Upgrade to point_based mode with 100+ deals or regression mode with 200+ deals for validated weights.',
  };
}

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
      'draft',
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
  const featureMatrix = await buildFeatureMatrix(workspaceId);

  // Step 3: Discover persona patterns
  const personas = discoverPersonaPatterns(featureMatrix);

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
  };
}
