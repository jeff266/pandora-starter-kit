/**
 * Editable Deal Fields API Routes
 *
 * Endpoints for configuring which CRM fields should be editable on Deal Detail page
 */

import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { requirePermission } from '../middleware/permissions.js';
import { suggestEditableFields } from '../analysis/field-suggestions.js';
import { discoverCRMProperties } from '../crm-writeback/property-discovery.js';
import { updateDeal as updateHubSpotDeal } from '../connectors/hubspot/hubspot-writer.js';
import { updateDeal as updateSalesforceDeal } from '../connectors/salesforce/salesforce-writer.js';

// Curated list of user-editable deals columns when no CRM is connected
const DEALS_COLUMN_FALLBACK = [
  { field_name: 'name',              label: 'Deal Name',          crm_property_name: 'name',              field_type: 'text' },
  { field_name: 'amount',            label: 'Amount',             crm_property_name: 'amount',            field_type: 'number' },
  { field_name: 'stage',             label: 'Stage',              crm_property_name: 'dealstage',         field_type: 'text' },
  { field_name: 'close_date',        label: 'Close Date',         crm_property_name: 'closedate',         field_type: 'date' },
  { field_name: 'owner',             label: 'Owner',              crm_property_name: 'hubspot_owner_id',  field_type: 'text' },
  { field_name: 'probability',       label: 'Probability',        crm_property_name: 'hs_deal_stage_probability', field_type: 'number' },
  { field_name: 'forecast_category', label: 'Forecast Category',  crm_property_name: 'hs_forecast_category', field_type: 'text' },
  { field_name: 'pipeline',          label: 'Pipeline',           crm_property_name: 'pipeline',          field_type: 'text' },
  { field_name: 'next_steps',        label: 'Next Steps',         crm_property_name: 'hs_next_step',      field_type: 'textarea' },
  { field_name: 'lead_source',       label: 'Lead Source',        crm_property_name: 'leadsource',        field_type: 'text' },
];

const router = Router();
const logger = createLogger('EditableFieldsRoutes');

// Columns that exist as dedicated top-level columns in the deals table.
// Everything else lives in custom_fields (JSONB).
const NATIVE_DEAL_COLUMNS = new Set([
  'name', 'amount', 'stage', 'close_date', 'owner', 'probability',
  'forecast_category', 'pipeline', 'next_steps', 'lead_source',
  'narrative', 'scope_id',
]);

/**
 * GET /:workspaceId/editable-fields/suggestions
 * Returns AI-powered field suggestions
 */
router.get('/:workspaceId/editable-fields/suggestions',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;

      const suggestions = await suggestEditableFields(workspaceId, limit);

      res.json({ suggestions });
    } catch (err) {
      logger.error('Failed to generate field suggestions', err as Error);
      res.status(500).json({ error: 'Failed to generate suggestions' });
    }
});

/**
 * GET /:workspaceId/editable-fields/deal-properties
 * Returns available CRM deal properties for the CRM property picker.
 * Uses live CRM discovery when a CRM is connected; falls back to a curated
 * list of Pandora deals-table columns otherwise.
 */
router.get('/:workspaceId/editable-fields/deal-properties',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req.params;
    try {
      const crmProperties = await discoverCRMProperties(workspaceId, 'deal');
      const properties = crmProperties.map((p) => ({
        field_name: p.name,
        label: p.label,
        crm_property_name: p.name,
        field_type: p.type,
        options: p.options ?? null,
      }));
      res.json({ properties, source: 'crm' });
    } catch {
      res.json({ properties: DEALS_COLUMN_FALLBACK, source: 'fallback' });
    }
  }
);

/**
 * GET /:workspaceId/editable-fields
 * Returns all editable field configurations for workspace
 */
router.get('/:workspaceId/editable-fields',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params;

      const result = await query(
        `SELECT * FROM editable_deal_fields
         WHERE workspace_id = $1 AND is_editable = true
         ORDER BY display_order ASC`,
        [workspaceId]
      );

      res.json({ fields: result.rows });
    } catch (err) {
      logger.error('Failed to fetch editable fields', err as Error);
      res.status(500).json({ error: 'Failed to fetch editable fields' });
    }
});

/**
 * POST /:workspaceId/editable-fields
 * Create a new editable field configuration
 */
router.post('/:workspaceId/editable-fields',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params;
      const userId = (req as any).user?.user_id;
      const {
        field_name,
        field_label,
        field_type,
        crm_property_name,
        crm_property_label,
        is_required,
        help_text,
        field_options,
      } = req.body;

      if (!field_name || !field_label || !field_type || !crm_property_name) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      // Check for duplicate
      const existing = await query(
        'SELECT id FROM editable_deal_fields WHERE workspace_id = $1 AND field_name = $2',
        [workspaceId, field_name]
      );

      if (existing.rows.length > 0) {
        res.status(400).json({ error: 'Field already configured' });
        return;
      }

      // Get next display order
      const orderResult = await query(
        'SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM editable_deal_fields WHERE workspace_id = $1',
        [workspaceId]
      );
      const displayOrder = orderResult.rows[0]?.next_order || 1;

      // Insert new field
      const result = await query(
        `INSERT INTO editable_deal_fields
          (workspace_id, field_name, field_label, field_type, crm_property_name,
           crm_property_label, is_required, help_text, display_order, created_by_user_id,
           field_options)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          workspaceId,
          field_name,
          field_label,
          field_type,
          crm_property_name,
          crm_property_label || null,
          is_required || false,
          help_text || null,
          displayOrder,
          userId || null,
          field_options ? JSON.stringify(field_options) : null,
        ]
      );

      logger.info('Editable field created', {
        workspace_id: workspaceId,
        field_name,
        field_id: result.rows[0].id
      });

      res.status(201).json({ field: result.rows[0] });
    } catch (err) {
      logger.error('Failed to create editable field', err as Error);
      res.status(500).json({ error: 'Failed to create editable field' });
    }
});

/**
 * PATCH /:workspaceId/editable-fields/:fieldId
 * Update an editable field configuration
 */
router.patch('/:workspaceId/editable-fields/:fieldId',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, fieldId } = req.params;
      const updates = req.body;

      const allowedFields = [
        'field_label',
        'field_type',
        'is_editable',
        'is_required',
        'display_order',
        'help_text',
      ];

      const setClause: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (key === 'field_options') {
          setClause.push(`field_options = $${paramIndex}`);
          values.push(value !== null && value !== undefined ? JSON.stringify(value) : null);
          paramIndex++;
        } else if (allowedFields.includes(key)) {
          setClause.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setClause.length === 0) {
        res.status(400).json({ error: 'No valid fields to update' });
        return;
      }

      values.push(workspaceId, fieldId);

      const result = await query(
        `UPDATE editable_deal_fields
         SET ${setClause.join(', ')}
         WHERE workspace_id = $${paramIndex} AND id = $${paramIndex + 1}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Field not found' });
        return;
      }

      logger.info('Editable field updated', { workspace_id: workspaceId, field_id: fieldId });
      res.json({ field: result.rows[0] });
    } catch (err) {
      logger.error('Failed to update editable field', err as Error);
      res.status(500).json({ error: 'Failed to update editable field' });
    }
});

/**
 * DELETE /:workspaceId/editable-fields/:fieldId
 * Delete (hard delete) an editable field configuration
 */
router.delete('/:workspaceId/editable-fields/:fieldId',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, fieldId } = req.params;

      const result = await query(
        'DELETE FROM editable_deal_fields WHERE workspace_id = $1 AND id = $2 RETURNING id',
        [workspaceId, fieldId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Field not found' });
        return;
      }

      logger.info('Editable field deleted', { workspace_id: workspaceId, field_id: fieldId });
      res.json({ success: true });
    } catch (err) {
      logger.error('Failed to delete editable field', err as Error);
      res.status(500).json({ error: 'Failed to delete editable field' });
    }
});

/**
 * POST /:workspaceId/editable-fields/reorder
 * Bulk update display order
 */
router.post('/:workspaceId/editable-fields/reorder',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params;
      const { field_ids } = req.body; // Array of field IDs in desired order

      if (!Array.isArray(field_ids)) {
        res.status(400).json({ error: 'field_ids must be an array' });
        return;
      }

      // Update display_order for each field
      for (let i = 0; i < field_ids.length; i++) {
        await query(
          'UPDATE editable_deal_fields SET display_order = $1 WHERE id = $2 AND workspace_id = $3',
          [i + 1, field_ids[i], workspaceId]
        );
      }

      logger.info('Editable fields reordered', { workspace_id: workspaceId, count: field_ids.length });
      res.json({ success: true });
    } catch (err) {
      logger.error('Failed to reorder editable fields', err as Error);
      res.status(500).json({ error: 'Failed to reorder fields' });
    }
});

/**
 * PATCH /:workspaceId/deals/:dealId/field
 * Update a single deal field and write back to CRM
 */
router.patch('/:workspaceId/deals/:dealId/field',
  requirePermission('deals.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, dealId } = req.params;
      const { field_name, value } = req.body;

      if (!field_name) {
        res.status(400).json({ error: 'field_name is required' });
        return;
      }

      // 1. Validate field is editable
      const fieldConfig = await query(
        `SELECT * FROM editable_deal_fields
         WHERE workspace_id = $1 AND field_name = $2 AND is_editable = true`,
        [workspaceId, field_name]
      );

      if (fieldConfig.rows.length === 0) {
        res.status(403).json({ error: 'Field is not editable' });
        return;
      }

      const config = fieldConfig.rows[0];

      // 2. Get current deal info
      const dealResult = await query(
        'SELECT source_id, source FROM deals WHERE id = $1 AND workspace_id = $2',
        [dealId, workspaceId]
      );

      if (dealResult.rows.length === 0) {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }

      const deal = dealResult.rows[0];
      const crmId = deal.source_id;
      const crmType = deal.source;

      // 3. Update local database
      if (NATIVE_DEAL_COLUMNS.has(field_name)) {
        await query(
          `UPDATE deals SET ${field_name} = $1, updated_at = NOW()
           WHERE id = $2 AND workspace_id = $3`,
          [value, dealId, workspaceId]
        );
      } else {
        await query(
          `UPDATE deals
           SET custom_fields = custom_fields || jsonb_build_object($1::text, to_jsonb($2::text)),
               updated_at = NOW()
           WHERE id = $3 AND workspace_id = $4`,
          [config.crm_property_name, value !== null && value !== undefined ? String(value) : null, dealId, workspaceId]
        );
      }

      // 4. Write back to CRM
      try {
        if (crmType === 'hubspot') {
          await updateHubSpotDeal(workspaceId, crmId, {
            [config.crm_property_name]: value
          });
        } else if (crmType === 'salesforce') {
          await updateSalesforceDeal(workspaceId, crmId, {
            [config.crm_property_name]: value
          });
        }

        // 5. Log the write
        await query(
          `INSERT INTO crm_write_log
            (workspace_id, crm_type, crm_object_type, crm_record_id,
             crm_property_name, value_written, trigger_source, status, duration_ms)
           VALUES ($1, $2, 'deal', $3, $4, $5, 'inline_edit', 'success', 0)`,
          [workspaceId, crmType, crmId, config.crm_property_name, JSON.stringify(value)]
        );

        logger.info('Deal field updated and written to CRM', {
          workspace_id: workspaceId,
          deal_id: dealId,
          field_name,
          crm_type: crmType
        });

        res.json({ success: true, value });

      } catch (crmError) {
        // Log CRM write failure
        await query(
          `INSERT INTO crm_write_log
            (workspace_id, crm_type, crm_object_type, crm_record_id,
             crm_property_name, value_written, trigger_source, status, error_message, duration_ms)
           VALUES ($1, $2, 'deal', $3, $4, $5, 'inline_edit', 'failed', $6, 0)`,
          [
            workspaceId,
            crmType,
            crmId,
            config.crm_property_name,
            JSON.stringify(value),
            (crmError as Error).message
          ]
        );

        logger.error('Failed to write back to CRM', crmError as Error);

        // Local DB was updated successfully, but CRM write failed
        res.status(207).json({
          success: true,
          value,
          warning: 'Updated locally but CRM write failed',
          crm_error: (crmError as Error).message
        });
      }

    } catch (err) {
      logger.error('Failed to update deal field', err as Error);
      res.status(500).json({ error: 'Failed to update field' });
    }
});

export default router;
