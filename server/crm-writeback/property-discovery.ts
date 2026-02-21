/**
 * CRM Property Discovery
 *
 * Fetches available custom properties from HubSpot and Salesforce
 * so users can see their actual CRM fields in the mapping UI.
 */

import { getConnectorCredentials } from '../lib/credential-store.js';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import type { CRMObjectType } from './pandora-fields.js';

const logger = createLogger('PropertyDiscovery');

export interface CRMProperty {
  name: string;       // internal API name
  label: string;      // human label
  type: string;       // 'number' | 'text' | 'textarea' | 'checkbox' | 'date' | etc.
  object_type: string; // 'deal' | 'company' | 'contact' | etc.
  is_custom: boolean;
}

// In-memory cache: workspaceId:objectType -> { properties, timestamp }
const propertyCache = new Map<string, { properties: CRMProperty[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * HubSpot: fetch properties for a given object type
 * GET /crm/v3/properties/{objectType}
 * Filter to show custom + relevant standard properties only
 */
export async function fetchHubSpotProperties(
  accessToken: string,
  objectType: 'deals' | 'companies' | 'contacts'
): Promise<CRMProperty[]> {
  const response = await fetch(
    `https://api.hubapi.com/crm/v3/properties/${objectType}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot property fetch failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { results: any[] };

  // Filter out internal HubSpot fields and calculation fields
  const filtered = data.results.filter((prop: any) => {
    // Skip hs_ internal fields except important ones
    if (prop.name.startsWith('hs_') && !['hs_owner_id'].includes(prop.name)) {
      return false;
    }
    // Skip calculated fields
    if (prop.fieldType === 'calculation_equation') {
      return false;
    }
    // Skip hubspot_owner_id (use hs_owner_id instead)
    if (prop.name === 'hubspot_owner_id') {
      return false;
    }
    return true;
  });

  const properties: CRMProperty[] = filtered.map((prop: any) => ({
    name: prop.name,
    label: prop.label || prop.name,
    type: mapHubSpotFieldType(prop.type),
    object_type: objectType === 'deals' ? 'deal' : objectType === 'companies' ? 'company' : 'contact',
    is_custom: !prop.name.startsWith('hs_') && prop.name !== 'dealname' && prop.name !== 'amount' && prop.name !== 'closedate',
  }));

  // Sort: custom fields first, then standard, alphabetical within each group
  properties.sort((a, b) => {
    if (a.is_custom !== b.is_custom) {
      return a.is_custom ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });

  return properties;
}

function mapHubSpotFieldType(hsType: string): string {
  const typeMap: Record<string, string> = {
    number: 'number',
    string: 'text',
    enumeration: 'text',
    date: 'date',
    datetime: 'datetime',
    bool: 'checkbox',
  };
  return typeMap[hsType] || 'text';
}

/**
 * Salesforce: fetch fields for a given SObject via describe
 * GET /services/data/v62.0/sobjects/{SObjectName}/describe
 * Filter to updateable=true fields only
 */
export async function fetchSalesforceFields(
  accessToken: string,
  instanceUrl: string,
  sobjectName: 'Opportunity' | 'Account' | 'Contact'
): Promise<CRMProperty[]> {
  const response = await fetch(
    `${instanceUrl}/services/data/v62.0/sobjects/${sobjectName}/describe`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Salesforce describe failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { fields: any[] };

  // Filter to updateable and createable fields only
  const filtered = data.fields.filter((field: any) => {
    return field.updateable === true && field.createable === true;
  });

  const properties: CRMProperty[] = filtered.map((field: any) => ({
    name: field.name,
    label: field.label || field.name,
    type: mapSalesforceFieldType(field.type),
    object_type: sobjectName === 'Opportunity' ? 'deal' : sobjectName.toLowerCase(),
    is_custom: field.custom === true,
  }));

  // Sort: custom fields first, then standard, alphabetical within each group
  properties.sort((a, b) => {
    if (a.is_custom !== b.is_custom) {
      return a.is_custom ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });

  return properties;
}

function mapSalesforceFieldType(sfType: string): string {
  const typeMap: Record<string, string> = {
    double: 'number',
    currency: 'number',
    int: 'number',
    string: 'text',
    textarea: 'textarea',
    picklist: 'text',
    date: 'date',
    datetime: 'datetime',
    boolean: 'checkbox',
  };
  return typeMap[sfType] || 'text';
}

/**
 * Unified: returns properties for the workspace's connected CRM
 */
export async function discoverCRMProperties(
  workspaceId: string,
  objectType: CRMObjectType,
  db?: any
): Promise<CRMProperty[]> {
  // Check cache first
  const cacheKey = `${workspaceId}:${objectType}`;
  const cached = propertyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.info('Property cache hit', { workspaceId, objectType });
    return cached.properties;
  }

  // Check which CRM is connected
  const hubspotCreds = await getConnectorCredentials(workspaceId, 'hubspot');
  const salesforceCreds = await getConnectorCredentials(workspaceId, 'salesforce');

  let properties: CRMProperty[] = [];

  if (hubspotCreds?.accessToken) {
    logger.info('Fetching HubSpot properties', { workspaceId, objectType });
    const hsObjectType =
      objectType === 'deal' ? 'deals' :
      objectType === 'company' || objectType === 'account' ? 'companies' :
      'contacts';
    properties = await fetchHubSpotProperties(hubspotCreds.accessToken, hsObjectType);
  } else if (salesforceCreds?.accessToken && salesforceCreds?.instanceUrl) {
    logger.info('Fetching Salesforce properties', { workspaceId, objectType });
    const sfObjectType =
      objectType === 'deal' ? 'Opportunity' :
      objectType === 'company' || objectType === 'account' ? 'Account' :
      'Contact';
    properties = await fetchSalesforceFields(
      salesforceCreds.accessToken,
      salesforceCreds.instanceUrl,
      sfObjectType
    );
  } else {
    throw new Error('No CRM connected for this workspace');
  }

  // Cache the result
  propertyCache.set(cacheKey, { properties, timestamp: Date.now() });

  return properties;
}

/**
 * Clear cache for a workspace (call after CRM disconnect)
 */
export function clearPropertyCache(workspaceId: string): void {
  const keysToDelete: string[] = [];
  for (const key of propertyCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => propertyCache.delete(key));
  logger.info('Property cache cleared', { workspaceId, keysCleared: keysToDelete.length });
}
