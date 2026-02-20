import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import pool from '../db.js';
import { testSlackWebhook, getSlackWebhook } from '../connectors/slack/client.js';

const router = Router();

router.post('/:id/settings/slack', async (req, res) => {
  try {
    const { id } = req.params;
    const { webhook_url } = req.body;

    if (!webhook_url || typeof webhook_url !== 'string') {
      return res.status(400).json({ error: 'webhook_url is required and must be a string' });
    }

    if (!webhook_url.startsWith('https://hooks.slack.com/')) {
      return res.status(400).json({ error: 'webhook_url must be a valid Slack webhook URL' });
    }

    const result = await pool.query(
      `UPDATE workspaces
       SET settings = jsonb_set(COALESCE(settings, '{}'), '{slack_webhook_url}', to_jsonb($2::text)),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, settings->>'slack_webhook_url' AS slack_webhook_url`,
      [id, webhook_url]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    return res.json({ ok: true, slack_webhook_url: result.rows[0].slack_webhook_url });
  } catch (err) {
    console.error('[slack-settings] Error saving webhook:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/settings/slack/test', async (req, res) => {
  try {
    const { id } = req.params;

    const ws = await pool.query('SELECT id FROM workspaces WHERE id = $1', [id]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const webhookUrl = await getSlackWebhook(id);
    if (!webhookUrl) {
      return res.status(400).json({ error: 'No Slack webhook URL configured. Set SLACK_WEBHOOK secret or save a URL via POST /:id/settings/slack' });
    }

    const result = await testSlackWebhook(webhookUrl);
    return res.json(result);
  } catch (err) {
    console.error('[slack-settings] Error testing webhook:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/settings/slack/test-dm', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }
    const { getSlackAppClient } = await import('../connectors/slack/slack-app-client.js');
    const client = getSlackAppClient();

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🧪 Pandora Test Notification', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*This is a test DM from Pandora.*\nIf you see this, DM delivery is working correctly.',
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_Sent at ${new Date().toISOString()}_` }],
      },
    ];

    const result = await client.sendDirectMessage(id, user_id, blocks, 'Pandora test notification');
    return res.json(result);
  } catch (err) {
    console.error('[slack-settings] Error testing DM:', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
