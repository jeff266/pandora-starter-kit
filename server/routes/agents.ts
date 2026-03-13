import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getAgentRegistry } from '../agents/registry.js';
import { getAgentRuntime } from '../agents/runtime.js';
import { query } from '../db.js';
import { generateWorkbook } from '../delivery/workbook-generator.js';
import { getSkillRegistry } from '../skills/registry.js';
import type { AgentDefinition } from '../agents/types.js';
import { requireAdmin } from '../middleware/auth.js';

const agentsGlobalRouter = Router();
const agentsWorkspaceRouter = Router();

agentsGlobalRouter.get('/agents', requireAdmin, (_req: Request, res: Response) => {
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

agentsGlobalRouter.get('/agents/:agentId', requireAdmin, (req: Request, res: Response) => {
  const registry = getAgentRegistry();
  const agent = registry.get(req.params.agentId as string);
  if (!agent) {
    return res.status(404).json({ error: `Agent '${req.params.agentId as string}' not found` });
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
      // Operator model fields (optional)
      ...(body.role && { role: body.role }),
      ...(body.execution_mode && { execution_mode: body.execution_mode }),
      ...(body.loop_config && { loop_config: body.loop_config }),
      ...(body.post_action_playbook && { post_action_playbook: body.post_action_playbook }),
      ...(body.autonomy_tier && { autonomy_tier: body.autonomy_tier }),
      ...(body.promotion_history && { promotion_history: body.promotion_history }),
      ...(body.goal && { goal: body.goal }),
      ...(body.standing_questions && { standing_questions: body.standing_questions }),
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
  const existing = registry.get(req.params.agentId as string);
  if (!existing) {
    return res.status(404).json({ error: `Agent '${req.params.agentId as string}' not found` });
  }

  const updates = req.body;
  const updated: AgentDefinition = {
    ...existing,
    ...updates,
    id: existing.id,
    updatedAt: new Date(),
    // Operator model fields are merged via spread operator above, but explicitly preserve if not provided
    ...(updates.role !== undefined && { role: updates.role }),
    ...(updates.execution_mode !== undefined && { execution_mode: updates.execution_mode }),
    ...(updates.loop_config !== undefined && { loop_config: updates.loop_config }),
    ...(updates.post_action_playbook !== undefined && { post_action_playbook: updates.post_action_playbook }),
    ...(updates.autonomy_tier !== undefined && { autonomy_tier: updates.autonomy_tier }),
    ...(updates.promotion_history !== undefined && { promotion_history: updates.promotion_history }),
  };

  registry.remove(existing.id);
  registry.register(updated);
  res.json({ ok: true, agent: updated });
});

agentsGlobalRouter.delete('/agents/:agentId', requireAdmin, (req: Request, res: Response) => {
  const registry = getAgentRegistry();
  const removed = registry.remove(req.params.agentId as string);
  if (!removed) {
    return res.status(404).json({ error: `Agent '${req.params.agentId as string}' not found` });
  }
  res.json({ ok: true });
});

agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/run', requirePermission('skills.run_manual'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const agentId = req.params.agentId as string;
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
  const workspaceId = req.params.workspaceId as string;
  const agentId = req.params.agentId as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const before = req.query.before as string | undefined;

  const params: any[] = [workspaceId, agentId, limit];
  let cursorClause = '';
  if (before) {
    params.push(before);
    cursorClause = `AND started_at < $${params.length}`;
  }

  const result = await query(
    `SELECT id, agent_id, workspace_id, status,
            started_at, completed_at, duration_ms,
            skill_results, skill_evidence, token_usage, error,
            synthesis_mode,
            synthesized_output AS synthesis_output
     FROM agent_runs
     WHERE workspace_id = $1 AND agent_id = $2 ${cursorClause}
     ORDER BY started_at DESC
     LIMIT $3`,
    params
  );

  const rows = result.rows.map((run: any) => {
    const skillResults: any[] = Array.isArray(run.skill_results) ? run.skill_results
      : (typeof run.skill_results === 'string' ? JSON.parse(run.skill_results || '[]') : []);
    const skillEvidence: Record<string, any> = run.skill_evidence || {};
    const tokenUsage: any = typeof run.token_usage === 'string'
      ? JSON.parse(run.token_usage || '{}') : (run.token_usage || {});

    let findingsCount = 0;
    for (const ev of Object.values(skillEvidence)) {
      findingsCount += (ev as any)?.evidence?.claims?.length || 0;
    }
    if (findingsCount === 0 && skillResults.length > 0) {
      findingsCount = skillResults.filter((s: any) => s.status === 'success').length;
    }

    const totalTokens: number | null =
      (tokenUsage.total != null ? tokenUsage.total :
        ((tokenUsage.input || 0) + (tokenUsage.output || 0))) || null;

    const skillsRun: string[] = skillResults
      .map((s: any) => s.skillId || s.skill_id || '')
      .filter(Boolean);

    return {
      id: run.id,
      status: run.status,
      synthesis_mode: run.synthesis_mode || null,
      started_at: run.started_at,
      completed_at: run.completed_at,
      duration_ms: run.duration_ms,
      findings_count: findingsCount || null,
      skills_run: skillsRun,
      total_tokens: totalTokens,
      synthesis_output: run.synthesis_output || null,
      error_message: run.error || null,
      trend: null as 'improving' | 'worsening' | 'stable' | null,
    };
  });

  for (let i = 0; i < rows.length - 1; i++) {
    const cur = rows[i];
    const prev = rows[i + 1];
    if (cur.findings_count != null && prev.findings_count != null) {
      if (cur.findings_count < prev.findings_count) cur.trend = 'improving';
      else if (cur.findings_count > prev.findings_count) cur.trend = 'worsening';
      else cur.trend = 'stable';
    }
  }

  res.json({ runs: rows, has_more: rows.length === limit });
});

agentsWorkspaceRouter.get('/:workspaceId/agents/runs/all', async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
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
    const workspaceId = req.params.workspaceId as string;
    const agentId = req.params.agentId as string;
    const runId = req.params.runId as string;

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

agentsWorkspaceRouter.post('/agents/suggest-skills', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const { goal = '', standing_questions = [] } = req.body as { goal?: string; standing_questions?: string[] };

  if (!goal && standing_questions.length === 0) {
    return res.json({ suggested: [] });
  }

  const skillRegistry = getSkillRegistry();
  const catalog = skillRegistry.getAll().map((s: any) => ({
    id: s.id,
    name: s.name,
    description: s.description || s.name,
  }));

  const catalogText = catalog
    .map((s: { id: string; name: string; description: string }) => `- ${s.id}: ${s.name} — ${s.description}`)
    .join('\n');

  const questionsText = standing_questions.length > 0
    ? `Standing questions:\n${(standing_questions as string[]).map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}`
    : '';

  const systemPrompt = `You are a RevOps analyst helping configure a revenue intelligence agent. Given an agent goal and standing questions, select the most relevant skills from the available catalog. Return ONLY valid JSON matching this schema exactly: { "suggested": [{ "skill_id": string, "reason": string }] }. Include 2–4 skills maximum. Reason should be one short sentence (≤15 words) explaining why this skill answers the goal/questions.`;

  const userPrompt = `Agent goal: ${goal || '(not set)'}
${questionsText}

Available skills:
${catalogText}

Return JSON: { "suggested": [{ "skill_id": "...", "reason": "..." }] }`;

  try {
    const { callLLM } = await import('../utils/llm-router.js');
    const llmResponse = await callLLM(workspaceId, 'classify', {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = llmResponse.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ suggested: [] });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validSkillIds = new Set(catalog.map((s: { id: string }) => s.id));
    const suggested = (parsed.suggested || []).filter(
      (s: { skill_id: string; reason: string }) => s.skill_id && validSkillIds.has(s.skill_id) && s.reason
    );

    return res.json({ suggested });
  } catch (err) {
    console.warn('[agents] suggest-skills LLM call failed, returning empty:', (err as Error).message);
    return res.json({ suggested: [] });
  }
});

export { agentsGlobalRouter, agentsWorkspaceRouter };
