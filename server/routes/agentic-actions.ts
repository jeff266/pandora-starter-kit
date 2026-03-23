/**
 * Agentic Actions API Routes
 * Endpoints for managing workspace action settings (thresholds, protection rules, etc.)
 */

import express from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { requirePermission } from '../middleware/permissions.js';
import { getActionThresholdResolver } from '../actions/threshold-resolver.js';

const router = express.Router();
const logger = createLogger('AgenticActionsRoutes');

/**
 * GET /:workspaceId/agentic-actions/settings
 * Get workspace action settings
 */
router.get('/:workspaceId/agentic-actions/settings', async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;

    const resolver = getActionThresholdResolver();
    const settings = await resolver.getSettings(workspaceId);

    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    res.json({ settings });
  } catch (err) {
    logger.error('Failed to fetch agentic action settings', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /:workspaceId/agentic-actions/settings
 * Update workspace action settings
 */
router.put('/:workspaceId/agentic-actions/settings', requirePermission('settings.manage'), async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const {
      action_threshold,
      protected_stages,
      protected_fields,
      field_overrides,
      notify_on_auto_write,
      notify_channel,
      notify_rep,
      notify_manager,
      undo_window_hours,
      audit_webhook_url,
      audit_webhook_secret,
      audit_webhook_enabled,
    } = req.body;

    // Validate action_threshold
    if (action_threshold && !['high', 'medium', 'low'].includes(action_threshold)) {
      return res.status(400).json({ error: 'Invalid action_threshold. Must be high, medium, or low.' });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (action_threshold !== undefined) {
      updates.push(`action_threshold = $${paramIndex}`);
      values.push(action_threshold);
      paramIndex++;
    }

    if (protected_stages !== undefined) {
      updates.push(`protected_stages = $${paramIndex}::jsonb`);
      values.push(JSON.stringify(protected_stages));
      paramIndex++;
    }

    if (protected_fields !== undefined) {
      updates.push(`protected_fields = $${paramIndex}::jsonb`);
      values.push(JSON.stringify(protected_fields));
      paramIndex++;
    }

    if (field_overrides !== undefined) {
      updates.push(`field_overrides = $${paramIndex}::jsonb`);
      values.push(JSON.stringify(field_overrides));
      paramIndex++;
    }

    if (notify_on_auto_write !== undefined) {
      updates.push(`notify_on_auto_write = $${paramIndex}`);
      values.push(notify_on_auto_write);
      paramIndex++;
    }

    if (notify_channel !== undefined) {
      updates.push(`notify_channel = $${paramIndex}`);
      values.push(notify_channel);
      paramIndex++;
    }

    if (notify_rep !== undefined) {
      updates.push(`notify_rep = $${paramIndex}`);
      values.push(notify_rep);
      paramIndex++;
    }

    if (notify_manager !== undefined) {
      updates.push(`notify_manager = $${paramIndex}`);
      values.push(notify_manager);
      paramIndex++;
    }

    if (undo_window_hours !== undefined) {
      updates.push(`undo_window_hours = $${paramIndex}`);
      values.push(undo_window_hours);
      paramIndex++;
    }

    if (audit_webhook_url !== undefined) {
      updates.push(`audit_webhook_url = $${paramIndex}`);
      values.push(audit_webhook_url);
      paramIndex++;
    }

    if (audit_webhook_secret !== undefined) {
      updates.push(`audit_webhook_secret = $${paramIndex}`);
      values.push(audit_webhook_secret);
      paramIndex++;
    }

    if (audit_webhook_enabled !== undefined) {
      updates.push(`audit_webhook_enabled = $${paramIndex}`);
      values.push(audit_webhook_enabled);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(workspaceId);

    const result = await query(
      `UPDATE workspace_action_settings
       SET ${updates.join(', ')}
       WHERE workspace_id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    // Clear resolver cache for this workspace
    const resolver = getActionThresholdResolver();
    resolver.clearCache(workspaceId);

    // Normalize the result
    const settings = {
      id: result.rows[0].id,
      workspace_id: result.rows[0].workspace_id,
      action_threshold: result.rows[0].action_threshold,
      protected_stages: Array.isArray(result.rows[0].protected_stages) ? result.rows[0].protected_stages : [],
      field_overrides: typeof result.rows[0].field_overrides === 'object' && result.rows[0].field_overrides !== null
        ? result.rows[0].field_overrides
        : {},
      protected_fields: Array.isArray(result.rows[0].protected_fields) ? result.rows[0].protected_fields : [],
      notify_on_auto_write: result.rows[0].notify_on_auto_write,
      notify_channel: result.rows[0].notify_channel,
      notify_rep: result.rows[0].notify_rep,
      notify_manager: result.rows[0].notify_manager,
      undo_window_hours: result.rows[0].undo_window_hours,
      audit_webhook_url: result.rows[0].audit_webhook_url,
      audit_webhook_secret: result.rows[0].audit_webhook_secret,
      audit_webhook_enabled: result.rows[0].audit_webhook_enabled,
    };

    logger.info('Agentic action settings updated', { workspace_id: workspaceId });
    res.json({ settings });
  } catch (err) {
    logger.error('Failed to update agentic action settings', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
