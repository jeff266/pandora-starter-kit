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
import type {
  SalesforceOpportunity,
  SalesforceContact,
  SalesforceAccount,
  SalesforceStage,
} from './types.js';

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

  // Build custom fields
  const customFields: Record<string, unknown> = {};

  if (opp.Probability !== null) {
    customFields.probability = opp.Probability;
  }

  if (opp.Description) {
    customFields.description = sanitizeText(opp.Description, 5000);
  }

  if (opp.NextStep) {
    customFields.next_step = sanitizeText(opp.NextStep, 1000);
  }

  if (opp.Type) {
    customFields.type = opp.Type;
  }

  if (opp.LeadSource) {
    customFields.lead_source = opp.LeadSource;
  }

  // Flag if amount is zero but deal is open
  if (opp.Amount === 0 && !opp.IsClosed) {
    customFields._amount_zero = true;
  }

  // Extract custom fields (fields with __c suffix or namespace__FieldName__c)
  for (const [key, value] of Object.entries(opp)) {
    if (key.includes('__c') && value !== null && value !== undefined) {
      customFields[key] = value;
    }
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
    custom_fields: {},
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
    custom_fields: {},
  };
}
