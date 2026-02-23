/**
 * Schema Query Tool
 *
 * Dynamically discovers available CRM fields for Ask Pandora to query.
 * Caches results at workspace level to avoid repeated API calls.
 */

import { query } from '../db.js';
import { HubSpotClient } from '../connectors/hubspot/client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Schema Query');

export interface SchemaField {
  internal_name: string;
  label: string;
  type: string;                          // 'string' | 'number' | 'enumeration' | 'date' | 'datetime' | 'bool'
  field_type?: string;                   // HubSpot fieldType (text, select, checkbox, etc.)
  options?: string[];                    // For enumeration types only
  population_rate: number;               // 0.0 - 1.0
  is_custom: boolean;                    // true if workspace-added, false if CRM-native
  group_name?: string;                   // HubSpot property group
  description?: string;                  // Field description from CRM
}

export interface SchemaResult {
  object_type: string;
  crm_source: string;
  workspace_id: string;
  cached_at: string;
  cache_hit: boolean;
  field_count: number;
  fields: SchemaField[];
}

export type ObjectType = 'deals' | 'companies' | 'contacts';
export type FilterMode = 'all' | 'populated' | 'custom_only';

/**
 * Query available fields for a CRM object type
 * Uses workspace-level cache with 24-hour TTL
 */
export async function querySchema(
  workspaceId: string,
  objectType: ObjectType,
  filter: FilterMode = 'populated'
): Promise<SchemaResult> {

  // 1. Check cache first
  const cached = await query<{
    schema_json: SchemaField[];
    field_count: number;
    fetched_at: Date;
    crm_source: string;
  }>(`
    SELECT schema_json, field_count, fetched_at, crm_source
    FROM workspace_schema_cache
    WHERE workspace_id = $1
      AND object_type = $2
      AND fetched_at > NOW() - (ttl_hours || ' hours')::INTERVAL
  `, [workspaceId, objectType]);

  if (cached.rows[0]) {
    const row = cached.rows[0];
    let fields: SchemaField[] = row.schema_json;
    fields = applyFilter(fields, filter);

    logger.info(`[querySchema] Cache hit for ${workspaceId}/${objectType}, ${fields.length} fields after filter=${filter}`);

    return {
      object_type: objectType,
      crm_source: row.crm_source,
      workspace_id: workspaceId,
      cached_at: row.fetched_at.toISOString(),
      cache_hit: true,
      field_count: fields.length,
      fields,
    };
  }

  // 2. Cache miss — fetch fresh from CRM
  logger.info(`[querySchema] Cache miss for ${workspaceId}/${objectType}, fetching from CRM`);

  const crmSource = await getCRMSource(workspaceId);

  let rawFields: SchemaField[] = [];

  if (crmSource === 'hubspot') {
    rawFields = await fetchHubSpotSchema(workspaceId, objectType);
  } else if (crmSource === 'salesforce') {
    throw new Error('Salesforce schema discovery not yet implemented');
  } else {
    throw new Error(`Unknown CRM source: ${crmSource}`);
  }

  // 3. Write to cache
  await query(`
    INSERT INTO workspace_schema_cache
      (workspace_id, object_type, crm_source, schema_json, field_count, fetched_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
    ON CONFLICT (workspace_id, object_type, crm_source)
    DO UPDATE SET
      schema_json = EXCLUDED.schema_json,
      field_count = EXCLUDED.field_count,
      fetched_at = EXCLUDED.fetched_at
  `, [workspaceId, objectType, crmSource, JSON.stringify(rawFields), rawFields.length]);

  logger.info(`[querySchema] Cached ${rawFields.length} fields for ${workspaceId}/${objectType}`);

  let fields = applyFilter(rawFields, filter);

  return {
    object_type: objectType,
    crm_source: crmSource,
    workspace_id: workspaceId,
    cached_at: new Date().toISOString(),
    cache_hit: false,
    field_count: fields.length,
    fields,
  };
}

/**
 * Fetch schema from HubSpot
 * Optimized: Only calculate fill rate for custom fields to reduce API calls
 */
async function fetchHubSpotSchema(
  workspaceId: string,
  objectType: ObjectType
): Promise<SchemaField[]> {

  const hubspotClient = new HubSpotClient(workspaceId);

  const properties = await hubspotClient.getProperties(objectType);

  const fields: SchemaField[] = await Promise.all(
    properties.map(async (prop: any): Promise<SchemaField> => {

      const isCustom = !prop.hubspotDefined;

      // Only calculate fill rate for custom fields to reduce API overhead
      // Standard HubSpot fields are assumed to be well-populated (1.0)
      let populationRate = 1.0;

      if (isCustom) {
        try {
          const fillRateResult = await hubspotClient.calculatePropertyFillRate(objectType, prop.name);
          populationRate = fillRateResult.fillRate / 100; // normalize to 0-1
        } catch (error) {
          logger.warn(`[fetchHubSpotSchema] Failed to get fill rate for ${prop.name}:`, error);
          populationRate = 0; // Default to 0 if check fails
        }
      }

      return {
        internal_name: prop.name,
        label: prop.label || prop.name,
        type: normalizeHubSpotType(prop.type),
        field_type: prop.fieldType,
        options: prop.type === 'enumeration' && prop.options
          ? prop.options.map((o: any) => o.label)
          : undefined,
        population_rate: populationRate,
        is_custom: isCustom,
        group_name: prop.groupName,
        description: prop.description,
      };
    })
  );

  return fields;
}

/**
 * Get CRM source for workspace
 */
async function getCRMSource(workspaceId: string): Promise<string> {
  const result = await query<{ crm_source: string }>(`
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM connections WHERE workspace_id = $1 AND connector_name = 'hubspot')
          THEN 'hubspot'
        WHEN EXISTS (SELECT 1 FROM connections WHERE workspace_id = $1 AND connector_name = 'salesforce')
          THEN 'salesforce'
        ELSE NULL
      END as crm_source
  `, [workspaceId]);

  const crmSource = result.rows[0]?.crm_source;

  if (!crmSource) {
    throw new Error(`No CRM connector found for workspace ${workspaceId}`);
  }

  return crmSource;
}

/**
 * Apply filter to field list
 */
function applyFilter(fields: SchemaField[], filter: FilterMode): SchemaField[] {
  if (filter === 'all') return fields;
  if (filter === 'populated') return fields.filter(f => f.population_rate > 0.1);
  if (filter === 'custom_only') return fields.filter(f => f.is_custom);
  return fields;
}

/**
 * Normalize HubSpot type to common type system
 */
function normalizeHubSpotType(hubspotType: string): string {
  const map: Record<string, string> = {
    string: 'string',
    number: 'number',
    enumeration: 'enumeration',
    date: 'date',
    dateTime: 'datetime',
    bool: 'bool',
    phone_number: 'string',
  };
  return map[hubspotType] ?? 'string';
}

/**
 * Invalidate schema cache for a workspace
 * Used after connector changes or manual refresh
 */
export async function invalidateSchemaCache(
  workspaceId: string,
  objectType?: ObjectType
): Promise<void> {
  if (objectType) {
    await query(`
      DELETE FROM workspace_schema_cache
      WHERE workspace_id = $1 AND object_type = $2
    `, [workspaceId, objectType]);
    logger.info(`[invalidateSchemaCache] Cleared cache for ${workspaceId}/${objectType}`);
  } else {
    await query(`
      DELETE FROM workspace_schema_cache
      WHERE workspace_id = $1
    `, [workspaceId]);
    logger.info(`[invalidateSchemaCache] Cleared all schema cache for ${workspaceId}`);
  }
}

/**
 * Prefetch schemas for all object types (fire and forget)
 * Called after HubSpot connection to warm cache
 */
export function prefetchSchemas(workspaceId: string): void {
  Promise.all([
    querySchema(workspaceId, 'deals', 'all'),
    querySchema(workspaceId, 'companies', 'all'),
    querySchema(workspaceId, 'contacts', 'all'),
  ]).catch(err => {
    logger.warn(`[prefetchSchemas] Non-critical prefetch failed for ${workspaceId}:`, err);
  });
}
