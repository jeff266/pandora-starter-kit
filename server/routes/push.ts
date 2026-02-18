/**
 * Push API Routes
 *
 * POST   /:workspaceId/push/channels              Create delivery channel
 * GET    /:workspaceId/push/channels              List workspace channels
 * PATCH  /:workspaceId/push/channels/:id          Update channel config
 * DELETE /:workspaceId/push/channels/:id          Delete channel
 * POST   /:workspaceId/push/channels/:id/test     Send test message
 *
 * POST   /:workspaceId/push/rules                 Create delivery rule
 * GET    /:workspaceId/push/rules                 List workspace rules
 * PATCH  /:workspaceId/push/rules/:id             Update rule
 * DELETE /:workspaceId/push/rules/:id             Delete rule
 * PATCH  /:workspaceId/push/rules/:id/toggle      Enable/disable rule
 * POST   /:workspaceId/push/rules/:id/trigger     Manually trigger rule
 *
 * GET    /:workspaceId/push/log                   Recent deliveries
 * GET    /:workspaceId/push/log/:ruleId           Deliveries for a rule
 */

import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { assembleFindingsForRule, type DeliveryRuleRow } from '../push/finding-assembler.js';
import { executeDelivery, type DeliveryChannelRow } from '../push/delivery-executor.js';
import { reloadCronTriggers } from '../push/trigger-manager.js';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getWorkspaceName(workspaceId: string): Promise<string> {
  const r = await query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
  return r.rows[0]?.name || 'Unknown Workspace';
}

// ─── Channels ─────────────────────────────────────────────────────────────────

router.post('/:workspaceId/push/channels', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { name, channel_type, config } = req.body;

  if (!name || !channel_type || !config) {
    return res.status(400).json({ error: 'name, channel_type, and config are required' });
  }
  if (!['slack', 'email', 'webhook'].includes(channel_type)) {
    return res.status(400).json({ error: 'channel_type must be slack, email, or webhook' });
  }

  try {
    const r = await query<any>(
      `INSERT INTO delivery_channels (workspace_id, name, channel_type, config)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [workspaceId, name, channel_type, JSON.stringify(config)]
    );
    return res.status(201).json(r.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/push/channels', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  try {
    const r = await query<any>(
      'SELECT * FROM delivery_channels WHERE workspace_id = $1 ORDER BY created_at DESC',
      [workspaceId]
    );
    return res.json({ channels: r.rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/:workspaceId/push/channels/:id', async (req: Request, res: Response) => {
  const { workspaceId, id } = req.params;
  const { name, config, is_active } = req.body;
  const sets: string[] = ['updated_at = NOW()'];
  const params: any[] = [id, workspaceId];

  if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
  if (config !== undefined) { params.push(JSON.stringify(config)); sets.push(`config = $${params.length}`); }
  if (is_active !== undefined) { params.push(is_active); sets.push(`is_active = $${params.length}`); }

  try {
    const r = await query<any>(
      `UPDATE delivery_channels SET ${sets.join(', ')} WHERE id = $1 AND workspace_id = $2 RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    return res.json(r.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:workspaceId/push/channels/:id', async (req: Request, res: Response) => {
  const { workspaceId, id } = req.params;
  try {
    await query('DELETE FROM delivery_channels WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/push/channels/:id/test', async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const id = req.params.id as string;
  try {
    const r = await query<any>(
      'SELECT * FROM delivery_channels WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );
    const channel: DeliveryChannelRow | undefined = r.rows[0];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const workspaceName = await getWorkspaceName(workspaceId);

    // Build a test payload
    const testFinding = {
      id: 'test-id',
      skill_id: 'test',
      skill_run_id: 'test',
      severity: 'info',
      category: 'connection_test',
      message: `Pandora connected to ${workspaceName}. Push API is working correctly.`,
      deal_id: null,
      deal_name: null,
      deal_amount: null,
      deal_owner: null,
      ai_score: null,
      account_id: null,
      owner_email: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };

    // Create a fake rule for formatting
    const fakeRule: DeliveryRuleRow = {
      id: 'test',
      workspace_id: workspaceId,
      channel_id: id,
      name: 'Connection Test',
      filter_config: {},
      template: 'standard',
      consecutive_failures: 0,
      last_delivery_at: null,
      last_triggered_at: null,
      trigger_type: 'cron',
      trigger_config: {},
      is_active: true,
    };

    await executeDelivery(fakeRule, channel, [testFinding], 'manual_test', workspaceName);

    // Mark channel as verified
    await query(
      'UPDATE delivery_channels SET verified_at = NOW() WHERE id = $1',
      [id]
    );

    return res.json({ ok: true, message: 'Test message sent successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Rules ────────────────────────────────────────────────────────────────────

router.post('/:workspaceId/push/rules', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { channel_id, name, trigger_type, trigger_config, filter_config, template } = req.body;

  if (!channel_id || !name || !trigger_type || !trigger_config) {
    return res.status(400).json({ error: 'channel_id, name, trigger_type, trigger_config are required' });
  }

  try {
    const r = await query<any>(
      `INSERT INTO delivery_rules
         (workspace_id, channel_id, name, trigger_type, trigger_config, filter_config, template)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        workspaceId, channel_id, name, trigger_type,
        JSON.stringify(trigger_config),
        JSON.stringify(filter_config || {}),
        template || 'standard',
      ]
    );
    // Reload cron triggers if this is a cron rule
    if (trigger_type === 'cron') {
      reloadCronTriggers().catch(() => {});
    }
    return res.status(201).json(r.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/push/rules', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  try {
    const r = await query<any>(
      `SELECT dr.*, dc.name as channel_name, dc.channel_type
       FROM delivery_rules dr
       JOIN delivery_channels dc ON dc.id = dr.channel_id
       WHERE dr.workspace_id = $1
       ORDER BY dr.created_at DESC`,
      [workspaceId]
    );
    return res.json({ rules: r.rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/:workspaceId/push/rules/:id', async (req: Request, res: Response) => {
  const { workspaceId, id } = req.params;
  const { name, filter_config, trigger_config, template, is_active } = req.body;
  const sets: string[] = ['updated_at = NOW()'];
  const params: any[] = [id, workspaceId];

  if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
  if (filter_config !== undefined) { params.push(JSON.stringify(filter_config)); sets.push(`filter_config = $${params.length}`); }
  if (trigger_config !== undefined) { params.push(JSON.stringify(trigger_config)); sets.push(`trigger_config = $${params.length}`); }
  if (template !== undefined) { params.push(template); sets.push(`template = $${params.length}`); }
  if (is_active !== undefined) { params.push(is_active); sets.push(`is_active = $${params.length}`); }

  try {
    const r = await query<any>(
      `UPDATE delivery_rules SET ${sets.join(', ')} WHERE id = $1 AND workspace_id = $2 RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
    reloadCronTriggers().catch(() => {});
    return res.json(r.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:workspaceId/push/rules/:id', async (req: Request, res: Response) => {
  const { workspaceId, id } = req.params;
  try {
    await query('DELETE FROM delivery_rules WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    reloadCronTriggers().catch(() => {});
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/:workspaceId/push/rules/:id/toggle', async (req: Request, res: Response) => {
  const { workspaceId, id } = req.params;
  try {
    const r = await query<any>(
      `UPDATE delivery_rules SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 RETURNING *`,
      [id, workspaceId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
    reloadCronTriggers().catch(() => {});
    return res.json({ is_active: r.rows[0].is_active });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/push/rules/:id/trigger', async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const id = req.params.id as string;
  try {
    const ruleRes = await query<any>(
      'SELECT * FROM delivery_rules WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );
    const rule: DeliveryRuleRow | undefined = ruleRes.rows[0];
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    const channelRes = await query<any>(
      'SELECT * FROM delivery_channels WHERE id = $1',
      [rule.channel_id]
    );
    const channel: DeliveryChannelRow | undefined = channelRes.rows[0];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const workspaceName = await getWorkspaceName(workspaceId);
    const findings = await assembleFindingsForRule(rule, workspaceId);

    // Update last_triggered_at
    await query('UPDATE delivery_rules SET last_triggered_at = NOW() WHERE id = $1', [id]);

    await executeDelivery(rule, channel, findings, 'manual', workspaceName);

    return res.json({ ok: true, findings_sent: findings.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Delivery Log ─────────────────────────────────────────────────────────────

router.get('/:workspaceId/push/log', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const status = req.query.status as string | undefined;
  const limit = parseInt(req.query.limit as string || '50', 10);
  const offset = parseInt(req.query.offset as string || '0', 10);

  const conditions = ['dl.workspace_id = $1'];
  const params: any[] = [workspaceId];

  if (status) {
    params.push(status);
    conditions.push(`dl.status = $${params.length}`);
  }

  try {
    const r = await query<any>(
      `SELECT dl.*, dr.name as rule_name, dc.channel_type
       FROM delivery_log dl
       JOIN delivery_rules dr ON dr.id = dl.rule_id
       JOIN delivery_channels dc ON dc.id = dl.channel_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY dl.delivered_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return res.json({ log: r.rows, limit, offset });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/push/log/:ruleId', async (req: Request, res: Response) => {
  const { workspaceId, ruleId } = req.params;
  const limit = parseInt(req.query.limit as string || '20', 10);

  try {
    const r = await query<any>(
      `SELECT * FROM delivery_log
       WHERE workspace_id = $1 AND rule_id = $2
       ORDER BY delivered_at DESC LIMIT $3`,
      [workspaceId, ruleId, limit]
    );
    return res.json({ log: r.rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
