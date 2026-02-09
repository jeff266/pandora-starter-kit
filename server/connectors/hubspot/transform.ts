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
  close_date: string | null;
  owner: string | null;
  probability: number | null;
  forecast_category: string | null;
  pipeline: string | null;
  last_activity_date: Date | null;
  custom_fields: Record<string, any>;
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
    close_date: sanitizeDate(props.closedate),
    owner: sanitizeText(props.hubspot_owner_id),
    probability: sanitizeNumber(props.hs_deal_stage_probability),
    forecast_category: null,
    pipeline: resolvedPipeline,
    last_activity_date: parseDate(sanitizeDate(props.notes_last_updated)),
    custom_fields: extractCustomFields(props, CORE_DEAL_FIELDS),
  };
}

export function transformContact(contact: HubSpotContact, workspaceId: string): NormalizedContact {
  const props = contact.properties;

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
