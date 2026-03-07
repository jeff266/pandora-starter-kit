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

router.post('/:id/settings/slack/consolidated-brief', async (req, res) => {
  try {
    const { id } = req.params;
    const { use_consolidated_brief } = req.body;

    if (typeof use_consolidated_brief !== 'boolean') {
      return res.status(400).json({ error: 'use_consolidated_brief must be a boolean' });
    }

    const ws = await pool.query('SELECT id FROM workspaces WHERE id = $1', [id]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    await pool.query(
      `UPDATE slack_channel_config
       SET use_consolidated_brief = $1
       WHERE workspace_id = $2`,
      [use_consolidated_brief, id]
    );

    console.log(`[slack-settings] Workspace ${id} consolidated brief mode set to ${use_consolidated_brief}`);
    return res.json({ ok: true, use_consolidated_brief });
  } catch (err) {
    console.error('[slack-settings] Error updating consolidated brief setting:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/settings/slack/consolidated-brief', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT use_consolidated_brief FROM slack_channel_config WHERE workspace_id=$1 LIMIT 1`,
      [id]
    );

    const enabled = result.rows.length > 0 ? result.rows[0].use_consolidated_brief : false;
    return res.json({ use_consolidated_brief: enabled });
  } catch (err) {
    console.error('[slack-settings] Error reading consolidated brief setting:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
