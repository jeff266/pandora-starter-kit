import type {
  HubSpotDeal,
  HubSpotContact,
  HubSpotCompany,
  HubSpotPipeline,
  HubSpotPipelineStage,
  HubSpotProperty,
  HubSpotListResponse,
  HubSpotSearchResponse,
  HubSpotPropertiesResponse,
} from './types.js';
import { hubspotFetch, hubspotSearchFetch } from '../../utils/throttle.js';

export class HubSpotClient {
  private baseUrl = "https://api.hubapi.com";
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, useSearchApi: boolean = false): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Choose throttled fetcher based on API type
    const throttledFetch = useSearchApi ? hubspotSearchFetch : hubspotFetch;

    const response = await throttledFetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<{ success: boolean; accountInfo?: { portalId: number; name: string }; error?: string }> {
    try {
      const accountInfo = await this.request<{ portalId: number; accountType: string; uiDomain: string }>(
        "/account-info/v3/details"
      );
      return {
        success: true,
        accountInfo: {
          portalId: accountInfo.portalId,
          name: accountInfo.uiDomain,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getDeals(limit = 100, after?: string, customProperties?: string[]): Promise<HubSpotListResponse<HubSpotDeal>> {
    const coreProperties = [
      "dealname", "amount", "dealstage", "closedate", "createdate",
      "hs_lastmodifieddate", "pipeline", "hubspot_owner_id",
      "hs_deal_stage_probability", "notes_last_updated",
      "closed_lost_reason", "closed_won_reason", "hs_closed_lost_competitor",
      // Forecast category properties (custom properties, may not exist)
      "forecast_category", "hs_forecast_category",
    ];

    const allProperties = customProperties
      ? Array.from(new Set([...coreProperties, ...customProperties]))
      : coreProperties;

    let endpoint = `/crm/v3/objects/deals?limit=${limit}&properties=${allProperties.join(",")}`;
    endpoint += "&associations=contacts,companies";

    if (after) {
      endpoint += `&after=${after}`;
    }

    return this.request<HubSpotListResponse<HubSpotDeal>>(endpoint);
  }

  async getAllDeals(includeAllProperties = false): Promise<HubSpotDeal[]> {
    const allDeals: HubSpotDeal[] = [];
    let after: string | undefined;

    let customProps: string[] | undefined;
    if (includeAllProperties) {
      try {
        const props = await this.getProperties("deals");
        customProps = props.map(p => p.name);
        console.log(`[HubSpot] Fetching deals with ${customProps.length} properties`);
      } catch (e) {
        console.warn("[HubSpot] Could not fetch property names, using defaults");
      }
    }

    do {
      const response = await this.getDeals(100, after, customProps);
      allDeals.push(...response.results);
      after = response.paging?.next?.after;
    } while (after);

    return allDeals;
  }

  async getContacts(limit = 100, after?: string, customProperties?: string[]): Promise<HubSpotListResponse<HubSpotContact>> {
    const coreProperties = [
      "firstname", "lastname", "email", "phone", "company",
      "jobtitle", "lifecyclestage", "hs_lead_status",
      "createdate", "lastmodifieddate", "hubspot_owner_id",
      "hs_analytics_source", "hubspotscore", "hs_buying_role",
    ];

    const allProperties = customProperties
      ? Array.from(new Set([...coreProperties, ...customProperties]))
      : coreProperties;

    let endpoint = `/crm/v3/objects/contacts?limit=${limit}&properties=${allProperties.join(",")}`;
    endpoint += "&associations=companies,deals";

    if (after) {
      endpoint += `&after=${after}`;
    }

    return this.request<HubSpotListResponse<HubSpotContact>>(endpoint);
  }

  async getAllContacts(includeAllProperties = false): Promise<HubSpotContact[]> {
    const allContacts: HubSpotContact[] = [];
    let after: string | undefined;

    let customProps: string[] | undefined;
    if (includeAllProperties) {
      try {
        const props = await this.getProperties("contacts");
        customProps = props.map(p => p.name);
        console.log(`[HubSpot] Fetching contacts with ${customProps.length} properties`);
      } catch (e) {
        console.warn("[HubSpot] Could not fetch contact property names, using defaults");
      }
    }

    do {
      const response = await this.getContacts(100, after, customProps);
      allContacts.push(...response.results);
      after = response.paging?.next?.after;
    } while (after);

    return allContacts;
  }

  async getCompanies(limit = 100, after?: string, customProperties?: string[]): Promise<HubSpotListResponse<HubSpotCompany>> {
    const coreProperties = [
      "name", "domain", "industry", "numberofemployees",
      "annualrevenue", "city", "state", "country",
      "createdate", "hs_lastmodifieddate",
    ];

    const allProperties = customProperties
      ? Array.from(new Set([...coreProperties, ...customProperties]))
      : coreProperties;

    let endpoint = `/crm/v3/objects/companies?limit=${limit}&properties=${allProperties.join(",")}`;

    if (after) {
      endpoint += `&after=${after}`;
    }

    return this.request<HubSpotListResponse<HubSpotCompany>>(endpoint);
  }

  async getAllCompanies(includeAllProperties = false): Promise<HubSpotCompany[]> {
    const allCompanies: HubSpotCompany[] = [];
    let after: string | undefined;

    let customProps: string[] | undefined;
    if (includeAllProperties) {
      try {
        const props = await this.getProperties("companies");
        customProps = props.map(p => p.name);
        console.log(`[HubSpot] Fetching companies with ${customProps.length} properties`);
      } catch (e) {
        console.warn("[HubSpot] Could not fetch company property names, using defaults");
      }
    }

    do {
      const response = await this.getCompanies(100, after, customProps);
      allCompanies.push(...response.results);
      after = response.paging?.next?.after;
    } while (after);

    return allCompanies;
  }

  async getPipelines(): Promise<HubSpotPipeline[]> {
    const response = await this.request<{ results: HubSpotPipeline[] }>("/crm/v3/pipelines/deals");
    return response.results;
  }

  async getDealStages(): Promise<Map<string, HubSpotPipelineStage>> {
    const pipelines = await this.getPipelines();
    const stageMap = new Map<string, HubSpotPipelineStage>();

    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        stageMap.set(stage.id, stage);
      }
    }

    return stageMap;
  }

  async getProperties(objectType: "deals" | "contacts" | "companies"): Promise<HubSpotProperty[]> {
    try {
      const response = await this.request<HubSpotPropertiesResponse>(
        `/crm/v3/properties/${objectType}`
      );
      return response.results;
    } catch (error) {
      console.error(`[HubSpot] Failed to fetch ${objectType} properties:`, error);
      return [];
    }
  }

  async getAllProperties(): Promise<{
    deals: HubSpotProperty[];
    contacts: HubSpotProperty[];
    companies: HubSpotProperty[];
  }> {
    const [deals, contacts, companies] = await Promise.all([
      this.getProperties("deals"),
      this.getProperties("contacts"),
      this.getProperties("companies"),
    ]);
    return { deals, contacts, companies };
  }

  isCustomProperty(property: HubSpotProperty): boolean {
    return !property.hubspotDefined;
  }

  async getCustomProperties(objectType: "deals" | "contacts" | "companies"): Promise<HubSpotProperty[]> {
    const allProperties = await this.getProperties(objectType);
    return allProperties.filter(p => !p.hubspotDefined && !p.hidden && !p.archived);
  }

  async countRecords(objectType: "deals" | "contacts" | "companies"): Promise<number> {
    try {
      const response = await this.request<{ total: number; results: unknown[] }>(
        `/crm/v3/objects/${objectType}/search`,
        {
          method: "POST",
          body: JSON.stringify({ limit: 1 }),
        },
        true // Use Search API throttle
      );
      return response.total;
    } catch (error) {
      console.error(`[HubSpot] Failed to count ${objectType}:`, error);
      return 0;
    }
  }

  async countRecordsWithProperty(
    objectType: "deals" | "contacts" | "companies",
    propertyName: string
  ): Promise<number | null> {
    try {
      const response = await this.request<{ total: number; results: unknown[] }>(
        `/crm/v3/objects/${objectType}/search`,
        {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [{
              filters: [{
                propertyName,
                operator: "HAS_PROPERTY",
              }],
            }],
            limit: 1,
          }),
        },
        true // Use Search API throttle
      );
      return response.total;
    } catch (error) {
      console.warn(`[HubSpot] HAS_PROPERTY not supported for ${propertyName}, will use fallback`);
      return null;
    }
  }

  async calculateFillRateFromSample(
    objectType: "deals" | "contacts" | "companies",
    propertyName: string,
    daysBack: number = 365,
    sampleSize: number = 200
  ): Promise<{ fillRate: number; sampleSize: number; filledInSample: number; isEstimate: boolean }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      const cutoffTimestamp = cutoffDate.getTime();

      const response = await this.request<{
        total: number;
        results: Array<{ id: string; properties: Record<string, string | null> }>;
      }>(
        `/crm/v3/objects/${objectType}/search`,
        {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [{
              filters: [{
                propertyName: "createdate",
                operator: "GTE",
                value: cutoffTimestamp.toString(),
              }],
            }],
            properties: [propertyName, "createdate"],
            limit: sampleSize,
          }),
        },
        true // Use Search API throttle
      );

      const actualSampleSize = response.results.length;
      let filledInSample = 0;

      for (const record of response.results) {
        const value = record.properties[propertyName];
        if (value !== null && value !== undefined && value !== "") {
          filledInSample++;
        }
      }

      const fillRate = actualSampleSize > 0
        ? Math.round((filledInSample / actualSampleSize) * 10000) / 100
        : 0;

      return {
        fillRate,
        sampleSize: actualSampleSize,
        filledInSample,
        isEstimate: actualSampleSize < response.total,
      };
    } catch (error) {
      console.error(`[HubSpot] Failed to calculate fill rate from sample for ${propertyName}:`, error);
      return { fillRate: 0, sampleSize: 0, filledInSample: 0, isEstimate: true };
    }
  }

  async calculatePropertyFillRate(
    objectType: "deals" | "contacts" | "companies",
    propertyName: string
  ): Promise<{ fillRate: number; totalRecords: number; filledRecords: number; usedFallback: boolean }> {
    const [totalRecords, filledRecordsOrNull] = await Promise.all([
      this.countRecords(objectType),
      this.countRecordsWithProperty(objectType, propertyName),
    ]);

    if (filledRecordsOrNull !== null) {
      const fillRate = totalRecords > 0 ? (filledRecordsOrNull / totalRecords) * 100 : 0;
      return {
        fillRate: Math.round(fillRate * 100) / 100,
        totalRecords,
        filledRecords: filledRecordsOrNull,
        usedFallback: false,
      };
    }

    const sampleResult = await this.calculateFillRateFromSample(objectType, propertyName, 365, 200);

    return {
      fillRate: sampleResult.fillRate,
      totalRecords: sampleResult.sampleSize,
      filledRecords: sampleResult.filledInSample,
      usedFallback: true,
    };
  }

  async searchRecentlyModified(
    objectType: "deals" | "contacts" | "companies",
    since: Date,
    properties: string[],
    limit = 100,
    after?: string
  ): Promise<HubSpotSearchResponse<{ id: string; properties: Record<string, string | null> }>> {
    const dateField = objectType === "contacts" ? "lastmodifieddate" : "hs_lastmodifieddate";

    return this.request<HubSpotSearchResponse<{ id: string; properties: Record<string, string | null> }>>(
      `/crm/v3/objects/${objectType}/search`,
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{
            filters: [{
              propertyName: dateField,
              operator: "GTE",
              value: since.getTime().toString(),
            }],
          }],
          properties,
          limit,
          ...(after ? { after } : {}),
        }),
      },
      true // Use Search API throttle
    );
  }

  async getOwners(): Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>> {
    try {
      return await this.getOwnersViaOwnersApi();
    } catch (error: any) {
      if (error?.message?.includes('403') || error?.message?.includes('MISSING_SCOPES')) {
        console.log('[HubSpot] Owners API scope unavailable, falling back to Settings/Users API');
        return await this.getOwnersViaUsersApi();
      }
      throw error;
    }
  }

  private async getOwnersViaOwnersApi(): Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>> {
    const owners: Array<{ id: string; firstName: string; lastName: string; email: string }> = [];
    let after: string | undefined;

    do {
      let endpoint = '/crm/v3/owners?limit=100';
      if (after) endpoint += `&after=${after}`;

      const response = await this.request<{
        results: Array<{ id: string; firstName: string; lastName: string; email: string }>;
        paging?: { next?: { after: string } };
      }>(endpoint);

      owners.push(...response.results);
      after = response.paging?.next?.after;
    } while (after);

    return owners;
  }

  private async getOwnersViaUsersApi(): Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>> {
    const users: Array<{ id: string; firstName: string; lastName: string; email: string }> = [];
    let after: string | undefined;

    do {
      let endpoint = '/settings/v3/users?limit=100';
      if (after) endpoint += `&after=${after}`;

      const response = await this.request<{
        results: Array<{ id: string; email: string; firstName?: string; lastName?: string }>;
        paging?: { next?: { after: string } };
      }>(endpoint);

      for (const user of response.results) {
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        if (fullName && fullName !== ' ') {
          users.push({
            id: user.id,
            firstName,
            lastName,
            email: user.email,
          });
        }
      }
      after = response.paging?.next?.after;
    } while (after);

    console.log(`[HubSpot] Resolved ${users.length} users via Settings/Users API`);
    return users;
  }

  async getAssociations(
    fromObjectType: string,
    toObjectType: string,
    objectId: string
  ): Promise<string[]> {
    try {
      const response = await this.request<{ results: Array<{ id: string }> }>(
        `/crm/v3/objects/${fromObjectType}/${objectId}/associations/${toObjectType}`
      );
      return response.results.map(r => r.id);
    } catch (error) {
      console.warn(`[HubSpot] Failed to get associations ${fromObjectType}/${objectId} → ${toObjectType}`);
      return [];
    }
  }

  /**
   * Get activities (engagements) from HubSpot
   * Fetches emails, calls, meetings, notes, and tasks
   */
  async getAllEngagements(sinceTimestamp?: number): Promise<any[]> {
    const engagementTypes = ['emails', 'calls', 'meetings', 'notes'];
    const allEngagements: any[] = [];

    for (const type of engagementTypes) {
      try {
        const engagements = await this.getEngagementsByType(type, sinceTimestamp);
        allEngagements.push(...engagements.map(e => ({ ...e, engagement_type: type.slice(0, -1) }))); // Remove 's' from type
        console.log(`[HubSpot] Fetched ${engagements.length} ${type}`);
      } catch (error) {
        console.warn(`[HubSpot] Failed to fetch ${type}:`, error instanceof Error ? error.message : String(error));
      }
    }

    return allEngagements;
  }

  private async getEngagementsByType(type: string, sinceTimestamp?: number): Promise<any[]> {
    const allRecords: any[] = [];
    let after: string | undefined;

    do {
      let endpoint = `/crm/v3/objects/${type}?limit=100&properties=hs_timestamp,hs_email_subject,hs_email_text,hs_call_title,hs_call_body,hs_call_duration,hs_meeting_title,hs_meeting_body,hs_note_body&associations=contacts,deals,companies`;

      if (after) {
        endpoint += `&after=${after}`;
      }

      const response = await this.request<any>(endpoint);
      allRecords.push(...response.results);
      after = response.paging?.next?.after;

      // Break if we've gone past sinceTimestamp
      if (sinceTimestamp && response.results.length > 0) {
        const oldestTimestamp = Math.min(...response.results.map((r: any) =>
          parseInt(r.properties?.hs_timestamp || '0', 10)
        ));
        if (oldestTimestamp < sinceTimestamp) {
          break;
        }
      }
    } while (after);

    // Filter by timestamp if provided
    if (sinceTimestamp) {
      return allRecords.filter(r => {
        const timestamp = parseInt(r.properties?.hs_timestamp || '0', 10);
        return timestamp >= sinceTimestamp;
      });
    }

    return allRecords;
  }

  /**
   * Get property history for a specific object and property
   * Uses HubSpot's propertiesWithHistory parameter to get historical values
   *
   * @param objectType - 'deals' | 'contacts' | 'companies'
   * @param objectId - HubSpot object ID
   * @param propertyName - Property to get history for (e.g., 'dealstage')
   * @returns Array of property history entries in reverse chronological order (most recent first)
   */
  async getPropertyHistory(
    objectType: 'deals' | 'contacts' | 'companies',
    objectId: string,
    propertyName: string
  ): Promise<PropertyHistoryEntry[]> {
    try {
      const endpoint = `/crm/v3/objects/${objectType}/${objectId}?propertiesWithHistory=${propertyName}`;

      const response = await this.request<{
        propertiesWithHistory?: Record<string, PropertyHistoryEntry[]>;
      }>(endpoint);

      // Extract history for the requested property
      const history = response.propertiesWithHistory?.[propertyName] || [];

      // History is returned in reverse chronological order (most recent first)
      return history;
    } catch (error) {
      console.warn(`[HubSpot] Failed to get property history for ${objectType}/${objectId}/${propertyName}:`,
        error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}

export interface PropertyHistoryEntry {
  value: string;
  timestamp: string; // ISO 8601 timestamp
  sourceType: string; // e.g., 'CRM_UI', 'WORKFLOWS', 'INTEGRATION'
  sourceId: string | null;
  updatedByUserId?: string;
}
