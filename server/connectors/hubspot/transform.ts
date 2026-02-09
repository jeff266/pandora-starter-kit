import type { HubSpotDeal, HubSpotContact, HubSpotCompany } from './types.js';
import { parseNumber, parseDate, normalizeEmail, normalizePhone } from '../../utils/data-transforms.js';

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

export function transformDeal(deal: HubSpotDeal, workspaceId: string): NormalizedDeal {
  const props = deal.properties;

  return {
    workspace_id: workspaceId,
    source: "hubspot",
    source_id: deal.id,
    source_data: {
      properties: props,
      associations: deal.associations,
    },
    name: props.dealname ?? null,
    amount: parseNumber(props.amount),
    stage: props.dealstage ?? null,
    close_date: props.closedate && props.closedate !== '' ? props.closedate : null,
    owner: props.hubspot_owner_id ?? null,
    probability: parseNumber(props.hs_deal_stage_probability),
    forecast_category: null,
    pipeline: props.pipeline ?? null,
    last_activity_date: parseDate(props.notes_last_updated),
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
    email: normalizeEmail(props.email),
    first_name: props.firstname ?? null,
    last_name: props.lastname ?? null,
    title: props.jobtitle ?? null,
    seniority: null,
    department: null,
    lifecycle_stage: props.lifecyclestage ?? null,
    engagement_score: parseNumber(props.hubspotscore),
    phone: normalizePhone(props.phone),
    last_activity_date: parseDate(props.lastmodifieddate),
    custom_fields: extractCustomFields(props, CORE_CONTACT_FIELDS),
  };
}

export function transformCompany(company: HubSpotCompany, workspaceId: string): NormalizedAccount {
  const props = company.properties;

  return {
    workspace_id: workspaceId,
    source: "hubspot",
    source_id: company.id,
    source_data: {
      properties: props,
    },
    name: props.name ?? null,
    domain: props.domain ?? null,
    industry: props.industry ?? null,
    employee_count: parseNumber(props.numberofemployees) !== null
      ? Math.round(parseNumber(props.numberofemployees)!)
      : null,
    annual_revenue: parseNumber(props.annualrevenue),
    owner: null,
    custom_fields: extractCustomFields(props, CORE_COMPANY_FIELDS),
  };
}
