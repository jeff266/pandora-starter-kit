/**
 * CRM Write-back Engine
 *
 * Core execution layer that takes a mapping, resolves the current Pandora value
 * for a record, and writes it to the CRM.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { updateDeal as updateHubSpotDeal } from '../connectors/hubspot/hubspot-writer.js';
import { updateDeal as updateSalesforceDeal } from '../connectors/salesforce/salesforce-writer.js';
import { getConnectorCredentials } from '../lib/credential-store.js';

const logger = createLogger('WriteBackEngine');

export interface WriteBackRequest {
  workspace_id: string;
  mapping_id: string;
  crm_record_id: string;    // CRM external ID of the record to update
  entity_type: string;      // 'deal' | 'account' | 'company' | 'contact'
  trigger_source: string;   // 'skill_run:deal-score' | 'manual' | 'test'
  trigger_skill_run_id?: string;
}

export interface WriteBackResult {
  success: boolean;
  crm_record_id: string;
  value_written: any;
  error?: string;
  http_status?: number;
  skip_reason?: string;
}

interface CRMPropertyMapping {
  id: string;
  workspace_id: string;
  crm_type: string;
  pandora_field: string;
  crm_object_type: string;
  crm_property_name: string;
  crm_property_label: string | null;
  crm_field_type: string | null;
  write_mode: string;
  append_separator: string | null;
  append_timestamp_format: string | null;
  append_max_entries: number | null;
  write_condition: string | null;
  value_transform: string;
}

/**
 * Main execution function
 */
export async function executeWriteBack(
  request: WriteBackRequest
): Promise<WriteBackResult> {
  const startTime = Date.now();

  try {
    // 1. Load mapping
    const mappingResult = await query<CRMPropertyMapping>(
      'SELECT * FROM crm_property_mappings WHERE id = $1 AND workspace_id = $2',
      [request.mapping_id, request.workspace_id]
    );

    if (mappingResult.rows.length === 0) {
      return {
        success: false,
        crm_record_id: request.crm_record_id,
        value_written: null,
        error: 'Mapping not found',
      };
    }

    const mapping = mappingResult.rows[0];

    // 2. Resolve Pandora field value
    const pandoraValue = await resolveFieldValue(
      mapping.pandora_field,
      request.crm_record_id,
      request.workspace_id
    );

    if (pandoraValue === null || pandoraValue === undefined) {
      // Skip write - no value available
      await logWrite({
        workspace_id: request.workspace_id,
        mapping_id: mapping.id,
        crm_type: mapping.crm_type,
        crm_object_type: mapping.crm_object_type,
        crm_record_id: request.crm_record_id,
        crm_property_name: mapping.crm_property_name,
        value_written: null,
        trigger_source: request.trigger_source,
        trigger_skill_run_id: request.trigger_skill_run_id,
        status: 'skipped',
        error_message: 'Pandora field value not available',
        http_status_code: null,
        duration_ms: Date.now() - startTime,
      });

      return {
        success: false,
        crm_record_id: request.crm_record_id,
        value_written: null,
        skip_reason: 'value_not_available',
      };
    }

    // 3. Fetch current CRM value if needed for write mode
    let currentCRMValue: any = null;
    if (mapping.write_mode === 'never_overwrite' || mapping.write_mode === 'append' || mapping.write_mode === 'append_if_changed') {
      currentCRMValue = await fetchCurrentCRMValue(
        request.workspace_id,
        mapping.crm_type,
        mapping.crm_object_type,
        request.crm_record_id,
        mapping.crm_property_name
      );
    }

    // 4. Get last written value for append_if_changed
    let lastPandoraWrittenValue: any = null;
    if (mapping.write_mode === 'append_if_changed') {
      const lastWriteResult = await query(
        `SELECT value_written FROM crm_write_log
         WHERE mapping_id = $1 AND crm_record_id = $2 AND status = 'success'
         ORDER BY created_at DESC LIMIT 1`,
        [mapping.id, request.crm_record_id]
      );
      if (lastWriteResult.rows.length > 0) {
        lastPandoraWrittenValue = lastWriteResult.rows[0].value_written;
      }
    }

    // 5. Resolve write value (apply mode, transform, condition)
    const resolution = await resolveWriteValue(
      mapping,
      pandoraValue,
      currentCRMValue,
      lastPandoraWrittenValue
    );

    if (!resolution.shouldWrite) {
      // Skip write based on condition or mode
      await logWrite({
        workspace_id: request.workspace_id,
        mapping_id: mapping.id,
        crm_type: mapping.crm_type,
        crm_object_type: mapping.crm_object_type,
        crm_record_id: request.crm_record_id,
        crm_property_name: mapping.crm_property_name,
        value_written: null,
        trigger_source: request.trigger_source,
        trigger_skill_run_id: request.trigger_skill_run_id,
        status: 'skipped',
        error_message: resolution.skipReason || 'Write condition not met',
        http_status_code: null,
        duration_ms: Date.now() - startTime,
      });

      return {
        success: false,
        crm_record_id: request.crm_record_id,
        value_written: null,
        skip_reason: resolution.skipReason,
      };
    }

    // 6. Execute CRM write
    const writeResult = await writeToCRM(
      request.workspace_id,
      mapping.crm_type,
      mapping.crm_object_type,
      request.crm_record_id,
      mapping.crm_property_name,
      resolution.finalValue
    );

    // 7. Log the write
    await logWrite({
      workspace_id: request.workspace_id,
      mapping_id: mapping.id,
      crm_type: mapping.crm_type,
      crm_object_type: mapping.crm_object_type,
      crm_record_id: request.crm_record_id,
      crm_property_name: mapping.crm_property_name,
      value_written: resolution.finalValue,
      trigger_source: request.trigger_source,
      trigger_skill_run_id: request.trigger_skill_run_id,
      status: writeResult.success ? 'success' : 'error',
      error_message: writeResult.error || null,
      http_status_code: writeResult.http_status || null,
      duration_ms: Date.now() - startTime,
    });

    // 8. Update mapping sync status
    await query(
      `UPDATE crm_property_mappings
       SET last_synced_at = NOW(),
           last_sync_status = $1,
           last_sync_error = $2
       WHERE id = $3`,
      [writeResult.success ? 'success' : 'error', writeResult.error || null, mapping.id]
    );

    return {
      success: writeResult.success,
      crm_record_id: request.crm_record_id,
      value_written: resolution.finalValue,
      error: writeResult.error,
      http_status: writeResult.http_status,
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Write-back execution failed', error, {
      workspace_id: request.workspace_id,
      mapping_id: request.mapping_id,
      crm_record_id: request.crm_record_id,
    });

    return {
      success: false,
      crm_record_id: request.crm_record_id,
      value_written: null,
      error: error.message,
    };
  }
}

/**
 * Batch: write all active mappings for a set of records after a skill run
 */
export async function executeSkillRunWriteBack(
  workspace_id: string,
  skill_name: string,
  skill_run_id: string,
  affected_record_ids: string[], // Pandora internal IDs
): Promise<WriteBackResult[]> {
  logger.info('Executing skill run write-back', {
    workspace_id,
    skill_name,
    skill_run_id,
    record_count: affected_record_ids.length,
  });

  // Get all active mappings for this workspace with after_skill_run trigger
  const mappingsResult = await query<CRMPropertyMapping>(
    `SELECT * FROM crm_property_mappings
     WHERE workspace_id = $1
       AND is_active = true
       AND sync_trigger = 'after_skill_run'`,
    [workspace_id]
  );

  if (mappingsResult.rows.length === 0) {
    logger.info('No active after_skill_run mappings found', { workspace_id });
    return [];
  }

  const results: WriteBackResult[] = [];

  // For each record, execute all applicable mappings
  for (const pandoraId of affected_record_ids) {
    // Resolve CRM record ID from Pandora ID
    const crmRecordId = await resolveCRMRecordId(workspace_id, pandoraId);
    if (!crmRecordId) {
      logger.warn('Could not resolve CRM record ID', { workspace_id, pandoraId });
      continue;
    }

    for (const mapping of mappingsResult.rows) {
      const result = await executeWriteBack({
        workspace_id,
        mapping_id: mapping.id,
        crm_record_id: crmRecordId,
        entity_type: mapping.crm_object_type,
        trigger_source: `skill_run:${skill_name}`,
        trigger_skill_run_id: skill_run_id,
      });

      results.push(result);
    }
  }

  logger.info('Skill run write-back completed', {
    workspace_id,
    skill_run_id,
    total_writes: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  });

  return results;
}

/**
 * Apply write mode, transform, and condition logic
 */
async function resolveWriteValue(
  mapping: CRMPropertyMapping,
  pandoraValue: any,
  currentCRMValue: any,
  lastPandoraWrittenValue: any
): Promise<{ shouldWrite: boolean; finalValue: any; skipReason?: string }> {
  // 1. Apply value_transform first
  let transformed = applyTransform(pandoraValue, mapping.value_transform);

  // 2. Apply write_condition guard
  if (mapping.write_condition) {
    const conditionMet = evaluateCondition(mapping.write_condition, transformed, lastPandoraWrittenValue);
    if (!conditionMet) {
      return {
        shouldWrite: false,
        finalValue: null,
        skipReason: `condition_not_met: ${mapping.write_condition}`,
      };
    }
  }

  // 3. Apply write_mode
  switch (mapping.write_mode) {
    case 'overwrite':
      // Always write. No current value check needed.
      return { shouldWrite: true, finalValue: transformed };

    case 'never_overwrite':
      // Only write if current CRM value is blank/null/empty string
      const isBlank = currentCRMValue === null || currentCRMValue === undefined || currentCRMValue === '';
      if (!isBlank) {
        return {
          shouldWrite: false,
          finalValue: null,
          skipReason: 'never_overwrite: field_already_has_value',
        };
      }
      return { shouldWrite: true, finalValue: transformed };

    case 'append':
      // For numeric fields, fall back to overwrite (can't meaningfully append numbers)
      if (mapping.crm_field_type === 'number') {
        return { shouldWrite: true, finalValue: transformed };
      }
      const appendedValue = buildAppendValue(
        currentCRMValue,
        transformed,
        mapping.append_separator || '\n---\n',
        mapping.append_timestamp_format || 'prefix',
        mapping.append_max_entries
      );
      return { shouldWrite: true, finalValue: appendedValue };

    case 'append_if_changed':
      // Only append if the new value differs from the last value Pandora wrote
      if (transformed === lastPandoraWrittenValue) {
        return {
          shouldWrite: false,
          finalValue: null,
          skipReason: 'append_if_changed: value_unchanged',
        };
      }
      if (mapping.crm_field_type === 'number') {
        return { shouldWrite: true, finalValue: transformed };
      }
      const appendedIfChanged = buildAppendValue(
        currentCRMValue,
        transformed,
        mapping.append_separator || '\n---\n',
        mapping.append_timestamp_format || 'prefix',
        mapping.append_max_entries
      );
      return { shouldWrite: true, finalValue: appendedIfChanged };

    default:
      return { shouldWrite: true, finalValue: transformed };
  }
}

/**
 * Build appended value with timestamp and entry limit
 */
function buildAppendValue(
  existing: string | null,
  newValue: string,
  separator: string,
  timestampFormat: string,
  maxEntries: number | null
): string {
  // Format the new entry with timestamp
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  let entry: string;
  switch (timestampFormat) {
    case 'prefix':
      entry = `[${dateLabel}] ${newValue}`;
      break;
    case 'suffix':
      entry = `${newValue} (${dateLabel})`;
      break;
    case 'none':
      entry = newValue;
      break;
    default:
      entry = newValue;
  }

  if (!existing || existing.trim() === '') {
    return entry;
  }

  const combined = `${existing}${separator}${entry}`;

  // Enforce maxEntries by trimming oldest Pandora-written blocks
  if (maxEntries !== null) {
    const parts = combined.split(separator);
    if (parts.length > maxEntries) {
      return parts.slice(parts.length - maxEntries).join(separator);
    }
  }

  return combined;
}

/**
 * Apply value transformations
 */
function applyTransform(value: any, transform: string): any {
  if (transform === 'raw' || !transform) {
    return value;
  }

  const [transformType, ...params] = transform.split(':');

  switch (transformType) {
    case 'truncate': {
      const maxLen = parseInt(params[0], 10);
      return String(value).substring(0, maxLen);
    }

    case 'round': {
      const decimals = parseInt(params[0], 10);
      const num = typeof value === 'number' ? value : parseFloat(value);
      return isNaN(num) ? value : Number(num.toFixed(decimals));
    }

    case 'date_only': {
      const date = new Date(value);
      return isNaN(date.getTime()) ? value : date.toISOString().split('T')[0];
    }

    case 'uppercase':
      return String(value).toUpperCase();

    case 'score_label': {
      const score = typeof value === 'number' ? value : parseFloat(value);
      if (isNaN(score)) return value;
      if (score >= 90) return 'Excellent';
      if (score >= 70) return 'Good';
      if (score >= 50) return 'Fair';
      return 'At Risk';
    }

    default:
      return value;
  }
}

/**
 * Evaluate write conditions
 */
function evaluateCondition(condition: string, value: any, lastValue: any): boolean {
  const [conditionType, ...params] = condition.split(':');

  switch (conditionType) {
    case 'score_above': {
      const threshold = parseFloat(params[0]);
      const score = typeof value === 'number' ? value : parseFloat(value);
      return !isNaN(score) && score > threshold;
    }

    case 'score_below': {
      const threshold = parseFloat(params[0]);
      const score = typeof value === 'number' ? value : parseFloat(value);
      return !isNaN(score) && score < threshold;
    }

    case 'score_changed_by': {
      const threshold = parseFloat(params[0]);
      const current = typeof value === 'number' ? value : parseFloat(value);
      const last = typeof lastValue === 'number' ? lastValue : parseFloat(lastValue);
      if (isNaN(current) || isNaN(last)) return true;
      return Math.abs(current - last) >= threshold;
    }

    case 'field_is_blank':
      return value === null || value === undefined || value === '';

    default:
      return true;
  }
}

/**
 * Resolve Pandora field value for a given CRM record
 */
async function resolveFieldValue(
  pandoraField: string,
  crmRecordId: string,
  workspaceId: string
): Promise<any> {
  try {
    switch (pandoraField) {
      case 'deal_score':
      case 'enhanced_deal_score': {
        const result = await query(
          'SELECT health_score FROM deals WHERE source_id = $1 AND workspace_id = $2',
          [crmRecordId, workspaceId]
        );
        return result.rows[0]?.health_score || null;
      }

      case 'account_score':
      case 'enhanced_account_score': {
        const result = await query(
          'SELECT health_score FROM accounts WHERE source_id = $1 AND workspace_id = $2',
          [crmRecordId, workspaceId]
        );
        return result.rows[0]?.health_score || null;
      }

      case 'account_signals_text': {
        // Would need to query skill output or computed field
        // Placeholder for now
        return null;
      }

      case 'deal_risk_summary':
      case 'next_step_recommendation': {
        // Would need to query skill output
        // Placeholder for now
        return null;
      }

      case 'pandora_last_analyzed_at': {
        const result = await query(
          `SELECT MAX(created_at) as last_analyzed
           FROM skill_runs
           WHERE workspace_id = $1 AND status = 'completed'`,
          [workspaceId]
        );
        return result.rows[0]?.last_analyzed?.toISOString() || null;
      }

      default:
        return null;
    }
  } catch (err) {
    logger.error('Failed to resolve field value', err as Error, { pandoraField, crmRecordId });
    return null;
  }
}

/**
 * Fetch current value of a CRM field
 */
async function fetchCurrentCRMValue(
  workspaceId: string,
  crmType: string,
  objectType: string,
  recordId: string,
  propertyName: string
): Promise<any> {
  try {
    const creds = await getConnectorCredentials(workspaceId, crmType);
    if (!creds?.accessToken) {
      throw new Error(`${crmType} credentials not found`);
    }

    if (crmType === 'hubspot') {
      const hsObjectType = objectType === 'deal' ? 'deals' : objectType === 'company' ? 'companies' : 'contacts';
      const response = await fetch(
        `https://api.hubapi.com/crm/v3/objects/${hsObjectType}/${recordId}?properties=${propertyName}`,
        {
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HubSpot fetch failed: ${response.status}`);
      }

      const data = await response.json() as { properties: Record<string, any> };
      return data.properties[propertyName] || null;
    } else if (crmType === 'salesforce') {
      const sfObject = objectType === 'deal' ? 'Opportunity' : objectType === 'company' ? 'Account' : 'Contact';
      const response = await fetch(
        `${creds.instanceUrl}/services/data/v62.0/sobjects/${sfObject}/${recordId}?fields=${propertyName}`,
        {
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Salesforce fetch failed: ${response.status}`);
      }

      const data = await response.json() as Record<string, any>;
      return data[propertyName] || null;
    }

    return null;
  } catch (err) {
    logger.error('Failed to fetch current CRM value', err as Error, { workspaceId, objectType, recordId });
    return null;
  }
}

/**
 * Write value to CRM
 */
async function writeToCRM(
  workspaceId: string,
  crmType: string,
  objectType: string,
  recordId: string,
  propertyName: string,
  value: any
): Promise<{ success: boolean; error?: string; http_status?: number }> {
  try {
    if (crmType === 'hubspot') {
      const result = await updateHubSpotDeal(
        workspaceId,
        recordId,
        { [propertyName]: String(value) },
        { triggeredBy: 'crm_writeback' }
      );
      return {
        success: result.success,
        error: result.error,
      };
    } else if (crmType === 'salesforce') {
      const result = await updateSalesforceDeal(
        workspaceId,
        recordId,
        { [propertyName]: value },
        { triggeredBy: 'crm_writeback' }
      );
      return {
        success: result.success,
        error: result.error,
      };
    }

    return { success: false, error: 'Unsupported CRM type' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Log write operation
 */
async function logWrite(params: {
  workspace_id: string;
  mapping_id: string;
  crm_type: string;
  crm_object_type: string;
  crm_record_id: string;
  crm_property_name: string;
  value_written: any;
  trigger_source: string;
  trigger_skill_run_id?: string;
  status: string;
  error_message: string | null;
  http_status_code: number | null;
  duration_ms: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO crm_write_log
        (workspace_id, mapping_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
         value_written, trigger_source, trigger_skill_run_id, status, error_message, http_status_code, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        params.workspace_id,
        params.mapping_id,
        params.crm_type,
        params.crm_object_type,
        params.crm_record_id,
        params.crm_property_name,
        params.value_written ? JSON.stringify(params.value_written) : null,
        params.trigger_source,
        params.trigger_skill_run_id || null,
        params.status,
        params.error_message,
        params.http_status_code,
        params.duration_ms,
      ]
    );
  } catch (err) {
    logger.error('Failed to log write', err as Error);
  }
}

/**
 * Resolve CRM record ID from Pandora internal ID
 */
async function resolveCRMRecordId(workspaceId: string, pandoraId: string): Promise<string | null> {
  try {
    // Try deals first
    let result = await query(
      'SELECT source_id FROM deals WHERE id = $1 AND workspace_id = $2',
      [pandoraId, workspaceId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].source_id;
    }

    // Try accounts
    result = await query(
      'SELECT source_id FROM accounts WHERE id = $1 AND workspace_id = $2',
      [pandoraId, workspaceId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].source_id;
    }

    // Try contacts
    result = await query(
      'SELECT source_id FROM contacts WHERE id = $1 AND workspace_id = $2',
      [pandoraId, workspaceId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].source_id;
    }

    return null;
  } catch (err) {
    logger.error('Failed to resolve CRM record ID', err as Error, { pandoraId });
    return null;
  }
}
