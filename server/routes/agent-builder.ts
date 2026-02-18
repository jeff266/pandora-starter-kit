/**
 * Agent Builder API Routes
 *
 * POST   /:workspaceId/agents-v2                           Create agent
 * GET    /:workspaceId/agents-v2                           List agents
 * GET    /:workspaceId/agents-v2/:id                       Get agent
 * PATCH  /:workspaceId/agents-v2/:id                       Update agent
 * DELETE /:workspaceId/agents-v2/:id                       Delete agent
 * PATCH  /:workspaceId/agents-v2/:id/toggle                Toggle active
 * POST   /:workspaceId/agents-v2/:id/trigger               Manual trigger
 * GET    /agents-v2/templates                              List templates (global)
 * POST   /:workspaceId/agents-v2/templates/:templateId/deploy  Deploy template
 * GET    /:workspaceId/agents-v2/:id/performance           Performance stats
 * POST   /:workspaceId/agents-v2/tradeoffs/estimate        Estimate tradeoffs
 */

import { Router } from 'express';
import {
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgent,
  deployTemplate,
  getAgentPerformance,
  listAgents,
  getAgent,
} from '../agents/agent-service.js';
import { estimateTradeoffs } from '../agents/tradeoffs.js';
import { detectConflicts } from '../agents/conflicts.js';
import { AGENT_TEMPLATES } from '../agents/templates.js';
import { query } from '../db.js';
import { assembleFindingsForRule, type DeliveryRuleRow } from '../push/finding-assembler.js';

const router = Router();

// ─── Global: list templates (no workspace scope) ─────────────────────────────
router.get('/agents-v2/templates', (_req, res) => {
  return res.json(AGENT_TEMPLATES);
});

// ─── POST /:workspaceId/agents-v2 ─────────────────────────────────────────────
router.post('/:workspaceId/agents-v2', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const agent = await createAgent(workspaceId, req.body);
    return res.status(201).json(agent);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

// ─── GET /:workspaceId/agents-v2 ──────────────────────────────────────────────
router.get('/:workspaceId/agents-v2', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const activeParam = req.query.active as string | undefined;
    const activeFilter =
      activeParam === 'true' ? true :
      activeParam === 'false' ? false : null;
    const agents = await listAgents(workspaceId, activeFilter);
    return res.json(agents);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ─── POST /:workspaceId/agents-v2/tradeoffs/estimate ─────────────────────────
router.post('/:workspaceId/agents-v2/tradeoffs/estimate', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { skill_ids, trigger_config, filter_config, channel_id } = req.body;
    if (!skill_ids || !trigger_config || !filter_config) {
      return res.status(400).json({ error: 'skill_ids, trigger_config, and filter_config are required' });
    }
    const config = { skill_ids, trigger_config, filter_config, channel_id };
    const [tradeoffs, conflicts] = await Promise.all([
      estimateTradeoffs(workspaceId, config),
      detectConflicts(workspaceId, config),
    ]);
    return res.json({ ...tradeoffs, conflicts });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ─── POST /:workspaceId/agents-v2/templates/:templateId/deploy ───────────────
router.post('/:workspaceId/agents-v2/templates/:templateId/deploy', async (req, res) => {
  try {
    const { workspaceId, templateId } = req.params;
    const { channel_id, activate_immediately } = req.body;
    const agent = await deployTemplate(templateId, workspaceId, channel_id ?? null, activate_immediately ?? false);
    return res.status(201).json(agent);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

// ─── GET /:workspaceId/agents-v2/:id ─────────────────────────────────────────
router.get('/:workspaceId/agents-v2/:id', async (req, res) => {
  try {
    const { workspaceId, id } = req.params;
    const agent = await getAgent(id, workspaceId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    return res.json(agent);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ─── PATCH /:workspaceId/agents-v2/:id ───────────────────────────────────────
router.patch('/:workspaceId/agents-v2/:id', async (req, res) => {
  try {
    const { workspaceId, id } = req.params;
    const agent = await updateAgent(id, workspaceId, req.body);
    return res.json(agent);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

// ─── DELETE /:workspaceId/agents-v2/:id ──────────────────────────────────────
router.delete('/:workspaceId/agents-v2/:id', async (req, res) => {
  try {
    const { workspaceId, id } = req.params;
    await deleteAgent(id, workspaceId);
    return res.status(204).send();
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

// ─── PATCH /:workspaceId/agents-v2/:id/toggle ────────────────────────────────
router.patch('/:workspaceId/agents-v2/:id/toggle', async (req, res) => {
  try {
    const { workspaceId, id } = req.params;
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }
    const agent = await toggleAgent(id, workspaceId, is_active);
    return res.json(agent);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

// ─── POST /:workspaceId/agents-v2/:id/trigger ────────────────────────────────
router.post('/:workspaceId/agents-v2/:id/trigger', async (req, res) => {
  try {
    const { workspaceId, id } = req.params;
    const agent = await getAgent(id, workspaceId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.delivery_rule_id) {
      return res.status(400).json({ error: 'Agent has no delivery channel configured' });
    }

    const ruleResult = await query<DeliveryRuleRow>(
      'SELECT * FROM delivery_rules WHERE id=$1',
      [agent.delivery_rule_id]
    );
    if (ruleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery rule not found' });
    }

    const { executeDelivery } = await import('../push/delivery-executor.js');
    const channelResult = await query(
      'SELECT * FROM delivery_channels WHERE id=$1',
      [ruleResult.rows[0].channel_id]
    );
    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery channel not found' });
    }

    const wsResult = await query<{ name: string }>('SELECT name FROM workspaces WHERE id=$1', [workspaceId]);
    const workspaceName = wsResult.rows[0]?.name || 'Unknown Workspace';
    const findings = await assembleFindingsForRule(ruleResult.rows[0] as DeliveryRuleRow, workspaceId);

    executeDelivery(ruleResult.rows[0] as DeliveryRuleRow, channelResult.rows[0] as any, findings, 'manual', workspaceName).catch(
      err => console.error('[agent-builder] manual trigger error:', err)
    );

    return res.json({ triggered: true, rule_id: agent.delivery_rule_id, findings_queued: findings.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ─── GET /:workspaceId/agents-v2/:id/performance ─────────────────────────────
router.get('/:workspaceId/agents-v2/:id/performance', async (req, res) => {
  try {
    const { workspaceId, id } = req.params;
    const performance = await getAgentPerformance(id, workspaceId);
    return res.json(performance);
  } catch (err: any) {
    return res.status(404).json({ error: err.message || String(err) });
  }
});

export default router;
