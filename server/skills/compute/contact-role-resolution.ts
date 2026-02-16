/**
 * Contact Role Resolution — Multi-Source Resolution Engine
 *
 * Fills gaps in deal_contacts.buying_role using progressively lower-confidence methods.
 * Never overwrites higher-confidence roles with lower ones.
 *
 * Priority chain:
 * 1. CRM Contact Roles (0.95) — from OpportunityContactRole sync
 * 2. CRM Deal Fields (0.90) — champion__c, economic_buyer__c custom fields
 * 2.5. Conversation Participants (0.65) — contacts on calls
 * 3. Cross-Deal Pattern Match (0.70) — same contact, same role, same account
 * 4. Title-Based Inference (0.50-0.70) — Apollo seniority > LinkedIn > CRM title parse
 * 5. Activity-Based Inference (0.40) — meeting patterns, email volume
 * 6. Apollo Confidence Boost (+0.20) — confirms existing role via enrichment data
 */

import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ContactRoleResolution');

// ============================================================================
// Types
// ============================================================================

export interface ResolutionResult {
  totalDeals: number;
  dealsProcessed: number;

  contactsResolved: {
    total: number;
    bySource: Record<string, number>;
  };

  roleDistribution: Record<string, number>;

  dealsWithNoContacts: number;
  dealsWithNoRoles: number;
  dealsWithChampion: number;
  dealsWithEconomicBuyer: number;
  dealsFullyThreaded: number;

  avgContactsPerDeal: number;
  avgRolesPerDeal: number;

  newDiscoveries: {
    fromActivities: number;
    fromConversations: number;
    fromAccountMatch: number;
  };

  executionMs: number;
}

interface DealContactRecord {
  id: string;
  workspace_id: string;
  deal_id: string;
  contact_id: string;
  buying_role: string | null;
  role_source: string | null;
  role_confidence: number | null;
  role: string | null; // Original CRM role value
}

interface ContactRecord {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  account_id: string | null;
  source_id: string | null;
}

// ============================================================================
// Role Normalization
// ============================================================================

const ROLE_NORMALIZATION: Record<string, string> = {
  // Salesforce common picklist values
  'decision maker': 'decision_maker',
  'economic buyer': 'economic_buyer',
  'executive sponsor': 'executive_sponsor',
  'champion': 'champion',
  'influencer': 'influencer',
  'evaluator': 'technical_evaluator',
  'technical evaluator': 'technical_evaluator',
  'end user': 'end_user',
  'business user': 'end_user',
  'coach': 'coach',
  'blocker': 'blocker',
  'budget holder': 'economic_buyer',
  'budget authority': 'economic_buyer',
  'project lead': 'champion',
  'project manager': 'champion',
  'sponsor': 'executive_sponsor',
  'internal champion': 'champion',
  'technical buyer': 'technical_evaluator',
  'legal': 'influencer',
  'procurement': 'influencer',
  'it': 'technical_evaluator',
};

const STANDARD_ROLES = new Set([
  'champion',
  'economic_buyer',
  'decision_maker',
  'technical_evaluator',
  'influencer',
  'coach',
  'blocker',
  'end_user',
  'executive_sponsor',
]);

function normalizeRole(crmRole: string | null): string {
  if (!crmRole) return 'unknown';
  const lower = crmRole.toLowerCase().trim();
  return ROLE_NORMALIZATION[lower] || 'unknown';
}

// ============================================================================
// Priority 2: CRM Deal Field Patterns
// ============================================================================

const ROLE_FIELD_PATTERNS: Record<string, string[]> = {
  champion: [
    'champion',
    'champion_name',
    'champion_contact',
    'champion__c',
    'Champion__c',
    'internal_champion',
  ],
  economic_buyer: [
    'economic_buyer',
    'eb',
    'budget_holder',
    'budget_owner',
    'Economic_Buyer__c',
    'Budget_Authority__c',
  ],
  decision_maker: [
    'decision_maker',
    'dm',
    'final_approver',
    'executive_sponsor',
    'Decision_Maker__c',
    'Final_Approver__c',
  ],
  technical_evaluator: [
    'technical_evaluator',
    'tech_eval',
    'technical_contact',
    'Technical_Evaluator__c',
    'Tech_Lead__c',
  ],
};

// ============================================================================
// Priority 4: Title-Based Patterns
// ============================================================================

const TITLE_ROLE_MAP: { pattern: RegExp; role: string; confidence: number }[] = [
  // C-Suite → decision_maker or executive_sponsor
  { pattern: /\b(CEO|CTO|CRO|COO|CFO|CMO|CIO|CISO|Chief)\b/i, role: 'decision_maker', confidence: 0.55 },

  // VP level → economic_buyer or decision_maker
  { pattern: /\b(VP|Vice President)\b.*\b(Sales|Revenue|Business|Commercial)\b/i, role: 'economic_buyer', confidence: 0.50 },
  { pattern: /\b(VP|Vice President)\b.*\b(Engineer|Tech|Product|IT|R&D)\b/i, role: 'technical_evaluator', confidence: 0.50 },
  { pattern: /\b(VP|Vice President)\b/i, role: 'decision_maker', confidence: 0.45 },

  // Director level → varies by department
  { pattern: /\bDirector\b.*\b(Engineer|Tech|IT|R&D|Product)\b/i, role: 'technical_evaluator', confidence: 0.50 },
  { pattern: /\bDirector\b.*\b(Sales|Revenue|Business|Procurement)\b/i, role: 'economic_buyer', confidence: 0.45 },
  { pattern: /\bDirector\b.*\b(Ops|Operations|Process|Manufacturing)\b/i, role: 'champion', confidence: 0.45 },
  { pattern: /\bDirector\b/i, role: 'influencer', confidence: 0.40 },

  // Manager level → champion or influencer
  { pattern: /\b(Manager|Lead|Head)\b.*\b(Engineer|Tech|IT|R&D|Product)\b/i, role: 'technical_evaluator', confidence: 0.45 },
  { pattern: /\b(Manager|Lead|Head)\b.*\b(Project|Program|Process|Ops)\b/i, role: 'champion', confidence: 0.45 },
  { pattern: /\b(Manager|Lead|Head)\b/i, role: 'influencer', confidence: 0.40 },

  // Specific roles
  { pattern: /\b(Procurement|Purchasing|Buyer|Supply Chain)\b/i, role: 'influencer', confidence: 0.50 },
  { pattern: /\b(Legal|Counsel|Attorney|Compliance)\b/i, role: 'influencer', confidence: 0.50 },
  { pattern: /\b(Engineer|Developer|Architect|Scientist)\b/i, role: 'end_user', confidence: 0.45 },
  { pattern: /\b(Analyst|Consultant)\b/i, role: 'influencer', confidence: 0.35 },
  { pattern: /\b(Intern|Assistant|Coordinator)\b/i, role: 'end_user', confidence: 0.30 },
];

// ============================================================================
// Helper Functions
// ============================================================================

async function hasHigherConfidenceRole(
  workspaceId: string,
  dealId: string,
  contactId: string,
  threshold: number
): Promise<boolean> {
  const result = await query<{ role_confidence: number }>(`
    SELECT role_confidence
    FROM deal_contacts
    WHERE workspace_id = $1 AND deal_id = $2 AND contact_id = $3
      AND role_confidence >= $4
    LIMIT 1
  `, [workspaceId, dealId, contactId, threshold]);

  return result.rows.length > 0;
}

async function matchContactByValue(
  workspaceId: string,
  value: string,
  accountId: string | null
): Promise<ContactRecord | null> {
  if (!value || typeof value !== 'string') return null;

  // Try email match first
  if (value.includes('@')) {
    const result = await query<ContactRecord>(`
      SELECT id, first_name, last_name, email, title, account_id, source_id
      FROM contacts
      WHERE workspace_id = $1 AND email = $2
      LIMIT 1
    `, [workspaceId, value.toLowerCase().trim()]);

    if (result.rows.length > 0) return result.rows[0];
  }

  // Try Salesforce ID match
  if (value.match(/^[a-zA-Z0-9]{15,18}$/)) {
    const result = await query<ContactRecord>(`
      SELECT id, first_name, last_name, email, title, account_id, source_id
      FROM contacts
      WHERE workspace_id = $1 AND source_id = $2
      LIMIT 1
    `, [workspaceId, value]);

    if (result.rows.length > 0) return result.rows[0];
  }

  // Try name match (scoped to account if provided)
  const nameParts = value.split(' ');
  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    const accountFilter = accountId ? 'AND account_id = $3' : '';
    const params = accountId ? [workspaceId, firstName, accountId] : [workspaceId, firstName];

    const result = await query<ContactRecord>(`
      SELECT id, first_name, last_name, email, title, account_id, source_id
      FROM contacts
      WHERE workspace_id = $1
        AND first_name ILIKE $2
        AND last_name ILIKE '${lastName}'
        ${accountFilter}
      LIMIT 1
    `, params);

    if (result.rows.length > 0) return result.rows[0];
  }

  return null;
}

async function upsertDealContact(
  workspaceId: string,
  dealId: string,
  contactId: string,
  update: {
    buying_role?: string;
    role_source?: string;
    role_confidence?: number;
  }
): Promise<void> {
  const existingRecord = await query<{ id: string; source: string }>(`
    SELECT id, source FROM deal_contacts
    WHERE workspace_id = $1 AND deal_id = $2 AND contact_id = $3
    LIMIT 1
  `, [workspaceId, dealId, contactId]);

  if (existingRecord.rows.length > 0) {
    await query(`
      UPDATE deal_contacts
      SET buying_role = COALESCE($1, buying_role),
          role_source = COALESCE($2, role_source),
          role_confidence = COALESCE($3::numeric, role_confidence),
          updated_at = NOW()
      WHERE id = $4
        AND (role_confidence IS NULL OR role_confidence < $3::numeric)
    `, [update.buying_role, update.role_source, update.role_confidence, existingRecord.rows[0].id]);
  } else {
    const source = update.role_source || 'role_resolution';
    await query(`
      INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, source, buying_role, role_source, role_confidence, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (workspace_id, deal_id, contact_id, source)
      DO UPDATE SET
        buying_role = COALESCE(EXCLUDED.buying_role, deal_contacts.buying_role),
        role_source = COALESCE(EXCLUDED.role_source, deal_contacts.role_source),
        role_confidence = COALESCE(EXCLUDED.role_confidence, deal_contacts.role_confidence),
        updated_at = NOW()
      WHERE deal_contacts.role_confidence IS NULL
        OR deal_contacts.role_confidence < EXCLUDED.role_confidence
    `, [workspaceId, dealId, contactId, source, update.buying_role, update.role_source, update.role_confidence]);
  }
}

function inferRoleFromTitle(title: string | null): { role: string; confidence: number } | null {
  if (!title) return null;

  for (const pattern of TITLE_ROLE_MAP) {
    if (pattern.pattern.test(title)) {
      return { role: pattern.role, confidence: pattern.confidence };
    }
  }

  return null;
}

/**
 * Infer buying role from Apollo-verified seniority and department
 * Higher confidence (0.65) than title-only inference (0.50) because data is verified
 */
function inferRoleFromEnrichment(
  seniority: string,
  department: string
): { role: string; confidence: number } | null {
  // C-level → decision_maker or executive_sponsor
  if (seniority === 'c_level') {
    // C-level in business departments → decision_maker
    if (['executive', 'finance', 'operations'].includes(department)) {
      return { role: 'decision_maker', confidence: 0.70 };
    }
    // C-level in IT/engineering → executive_sponsor
    if (['it', 'engineering', 'product'].includes(department)) {
      return { role: 'executive_sponsor', confidence: 0.70 };
    }
    // Default C-level → decision_maker
    return { role: 'decision_maker', confidence: 0.65 };
  }

  // VP/SVP → economic_buyer or decision_maker
  if (['vp', 'svp'].includes(seniority)) {
    if (['finance', 'operations'].includes(department)) {
      return { role: 'economic_buyer', confidence: 0.65 };
    }
    if (['it', 'engineering', 'product'].includes(department)) {
      return { role: 'decision_maker', confidence: 0.65 };
    }
    return { role: 'decision_maker', confidence: 0.60 };
  }

  // Director → champion or technical_evaluator
  if (seniority === 'director') {
    if (['it', 'engineering', 'product'].includes(department)) {
      return { role: 'technical_evaluator', confidence: 0.60 };
    }
    return { role: 'champion', confidence: 0.60 };
  }

  // Manager → champion
  if (seniority === 'manager') {
    if (['it', 'engineering', 'product'].includes(department)) {
      return { role: 'technical_evaluator', confidence: 0.55 };
    }
    return { role: 'champion', confidence: 0.55 };
  }

  // IC (individual contributor) in technical departments → technical_evaluator
  if (seniority === 'ic' && ['it', 'engineering', 'product'].includes(department)) {
    return { role: 'technical_evaluator', confidence: 0.50 };
  }

  // No clear mapping
  return null;
}

// ============================================================================
// Priority 1: Normalize Existing CRM Roles
// ============================================================================

async function normalizeCrmRoles(workspaceId: string): Promise<number> {
  logger.info('[Priority 1] Normalizing existing CRM contact roles');

  // Fetch all CRM roles that aren't already normalized
  const result = await query<DealContactRecord>(`
    SELECT id, workspace_id, deal_id, contact_id, buying_role, role, role_source, role_confidence
    FROM deal_contacts
    WHERE workspace_id = $1
      AND role_source = 'crm_contact_role'
      AND (buying_role IS NULL OR buying_role NOT IN (
        'champion', 'economic_buyer', 'decision_maker',
        'technical_evaluator', 'influencer', 'coach',
        'blocker', 'end_user', 'executive_sponsor'
      ))
  `, [workspaceId]);

  let normalized = 0;

  for (const row of result.rows) {
    const normalizedRole = normalizeRole(row.role);

    if (normalizedRole !== 'unknown' && normalizedRole !== row.buying_role) {
      await query(`
        UPDATE deal_contacts
        SET buying_role = $1, updated_at = NOW()
        WHERE id = $2
      `, [normalizedRole, row.id]);
      normalized++;
    }
  }

  logger.info(`[Priority 1] Normalized ${normalized} CRM roles`);
  return normalized;
}

// ============================================================================
// Priority 2: CRM Deal Custom Fields
// ============================================================================

async function resolveCrmDealFields(workspaceId: string, dealId?: string, includeClosedDeals = false): Promise<number> {
  logger.info('[Priority 2] Resolving from CRM deal custom fields');

  // Load custom role field mappings from workspace config
  const { getRoleFieldMappings } = await import('../../config/index.js');
  const customRoleMappings = await getRoleFieldMappings(workspaceId);

  // Merge custom mappings with default patterns
  // Custom mappings are direct field → role, convert to role → [fields] for consistency
  const mergedPatterns: Record<string, string[]> = {};
  for (const [role, patterns] of Object.entries(ROLE_FIELD_PATTERNS)) {
    mergedPatterns[role] = [...patterns];
  }
  for (const [fieldName, role] of Object.entries(customRoleMappings)) {
    if (!mergedPatterns[role]) {
      mergedPatterns[role] = [];
    }
    if (!mergedPatterns[role].includes(fieldName)) {
      mergedPatterns[role].push(fieldName);
    }
  }

  const customMappingsCount = Object.keys(customRoleMappings).length;
  if (customMappingsCount > 0) {
    logger.info(`[Priority 2] Added ${customMappingsCount} custom role field mappings`);
  }

  const dealFilter = dealId ? 'AND d.id = $2' : '';
  const closedFilter = includeClosedDeals ? '' : "AND stage_normalized NOT IN ('closed_won', 'closed_lost')";
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const dealsResult = await query<{ id: string; account_id: string; custom_fields: any }>(`
    SELECT id, account_id, custom_fields
    FROM deals
    WHERE workspace_id = $1
      ${closedFilter}
      ${dealFilter}
  `, params);

  let resolved = 0;

  for (const deal of dealsResult.rows) {
    if (!deal.custom_fields) continue;

    for (const [role, patterns] of Object.entries(mergedPatterns)) {
      for (const pattern of patterns) {
        const value = deal.custom_fields[pattern];
        if (!value) continue;

        const contact = await matchContactByValue(workspaceId, value, deal.account_id);
        if (!contact) continue;

        const hasHigherRole = await hasHigherConfidenceRole(workspaceId, deal.id, contact.id, 0.90);
        if (hasHigherRole) continue;

        await upsertDealContact(workspaceId, deal.id, contact.id, {
          buying_role: role,
          role_source: 'crm_deal_field',
          role_confidence: 0.90,
        });

        resolved++;
        logger.debug(`[Priority 2] Matched ${contact.first_name} ${contact.last_name} as ${role} via field ${pattern}`);
      }
    }
  }

  logger.info(`[Priority 2] Resolved ${resolved} roles from CRM deal fields`);
  return resolved;
}

// ============================================================================
// Priority 2.5: Conversation Participant Match
// ============================================================================

async function resolveConversationParticipants(workspaceId: string, dealId?: string): Promise<number> {
  logger.info('[Priority 2.5] Resolving conversation participants');

  // Check if conversations table exists
  try {
    await query(`SELECT 1 FROM conversations LIMIT 0`);
  } catch {
    logger.info('[Priority 2.5] No conversations table, skipping');
    return 0;
  }

  const dealFilter = dealId ? 'AND conv.deal_id = $2' : '';
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const result = await query<{ contact_id: string; deal_id: string; email: string; name: string }>(`
    SELECT DISTINCT
      c.id as contact_id,
      conv.deal_id,
      c.email,
      c.first_name || ' ' || c.last_name as name
    FROM conversations conv
    CROSS JOIN LATERAL jsonb_array_elements(conv.participants) AS p
    JOIN contacts c ON (
      c.workspace_id = conv.workspace_id
      AND (
        c.email = p->>'email'
        OR (c.first_name || ' ' || c.last_name) ILIKE (p->>'name')
      )
    )
    WHERE conv.workspace_id = $1
      AND conv.deal_id IS NOT NULL
      ${dealFilter}
      AND c.id NOT IN (
        SELECT contact_id FROM deal_contacts
        WHERE workspace_id = $1
          ${dealFilter.replace('conv.deal_id', 'deal_id')}
      )
  `, params);

  let resolved = 0;

  for (const row of result.rows) {
    // Get contact title for initial role inference
    const contactResult = await query<{ title: string }>(`
      SELECT title FROM contacts WHERE id = $1
    `, [row.contact_id]);

    const title = contactResult.rows[0]?.title;
    const titleMatch = inferRoleFromTitle(title);

    await upsertDealContact(workspaceId, row.deal_id, row.contact_id, {
      buying_role: titleMatch?.role || 'unknown',
      role_source: 'conversation_participant',
      role_confidence: 0.65,
    });

    resolved++;
    logger.debug(`[Priority 2.5] Found ${row.name} on calls for deal, inferred role: ${titleMatch?.role || 'unknown'}`);
  }

  logger.info(`[Priority 2.5] Resolved ${resolved} contacts from conversation participants`);
  return resolved;
}

// ============================================================================
// Priority 3: Cross-Deal Pattern Match
// ============================================================================

async function resolveCrossDealPatterns(workspaceId: string, dealId?: string): Promise<number> {
  logger.info('[Priority 3] Resolving from cross-deal patterns');

  const dealFilter = dealId ? 'AND d_target.id = $2' : '';
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const result = await query<{
    target_deal_id: string;
    contact_id: string;
    buying_role: string;
    role_confidence: number;
    source_deal_id: string;
  }>(`
    SELECT
      dc_target.deal_id as target_deal_id,
      dc_target.contact_id,
      dc_other.buying_role,
      dc_other.role_confidence,
      dc_other.deal_id as source_deal_id
    FROM deal_contacts dc_target
    JOIN deals d_target ON dc_target.deal_id = d_target.id
    JOIN deals d_other ON d_other.account_id = d_target.account_id
      AND d_other.workspace_id = d_target.workspace_id
      AND d_other.id != d_target.id
    JOIN deal_contacts dc_other ON (
      dc_other.deal_id = d_other.id
      AND dc_other.contact_id = dc_target.contact_id
      AND dc_other.workspace_id = d_target.workspace_id
    )
    WHERE dc_target.workspace_id = $1
      ${dealFilter}
      AND (dc_target.buying_role IS NULL OR dc_target.buying_role = 'unknown')
      AND dc_other.buying_role IS NOT NULL
      AND dc_other.buying_role != 'unknown'
      AND dc_other.role_confidence >= 0.50
    ORDER BY dc_other.role_confidence DESC
  `, params);

  let resolved = 0;

  for (const row of result.rows) {
    const hasHigherRole = await hasHigherConfidenceRole(workspaceId, row.target_deal_id, row.contact_id, 0.70);
    if (hasHigherRole) continue;

    await upsertDealContact(workspaceId, row.target_deal_id, row.contact_id, {
      buying_role: row.buying_role,
      role_source: 'cross_deal_match',
      role_confidence: 0.70,
    });

    resolved++;
  }

  logger.info(`[Priority 3] Resolved ${resolved} roles from cross-deal patterns`);
  return resolved;
}

// ============================================================================
// Priority 4: Title-Based Inference
// ============================================================================

async function resolveTitleBasedInference(workspaceId: string, dealId?: string): Promise<number> {
  logger.info('[Priority 4] Resolving from title-based inference');

  const dealFilter = dealId ? 'AND dc.deal_id = $2' : '';
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  // Skip contacts that already have enrichment data with buying roles
  // Enriched contacts should not be overwritten by lower-confidence title inference
  const result = await query<{
    id: string;
    deal_id: string;
    contact_id: string;
    title: string;
    seniority_verified: string;
    department_verified: string;
    enrichment_status: string;
  }>(`
    SELECT dc.id, dc.deal_id, dc.contact_id, c.title,
           dc.seniority_verified, dc.department_verified, dc.enrichment_status
    FROM deal_contacts dc
    JOIN contacts c ON dc.contact_id = c.id AND dc.workspace_id = c.workspace_id
    WHERE dc.workspace_id = $1
      ${dealFilter}
      AND (dc.buying_role IS NULL OR dc.buying_role = 'unknown')
      AND c.title IS NOT NULL
  `, params);

  let resolved = 0;

  for (const row of result.rows) {
    let roleMatch: { role: string; confidence: number; source: string } | null = null;

    // Task 3b: Prefer Apollo-verified seniority + department for role inference
    if (row.seniority_verified && row.department_verified) {
      roleMatch = inferRoleFromEnrichment(row.seniority_verified, row.department_verified);
      if (roleMatch) {
        roleMatch.source = 'enrichment_inference';
        // Higher confidence (0.65) because Apollo verified the data
      }
    }

    // Fallback to title-based inference if enrichment doesn't provide a role
    if (!roleMatch) {
      const titleMatch = inferRoleFromTitle(row.title);
      if (titleMatch) {
        roleMatch = { ...titleMatch, source: 'title_match' };
      }
    }

    if (!roleMatch) continue;

    const hasHigherRole = await hasHigherConfidenceRole(workspaceId, row.deal_id, row.contact_id, roleMatch.confidence);
    if (hasHigherRole) continue;

    await upsertDealContact(workspaceId, row.deal_id, row.contact_id, {
      buying_role: roleMatch.role,
      role_source: roleMatch.source,
      role_confidence: roleMatch.confidence,
    });

    resolved++;
  }

  logger.info(`[Priority 4] Resolved ${resolved} roles from title inference`);
  return resolved;
}

// ============================================================================
// Priority 5: Activity-Based Inference
// ============================================================================

async function resolveActivityBasedInference(workspaceId: string, dealId?: string): Promise<number> {
  logger.info('[Priority 5] Resolving from activity patterns');

  const dealFilter = dealId ? 'AND dc.deal_id = $2' : '';
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const result = await query<{
    deal_id: string;
    contact_id: string;
    total_activities: number;
    meetings: number;
    emails: number;
    calls: number;
    first_activity: Date;
    last_activity: Date;
    active_days: number;
  }>(`
    SELECT
      dc.deal_id,
      dc.contact_id,
      COUNT(a.id) as total_activities,
      COUNT(a.id) FILTER (WHERE a.activity_type = 'meeting') as meetings,
      COUNT(a.id) FILTER (WHERE a.activity_type = 'email') as emails,
      COUNT(a.id) FILTER (WHERE a.activity_type = 'call') as calls,
      MIN(a.timestamp) as first_activity,
      MAX(a.timestamp) as last_activity,
      COUNT(DISTINCT DATE(a.timestamp)) as active_days
    FROM deal_contacts dc
    LEFT JOIN activities a ON (
      a.workspace_id = dc.workspace_id
      AND a.contact_id = dc.contact_id
      AND a.deal_id = dc.deal_id
    )
    WHERE dc.workspace_id = $1
      ${dealFilter}
      AND (dc.buying_role IS NULL OR dc.buying_role = 'unknown')
    GROUP BY dc.deal_id, dc.contact_id
    HAVING COUNT(a.id) >= 1
  `, params);

  let resolved = 0;

  for (const row of result.rows) {
    let inferredRole: string | null = null;
    let confidence = 0.40;

    // Champion: most meetings AND early engagement AND sustained activity
    if (row.meetings >= 3 && row.active_days >= 5) {
      inferredRole = 'champion';
      confidence = 0.40;
    }
    // Decision maker: late-stage appearance, few emails
    else if (row.meetings >= 1 && row.emails < 2) {
      inferredRole = 'decision_maker';
      confidence = 0.35;
    }
    // Influencer: high email volume, low meetings
    else if (row.emails >= 5 && row.meetings <= 1) {
      inferredRole = 'influencer';
      confidence = 0.35;
    }
    // End user: single meeting attendance
    else if (row.total_activities <= 2 && row.meetings === 1) {
      inferredRole = 'end_user';
      confidence = 0.30;
    }

    if (!inferredRole) continue;

    const hasHigherRole = await hasHigherConfidenceRole(workspaceId, row.deal_id, row.contact_id, confidence);
    if (hasHigherRole) continue;

    await upsertDealContact(workspaceId, row.deal_id, row.contact_id, {
      buying_role: inferredRole,
      role_source: 'activity_inference',
      role_confidence: confidence,
    });

    resolved++;
  }

  logger.info(`[Priority 5] Resolved ${resolved} roles from activity patterns`);
  return resolved;
}

// ============================================================================
// Discovery: Find Unassociated Contacts
// ============================================================================

async function discoverContactsFromActivities(workspaceId: string, dealId?: string): Promise<number> {
  logger.info('[Discovery] Finding contacts via activities');

  const dealFilter = dealId ? 'AND a.deal_id = $2' : '';
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const result = await query<{
    contact_id: string;
    deal_id: string;
    first_name: string;
    last_name: string;
    email: string;
    title: string;
    activity_count: number;
  }>(`
    SELECT DISTINCT
      a.contact_id,
      a.deal_id,
      c.first_name,
      c.last_name,
      c.email,
      c.title,
      COUNT(*) as activity_count
    FROM activities a
    JOIN contacts c ON a.contact_id = c.id AND a.workspace_id = c.workspace_id
    WHERE a.workspace_id = $1
      ${dealFilter}
      AND a.deal_id IS NOT NULL
      AND a.contact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM deal_contacts dc
        WHERE dc.workspace_id = a.workspace_id
          AND dc.deal_id = a.deal_id
          AND dc.contact_id = a.contact_id
      )
    GROUP BY a.contact_id, a.deal_id, c.first_name, c.last_name, c.email, c.title
    HAVING COUNT(*) >= 2
  `, params);

  let discovered = 0;

  for (const row of result.rows) {
    const titleMatch = inferRoleFromTitle(row.title);

    await upsertDealContact(workspaceId, row.deal_id, row.contact_id, {
      buying_role: titleMatch?.role || 'unknown',
      role_source: 'activity_discovery',
      role_confidence: 0.35,
    });

    discovered++;
    logger.debug(`[Discovery] Found ${row.first_name} ${row.last_name} on deal via ${row.activity_count} activities`);
  }

  logger.info(`[Discovery] Discovered ${discovered} contacts from activities`);
  return discovered;
}

async function discoverContactsFromAccount(workspaceId: string, dealId?: string, includeClosedDeals = false): Promise<number> {
  logger.info('[Discovery] Finding senior contacts at account (zero-contact deals only)');

  // Only run for deals with zero contacts
  const dealFilter = dealId ? 'AND d.id = $2' : '';
  const closedFilter = includeClosedDeals ? '' : "AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')";
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const dealsWithNoContacts = await query<{ id: string; account_id: string }>(`
    SELECT d.id, d.account_id
    FROM deals d
    WHERE d.workspace_id = $1
      ${closedFilter}
      ${dealFilter}
      AND NOT EXISTS (
        SELECT 1 FROM deal_contacts dc
        WHERE dc.workspace_id = d.workspace_id AND dc.deal_id = d.id
      )
  `, params);

  let discovered = 0;

  for (const deal of dealsWithNoContacts.rows) {
    const contacts = await query<ContactRecord>(`
      SELECT c.id, c.first_name, c.last_name, c.email, c.title
      FROM contacts c
      WHERE c.workspace_id = $1
        AND c.account_id = $2
        AND c.title ~* '(VP|Director|Chief|Head|Manager|Lead|President)'
      ORDER BY c.updated_at DESC
      LIMIT 10
    `, [workspaceId, deal.account_id]);

    for (const contact of contacts.rows) {
      const titleMatch = inferRoleFromTitle(contact.title);

      await upsertDealContact(workspaceId, deal.id, contact.id, {
        buying_role: titleMatch?.role || 'unknown',
        role_source: 'account_seniority_match',
        role_confidence: 0.25,
      });

      discovered++;
      logger.debug(`[Discovery] Inferred ${contact.first_name} ${contact.last_name} from account seniority`);
    }
  }

  logger.info(`[Discovery] Discovered ${discovered} contacts from account seniority`);
  return discovered;
}

// ============================================================================
// Priority 6: Apollo Confidence Boost
// ============================================================================

/**
 * Boost confidence for contacts whose existing role is confirmed by Apollo enrichment data.
 * Seniority preference: Apollo (seniority_verified) > LinkedIn (linkedin_data) > CRM title parse.
 * When Apollo confirms the same role that was inferred by a lower-confidence method,
 * boost role_confidence by 0.2 (capped at 0.95).
 */
async function boostConfidenceWithApollo(workspaceId: string, dealId?: string): Promise<number> {
  const dealFilter = dealId ? 'AND dc.deal_id = $2' : '';
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const result = await query<{
    id: string;
    buying_role: string;
    role_confidence: number;
    role_source: string;
    seniority_verified: string;
    department_verified: string;
  }>(`
    SELECT dc.id, dc.buying_role, dc.role_confidence, dc.role_source,
           dc.seniority_verified, dc.department_verified
    FROM deal_contacts dc
    WHERE dc.workspace_id = $1
      ${dealFilter}
      AND dc.buying_role IS NOT NULL
      AND dc.buying_role != 'unknown'
      AND dc.seniority_verified IS NOT NULL
      AND dc.department_verified IS NOT NULL
      AND dc.role_source != 'enrichment_inference'
      AND dc.role_source NOT LIKE '%+apollo_confirmed'
      AND dc.role_confidence < 0.95
  `, params);

  let boosted = 0;

  for (const row of result.rows) {
    const apolloInferred = inferRoleFromEnrichment(row.seniority_verified, row.department_verified);
    if (!apolloInferred) continue;

    if (apolloInferred.role === row.buying_role) {
      const newConfidence = Math.min(0.95, (row.role_confidence || 0) + 0.2);

      await query(`
        UPDATE deal_contacts
        SET role_confidence = $1,
            role_source = $2,
            updated_at = NOW()
        WHERE id = $3
      `, [newConfidence, `${row.role_source}+apollo_confirmed`, row.id]);

      boosted++;
    }
  }

  return boosted;
}

// ============================================================================
// Main Resolution Function
// ============================================================================

export async function resolveContactRoles(
  workspaceId: string,
  dealId?: string,
  options?: { includeClosedDeals?: boolean }
): Promise<ResolutionResult> {
  const includeClosedDeals = options?.includeClosedDeals ?? false;
  const startTime = Date.now();

  logger.info('[Contact Role Resolution] Starting', { workspaceId, dealId });

  const stats = {
    normalized: 0,
    crmDealField: 0,
    conversationParticipant: 0,
    crossDealMatch: 0,
    titleMatch: 0,
    activityInference: 0,
    activityDiscovery: 0,
    accountMatch: 0,
  };

  // Priority 1: Normalize existing CRM roles
  stats.normalized = await normalizeCrmRoles(workspaceId);

  // Priority 2: CRM deal custom fields
  stats.crmDealField = await resolveCrmDealFields(workspaceId, dealId, includeClosedDeals);

  // Priority 2.5: Conversation participants
  stats.conversationParticipant = await resolveConversationParticipants(workspaceId, dealId);

  // Priority 3: Cross-deal pattern match
  stats.crossDealMatch = await resolveCrossDealPatterns(workspaceId, dealId);

  // Priority 4: Title-based inference
  stats.titleMatch = await resolveTitleBasedInference(workspaceId, dealId);

  // Priority 5: Activity-based inference
  stats.activityInference = await resolveActivityBasedInference(workspaceId, dealId);

  // Priority 6: Apollo confidence boost — confirm existing roles with enrichment data
  const apolloBoosted = await boostConfidenceWithApollo(workspaceId, dealId);
  logger.info(`[Priority 6] Apollo-confirmed ${apolloBoosted} contact roles (+0.2 confidence)`);

  // Discovery: Unassociated contacts
  stats.activityDiscovery = await discoverContactsFromActivities(workspaceId, dealId);
  stats.accountMatch = await discoverContactsFromAccount(workspaceId, dealId, includeClosedDeals);

  // Compute final statistics
  const dealFilter = dealId ? 'AND dc.deal_id = $2' : '';
  const params = dealId ? [workspaceId, dealId] : [workspaceId];

  const sourceStats = await query<{ role_source: string; count: number }>(`
    SELECT role_source, COUNT(*) as count
    FROM deal_contacts
    WHERE workspace_id = $1 ${dealFilter}
    GROUP BY role_source
  `, params);

  const roleStats = await query<{ buying_role: string; count: number }>(`
    SELECT buying_role, COUNT(*) as count
    FROM deal_contacts
    WHERE workspace_id = $1 ${dealFilter}
    GROUP BY buying_role
  `, params);

  const dealStats = await query<{
    total_deals: number;
    deals_with_no_contacts: number;
    deals_with_no_roles: number;
    deals_with_champion: number;
    deals_with_economic_buyer: number;
    deals_fully_threaded: number;
    avg_contacts_per_deal: number;
    avg_roles_per_deal: number;
  }>(`
    SELECT
      COUNT(DISTINCT d.id) as total_deals,
      COUNT(DISTINCT d.id) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id)
      ) as deals_with_no_contacts,
      COUNT(DISTINCT d.id) FILTER (
        WHERE EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id)
          AND NOT EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id AND dc.buying_role IS NOT NULL AND dc.buying_role != 'unknown')
      ) as deals_with_no_roles,
      COUNT(DISTINCT d.id) FILTER (
        WHERE EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id AND dc.buying_role = 'champion')
      ) as deals_with_champion,
      COUNT(DISTINCT d.id) FILTER (
        WHERE EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id AND dc.buying_role = 'economic_buyer')
      ) as deals_with_economic_buyer,
      COUNT(DISTINCT d.id) FILTER (
        WHERE (SELECT COUNT(DISTINCT buying_role) FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id AND dc.buying_role IS NOT NULL AND dc.buying_role != 'unknown') >= 3
          AND EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id AND dc.buying_role = 'champion')
          AND EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id AND dc.buying_role IN ('economic_buyer', 'decision_maker'))
      ) as deals_fully_threaded,
      ROUND(AVG((SELECT COUNT(*) FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id)), 2) as avg_contacts_per_deal,
      ROUND(AVG((SELECT COUNT(*) FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id AND dc.buying_role IS NOT NULL AND dc.buying_role != 'unknown')), 2) as avg_roles_per_deal
    FROM deals d
    WHERE d.workspace_id = $1
      ${includeClosedDeals ? '' : "AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')"}
      ${dealFilter}
  `, params);

  const contactsBySource: Record<string, number> = {};
  for (const row of sourceStats.rows) {
    contactsBySource[row.role_source || 'unknown'] = Number(row.count);
  }

  const roleDistribution: Record<string, number> = {};
  for (const row of roleStats.rows) {
    roleDistribution[row.buying_role || 'unknown'] = Number(row.count);
  }

  const ds = dealStats.rows[0];

  const executionMs = Date.now() - startTime;

  logger.info('[Contact Role Resolution] Complete', {
    executionMs,
    totalContacts: Object.values(contactsBySource).reduce((a, b) => a + b, 0),
    resolved: stats,
  });

  return {
    totalDeals: Number(ds.total_deals),
    dealsProcessed: Number(ds.total_deals),
    contactsResolved: {
      total: Object.values(contactsBySource).reduce((a, b) => a + b, 0),
      bySource: contactsBySource,
    },
    roleDistribution,
    dealsWithNoContacts: Number(ds.deals_with_no_contacts),
    dealsWithNoRoles: Number(ds.deals_with_no_roles),
    dealsWithChampion: Number(ds.deals_with_champion),
    dealsWithEconomicBuyer: Number(ds.deals_with_economic_buyer),
    dealsFullyThreaded: Number(ds.deals_fully_threaded),
    avgContactsPerDeal: Number(ds.avg_contacts_per_deal),
    avgRolesPerDeal: Number(ds.avg_roles_per_deal),
    newDiscoveries: {
      fromActivities: stats.activityDiscovery,
      fromConversations: stats.conversationParticipant,
      fromAccountMatch: stats.accountMatch,
    },
    executionMs,
  };
}
