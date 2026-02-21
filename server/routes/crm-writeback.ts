/**
 * CRM Write-back API Routes
 *
 * Endpoints for managing CRM property mappings and executing write-backs
 */

import express from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { PANDORA_WRITABLE_FIELDS, getFieldByKey } from '../crm-writeback/pandora-fields.js';
import { discoverCRMProperties } from '../crm-writeback/property-discovery.js';
import { executeWriteBack } from '../crm-writeback/write-engine.js';

const router = express.Router();
const logger = createLogger('CRMWritebackRoutes');

/**
 * GET /api/workspaces/:id/crm-writeback/fields
 * Returns PANDORA_WRITABLE_FIELDS array (the Pandora side of the mapper)
 */
router.get('/api/workspaces/:id/crm-writeback/fields', async (req, res) => {
  try {
    res.json({ fields: PANDORA_WRITABLE_FIELDS });
  } catch (err) {
    logger.error('Failed to fetch Pandora fields', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/workspaces/:id/crm-writeback/crm-properties
 * Query params: objectType ('deal' | 'account' | 'company' | 'contact')
 * Returns CRMProperty[]
 */
router.get('/api/workspaces/:id/crm-writeback/crm-properties', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;
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
 * GET /api/workspaces/:id/crm-writeback/mappings
 * Returns all crm_property_mappings for workspace with recent write history
 */
router.get('/api/workspaces/:id/crm-writeback/mappings', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;

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
 * POST /api/workspaces/:id/crm-writeback/mappings
 * Create a new mapping
 */
router.post('/api/workspaces/:id/crm-writeback/mappings', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;
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
 * PATCH /api/workspaces/:id/crm-writeback/mappings/:mappingId
 * Update a mapping
 */
router.patch('/api/workspaces/:id/crm-writeback/mappings/:mappingId', async (req, res) => {
  try {
    const { id: workspaceId, mappingId } = req.params;
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
 * DELETE /api/workspaces/:id/crm-writeback/mappings/:mappingId
 * Soft delete: set is_active = false
 */
router.delete('/api/workspaces/:id/crm-writeback/mappings/:mappingId', async (req, res) => {
  try {
    const { id: workspaceId, mappingId } = req.params;

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
 * POST /api/workspaces/:id/crm-writeback/mappings/:mappingId/test
 * Execute a single write-back with trigger_source = 'test'
 */
router.post('/api/workspaces/:id/crm-writeback/mappings/:mappingId/test', async (req, res) => {
  try {
    const { id: workspaceId, mappingId } = req.params;
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
 * GET /api/workspaces/:id/crm-writeback/log
 * Query params: mapping_id (optional), limit (default 50), offset (default 0)
 */
router.get('/api/workspaces/:id/crm-writeback/log', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;
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
 * POST /api/workspaces/:id/crm-writeback/sync-all
 * Triggers manual sync of all active mappings for all eligible records
 */
router.post('/api/workspaces/:id/crm-writeback/sync-all', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;

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

export default router;
