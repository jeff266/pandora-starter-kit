/**
 * Salesforce → Pandora Transform Layer
 *
 * Maps Salesforce objects to normalized entities
 */

import { createLogger } from '../../utils/logger.js';
const logger = createLogger('Salesforce');
import {
  sanitizeDate as sanitizeDateField,
  sanitizeNumber,
  sanitizeInteger,
  sanitizeText as sanitizeTextField,
} from '../../utils/field-sanitizer.js';

// ============================================================================
// Salesforce ID Normalization
// ============================================================================

/**
 * Normalize Salesforce ID for comparison
 *
 * Salesforce IDs come in two formats:
 * - 15-character (case-sensitive, from CSV exports/reports)
 * - 18-character (case-insensitive, from API with checksum suffix)
 *
 * The first 15 characters are identical in both formats.
 * Always normalize to 15 characters before comparison to avoid mismatches.
 *
 * Example:
 * - 15-char: 006Dn00000A1bcd
 * - 18-char: 006Dn00000A1bcdEFG (same first 15 chars)
 *
 * @param id Salesforce ID (15 or 18 characters)
 * @returns Normalized 15-character ID for comparison
 */
export function normalizeSalesforceId(id: string | null | undefined): string | null {
  if (!id) return null;
  // Strip to 15 chars for comparison (first 15 are the same in both formats)
  return id.substring(0, 15);
}

import type {
  SalesforceOpportunity,
  SalesforceContact,
  SalesforceAccount,
  SalesforceLead,
  SalesforceStage,
  SalesforceTask,
  SalesforceEvent,
} from './types.js';
import { EXTRA_STANDARD_FIELDS } from './types.js';

// ============================================================================
// Normalized Entity Types (matching HubSpot schema)
// ============================================================================

export interface NormalizedDeal {
  workspace_id: string;
  source: 'salesforce';
  source_id: string;
  source_data: Record<string, any>;
  name: string | null;
  amount: number | null;
  stage: string | null;
  stage_normalized: string | null;
  close_date: string | null;
  owner: string | null;
  probability: number | null;
  forecast_category: string | null;
  forecast_category_source: 'native' | 'derived' | null;
  pipeline: string | null;
  last_activity_date: Date | null;
  custom_fields: Record<string, any>;
  account_source_id: string | null;
  contact_source_ids: string[];
}

export interface NormalizedContact {
  workspace_id: string;
  source: 'salesforce';
  source_id: string;
  source_data: Record<string, any>;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  lifecycle_stage: string | null;
  engagement_score: number | null;
  phone: string | null;
  last_activity_date: Date | null;
  custom_fields: Record<string, any>;
  account_source_id: string | null;
}

export interface NormalizedAccount {
  workspace_id: string;
  source: 'salesforce';
  source_id: string;
  source_data: Record<string, any>;
  name: string | null;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  owner: string | null;
  custom_fields: Record<string, any>;
}

export interface NormalizedLead {
  workspace_id: string;
  source: 'salesforce';
  source_id: string;
  source_data: Record<string, any>;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: string | null;
  website: string | null;
  status: string | null;
  lead_source: string | null;
  industry: string | null;
  annual_revenue: number | null;
  employee_count: number | null;
  is_converted: boolean;
  converted_at: Date | null;
  sf_converted_contact_id: string | null;
  sf_converted_account_id: string | null;
  sf_converted_opportunity_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  custom_fields: Record<string, any>;
  created_date: Date | null;
  last_modified: Date | null;
}

export interface NormalizedActivity {
  workspace_id: string;
  source: 'salesforce';
  source_id: string;
  source_data: Record<string, any>;
  activity_type: string;
  timestamp: Date;
  actor: string | null;
  subject: string | null;
  body: string | null;
  deal_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  direction: string | null;
  duration_seconds: number | null;
  custom_fields: Record<string, any>;
}

// ============================================================================
// Field Sanitization
// ============================================================================

/**
 * Sanitize text field - handle null, empty strings, truncate long values
 */
function sanitizeText(value: unknown, maxLength: number = 10000): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  let text = String(value);

  // Remove non-UTF8 characters
  text = text.replace(/[^\x00-\x7F\u0080-\uFFFF]/g, '?');

  // Truncate if too long
  if (text.length > maxLength) {
    logger.warn('[Salesforce Transform] Truncating long field', {
      originalLength: text.length,
      maxLength,
    });
    return text.slice(0, maxLength);
  }

  return text;
}

/**
 * Sanitize date field - validates date string, converts empty string to null
 */
function sanitizeDate(value: unknown): string | null {
  const sanitized = sanitizeDateField(value);
  // field-sanitizer returns string | Date | null
  // For Salesforce, we want string format for database
  if (sanitized === null) {
    return null;
  }
  if (sanitized instanceof Date) {
    return sanitized.toISOString().split('T')[0]; // YYYY-MM-DD format
  }
  return sanitized; // Already a valid date string
}

/**
 * Extract domain from website URL
 */
function extractDomain(website: string | null): string | null {
  if (!website) return null;

  try {
    // Remove protocol
    let domain = website.replace(/^https?:\/\//, '');
    // Remove www prefix
    domain = domain.replace(/^www\./, '');
    // Remove trailing slash and path
    domain = domain.split('/')[0];
    // Remove trailing dot
    domain = domain.replace(/\.$/, '');

    return domain.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Parse seniority from title using heuristics
 */
function parseSeniority(title: string | null): string | null {
  if (!title) return null;

  const titleLower = title.toLowerCase();

  // C-level
  if (
    titleLower.includes('ceo') ||
    titleLower.includes('cto') ||
    titleLower.includes('cfo') ||
    titleLower.includes('coo') ||
    titleLower.includes('cmo') ||
    titleLower.includes('cro') ||
    titleLower.includes('chief')
  ) {
    return 'c_level';
  }

  // VP
  if (
    titleLower.includes('svp') ||
    titleLower.includes('evp') ||
    titleLower.includes('vp') ||
    titleLower.includes('vice president')
  ) {
    return 'vp';
  }

  // Director
  if (titleLower.includes('director')) {
    return 'director';
  }

  // Manager
  if (titleLower.includes('manager') || titleLower.includes('head of')) {
    return 'manager';
  }

  // Default to individual contributor
  return 'ic';
}

// ============================================================================
// Custom Field Extraction
// ============================================================================

/**
 * Fields that are already mapped to normalized schema columns
 * These should NOT be included in custom_fields to avoid duplication
 */
const MAPPED_OPPORTUNITY_FIELDS = new Set([
  'Id',
  'Name',
  'Amount',
  'StageName',
  'CloseDate',
  'Probability',
  'ForecastCategoryName',
  'OwnerId',
  'Owner',
  'AccountId',
  'Account',
  'IsClosed',
  'IsWon',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
]);

const MAPPED_CONTACT_FIELDS = new Set([
  'Id',
  'FirstName',
  'LastName',
  'Email',
  'Phone',
  'Title',
  'Department',
  'AccountId',
  'Account',
  'OwnerId',
  'Owner',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
]);

const MAPPED_ACCOUNT_FIELDS = new Set([
  'Id',
  'Name',
  'Website',
  'Industry',
  'NumberOfEmployees',
  'AnnualRevenue',
  'OwnerId',
  'Owner',
  'BillingCity',
  'BillingState',
  'BillingCountry',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
]);

const MAPPED_LEAD_FIELDS = new Set([
  'Id',
  'FirstName',
  'LastName',
  'Email',
  'Phone',
  'Title',
  'Company',
  'Website',
  'Status',
  'LeadSource',
  'Industry',
  'AnnualRevenue',
  'NumberOfEmployees',
  'IsConverted',
  'ConvertedDate',
  'ConvertedContactId',
  'ConvertedAccountId',
  'ConvertedOpportunityId',
  'OwnerId',
  'Owner',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
]);

/**
 * Extract unmapped fields into custom_fields object
 * Includes:
 * - All custom fields (ending with __c)
 * - Extra standard fields defined in EXTRA_STANDARD_FIELDS
 * - Excludes fields already mapped to normalized schema
 */
function extractCustomFields(
  rawObject: Record<string, any>,
  objectType: 'opportunity' | 'contact' | 'account' | 'lead',
  mappedFields: Set<string>
): Record<string, any> {
  const customFields: Record<string, any> = {};
  const extraStandardFields = EXTRA_STANDARD_FIELDS[objectType] || [];

  for (const [key, value] of Object.entries(rawObject)) {
    // Skip null/undefined values
    if (value === null || value === undefined) {
      continue;
    }

    // Skip fields already mapped to normalized schema
    if (mappedFields.has(key)) {
      continue;
    }

    // Skip relationship objects (e.g., Owner, Account)
    if (typeof value === 'object' && !Array.isArray(value)) {
      continue;
    }

    // Include if:
    // 1. It's a custom field (contains __c)
    // 2. It's in the extra standard fields list
    const isCustom = key.includes('__c');
    const isExtraStandard = extraStandardFields.includes(key);

    if (isCustom || isExtraStandard) {
      // Sanitize text values to prevent database errors
      if (typeof value === 'string') {
        customFields[key] = sanitizeText(value, 5000);
      } else {
        customFields[key] = value;
      }
    }
  }

  return customFields;
}

// ============================================================================
// Opportunity Transform
// ============================================================================

export function transformOpportunity(
  opp: SalesforceOpportunity,
  workspaceId: string,
  stageMap: Map<string, SalesforceStage>
): NormalizedDeal {
  const stage = stageMap.get(opp.StageName);

  // Normalize stage using Salesforce metadata
  let stageNormalized: string | null = null;

  const isClosed = stage ? stage.IsClosed : opp.IsClosed;
  const isWon = stage ? stage.IsWon : opp.IsWon;
  const forecastCat = stage ? stage.ForecastCategoryName : opp.ForecastCategoryName;

  if (isClosed && isWon) {
    stageNormalized = 'closed_won';
  } else if (isClosed && !isWon) {
    stageNormalized = 'closed_lost';
  } else {
    switch (forecastCat) {
      case 'Omitted':
        stageNormalized = 'awareness';
        break;
      case 'Pipeline':
        stageNormalized = 'qualification';
        break;
      case 'Best Case':
        stageNormalized = 'evaluation';
        break;
      case 'Commit':
        stageNormalized = 'decision';
        break;
      default:
        if (stage) {
          const totalStages = Array.from(stageMap.values()).filter(s => !s.IsClosed).length;
          const stagePosition = stage.SortOrder;
          const percentThrough = totalStages > 0 ? stagePosition / totalStages : 0;

          if (percentThrough < 0.33) {
            stageNormalized = 'qualification';
          } else if (percentThrough < 0.66) {
            stageNormalized = 'evaluation';
          } else {
            stageNormalized = 'decision';
          }
        } else {
          stageNormalized = 'qualification';
        }
    }
  }

  // Normalize forecast category
  let forecastCategory: string | null = null;
  if (opp.ForecastCategoryName) {
    switch (opp.ForecastCategoryName) {
      case 'Omitted':
      case 'Pipeline':
        forecastCategory = 'pipeline';
        break;
      case 'Best Case':
        forecastCategory = 'best_case';
        break;
      case 'Commit':
        forecastCategory = 'commit';
        break;
      case 'Closed':
        forecastCategory = 'closed';
        break;
      default:
        forecastCategory = opp.ForecastCategoryName.toLowerCase().replace(/\s+/g, '_');
    }
  }

  // Extract all unmapped custom and extra standard fields
  const customFields = extractCustomFields(
    opp as unknown as Record<string, any>,
    'opportunity',
    MAPPED_OPPORTUNITY_FIELDS
  );

  // Flag if amount is zero but deal is open (enrichment hint)
  if (opp.Amount === 0 && !opp.IsClosed) {
    customFields._amount_zero = true;
  }

  return {
    workspace_id: workspaceId,
    source: 'salesforce',
    source_id: opp.Id,
    source_data: opp as unknown as Record<string, any>,
    name: sanitizeText(opp.Name, 255),
    amount: sanitizeNumber(opp.Amount), // FIX: empty string would crash PostgreSQL
    stage: opp.StageName,
    stage_normalized: stageNormalized,
    close_date: sanitizeDate(opp.CloseDate),
    owner: opp.Owner?.Email || opp.Owner?.Name || opp.OwnerId,
    probability: sanitizeNumber(opp.Probability), // FIX: empty string would crash PostgreSQL
    forecast_category: forecastCategory,
    forecast_category_source: forecastCategory ? 'native' : null, // Salesforce uses native ForecastCategoryName
    pipeline: null,
    last_activity_date: null,
    custom_fields: customFields,
    account_source_id: opp.AccountId,
    contact_source_ids: [],  // TODO: Extract from OpportunityContactRole in Phase 2
  };
}

// ============================================================================
// Contact Transform
// ============================================================================

export function transformContact(
  contact: SalesforceContact,
  workspaceId: string
): NormalizedContact {
  // Extract all unmapped custom and extra standard fields
  const customFields = extractCustomFields(
    contact as unknown as Record<string, any>,
    'contact',
    MAPPED_CONTACT_FIELDS
  );

  return {
    workspace_id: workspaceId,
    source: 'salesforce',
    source_id: contact.Id,
    source_data: contact as unknown as Record<string, any>,
    email: sanitizeText(contact.Email, 255),
    first_name: sanitizeText(contact.FirstName, 100),
    last_name: sanitizeText(contact.LastName, 100),
    title: sanitizeText(contact.Title, 255),
    seniority: parseSeniority(contact.Title),
    department: sanitizeText(contact.Department, 100),
    lifecycle_stage: null,
    engagement_score: null,
    phone: sanitizeText(contact.Phone, 50),
    last_activity_date: null,
    custom_fields: customFields,
    account_source_id: contact.AccountId,
  };
}

// ============================================================================
// Account Transform
// ============================================================================

export function transformAccount(
  account: SalesforceAccount,
  workspaceId: string
): NormalizedAccount {
  // Extract all unmapped custom and extra standard fields
  const customFields = extractCustomFields(
    account as unknown as Record<string, any>,
    'account',
    MAPPED_ACCOUNT_FIELDS
  );

  return {
    workspace_id: workspaceId,
    source: 'salesforce',
    source_id: account.Id,
    source_data: account as unknown as Record<string, any>,
    name: sanitizeText(account.Name, 255),
    domain: extractDomain(account.Website),
    industry: sanitizeText(account.Industry, 100),
    employee_count: sanitizeInteger(account.NumberOfEmployees), // FIX: empty string would crash PostgreSQL
    annual_revenue: sanitizeNumber(account.AnnualRevenue), // FIX: empty string would crash PostgreSQL
    owner: account.Owner?.Email || account.Owner?.Name || account.OwnerId,
    custom_fields: customFields,
  };
}

// ============================================================================
// Lead Transform
// ============================================================================

export function transformLead(
  lead: SalesforceLead,
  workspaceId: string
): NormalizedLead {
  // Extract all unmapped custom and extra standard fields
  const customFields = extractCustomFields(
    lead as unknown as Record<string, any>,
    'lead',
    MAPPED_LEAD_FIELDS
  );

  // Parse owner information
  const ownerId = lead.OwnerId;
  const ownerName = lead.Owner?.Name || null;
  const ownerEmail = lead.Owner?.Email || null;

  // Parse conversion date
  let convertedAt: Date | null = null;
  if (lead.ConvertedDate) {
    try {
      convertedAt = new Date(lead.ConvertedDate);
    } catch (error) {
      logger.warn('[Salesforce Transform] Invalid ConvertedDate', {
        leadId: lead.Id,
        convertedDate: lead.ConvertedDate,
      });
    }
  }

  // Parse created and modified dates
  let createdDate: Date | null = null;
  let lastModified: Date | null = null;

  try {
    createdDate = new Date(lead.CreatedDate);
  } catch (error) {
    logger.warn('[Salesforce Transform] Invalid CreatedDate', {
      leadId: lead.Id,
      createdDate: lead.CreatedDate,
    });
  }

  try {
    lastModified = new Date(lead.LastModifiedDate);
  } catch (error) {
    logger.warn('[Salesforce Transform] Invalid LastModifiedDate', {
      leadId: lead.Id,
      lastModifiedDate: lead.LastModifiedDate,
    });
  }

  return {
    workspace_id: workspaceId,
    source: 'salesforce',
    source_id: lead.Id,
    source_data: lead as unknown as Record<string, any>,
    first_name: sanitizeText(lead.FirstName, 100),
    last_name: sanitizeText(lead.LastName, 100),
    email: sanitizeText(lead.Email, 255),
    phone: sanitizeText(lead.Phone, 50),
    title: sanitizeText(lead.Title, 255),
    company: sanitizeText(lead.Company, 255),
    website: sanitizeText(lead.Website, 255),
    status: sanitizeText(lead.Status, 100),
    lead_source: sanitizeText(lead.LeadSource, 100),
    industry: sanitizeText(lead.Industry, 100),
    annual_revenue: sanitizeNumber(lead.AnnualRevenue),
    employee_count: sanitizeInteger(lead.NumberOfEmployees),
    is_converted: lead.IsConverted,
    converted_at: convertedAt,
    sf_converted_contact_id: lead.ConvertedContactId,
    sf_converted_account_id: lead.ConvertedAccountId,
    sf_converted_opportunity_id: lead.ConvertedOpportunityId,
    owner_id: ownerId,
    owner_name: ownerName,
    owner_email: ownerEmail,
    custom_fields: customFields,
    created_date: createdDate,
    last_modified: lastModified,
  };
}

// ============================================================================
// Activity Transforms
// ============================================================================

/**
 * Transform Salesforce Task to Pandora Activity
 * Maps WhatId/WhoId to deal_id/contact_id using lookup maps
 */
export function transformTask(
  task: SalesforceTask,
  workspaceId: string,
  dealIdMap: Map<string, string>,
  contactIdMap: Map<string, string>
): NormalizedActivity | null {
  // Determine activity type from TaskSubtype
  let activityType = 'task';
  if (task.TaskSubtype) {
    const subtype = task.TaskSubtype.toLowerCase();
    if (subtype === 'call') {
      activityType = 'call';
    } else if (subtype === 'email') {
      activityType = 'email';
    }
  }

  // Map WhatId (Opportunity/Account) and WhoId (Contact/Lead)
  let dealId: string | null = null;
  let contactId: string | null = null;
  let accountId: string | null = null;

  if (task.WhatId) {
    // WhatId starting with '006' is Opportunity
    if (task.WhatId.startsWith('006')) {
      // Normalize ID before lookup (handles 15-char vs 18-char IDs)
      dealId = dealIdMap.get(normalizeSalesforceId(task.WhatId)!) || null;
    }
    // WhatId starting with '001' is Account - we don't have accountIdMap yet, skip for now
  }

  if (task.WhoId) {
    // WhoId starting with '003' is Contact
    if (task.WhoId.startsWith('003')) {
      // Normalize ID before lookup
      contactId = contactIdMap.get(normalizeSalesforceId(task.WhoId)!) || null;
    }
  }

  // Skip if no deal or contact association (we need at least one for relevance)
  if (!dealId && !contactId) {
    return null;
  }

  // Use ActivityDate if available, otherwise CreatedDate
  const timestamp = task.ActivityDate
    ? new Date(task.ActivityDate)
    : new Date(task.CreatedDate);

  return {
    workspace_id: workspaceId,
    source: 'salesforce',
    source_id: task.Id,
    source_data: task as unknown as Record<string, any>,
    activity_type: activityType,
    timestamp,
    actor: task.OwnerId,
    subject: sanitizeText(task.Subject, 500),
    body: sanitizeText(task.Description, 10000),
    deal_id: dealId,
    contact_id: contactId,
    account_id: accountId,
    direction: null, // Tasks don't have direction
    duration_seconds: null,
    custom_fields: {
      status: task.Status,
      priority: task.Priority,
    },
  };
}

/**
 * Transform Salesforce Event to Pandora Activity
 * Maps WhatId/WhoId to deal_id/contact_id using lookup maps
 */
export function transformEvent(
  event: SalesforceEvent,
  workspaceId: string,
  dealIdMap: Map<string, string>,
  contactIdMap: Map<string, string>
): NormalizedActivity | null {
  // Map WhatId (Opportunity/Account) and WhoId (Contact/Lead)
  let dealId: string | null = null;
  let contactId: string | null = null;
  let accountId: string | null = null;

  if (event.WhatId) {
    // WhatId starting with '006' is Opportunity
    if (event.WhatId.startsWith('006')) {
      // Normalize ID before lookup (handles 15-char vs 18-char IDs)
      dealId = dealIdMap.get(normalizeSalesforceId(event.WhatId)!) || null;
    }
  }

  if (event.WhoId) {
    // WhoId starting with '003' is Contact
    if (event.WhoId.startsWith('003')) {
      // Normalize ID before lookup
      contactId = contactIdMap.get(normalizeSalesforceId(event.WhoId)!) || null;
    }
  }

  // Skip if no deal or contact association
  if (!dealId && !contactId) {
    return null;
  }

  // Calculate duration if EndDateTime exists
  let durationSeconds: number | null = null;
  if (event.EndDateTime) {
    const start = new Date(event.StartDateTime).getTime();
    const end = new Date(event.EndDateTime).getTime();
    durationSeconds = Math.floor((end - start) / 1000);
  }

  return {
    workspace_id: workspaceId,
    source: 'salesforce',
    source_id: event.Id,
    source_data: event as unknown as Record<string, any>,
    activity_type: 'meeting',
    timestamp: new Date(event.StartDateTime),
    actor: event.OwnerId,
    subject: sanitizeText(event.Subject, 500),
    body: sanitizeText(event.Description, 10000),
    deal_id: dealId,
    contact_id: contactId,
    account_id: accountId,
    direction: null, // Events don't have direction
    duration_seconds: durationSeconds,
    custom_fields: {
      location: event.Location,
      end_time: event.EndDateTime,
    },
  };
}

/**
 * Normalize a Salesforce stage name to a standard category
 * Uses stage metadata (IsClosed, IsWon, ForecastCategoryName, SortOrder) if available
 * Falls back to text-based pattern matching if metadata is unavailable
 */
export function normalizeSalesforceStageName(
  stageName: string | null,
  stageMap: Map<string, SalesforceStage>
): string | null {
  if (!stageName) return null;

  // Try to find stage in metadata
  const stage = stageMap.get(stageName);

  if (stage) {
    // Use same normalization logic as transformOpportunity
    if (stage.IsClosed && stage.IsWon) {
      return 'closed_won';
    } else if (stage.IsClosed && !stage.IsWon) {
      return 'closed_lost';
    } else {
      switch (stage.ForecastCategoryName) {
        case 'Omitted':
          return 'awareness';
        case 'Pipeline':
          return 'qualification';
        case 'Best Case':
          return 'evaluation';
        case 'Commit':
          return 'decision';
        default: {
          // Calculate position-based normalization
          const totalStages = Array.from(stageMap.values()).filter(s => !s.IsClosed).length;
          const percentThrough = totalStages > 0 ? stage.SortOrder / totalStages : 0;

          if (percentThrough < 0.33) return 'qualification';
          if (percentThrough < 0.66) return 'evaluation';
          return 'decision';
        }
      }
    }
  }

  // Fallback: text-based pattern matching (for historical stages that may no longer exist)
  const normalized = stageName.toLowerCase().trim();

  if (normalized.includes('closed') && normalized.includes('won')) return 'closed_won';
  if (normalized.includes('closed') && normalized.includes('lost')) return 'closed_lost';
  if (normalized.includes('contract') || normalized.includes('negotiation')) return 'decision';
  if (normalized.includes('proposal') || normalized.includes('quote')) return 'evaluation';
  if (normalized.includes('demo') || normalized.includes('presentation')) return 'evaluation';
  if (normalized.includes('qualified') || normalized.includes('discovery')) return 'qualification';
  if (normalized.includes('prospecting') || normalized.includes('lead')) return 'qualification';

  // Default fallback
  return 'pipeline';
}

/**
 * Transform Salesforce OpportunityFieldHistory records into StageChange objects
 * Groups history records by OpportunityId and builds transition sequences
 */
export function transformStageHistory(
  historyRecords: SalesforceOpportunityFieldHistory[],
  workspaceId: string,
  dealIdMap: Map<string, string>, // Map from Salesforce Opportunity ID -> Pandora deal UUID
  stageMap: Map<string, SalesforceStage>
): Array<{
  dealId: string;
  dealSourceId: string;
  workspaceId: string;
  fromStage: string | null;
  fromStageNormalized: string | null;
  toStage: string;
  toStageNormalized: string | null;
  changedAt: Date;
  durationMs: number | null;
}> {
  if (historyRecords.length === 0) return [];

  // Group history by OpportunityId
  const historyByOpp = new Map<string, SalesforceOpportunityFieldHistory[]>();

  for (const record of historyRecords) {
    const existing = historyByOpp.get(record.OpportunityId) || [];
    existing.push(record);
    historyByOpp.set(record.OpportunityId, existing);
  }

  const transitions: Array<{
    dealId: string;
    dealSourceId: string;
    workspaceId: string;
    fromStage: string | null;
    fromStageNormalized: string | null;
    toStage: string;
    toStageNormalized: string | null;
    changedAt: Date;
    durationMs: number | null;
  }> = [];

  // Process each opportunity's stage history
  for (const [oppId, records] of historyByOpp.entries()) {
    // Normalize ID before lookup (handles 15-char vs 18-char IDs)
    const dealId = dealIdMap.get(normalizeSalesforceId(oppId)!);
    if (!dealId) {
      // Skip opportunities that don't exist in our deals table
      continue;
    }

    // Sort chronologically (should already be sorted by query, but ensure it)
    const sorted = [...records].sort(
      (a, b) => new Date(a.CreatedDate).getTime() - new Date(b.CreatedDate).getTime()
    );

    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i];
      const prevRecord = i > 0 ? sorted[i - 1] : null;

      // Skip if NewValue is null (shouldn't happen, but be safe)
      if (!record.NewValue) continue;

      // Skip if stage didn't actually change
      if (prevRecord && prevRecord.NewValue === record.NewValue) continue;

      // Calculate duration in previous stage
      let durationMs: number | null = null;
      if (prevRecord) {
        const prevTime = new Date(prevRecord.CreatedDate).getTime();
        const currentTime = new Date(record.CreatedDate).getTime();
        durationMs = currentTime - prevTime;
      }

      transitions.push({
        dealId,
        dealSourceId: oppId,
        workspaceId,
        fromStage: record.OldValue,
        fromStageNormalized: normalizeSalesforceStageName(record.OldValue, stageMap),
        toStage: record.NewValue,
        toStageNormalized: normalizeSalesforceStageName(record.NewValue, stageMap),
        changedAt: new Date(record.CreatedDate),
        durationMs,
      });
    }
  }

  return transitions;
}
