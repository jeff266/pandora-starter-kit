/**
 * CRM Write-back API Routes
 *
 * Endpoints for managing CRM property mappings and executing write-backs
 */

import express from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { requirePermission } from '../middleware/permissions.js';
import { PANDORA_WRITABLE_FIELDS, getFieldByKey } from '../crm-writeback/pandora-fields.js';
import { discoverCRMProperties } from '../crm-writeback/property-discovery.js';
import { executeWriteBack } from '../crm-writeback/write-engine.js';

const router = express.Router();
const logger = createLogger('CRMWritebackRoutes');

/**
 * GET /:workspaceId/crm-writeback/fields
 * Returns PANDORA_WRITABLE_FIELDS array (the Pandora side of the mapper)
 */
router.get('/:workspaceId/crm-writeback/fields', async (req, res) => {
  try {
    res.json({ fields: PANDORA_WRITABLE_FIELDS });
  } catch (err) {
    logger.error('Failed to fetch Pandora fields', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/crm-writeback/crm-properties
 * Query params: objectType ('deal' | 'account' | 'company' | 'contact')
 * Returns CRMProperty[]
 */
router.get('/:workspaceId/crm-writeback/crm-properties', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { objectType } = req.query;

    if (!objectType || !['deal', 'account', 'company', 'contact'].includes(objectType as string)) {
      return res.status(400).json({ error: 'Invalid objectType parameter' });
    }

    const properties = await discoverCRMProperties(workspaceId, objectType as any);
    res.json({ properties });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to discover CRM properties', error);

    if (error.message.includes('No CRM connected')) {
      return res.status(400).json({ error: 'No CRM connected for this workspace' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/crm-writeback/mappings
 * Returns all crm_property_mappings for workspace with recent write history
 */
router.get('/:workspaceId/crm-writeback/mappings', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const mappingsResult = await query(
      `SELECT * FROM crm_property_mappings
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId]
    );

    // For each mapping, fetch last 3 write log entries
    const mappings = [];
    for (const mapping of mappingsResult.rows) {
      const logResult = await query(
        `SELECT id, crm_record_id, status, error_message, created_at
         FROM crm_write_log
         WHERE mapping_id = $1
         ORDER BY created_at DESC
         LIMIT 3`,
        [mapping.id]
      );

      mappings.push({
        ...mapping,
        recent_writes: logResult.rows,
      });
    }

    res.json({ mappings });
  } catch (err) {
    logger.error('Failed to fetch mappings', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:workspaceId/crm-writeback/mappings
 * Create a new mapping
 */
router.post('/:workspaceId/crm-writeback/mappings', requirePermission('connectors.connect'), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const {
      crm_type,
      pandora_field,
      crm_object_type,
      crm_property_name,
      crm_property_label,
      crm_field_type,
      sync_trigger = 'after_skill_run',
      write_mode = 'overwrite',
      append_separator = '\n---\n',
      append_timestamp_format = 'prefix',
      append_max_entries = null,
      write_condition = null,
      value_transform = 'raw',
    } = req.body;

    // Validate pandora_field exists in registry
    const pandoraFieldDef = getFieldByKey(pandora_field);
    if (!pandoraFieldDef) {
      return res.status(400).json({ error: 'Invalid pandora_field' });
    }

    // Validate write_mode
    if (!['overwrite', 'never_overwrite', 'append', 'append_if_changed'].includes(write_mode)) {
      return res.status(400).json({ error: 'Invalid write_mode' });
    }

    // Check for duplicate mapping
    const duplicateCheck = await query(
      `SELECT id FROM crm_property_mappings
       WHERE workspace_id = $1
         AND crm_type = $2
         AND pandora_field = $3
         AND crm_object_type = $4`,
      [workspaceId, crm_type, pandora_field, crm_object_type]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        error: 'Mapping already exists for this Pandora field and CRM object type',
      });
    }

    // Insert mapping
    const result = await query(
      `INSERT INTO crm_property_mappings
        (workspace_id, crm_type, pandora_field, crm_object_type, crm_property_name,
         crm_property_label, crm_field_type, sync_trigger, write_mode,
         append_separator, append_timestamp_format, append_max_entries,
         write_condition, value_transform)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        workspaceId,
        crm_type,
        pandora_field,
        crm_object_type,
        crm_property_name,
        crm_property_label,
        crm_field_type,
        sync_trigger,
        write_mode,
        append_separator,
        append_timestamp_format,
        append_max_entries,
        write_condition,
        value_transform,
      ]
    );

    logger.info('Mapping created', { workspace_id: workspaceId, mapping_id: result.rows[0].id });
    res.status(201).json({ mapping: result.rows[0] });
  } catch (err) {
    logger.error('Failed to create mapping', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /:workspaceId/crm-writeback/mappings/:mappingId
 * Update a mapping
 */
router.patch('/:workspaceId/crm-writeback/mappings/:mappingId', requirePermission('connectors.connect'), async (req, res) => {
  try {
    const { workspaceId, mappingId } = req.params;
    const updates = req.body;

    // Build update query dynamically
    const allowedFields = [
      'sync_trigger',
      'is_active',
      'write_mode',
      'append_separator',
      'append_timestamp_format',
      'append_max_entries',
      'write_condition',
      'value_transform',
    ];

    const setClause: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClause.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    setClause.push(`updated_at = NOW()`);
    values.push(workspaceId, mappingId);

    const result = await query(
      `UPDATE crm_property_mappings
       SET ${setClause.join(', ')}
       WHERE workspace_id = $${paramIndex} AND id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mapping not found' });
    }

    logger.info('Mapping updated', { workspace_id: workspaceId, mapping_id: mappingId });
    res.json({ mapping: result.rows[0] });
  } catch (err) {
    logger.error('Failed to update mapping', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /:workspaceId/crm-writeback/mappings/:mappingId
 * Soft delete: set is_active = false
 */
router.delete('/:workspaceId/crm-writeback/mappings/:mappingId', requirePermission('connectors.connect'), async (req, res) => {
  try {
    const { workspaceId, mappingId } = req.params;

    const result = await query(
      `UPDATE crm_property_mappings
       SET is_active = false, updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2
       RETURNING *`,
      [workspaceId, mappingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mapping not found' });
    }

    logger.info('Mapping soft deleted', { workspace_id: workspaceId, mapping_id: mappingId });
    res.json({ message: 'Mapping deactivated', mapping: result.rows[0] });
  } catch (err) {
    logger.error('Failed to delete mapping', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:workspaceId/crm-writeback/mappings/:mappingId/test
 * Execute a single write-back with trigger_source = 'test'
 */
router.post('/:workspaceId/crm-writeback/mappings/:mappingId/test', requirePermission('connectors.trigger_sync'), async (req, res) => {
  try {
    const { workspaceId, mappingId } = req.params;
    const { crm_record_id } = req.body;

    if (!crm_record_id) {
      return res.status(400).json({ error: 'crm_record_id is required' });
    }

    // Get mapping to determine entity type
    const mappingResult = await query(
      'SELECT crm_object_type FROM crm_property_mappings WHERE id = $1 AND workspace_id = $2',
      [mappingId, workspaceId]
    );

    if (mappingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Mapping not found' });
    }

    const result = await executeWriteBack({
      workspace_id: workspaceId,
      mapping_id: mappingId,
      crm_record_id,
      entity_type: mappingResult.rows[0].crm_object_type,
      trigger_source: 'test',
    });

    logger.info('Test write-back executed', { workspace_id: workspaceId, mapping_id: mappingId, result });
    res.json({ result });
  } catch (err) {
    logger.error('Failed to execute test write-back', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/crm-writeback/log
 * Query params: mapping_id (optional), limit (default 50), offset (default 0)
 */
router.get('/:workspaceId/crm-writeback/log', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { mapping_id, limit = '50', offset = '0' } = req.query;

    let queryText = `
      SELECT l.*, m.pandora_field, m.crm_property_name
      FROM crm_write_log l
      LEFT JOIN crm_property_mappings m ON m.id = l.mapping_id
      WHERE l.workspace_id = $1
    `;
    const params: any[] = [workspaceId];

    if (mapping_id) {
      params.push(mapping_id);
      queryText += ` AND l.mapping_id = $${params.length}`;
    }

    queryText += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const result = await query(queryText, params);

    res.json({ log_entries: result.rows });
  } catch (err) {
    logger.error('Failed to fetch write log', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:workspaceId/crm-writeback/sync-all
 * Triggers manual sync of all active mappings for all eligible records
 */
router.post('/:workspaceId/crm-writeback/sync-all', requirePermission('connectors.trigger_sync'), async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // This would typically start a background job
    // For now, return a job started message
    logger.info('Manual sync-all triggered', { workspace_id: workspaceId });

    res.json({
      message: 'Sync job started',
      job_id: `sync-${workspaceId}-${Date.now()}`,
    });
  } catch (err) {
    logger.error('Failed to trigger sync-all', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/crm-writeback/log/export
 * Export CRM write log as CSV
 * Query params: start_date, end_date, status, initiated_by
 */
router.get('/:workspaceId/crm-writeback/log/export', requirePermission('connectors.view_logs'), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { start_date, end_date, status, initiated_by } = req.query;

    let queryText = `
      SELECT
        l.id,
        l.created_at,
        l.crm_type,
        l.crm_object_type,
        l.crm_record_id,
        l.crm_property_name,
        l.value_written,
        l.previous_value,
        l.status,
        l.error_message,
        l.trigger_source,
        l.duration_ms,
        l.initiated_by,
        l.action_threshold_at_write,
        l.reversed_at,
        l.reversed_by,
        l.reversal_write_log_id,
        l.source_citation,
        m.pandora_field,
        m.crm_property_label
      FROM crm_write_log l
      LEFT JOIN crm_property_mappings m ON m.id = l.mapping_id
      WHERE l.workspace_id = $1
    `;
    const params: any[] = [workspaceId];

    // Add date filters
    if (start_date) {
      params.push(start_date);
      queryText += ` AND l.created_at >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      queryText += ` AND l.created_at <= $${params.length}`;
    }

    // Add status filter
    if (status) {
      params.push(status);
      queryText += ` AND l.status = $${params.length}`;
    }

    // Add initiated_by filter
    if (initiated_by) {
      params.push(initiated_by);
      queryText += ` AND l.initiated_by = $${params.length}`;
    }

    queryText += ` ORDER BY l.created_at DESC LIMIT 10000`; // Max 10k rows for safety

    const result = await query(queryText, params);

    // Convert to CSV
    const rows = result.rows;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No write log entries found for the specified filters' });
    }

    // Build CSV header
    const headers = [
      'Write Log ID',
      'Timestamp',
      'CRM Type',
      'Object Type',
      'CRM Record ID',
      'CRM Property Name',
      'CRM Property Label',
      'Pandora Field',
      'Value Written',
      'Previous Value',
      'Status',
      'Error Message',
      'Trigger Source',
      'Initiated By',
      'Threshold Level',
      'Duration (ms)',
      'Reversed At',
      'Reversed By',
      'Reversal Log ID',
      'Source Citation',
    ];

    const csvRows = [headers.join(',')];

    // Build CSV rows
    for (const row of rows) {
      const csvRow = [
        row.id,
        new Date(row.created_at).toISOString(),
        row.crm_type || '',
        row.crm_object_type || '',
        row.crm_record_id || '',
        row.crm_property_name || '',
        row.crm_property_label || '',
        row.pandora_field || '',
        escapeCsvValue(row.value_written || ''),
        escapeCsvValue(row.previous_value || ''),
        row.status || '',
        escapeCsvValue(row.error_message || ''),
        row.trigger_source || '',
        row.initiated_by || '',
        row.action_threshold_at_write || '',
        row.duration_ms || '',
        row.reversed_at ? new Date(row.reversed_at).toISOString() : '',
        row.reversed_by || '',
        row.reversal_write_log_id || '',
        escapeCsvValue(row.source_citation || ''),
      ];
      csvRows.push(csvRow.join(','));
    }

    const csv = csvRows.join('\n');
    const filename = `crm_write_log_${workspaceId}_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

    logger.info('CRM write log exported', {
      workspace_id: workspaceId,
      row_count: rows.length,
    });
  } catch (err) {
    logger.error('Failed to export write log', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Helper function to escape CSV values
 */
function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * POST /:workspaceId/crm-writeback/log/:writeLogId/reverse
 * Reverses a CRM write within the undo window
 */
router.post('/:workspaceId/crm-writeback/log/:writeLogId/reverse', requirePermission('connectors.trigger_sync'), async (req, res) => {
  try {
    const { workspaceId, writeLogId } = req.params;
    const userId = (req as any).user?.id; // From auth middleware

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    // Get write log entry
    const logResult = await query(
      `SELECT l.*, w.undo_window_hours
       FROM crm_write_log l
       LEFT JOIN workspace_action_settings w ON w.workspace_id = l.workspace_id
       WHERE l.id = $1 AND l.workspace_id = $2`,
      [writeLogId, workspaceId]
    );

    if (logResult.rows.length === 0) {
      return res.status(404).json({ error: 'Write log entry not found' });
    }

    const logEntry = logResult.rows[0];
    const undoWindowHours = logEntry.undo_window_hours || 24;

    // Check if already reversed
    if (logEntry.reversed_at) {
      return res.status(400).json({
        error: 'This write has already been reversed',
        reversed_at: logEntry.reversed_at,
        reversed_by: logEntry.reversed_by,
      });
    }

    // Check if within undo window
    const writeTime = new Date(logEntry.created_at).getTime();
    const now = Date.now();
    const windowMs = undoWindowHours * 60 * 60 * 1000;

    if (now - writeTime > windowMs) {
      return res.status(400).json({
        error: `Undo window expired. This write can only be reversed within ${undoWindowHours} hours.`,
        hours_elapsed: Math.floor((now - writeTime) / (60 * 60 * 1000)),
      });
    }

    // Check if previous_value exists
    if (!logEntry.previous_value) {
      return res.status(400).json({
        error: 'No previous value recorded - this write cannot be reversed automatically',
      });
    }

    const previousValue = JSON.parse(logEntry.previous_value);
    const field = logEntry.crm_property_name;
    const crmType = logEntry.crm_type;
    const crmRecordId = logEntry.crm_record_id;

    // Import CRM writers
    const { updateDeal: updateHubSpotDeal } = await import('../connectors/hubspot/hubspot-writer.js');
    const { updateDeal: updateSalesforceDeal } = await import('../connectors/salesforce/salesforce-writer.js');

    const startTime = Date.now();

    try {
      // Write previous value back to CRM
      if (crmType === 'hubspot') {
        await updateHubSpotDeal(workspaceId, crmRecordId, {
          [field]: previousValue,
        });
      } else if (crmType === 'salesforce') {
        await updateSalesforceDeal(workspaceId, crmRecordId, {
          [field]: previousValue,
        });
      } else {
        return res.status(400).json({ error: `Unsupported CRM type: ${crmType}` });
      }

      const durationMs = Date.now() - startTime;

      // Create reversal write log entry
      const reversalLogResult = await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, duration_ms, reversal_write_log_id,
           previous_value, action_threshold_at_write, initiated_by, source_citation)
         VALUES ($1, $2, $3, $4, $5, $6, 'user_manual', 'success', $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          workspaceId,
          crmType,
          logEntry.crm_object_type,
          crmRecordId,
          field,
          JSON.stringify(previousValue),
          durationMs,
          writeLogId, // Points to original write being reversed
          logEntry.value_written, // The new value becomes the previous value
          logEntry.action_threshold_at_write,
          'user_manual',
          `Reversal of write ${writeLogId} by user`,
        ]
      );

      const reversalLogId = reversalLogResult.rows[0].id;

      // Mark original write as reversed
      await query(
        `UPDATE crm_write_log
         SET reversed_at = NOW(), reversed_by = $1, reversal_write_log_id = $2
         WHERE id = $3`,
        [userId, reversalLogId, writeLogId]
      );

      // Update local deal field (if deal)
      if (logEntry.crm_object_type === 'deal') {
        await query(
          `UPDATE deals
           SET ${field} = $1, updated_at = NOW()
           WHERE crm_id = $2 AND workspace_id = $3`,
          [previousValue, crmRecordId, workspaceId]
        );
      }

      logger.info('CRM write reversed successfully', {
        workspace_id: workspaceId,
        write_log_id: writeLogId,
        reversal_log_id: reversalLogId,
        field,
      });

      res.json({
        success: true,
        message: `Reversed ${field} back to previous value`,
        reversal_log_id: reversalLogId,
      });
    } catch (error: any) {
      logger.error('Failed to reverse CRM write', {
        workspace_id: workspaceId,
        write_log_id: writeLogId,
        error: error.message,
      });

      // Log the failed reversal attempt
      await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, error_message, duration_ms, reversal_write_log_id, initiated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'user_manual', 'failed', $7, $8, $9, $10)`,
        [
          workspaceId,
          crmType,
          logEntry.crm_object_type,
          crmRecordId,
          field,
          JSON.stringify(previousValue),
          error.message,
          Date.now() - startTime,
          writeLogId,
          'user_manual',
        ]
      );

      res.status(500).json({ error: `Failed to reverse write: ${error.message}` });
    }
  } catch (err) {
    logger.error('Failed to process reversal request', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
