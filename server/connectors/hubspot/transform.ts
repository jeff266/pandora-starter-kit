import type { HubSpotDeal, HubSpotContact, HubSpotCompany } from './types.js';
import { parseNumber, parseDate, normalizeEmail, normalizePhone } from '../../utils/data-transforms.js';
import { sanitizeDate, sanitizeNumber, sanitizeText } from '../../utils/hubspot-sanitize.js';

export interface NormalizedDeal {
  workspace_id: string;
  source: string;
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

// TODO: Allow per-workspace override via context_layer.definitions.stage_mapping
const DEFAULT_STAGE_NORMALIZED_MAP: Record<string, string> = {
  appointmentscheduled: 'qualification',
  qualifiedtobuy: 'qualification',
  presentationscheduled: 'evaluation',
  decisionmakerboughtin: 'evaluation',
  contractsent: 'negotiation',
  closedwon: 'closed_won',
  closedlost: 'closed_lost',
  intro: 'awareness',
  engaged: 'qualification',
  proposal: 'negotiation',
  contract: 'negotiation',
  won: 'closed_won',
  lost: 'closed_lost',
  debook: 'closed_lost',
  notstarted: 'awareness',
  renewalprep: 'evaluation',
  scopeoptions: 'evaluation',
  scopeandoptions: 'evaluation',
};

function normalizeStage(rawStage: string | null): string | null {
  if (!rawStage) return null;
  const cleaned = rawStage.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  return DEFAULT_STAGE_NORMALIZED_MAP[cleaned] ?? 'awareness';
}

export interface NormalizedContact {
  workspace_id: string;
  source: string;
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
  source: string;
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

const CORE_DEAL_FIELDS = new Set([
  "dealname", "amount", "dealstage", "closedate", "createdate",
  "hs_lastmodifieddate", "pipeline", "hubspot_owner_id",
  "hs_deal_stage_probability", "notes_last_updated",
  "closed_lost_reason", "closed_won_reason", "hs_closed_lost_competitor",
]);

const CORE_CONTACT_FIELDS = new Set([
  "firstname", "lastname", "email", "phone", "company",
  "jobtitle", "lifecyclestage", "hs_lead_status",
  "createdate", "lastmodifieddate", "hubspot_owner_id",
  "hs_analytics_source", "hubspotscore", "hs_buying_role",
]);

const CORE_COMPANY_FIELDS = new Set([
  "name", "domain", "industry", "numberofemployees",
  "annualrevenue", "city", "state", "country",
  "createdate", "hs_lastmodifieddate",
]);

function extractCustomFields(
  properties: Record<string, string | undefined>,
  coreFields: Set<string>
): Record<string, any> {
  const custom: Record<string, any> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!coreFields.has(key) && value !== null && value !== undefined && value !== "") {
      custom[key] = value;
    }
  }
  return custom;
}

export interface DealTransformOptions {
  stageMap?: Map<string, string>;
  pipelineMap?: Map<string, string>;
  ownerMap?: Map<string, string>;
  forecastThresholds?: {
    commit_threshold: number;    // Default: 90
    best_case_threshold: number; // Default: 60
  };
}

export interface ContactTransformOptions {
  ownerMap?: Map<string, string>;
}

function extractCompanyAssociationId(associations: any): string | null {
  const companyResults = associations?.companies?.results;
  if (Array.isArray(companyResults) && companyResults.length > 0) {
    return companyResults[0].id ?? null;
  }
  return null;
}

function resolveOwnerName(ownerId: string | null, ownerMap?: Map<string, string>): string | null {
  if (!ownerId || !ownerMap) return ownerId;
  return ownerMap.get(ownerId) ?? ownerId;
}

/**
 * Normalize forecast category value from HubSpot custom property
 */
function normalizeForecastCategory(value: string): string | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();

  // Map common variations to standard values
  switch (normalized) {
    case 'commit':
    case 'committed':
      return 'commit';
    case 'best case':
    case 'bestcase':
    case 'best_case':
      return 'best_case';
    case 'pipeline':
      return 'pipeline';
    case 'closed':
    case 'closed won':
    case 'closedwon':
    case 'closed_won':
      return 'closed';
    case 'omitted':
      return 'pipeline';
    case 'not forecasted':
    case 'not_forecasted':
    case 'notforecasted':
      return 'not_forecasted';
    default:
      // Return as-is if it looks reasonable, null otherwise
      return /^[a-z_]+$/.test(normalized) ? normalized : null;
  }
}

/**
 * Derive forecast_category from deal stage probability
 *
 * @param probability - Deal stage probability (0-100)
 * @param thresholds - Workspace-specific thresholds (default: commit >= 90, best_case >= 60)
 * @returns Derived forecast category
 */
function deriveForecastCategoryFromProbability(
  probability: number | null,
  thresholds?: { commit_threshold: number; best_case_threshold: number }
): string | null {
  if (probability === null || probability === undefined) {
    return 'pipeline';
  }

  const commitThreshold = thresholds?.commit_threshold ?? 90;
  const bestCaseThreshold = thresholds?.best_case_threshold ?? 60;

  if (probability >= commitThreshold) {
    return 'commit';
  }
  if (probability >= bestCaseThreshold) {
    return 'best_case';
  }
  return 'pipeline';
}

/**
 * Determine forecast_category with fallback strategy:
 * 1. Check for custom HubSpot property (forecast_category or hs_forecast_category)
 * 2. Fallback to deriving from probability
 *
 * @returns { category, source } where source is 'native' or 'derived'
 */
function resolveForecastCategory(
  props: Record<string, any>,
  probability: number | null,
  thresholds?: { commit_threshold: number; best_case_threshold: number }
): { category: string | null; source: 'native' | 'derived' | null } {
  // Check for custom property first (native)
  const customForecastCategory = props.forecast_category || props.hs_forecast_category;
  if (customForecastCategory) {
    const normalized = normalizeForecastCategory(sanitizeText(customForecastCategory));
    if (normalized) {
      return { category: normalized, source: 'native' };
    }
  }

  // Fallback to deriving from probability
  const derived = deriveForecastCategoryFromProbability(probability, thresholds);
  return { category: derived, source: derived ? 'derived' : null };
}

export function transformDeal(
  deal: HubSpotDeal,
  workspaceId: string,
  options?: DealTransformOptions
): NormalizedDeal {
  const props = deal.properties;

  const rawStage = sanitizeText(props.dealstage);
  const rawPipeline = sanitizeText(props.pipeline);

  let resolvedStage = rawStage;
  if (rawStage && options?.stageMap) {
    const label = options.stageMap.get(rawStage);
    if (label) {
      resolvedStage = label;
    } else {
      console.warn(`[HubSpot Transform] Unknown stage ID: ${rawStage} for deal ${deal.id}`);
    }
  }

  let resolvedPipeline = rawPipeline;
  if (rawPipeline && options?.pipelineMap) {
    const label = options.pipelineMap.get(rawPipeline);
    if (label) {
      resolvedPipeline = label;
    }
  }

  const accountSourceId = extractCompanyAssociationId(deal.associations);

  const contactSourceIds: string[] = [];
  const contactResults = deal.associations?.contacts?.results;
  if (Array.isArray(contactResults)) {
    for (const c of contactResults) {
      if (c.id) contactSourceIds.push(c.id);
    }
  }

  // Resolve forecast_category with fallback strategy
  const probability = sanitizeNumber(props.hs_deal_stage_probability);
  const forecastCategoryResolved = resolveForecastCategory(
    props,
    probability,
    options?.forecastThresholds
  );

  return {
    workspace_id: workspaceId,
    source: "hubspot",
    source_id: deal.id,
    source_data: {
      properties: props,
      associations: deal.associations,
    },
    name: sanitizeText(props.dealname),
    amount: sanitizeNumber(props.amount),
    stage: resolvedStage,
    stage_normalized: normalizeStage(resolvedStage),
    close_date: sanitizeDate(props.closedate),
    owner: resolveOwnerName(sanitizeText(props.hubspot_owner_id), options?.ownerMap),
    probability,
    forecast_category: forecastCategoryResolved.category,
    forecast_category_source: forecastCategoryResolved.source,
    pipeline: resolvedPipeline,
    last_activity_date: parseDate(sanitizeDate(props.notes_last_updated)),
    custom_fields: extractCustomFields(props, CORE_DEAL_FIELDS),
    account_source_id: accountSourceId,
    contact_source_ids: contactSourceIds,
  };
}

export function transformContact(
  contact: HubSpotContact,
  workspaceId: string,
  options?: ContactTransformOptions
): NormalizedContact {
  const props = contact.properties;

  const accountSourceId = extractCompanyAssociationId(contact.associations);

  return {
    workspace_id: workspaceId,
    source: "hubspot",
    source_id: contact.id,
    source_data: {
      properties: props,
      associations: contact.associations,
    },
    email: normalizeEmail(sanitizeText(props.email)),
    first_name: sanitizeText(props.firstname),
    last_name: sanitizeText(props.lastname),
    title: sanitizeText(props.jobtitle),
    seniority: null,
    department: null,
    lifecycle_stage: sanitizeText(props.lifecyclestage),
    engagement_score: sanitizeNumber(props.hubspotscore),
    phone: normalizePhone(sanitizeText(props.phone)),
    last_activity_date: parseDate(sanitizeDate(props.lastmodifieddate)),
    custom_fields: extractCustomFields(props, CORE_CONTACT_FIELDS),
    account_source_id: accountSourceId,
  };
}

export function transformCompany(company: HubSpotCompany, workspaceId: string): NormalizedAccount {
  const props = company.properties;

  const employeeCount = sanitizeNumber(props.numberofemployees);

  return {
    workspace_id: workspaceId,
    source: "hubspot",
    source_id: company.id,
    source_data: {
      properties: props,
    },
    name: sanitizeText(props.name),
    domain: sanitizeText(props.domain),
    industry: sanitizeText(props.industry),
    employee_count: employeeCount !== null ? Math.round(employeeCount) : null,
    annual_revenue: sanitizeNumber(props.annualrevenue),
    owner: null,
    custom_fields: extractCustomFields(props, CORE_COMPANY_FIELDS),
  };
}
