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
 * GET    /:workspaceId/agent-templates                     List briefing templates
 * POST   /:workspaceId/agents/from-template                Create agent from template
 * POST   /:workspaceId/agents-v2/templates/:templateId/deploy  Deploy template
 * GET    /:workspaceId/agents-v2/:id/performance           Performance stats
 * POST   /:workspaceId/agents-v2/tradeoffs/estimate        Estimate tradeoffs
 */

import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { requireUserSession } from '../middleware/auth.js';
import {
  createAgent,
  createAgentFromTemplate,
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
import { getAgentTemplates } from '../agents/agent-templates.js';
import { getAgentRegistry } from '../agents/registry.js';
import { query } from '../db.js';
import { assembleFindingsForRule, type DeliveryRuleRow } from '../push/finding-assembler.js';
import { interpretFreeText, getWorkspaceCopilotContext } from '../copilot/agent-copilot-interpreter.js';

const router = Router();

// ─── Global: list templates (no workspace scope) ─────────────────────────────
router.get('/agents-v2/templates', requireUserSession, (_req, res) => {
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

    const [dbAgents, registry] = await Promise.all([
      listAgents(workspaceId, activeFilter),
      Promise.resolve(getAgentRegistry()),
    ]);

    const builtInAgents = registry.listForWorkspace(workspaceId).map(def => ({
      id: def.id,
      workspace_id: workspaceId,
      name: def.name,
      description: def.description,
      goal: def.goal,
      is_active: def.enabled !== false,
      is_builtin: true,
      skill_ids: def.skills?.map((s: any) => s.skillId) ?? [],
      standing_questions: def.standing_questions ?? [],
      trigger_config: def.trigger ?? null,
      delivery_config: def.delivery ?? null,
      output_formats: def.delivery?.format ? [def.delivery.format] : [],
      created_at: def.createdAt ?? new Date(),
      updated_at: def.updatedAt ?? new Date(),
    }));

    const dbAgentIds = new Set(dbAgents.map((a: any) => a.id));
    const dedupedBuiltIns = builtInAgents.filter(a => !dbAgentIds.has(a.id));

    return res.json([...dedupedBuiltIns, ...dbAgents]);
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

// ─── GET /:workspaceId/agent-templates ────────────────────────────────────────
router.get('/:workspaceId/agent-templates', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const templates = await getAgentTemplates(workspaceId);
    return res.json({ templates });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ─── POST /:workspaceId/agents/from-template ─────────────────────────────────
router.post('/:workspaceId/agents/from-template', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { template_id, overrides } = req.body;
    if (!template_id) {
      return res.status(400).json({ error: 'template_id is required' });
    }
    const agent = await createAgentFromTemplate(workspaceId, template_id, overrides);
    return res.status(201).json({ agent });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
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

// ─── POST /:workspaceId/agents/:agentId/generate ────────────────────────────
router.post('/:workspaceId/agents/:agentId/generate', async (req, res) => {
  try {
    const { workspaceId, agentId } = req.params;
    const { triggered_by = 'manual', skip_delivery = false } = req.body;

    // Get agent to find its linked report template
    const agentResult = await query(
      'SELECT * FROM agents WHERE id = $1 AND workspace_id = $2',
      [agentId, workspaceId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Find report template linked to this agent
    const templateResult = await query(
      'SELECT id FROM report_templates WHERE agent_id = $1 AND workspace_id = $2',
      [agentId, workspaceId]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'No report template linked to this agent' });
    }

    const reportTemplateId = templateResult.rows[0].id;

    // Import and call the editorial generator
    const { generateEditorialReport } = await import('../reports/editorial-generator.js');

    const generation = await generateEditorialReport({
      workspace_id: workspaceId,
      report_template_id: reportTemplateId,
      triggered_by,
      preview_only: false,
      skip_delivery,
    });

    res.json({
      success: true,
      generation_id: generation.id,
      generation,
    });
  } catch (err: any) {
    console.error('[agent generate] error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// ─── GET /:workspaceId/agents/:agentId/generations ──────────────────────────
router.get('/:workspaceId/agents/:agentId/generations', async (req, res) => {
  try {
    const { workspaceId, agentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

    const result = await query(
      `SELECT id, created_at, opening_narrative,
              editorial_decisions, generation_duration_ms,
              render_duration_ms, skills_run, total_tokens,
              run_digest, sections_snapshot,
              formats_generated
       FROM report_generations
       WHERE workspace_id = $1 AND agent_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [workspaceId, agentId, limit]
    );

    res.json({ generations: result.rows });
  } catch (err: any) {
    console.error('[agent generations] error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch generations' });
  }
});

// ─── Copilot: workspace context ──────────────────────────────────────────────
router.get('/:workspaceId/agents-v2/copilot/context', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const context = await getWorkspaceCopilotContext(workspaceId);
    res.json(context);
  } catch (err: any) {
    console.error('[Copilot] context error:', err);
    res.status(500).json({ error: err.message || 'Failed to load copilot context' });
  }
});

// ─── Copilot: interpret free text ────────────────────────────────────────────
router.post('/:workspaceId/agents-v2/copilot/interpret', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { step, user_input, current_draft } = req.body;

    if (!step || !user_input) {
      return res.status(400).json({ error: 'step and user_input are required' });
    }

    const context = await getWorkspaceCopilotContext(workspaceId);
    const result = await interpretFreeText(workspaceId, {
      step,
      user_input,
      current_draft: current_draft || {},
      workspace_context: {
        available_skills: context.skills.map(s => s.id),
        crm_type: context.crm_type,
        has_conversation_intel: context.has_conversation_intel,
      },
    });

    res.json(result);
  } catch (err: any) {
    console.error('[Copilot] interpret error:', err);
    res.status(500).json({ error: err.message || 'Interpretation failed' });
  }
});

export default router;
