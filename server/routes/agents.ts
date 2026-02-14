import { Router, type Request, type Response } from 'express';
import { getAgentRegistry } from '../agents/registry.js';
import { getAgentRuntime } from '../agents/runtime.js';
import { query } from '../db.js';
import type { AgentDefinition } from '../agents/types.js';

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

agentsGlobalRouter.post('/agents', (req: Request, res: Response) => {
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

agentsGlobalRouter.put('/agents/:agentId', (req: Request, res: Response) => {
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

agentsGlobalRouter.delete('/agents/:agentId', (req: Request, res: Response) => {
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

export { agentsGlobalRouter, agentsWorkspaceRouter };
