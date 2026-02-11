import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

/**
 * GET /api/workspaces/:id/webhook
 * Get webhook configuration for a workspace
 */
router.get('/:id/webhook', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    const result = await query<{ webhook_url: string | null; webhook_secret: string | null }>(
      `SELECT webhook_url, webhook_secret FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const row = result.rows[0];
    res.json({
      webhookUrl: row.webhook_url,
      hasSecret: !!row.webhook_secret,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Webhook Config] Get error:', msg);
    res.status(500).json({ error: 'Failed to fetch webhook configuration' });
  }
});

/**
 * PUT /api/workspaces/:id/webhook
 * Configure webhook for a workspace
 */
router.put('/:id/webhook', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const { webhookUrl, webhookSecret } = req.body;

  // Validate webhook URL if provided
  if (webhookUrl) {
    try {
      const url = new URL(webhookUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        res.status(400).json({ error: 'Webhook URL must use HTTP or HTTPS protocol' });
        return;
      }
    } catch (error) {
      res.status(400).json({ error: 'Invalid webhook URL' });
      return;
    }
  }

  try {
    await query(
      `UPDATE workspaces
       SET webhook_url = $1, webhook_secret = $2, updated_at = NOW()
       WHERE id = $3`,
      [webhookUrl || null, webhookSecret || null, workspaceId]
    );

    res.json({
      success: true,
      webhookUrl: webhookUrl || null,
      hasSecret: !!webhookSecret,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Webhook Config] Update error:', msg);
    res.status(500).json({ error: 'Failed to update webhook configuration' });
  }
});

/**
 * DELETE /api/workspaces/:id/webhook
 * Remove webhook configuration from a workspace
 */
router.delete('/:id/webhook', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    await query(
      `UPDATE workspaces
       SET webhook_url = NULL, webhook_secret = NULL, updated_at = NOW()
       WHERE id = $1`,
      [workspaceId]
    );

    res.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Webhook Config] Delete error:', msg);
    res.status(500).json({ error: 'Failed to remove webhook configuration' });
  }
});

/**
 * POST /api/workspaces/:id/webhook/test
 * Send a test webhook to verify configuration
 */
router.post('/:id/webhook/test', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    const { sendWebhook } = await import('../utils/webhook-notifier.js');

    await sendWebhook({
      event: 'sync.progress',
      workspaceId,
      timestamp: new Date().toISOString(),
      data: {
        jobType: 'test',
        progress: {
          current: 50,
          total: 100,
          message: 'Test webhook notification',
        },
      },
    });

    res.json({ success: true, message: 'Test webhook sent' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Webhook Config] Test error:', msg);
    res.status(500).json({ error: 'Failed to send test webhook', message: msg });
  }
});

export default router;
