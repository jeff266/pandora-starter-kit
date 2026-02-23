/**
 * Webhook Enrichment Routes
 *
 * API endpoints for bidirectional webhook enrichment connector.
 */

import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getActiveToken, rotateToken, getWebhookUrl, validateToken } from '../enrichment/webhook-token-manager.js';
import { sendOutboundWebhook, replayDeadLetter } from '../enrichment/webhook-outbound.js';
import { processInboundWebhook } from '../enrichment/webhook-inbound.js';
import { getInboundHistory } from '../enrichment/webhook-inbound.js';

const router = Router();
const logger = createLogger('Webhook Routes');

interface WorkspaceParams {
  workspaceId: string;
}

interface WebhookParams {
  workspaceId: string;
  token: string;
}

interface DLQParams {
  workspaceId: string;
  dlqId: string;
}

// ============================================================================
// Outbound Webhook Configuration
// ============================================================================

/**
 * Save outbound webhook URL
 */
router.post('/:workspaceId/enrichment/webhook/outbound/config', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { endpoint_url } = req.body;

    if (!endpoint_url || typeof endpoint_url !== 'string') {
      res.status(400).json({ error: 'endpoint_url is required' });
      return;
    }

    // Validate URL format
    try {
      new URL(endpoint_url);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    // Check workspace exists
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Upsert configuration
    await query(
      `INSERT INTO webhook_outbound_configs (workspace_id, endpoint_url, is_active, updated_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (workspace_id)
       DO UPDATE SET endpoint_url = $2, is_active = true, updated_at = NOW()`,
      [workspaceId, endpoint_url]
    );

    logger.info('Outbound webhook configured', {
      workspace_id: workspaceId,
      endpoint_url,
    });

    res.json({ success: true, message: 'Outbound webhook URL saved' });
  } catch (err: any) {
    logger.error('Failed to save outbound config', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get outbound webhook configuration
 */
router.get('/:workspaceId/enrichment/webhook/outbound/config', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const result = await query(
      `SELECT endpoint_url, is_active, last_test_at, last_test_success, last_test_error
       FROM webhook_outbound_configs
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      res.json({ configured: false });
      return;
    }

    res.json({
      configured: true,
      endpoint_url: result.rows[0].endpoint_url,
      is_active: result.rows[0].is_active,
      last_test: result.rows[0].last_test_at ? {
        at: result.rows[0].last_test_at,
        success: result.rows[0].last_test_success,
        error: result.rows[0].last_test_error,
      } : null,
    });
  } catch (err: any) {
    logger.error('Failed to get outbound config', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete outbound webhook configuration
 */
router.delete('/:workspaceId/enrichment/webhook/outbound/config', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    await query(
      'DELETE FROM webhook_outbound_configs WHERE workspace_id = $1',
      [workspaceId]
    );

    logger.info('Outbound webhook disconnected', { workspace_id: workspaceId });

    res.json({ success: true, message: 'Outbound webhook disconnected' });
  } catch (err: any) {
    logger.error('Failed to delete outbound config', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Test outbound webhook connection
 */
router.post('/:workspaceId/enrichment/webhook/outbound/test', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const configResult = await query(
      'SELECT endpoint_url FROM webhook_outbound_configs WHERE workspace_id = $1',
      [workspaceId]
    );

    if (configResult.rows.length === 0) {
      res.status(400).json({ error: 'No outbound webhook configured' });
      return;
    }

    const endpointUrl = configResult.rows[0].endpoint_url;

    // Send test payload
    const testPayload = {
      pandora_batch_id: 'test_' + Date.now(),
      workspace_id: workspaceId,
      triggered_at: new Date().toISOString(),
      account_count: 0,
      accounts: [],
      test: true,
    };

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10000),
      });

      const success = response.ok;
      const error = success ? null : `HTTP ${response.status}: ${response.statusText}`;

      // Update test result
      await query(
        `UPDATE webhook_outbound_configs
         SET last_test_at = NOW(),
             last_test_success = $1,
             last_test_error = $2
         WHERE workspace_id = $3`,
        [success, error, workspaceId]
      );

      if (success) {
        res.json({ success: true, message: 'Connection test successful' });
      } else {
        res.status(400).json({ success: false, error });
      }
    } catch (error: any) {
      const errorMsg = error.message || 'Connection failed';

      await query(
        `UPDATE webhook_outbound_configs
         SET last_test_at = NOW(),
             last_test_success = false,
             last_test_error = $1
         WHERE workspace_id = $2`,
        [errorMsg, workspaceId]
      );

      res.status(400).json({ success: false, error: errorMsg });
    }
  } catch (err: any) {
    logger.error('Failed to test outbound webhook', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger outbound enrichment
 */
router.post('/:workspaceId/enrichment/webhook/outbound/trigger', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const configResult = await query(
      'SELECT endpoint_url FROM webhook_outbound_configs WHERE workspace_id = $1 AND is_active = true',
      [workspaceId]
    );

    if (configResult.rows.length === 0) {
      res.status(400).json({ error: 'No active outbound webhook configured' });
      return;
    }

    const endpointUrl = configResult.rows[0].endpoint_url;

    // Send webhook
    const result = await sendOutboundWebhook(workspaceId, endpointUrl);

    if (result.success) {
      res.json({
        success: true,
        batch_id: result.batch_id,
        message: 'Enrichment triggered successfully',
      });
    } else if (result.retry_scheduled) {
      res.json({
        success: false,
        batch_id: result.batch_id,
        message: 'Delivery failed, retry scheduled',
        retry_scheduled: true,
      });
    } else {
      res.status(400).json({
        success: false,
        batch_id: result.batch_id,
        error: result.error,
        moved_to_dlq: result.moved_to_dlq,
      });
    }
  } catch (err: any) {
    logger.error('Failed to trigger outbound webhook', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Inbound Webhook Configuration
// ============================================================================

/**
 * Get inbound webhook URL
 */
router.get('/:workspaceId/enrichment/webhook/inbound/url', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const baseUrl = process.env.APP_BASE_URL || 'https://app.pandora.io';
    const webhookUrl = await getWebhookUrl(workspaceId, baseUrl);

    res.json({
      webhook_url: webhookUrl,
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('Failed to get inbound webhook URL', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Rotate inbound webhook token
 */
router.post('/:workspaceId/enrichment/webhook/inbound/rotate', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const newToken = await rotateToken(workspaceId);
    const baseUrl = process.env.APP_BASE_URL || 'https://app.pandora.io';
    const webhookUrl = `${baseUrl}/webhooks/enrich/${workspaceId}/${newToken.token}`;

    logger.info('Inbound webhook token rotated', {
      workspace_id: workspaceId,
      token_id: newToken.id,
    });

    res.json({
      success: true,
      webhook_url: webhookUrl,
      message: 'Token rotated successfully. Update your Clay/Zapier/Make workflow with the new URL.',
    });
  } catch (err: any) {
    logger.error('Failed to rotate token', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get inbound processing history
 */
router.get('/:workspaceId/enrichment/webhook/inbound/history', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const history = await getInboundHistory(workspaceId, limit);

    res.json({ history });
  } catch (err: any) {
    logger.error('Failed to get inbound history', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Dead Letter Queue
// ============================================================================

/**
 * List dead letter queue items
 */
router.get('/:workspaceId/enrichment/webhook/dlq', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const result = await query(
      `SELECT id, batch_id, endpoint_url, final_error, final_status_code, total_attempts, failed_at, replayed, replayed_at, replay_result
       FROM webhook_dead_letter_queue
       WHERE workspace_id = $1
       ORDER BY failed_at DESC
       LIMIT 100`,
      [workspaceId]
    );

    res.json({ items: result.rows });
  } catch (err: any) {
    logger.error('Failed to list DLQ items', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Replay dead letter queue item
 */
router.post('/:workspaceId/enrichment/webhook/dlq/:dlqId/replay', async (req: Request<DLQParams>, res: Response) => {
  try {
    const { workspaceId, dlqId } = req.params;

    const result = await replayDeadLetter(workspaceId, dlqId);

    if (result.success) {
      res.json({
        success: true,
        batch_id: result.batch_id,
        message: 'Dead letter item replayed successfully',
      });
    } else {
      res.json({
        success: false,
        batch_id: result.batch_id,
        error: result.error,
        message: 'Replay failed',
      });
    }
  } catch (err: any) {
    logger.error('Failed to replay DLQ item', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
