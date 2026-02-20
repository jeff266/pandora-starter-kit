import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getAgentRegistry } from '../agents/registry.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getAgentRuntime } from '../agents/runtime.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { generateWorkbook } from '../delivery/workbook-generator.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getSkillRegistry } from '../skills/registry.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import type { AgentDefinition } from '../agents/types.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { requireAdmin } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';

const agentsGlobalRouter = Router();
const agentsWorkspaceRouter = Router();

agentsGlobalRouter.get('/agents', (_req: Request, res: Response) => {
  const registry = getAgentRegistry();
  const agents = registry.list().map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    skillCount: a.skills.length,
    skills: a.skills.map(s => s.skillId),
    trigger: a.trigger,
    delivery: { channel: a.delivery.channel, format: a.delivery.format },
    enabled: a.enabled,
    workspaceIds: a.workspaceIds,
    createdBy: a.createdBy,
  }));
  res.json({ agents });
});

agentsGlobalRouter.get('/agents/:agentId', (req: Request, res: Response) => {
  const registry = getAgentRegistry();
  const agent = registry.get(req.params.agentId);
  if (!agent) {
    return res.status(404).json({ error: `Agent '${req.params.agentId}' not found` });
  }
  res.json(agent);
});

agentsGlobalRouter.post('/agents', requireAdmin, (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<AgentDefinition>;
    if (!body.id || !body.name || !body.skills || !body.synthesis) {
      return res.status(400).json({ error: 'Missing required fields: id, name, skills, synthesis' });
    }

    const agent: AgentDefinition = {
      id: body.id,
      name: body.name,
      description: body.description || '',
      skills: body.skills,
      synthesis: body.synthesis,
      trigger: body.trigger || { type: 'manual' },
      delivery: body.delivery || { channel: 'api', format: 'markdown' },
      workspaceIds: body.workspaceIds || 'all',
      enabled: body.enabled !== false,
      createdBy: body.createdBy || 'api',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const registry = getAgentRegistry();
    registry.register(agent);
    res.status(201).json({ ok: true, agent });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

agentsGlobalRouter.put('/agents/:agentId', requireAdmin, (req: Request, res: Response) => {
  const registry = getAgentRegistry();
  const existing = registry.get(req.params.agentId);
  if (!existing) {
    return res.status(404).json({ error: `Agent '${req.params.agentId}' not found` });
  }

  const updates = req.body;
  const updated: AgentDefinition = {
    ...existing,
    ...updates,
    id: existing.id,
    updatedAt: new Date(),
  };

  registry.remove(existing.id);
  registry.register(updated);
  res.json({ ok: true, agent: updated });
});

agentsGlobalRouter.delete('/agents/:agentId', requireAdmin, (req: Request, res: Response) => {
  const registry = getAgentRegistry();
  const removed = registry.remove(req.params.agentId);
  if (!removed) {
    return res.status(404).json({ error: `Agent '${req.params.agentId}' not found` });
  }
  res.json({ ok: true });
});

agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/run', async (req: Request, res: Response) => {
  const { workspaceId, agentId } = req.params;
  const { dryRun } = req.body || {};

  try {
    const runtime = getAgentRuntime();
    const result = await runtime.executeAgent(agentId, workspaceId, { dryRun });
    res.json(result);
  } catch (err: any) {
    console.error(`[Agent Route] Agent ${agentId} failed:`, err.message);
    res.status(500).json({
      error: err.message,
      agentId,
      workspaceId,
    });
  }
});

agentsWorkspaceRouter.get('/:workspaceId/agents/:agentId/runs', async (req: Request, res: Response) => {
  const { workspaceId, agentId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const result = await query(
    `SELECT id, agent_id, workspace_id, status,
            started_at, completed_at, duration_ms,
            skill_results, token_usage, error
     FROM agent_runs
     WHERE workspace_id = $1 AND agent_id = $2
     ORDER BY started_at DESC
     LIMIT $3`,
    [workspaceId, agentId, limit]
  );

  res.json({ runs: result.rows });
});

agentsWorkspaceRouter.get('/:workspaceId/agents/runs/all', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const result = await query(
    `SELECT id, agent_id, workspace_id, status,
            started_at, completed_at, duration_ms,
            skill_results, token_usage, error
     FROM agent_runs
     WHERE workspace_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );

  res.json({ runs: result.rows });
});

agentsWorkspaceRouter.get('/:workspaceId/agents/:agentId/runs/:runId/export', async (req: Request, res: Response) => {
  try {
    const { workspaceId, agentId, runId } = req.params;

    const ws = await query('SELECT id, name FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const result = await query(
      `SELECT id, agent_id, skill_results, skill_evidence, started_at
       FROM agent_runs
       WHERE workspace_id = $1 AND agent_id = $2 AND id::text = $3::text`,
      [workspaceId, agentId, runId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent run not found' });
    }

    const row = result.rows[0];

    let skillResults: any;
    let skillEvidenceRaw: any;
    try {
      skillResults = typeof row.skill_results === 'string' ? JSON.parse(row.skill_results) : row.skill_results;
      skillEvidenceRaw = typeof row.skill_evidence === 'string' ? JSON.parse(row.skill_evidence) : row.skill_evidence;
    } catch {
      return res.status(422).json({ error: 'Agent run data is malformed' });
    }

    if (!skillEvidenceRaw || Object.keys(skillEvidenceRaw).length === 0) {
      return res.status(404).json({ error: 'No evidence data available for this agent run' });
    }

    const agentRegistry = getAgentRegistry();
    const agent = agentRegistry.get(agentId);
    const skillRegistry = getSkillRegistry();

    const skillEvidence: Record<string, { evidence: any; schema?: any; displayName?: string }> = {};
    for (const [outputKey, evidence] of Object.entries(skillEvidenceRaw)) {
      const skillStep = agent?.skills.find(s => s.outputKey === outputKey);
      const skill = skillStep ? skillRegistry.get(skillStep.skillId) : null;
      skillEvidence[outputKey] = {
        evidence: evidence as any,
        schema: skill?.evidenceSchema,
        displayName: skill?.name || outputKey,
      };
    }

    const narrative = skillResults
      ? Object.values(skillResults as Record<string, any>)
          .map((r: any) => r?.output || '')
          .filter(Boolean)
          .join('\n\n---\n\n')
      : '';

    const buffer = await generateWorkbook({
      agentName: agent?.name || agentId,
      runDate: row.started_at,
      narrative,
      workspaceName: ws.rows[0].name,
      skillEvidence,
    });

    const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date(row.started_at).toISOString().split('T')[0];
    const filename = `pandora-${safeAgentId}-${dateStr}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(buffer);
  } catch (err) {
    console.error('[agents] Error exporting agent run:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export { agentsGlobalRouter, agentsWorkspaceRouter };
