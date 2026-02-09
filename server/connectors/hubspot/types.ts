export interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    closedate?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    pipeline?: string;
    hubspot_owner_id?: string;
    hs_deal_stage_probability?: string;
    notes_last_updated?: string;
    closed_lost_reason?: string;
    closed_won_reason?: string;
    hs_closed_lost_competitor?: string;
    [key: string]: string | undefined;
  };
  associations?: {
    contacts?: { results: Array<{ id: string }> };
    companies?: { results: Array<{ id: string }> };
  };
}

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    company?: string;
    jobtitle?: string;
    lifecyclestage?: string;
    hs_lead_status?: string;
    createdate?: string;
    lastmodifieddate?: string;
    hubspot_owner_id?: string;
    hs_analytics_source?: string;
    hubspotscore?: string;
    hs_buying_role?: string;
    [key: string]: string | undefined;
  };
  associations?: {
    companies?: { results: Array<{ id: string }> };
    deals?: { results: Array<{ id: string }> };
  };
}

export interface HubSpotCompany {
  id: string;
  properties: {
    name?: string;
    domain?: string;
    industry?: string;
    numberofemployees?: string;
    annualrevenue?: string;
    city?: string;
    state?: string;
    country?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    [key: string]: string | undefined;
  };
}

export interface HubSpotPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: {
    probability?: string;
    isClosed?: string;
  };
}

export interface HubSpotPipeline {
  id: string;
  label: string;
  stages: HubSpotPipelineStage[];
}

export interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  description: string;
  groupName: string;
  options: Array<{ label: string; value: string; displayOrder: number }>;
  displayOrder: number;
  hasUniqueValue: boolean;
  hidden: boolean;
  hubspotDefined: boolean;
  modificationMetadata?: {
    archivable: boolean;
    readOnlyDefinition: boolean;
    readOnlyValue: boolean;
  };
  formField: boolean;
  calculated: boolean;
  externalOptions: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HubSpotListResponse<T> {
  results: T[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

export interface HubSpotSearchResponse<T> {
  total: number;
  results: T[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

export interface HubSpotPropertiesResponse {
  results: HubSpotProperty[];
}
