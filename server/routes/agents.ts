import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getAgentRegistry } from '../agents/registry.js';
import { getAgentRuntime } from '../agents/runtime.js';
import { query } from '../db.js';
import { generateWorkbook } from '../delivery/workbook-generator.js';
import { getSkillRegistry } from '../skills/registry.js';
import type { AgentDefinition } from '../agents/types.js';
import { requireAdmin } from '../middleware/auth.js';
import { callLLM } from '../utils/llm-router.js';

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
  const { dryRun, question } = req.body || {};

  try {
    const runtime = getAgentRuntime();
    const result = await runtime.executeAgent(agentId, workspaceId, {
      dryRun,
      question: question || undefined,
      triggerType: question ? 'conversational' : 'manual',
    });
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

// Manual trigger for reports-first scheduling (testing flow without waiting for schedule)
agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/run-now', requirePermission('skills.run_manual'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const agentId = req.params.agentId as string;
  const { phase = 'both' } = req.body || {};

  if (!['skills', 'delivery', 'both'].includes(phase)) {
    return res.status(400).json({ error: 'Invalid phase. Must be: skills, delivery, or both' });
  }

  try {
    const { triggerAgentRunNow } = await import('../sync/report-scheduler.js');
    const result = await triggerAgentRunNow(agentId, workspaceId, phase as 'skills' | 'delivery' | 'both');
    res.json(result);
  } catch (err: any) {
    console.error(`[Agent Route] run-now failed for ${agentId}:`, err.message);
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

// ── Report Document Endpoints (Phase 2) ──────────────────────────────────────

agentsWorkspaceRouter.get('/:workspaceId/reports/latest', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const documentType = (req.query.type as string) || 'monday_briefing';

  try {
    const { getLatestReportDocument } = await import('../orchestrator/persistence.js');
    const report = await getLatestReportDocument(workspaceId, documentType);

    if (!report) {
      return res.status(404).json({ error: 'No reports found for this workspace and type' });
    }

    res.json(report);
  } catch (err: any) {
    console.error('[Reports] Failed to get latest report:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /reports/current — client-friendly alias for section picker in AddToReportButton
agentsWorkspaceRouter.get('/:workspaceId/reports/current', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const documentType = (req.query.type as string) || 'monday_briefing';

  try {
    const { getLatestReportDocument } = await import('../orchestrator/persistence.js');
    const report = await getLatestReportDocument(workspaceId, documentType);

    if (!report) {
      return res.status(404).json({ error: 'No report found' });
    }

    const sections = Array.isArray(report.sections)
      ? report.sections.map((s: any) => ({ id: s.id || s.section_id, title: s.title }))
      : [];

    res.json({
      id: report.id,
      week_label: report.generated_at
        ? new Date(report.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '',
      section_count: sections.length,
      sections,
    });
  } catch (err: any) {
    console.error('[Reports] Failed to get current report:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.get('/:workspaceId/reports', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

  try {
    const { getAllReportsForWorkspace } = await import('../orchestrator/persistence.js');
    const reports = await getAllReportsForWorkspace(workspaceId, limit);

    res.json({ reports, count: reports.length });
  } catch (err: any) {
    console.error('[Reports] Failed to get reports:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.get('/:workspaceId/reports/:reportId', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const reportId = req.params.reportId as string;

  try {
    const { getReportDocumentById } = await import('../orchestrator/persistence.js');
    const report = await getReportDocumentById(workspaceId, reportId);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (err: any) {
    console.error('[Reports] Failed to get report by ID:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Living Document: Per-section TipTap content save ─────────────────────────

agentsWorkspaceRouter.patch('/:workspaceId/report-documents/:documentId', requireAnyPermission('agents.edit_own', 'agents.edit_any'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const documentId = req.params.documentId as string;
  const { section_id, tiptap_content } = req.body;

  if (!section_id || typeof section_id !== 'string') {
    return res.status(400).json({ error: 'section_id is required' });
  }
  if (!tiptap_content || typeof tiptap_content !== 'object') {
    return res.status(400).json({ error: 'tiptap_content must be a JSON object' });
  }

  try {
    const result = await query(
      `UPDATE report_documents
       SET tiptap_content = jsonb_set(
         COALESCE(tiptap_content, '{}'::jsonb),
         $1::text[],
         $2::jsonb,
         true
       ),
       updated_at = NOW()
       WHERE id = $3 AND workspace_id = $4
       RETURNING id, tiptap_content`,
      [
        `{${section_id}}`,
        JSON.stringify(tiptap_content),
        documentId,
        workspaceId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report document not found' });
    }

    res.json({ ok: true, section_id, saved_at: new Date().toISOString() });
  } catch (err: any) {
    console.error('[ReportDocs] Failed to save tiptap content:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Hypothesis Tracking Endpoint ─────────────────────────────────────────────

agentsWorkspaceRouter.get('/:workspaceId/hypotheses', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;

  try {
    const result = await query(`
      SELECT
        metric_key,
        hypothesis_text,
        confidence,
        current_value,
        threshold,
        unit,
        updated_at
      FROM standing_hypotheses
      WHERE workspace_id = $1
        AND status = 'active'
        AND metric_key IS NOT NULL
      ORDER BY confidence DESC
    `, [workspaceId]);

    res.json({
      hypotheses: result.rows,
      count: result.rows.length
    });
  } catch (err: any) {
    console.error('[Hypotheses] Failed to get hypotheses:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Report Annotation Endpoints (Phase 3a) ───────────────────────────────────

// Helper: Verify report belongs to workspace
async function verifyReportOwnership(workspaceId: string, reportId: string): Promise<boolean> {
  const result = await query(
    'SELECT id FROM report_documents WHERE id = $1 AND workspace_id = $2',
    [reportId, workspaceId]
  );
  return result.rows.length > 0;
}

agentsWorkspaceRouter.get('/:workspaceId/reports/:reportId/annotations', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const reportId = req.params.reportId as string;

  try {
    // Verify ownership
    if (!await verifyReportOwnership(workspaceId, reportId)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const result = await query(
      `SELECT * FROM report_annotations
       WHERE report_document_id = $1
       ORDER BY section_id, paragraph_index`,
      [reportId]
    );

    res.json(result.rows);
  } catch (err: any) {
    console.error('[Annotations] Failed to get annotations:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.post('/:workspaceId/reports/:reportId/annotations', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const reportId = req.params.reportId as string;
  const { section_id, paragraph_index, annotation_type, content, original_content } = req.body;

  try {
    // Verify ownership
    if (!await verifyReportOwnership(workspaceId, reportId)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Validate required fields
    if (!section_id || paragraph_index == null || !annotation_type) {
      return res.status(400).json({ error: 'Missing required fields: section_id, paragraph_index, annotation_type' });
    }

    if (!['note', 'override', 'flag'].includes(annotation_type)) {
      return res.status(400).json({ error: 'Invalid annotation_type. Must be: note, override, or flag' });
    }

    // Upsert behavior: check if annotation already exists for this location
    const existing = await query(
      `SELECT id FROM report_annotations
       WHERE report_document_id = $1
         AND section_id = $2
         AND paragraph_index = $3`,
      [reportId, section_id, paragraph_index]
    );

    let result;
    if (existing.rows.length > 0) {
      // Update existing annotation
      result = await query(
        `UPDATE report_annotations
         SET annotation_type = $1,
             content = $2,
             original_content = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [annotation_type, content || '', original_content || null, existing.rows[0].id]
      );
    } else {
      // Insert new annotation
      result = await query(
        `INSERT INTO report_annotations (
           workspace_id, report_document_id, section_id,
           paragraph_index, annotation_type, content, original_content
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [workspaceId, reportId, section_id, paragraph_index, annotation_type, content || '', original_content || null]
      );
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[Annotations] Failed to save annotation:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.patch('/:workspaceId/reports/:reportId/annotations/:annotationId', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const reportId = req.params.reportId as string;
  const annotationId = req.params.annotationId as string;
  const { content, annotation_type } = req.body;

  try {
    // Verify ownership
    if (!await verifyReportOwnership(workspaceId, reportId)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Build update fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (content !== undefined) {
      updates.push(`content = $${++paramCount}`);
      values.push(content);
    }

    if (annotation_type !== undefined) {
      if (!['note', 'override', 'flag'].includes(annotation_type)) {
        return res.status(400).json({ error: 'Invalid annotation_type' });
      }
      updates.push(`annotation_type = $${++paramCount}`);
      values.push(annotation_type);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(annotationId, reportId, workspaceId);

    const result = await query(
      `UPDATE report_annotations
       SET ${updates.join(', ')}
       WHERE id = $${++paramCount}
         AND report_document_id = $${++paramCount}
         AND workspace_id = $${++paramCount}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[Annotations] Failed to update annotation:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.delete('/:workspaceId/reports/:reportId/annotations/:annotationId', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const reportId = req.params.reportId as string;
  const annotationId = req.params.annotationId as string;

  try {
    // Verify ownership
    if (!await verifyReportOwnership(workspaceId, reportId)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const result = await query(
      `DELETE FROM report_annotations
       WHERE id = $1
         AND report_document_id = $2
         AND workspace_id = $3
       RETURNING id`,
      [annotationId, reportId, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found' });
    }

    res.json({ deleted: true });
  } catch (err: any) {
    console.error('[Annotations] Failed to delete annotation:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Report Charts API (Build B) ──────────────────────────────────────────────

// GET chart suggestions for a report
agentsWorkspaceRouter.get('/:workspaceId/reports/:reportId/chart-suggestions', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;
    const result = await query(`
      SELECT section_id, chart_type, title, data_labels, data_values, reasoning, priority
      FROM report_chart_suggestions
      WHERE workspace_id = $1 AND report_document_id = $2
      ORDER BY priority DESC, created_at ASC
    `, [workspaceId, reportId]);
    res.json({ suggestions: result.rows });
  } catch (err: any) {
    console.error('[Charts] Failed to get chart suggestions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET all charts for a report
agentsWorkspaceRouter.get('/:workspaceId/reports/:reportId/charts', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;
    const result = await query(`
      SELECT id, section_id, chart_type, title, data_labels, data_values,
             chart_options, position_in_section, created_at, updated_at
      FROM report_charts
      WHERE workspace_id = $1 AND report_document_id = $2
      ORDER BY section_id, position_in_section ASC
    `, [workspaceId, reportId]);
    res.json({ charts: result.rows });
  } catch (err: any) {
    console.error('[Charts] Failed to get charts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST create a chart from suggestion or custom
agentsWorkspaceRouter.post('/:workspaceId/reports/:reportId/charts', requireAnyPermission('agents.edit_own', 'agents.edit_any'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;
    const { section_id, chart_type, title, data_labels, data_values, chart_options, position_in_section } = req.body;

    // Render chart to PNG via QuickChart.io HTTP API
    const { renderChartToPNG } = await import('../orchestrator/chart-renderer.js');
    const chartPNG = await renderChartToPNG({
      chart_type,
      title,
      data_labels,
      data_values,
      chart_options,
    });

    // Upsert: delete any existing chart for this section, then insert fresh
    await query(`
      DELETE FROM report_charts
      WHERE workspace_id = $1 AND report_document_id = $2 AND section_id = $3
    `, [workspaceId, reportId, section_id]);

    const result = await query(`
      INSERT INTO report_charts (
        workspace_id, report_document_id, section_id, chart_type,
        title, data_labels, data_values, chart_options, chart_png,
        position_in_section, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, section_id, chart_type, title, data_labels, data_values,
                chart_options, position_in_section, created_at, updated_at
    `, [
      workspaceId,
      reportId,
      section_id,
      chart_type,
      title,
      JSON.stringify(data_labels),
      JSON.stringify(data_values),
      JSON.stringify(chart_options || {}),
      chartPNG,
      position_in_section || 0,
      (req as any).user?.id || null,
    ]);

    res.status(201).json({
      chart: result.rows[0],
      chart_png_base64: chartPNG.toString('base64'),
    });
  } catch (err: any) {
    console.error('[Charts] Failed to create chart:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET chart PNG image — supports ?t=<session_token> for <img> src usage in TipTap
agentsWorkspaceRouter.get('/:workspaceId/reports/:reportId/charts/:chartId/image', async (req: Request, res: Response) => {
  try {
    const { workspaceId, chartId } = req.params;
    const tokenParam = req.query.t as string | undefined;

    // Resolve auth: Bearer header takes priority, then ?t= query param
    if (!req.user && tokenParam) {
      const sessionResult = await query(`
        SELECT us.user_id, u.email, u.name, u.role as platform_role
        FROM user_sessions us
        JOIN users u ON u.id = us.user_id
        WHERE us.token = $1 AND us.expires_at > NOW()
      `, [tokenParam]);
      if (sessionResult.rows[0]) {
        req.user = sessionResult.rows[0];
        req.authMethod = 'session';
      }
    }

    if (!req.user && req.authMethod !== 'api_key') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await query(`
      SELECT chart_png FROM report_charts
      WHERE workspace_id = $1 AND id = $2
    `, [workspaceId, chartId]);

    if (!result.rows[0] || !result.rows[0].chart_png) {
      return res.status(404).json({ error: 'Chart image not found' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.rows[0].chart_png);
  } catch (err: any) {
    console.error('[Charts] Failed to get chart image:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a chart
agentsWorkspaceRouter.delete('/:workspaceId/reports/:reportId/charts/:chartId', requireAnyPermission('agents.edit_own', 'agents.edit_any'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, chartId } = req.params;
    await query(`
      DELETE FROM report_charts
      WHERE workspace_id = $1 AND id = $2
    `, [workspaceId, chartId]);
    res.json({ deleted: true });
  } catch (err: any) {
    console.error('[Charts] Failed to delete chart:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST preview chart — returns base64 PNG without saving
agentsWorkspaceRouter.post('/:workspaceId/charts/preview', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { spec } = req.body;
    if (!spec) return res.status(400).json({ error: 'spec required' });

    const { renderChartFromSpec } = await import('../orchestrator/chart-renderer.js');
    const t0 = Date.now();
    const pngBuffer = await renderChartFromSpec(spec);
    const elapsed = Date.now() - t0;
    console.log(`[Charts] Preview rendered in ${elapsed}ms (${Math.round(pngBuffer.length / 1024)}KB)`);
    const png_base64 = pngBuffer.toString('base64');
    res.json({ png_base64, render_ms: elapsed });
  } catch (err: any) {
    console.error('[Charts] Preview failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET companion XLSX file with chart data
agentsWorkspaceRouter.get('/:workspaceId/reports/:reportId/charts-data.xlsx', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;

    // Verify report exists
    const { getReportDocumentById } = await import('../orchestrator/persistence.js');
    const reportDoc = await getReportDocumentById(workspaceId, reportId);
    if (!reportDoc) return res.status(404).json({ error: 'Report not found' });

    // Generate XLSX with chart data
    const { generateChartDataXLSX } = await import('../orchestrator/chart-xlsx-generator.js');
    const xlsxBuffer = await generateChartDataXLSX(reportId);

    const filename = `${reportDoc.week_label.replace(/[^a-z0-9]/gi, '-')}-chart-data.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xlsxBuffer);
  } catch (err: any) {
    console.error('[Charts] Failed to generate XLSX:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Report Export Endpoint (Phase 3b) ────────────────────────────────────────

agentsWorkspaceRouter.post('/:workspaceId/reports/:reportId/export', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const reportId = req.params.reportId as string;

  const config = {
    format:            (req.body.format || 'pdf') as 'pdf' | 'docx' | 'pptx',
    audience:          (req.body.audience || 'internal') as 'internal' | 'client',
    included_sections: (req.body.included_sections as string[] | null) || null,
    prepared_by:       (req.body.prepared_by as string) || 'RevOps Impact',
    for_company:       (req.body.for_company as string) || '',
    anonymize:         Boolean(req.body.anonymize),
    link_target:       (req.body.link_target || 'command_center') as 'hubspot' | 'command_center',
    include_actions:   req.body.include_actions !== false,
  };

  try {
    const { getReportDocumentById } = await import('../orchestrator/persistence.js');
    const reportDoc = await getReportDocumentById(workspaceId, reportId);
    if (!reportDoc) return res.status(404).json({ error: 'Report not found' });

    const { mergeAnnotationsForExport } = await import('../orchestrator/annotation-merge.js');
    let finalDoc = await mergeAnnotationsForExport(reportDoc, workspaceId);

    // Filter sections
    if (config.included_sections && config.included_sections.length > 0) {
      finalDoc = { ...finalDoc, sections: finalDoc.sections.filter(s => config.included_sections!.includes(s.id)) };
    }

    // Strip actions if not included
    if (!config.include_actions) {
      finalDoc = { ...finalDoc, actions: [] };
    }

    // Anonymize rep names
    if (config.anonymize) {
      finalDoc = anonymizeRepNames(finalDoc);
    }

    // Clean action text and format urgency
    finalDoc = {
      ...finalDoc,
      actions: finalDoc.actions.map(a => ({
        ...a,
        text: a.text.replace(/\s*—?\s*Owned by:.*$/i, '').trim(),
      })),
    };

    const { renderPdf, renderDocx, renderPptx } = await import('../orchestrator/report-renderer.js');
    const slug = (finalDoc.week_label || 'report').replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '');

    if (config.format === 'pdf') {
      const buf = await renderPdf(finalDoc, config);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
      return res.send(buf);
    }

    if (config.format === 'docx') {
      const buf = await renderDocx(finalDoc, config);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}.docx"`);
      return res.send(buf);
    }

    if (config.format === 'pptx') {
      const buf = await renderPptx(finalDoc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}.pptx"`);
      return res.send(buf);
    }

    return res.status(400).json({ error: `Unsupported format: ${config.format}` });
  } catch (err: any) {
    console.error('[Reports] Failed to export report:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Issue Tree Endpoints ─────────────────────────────────────────────────────

async function verifyAgentOwnership(workspaceId: string, agentId: string): Promise<boolean> {
  const result = await query(
    'SELECT id FROM agents WHERE id = $1 AND workspace_id = $2',
    [agentId, workspaceId]
  );
  return result.rows.length > 0;
}

agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/generate-questions', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const { workspaceId, agentId } = req.params;

  try {
    // Verify workspace + agent ownership
    if (!await verifyAgentOwnership(workspaceId, agentId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const { goal } = req.body;
    // goal from request body takes precedence over agent.goal — allows preview before saving

    if (!goal?.trim()) {
      return res.status(400).json({ error: 'Goal is required' });
    }

    // Get available skills for this workspace
    const skillRegistry = getSkillRegistry();
    const availableSkills = skillRegistry.getAll().map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description || s.name,
      category: s.category,
    }));

    const skillSummary = availableSkills
      .slice(0, 20)
      .map(s => `${s.id}: ${s.name} — ${s.description}`)
      .join('\n');

    const systemPrompt = `You are helping a Revenue Operations leader structure their weekly intelligence briefing. Given a business goal and available data sources, generate 3-5 specific questions that comprehensively cover the goal.

Rules:
- Questions must be mutually exclusive (no overlap)
- Questions must collectively exhaust the goal (nothing important left uncovered)
- Each question must be answerable with the available data sources
- Questions should be specific enough to drive a clear answer, not vague
- Write questions a VP RevOps would actually ask
- Do not use consulting jargon (no "MECE", no "issue tree", no "workstream")
- 3 questions minimum, 5 maximum

Respond ONLY with valid JSON:
{
  "questions": [
    {
      "text": "Will we hit our quarterly number?",
      "rationale": "One sentence why this is essential",
      "suggested_skills": ["forecast-rollup", "deal-risk-review"]
    }
  ]
}`;

    const userMessage = `GOAL: ${goal}

AVAILABLE DATA SOURCES:
${skillSummary}

Generate questions that comprehensively answer this goal using the available data.`;

    const response = await callLLM(workspaceId, 'reason', {
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 600,
      temperature: 0.3,
      _tracking: {
        workspaceId,
        skillId: 'agent-builder',
        phase: 'generate-questions',
      },
    });

    const raw = response.content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(raw);

    console.log(`[AgentBuilder] Generated ${parsed.questions.length} questions for agent ${agentId}`);

    return res.json({
      questions: parsed.questions,
      goal_used: goal,
      skills_considered: availableSkills.length,
    });

  } catch (err: any) {
    console.error('[AgentBuilder] Question generation failed:', err);
    return res.status(500).json({
      error: 'Question generation failed',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/generate-sections', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const { workspaceId, agentId } = req.params;
  const { goal, questions } = req.body;
  // questions: string[] — the accepted question texts

  try {
    // Verify workspace + agent ownership
    if (!await verifyAgentOwnership(workspaceId, agentId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (!goal?.trim()) {
      return res.status(400).json({ error: 'Goal is required' });
    }
    if (!questions?.length || questions.length < 2) {
      return res.status(400).json({ error: 'At least 2 questions required' });
    }

    const skillRegistry = getSkillRegistry();
    const availableSkills = skillRegistry.getAll().map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description || s.name,
      category: s.category,
    }));

    const skillSummary = availableSkills.slice(0, 20);

    const systemPrompt = `You are structuring a weekly intelligence report for a Revenue Operations leader. Given a business goal and specific questions, design a report structure where each section directly answers one question.

For each section, determine:
1. A clear title (3-5 words, no jargon)
2. Which question it answers
3. What kind of analysis it is:
   forecast / pipeline_health / execution / hygiene / retention / generation / custom
4. What action format the section drives:
   deal_level (specific deals to act on)
   rep_level (coaching or rep-specific actions)
   system_level (process or config changes)
5. Which 1-3 skills from the available list best answer this question
6. Which data to extract from those skills:
   deals, contacts, rep metrics, activities

Rules:
- One section per question
- Keep section count between 3 and 5
- Skill assignments must use IDs from the available skills list exactly
- section_intent must be one of the valid values
- action_format must match what the section actually drives

Respond ONLY with valid JSON:
{
  "sections": [
    {
      "title": "Forecast Landing Zone",
      "standing_question": "Will we hit our number?",
      "section_intent": "forecast",
      "action_format": "deal_level",
      "position": 1,
      "primary_skill_ids": ["forecast-rollup", "deal-risk-review"],
      "data_extraction_config": {
        "extract_deals": true,
        "extract_contacts": false,
        "extract_rep_metrics": false,
        "extract_activities": false,
        "key_metrics": ["closed_won", "open_pipeline", "coverage_ratio"]
      },
      "reasoning_layers": ["cause", "second_order", "action"],
      "rationale": "One sentence why this structure"
    }
  ]
}`;

    const userMessage = `GOAL: ${goal}

QUESTIONS TO ANSWER:
${questions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}

AVAILABLE SKILLS:
${JSON.stringify(skillSummary, null, 2)}

Design a report structure that answers all ${questions.length} questions.`;

    const response = await callLLM(workspaceId, 'reason', {
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1200,
      temperature: 0.2,
      _tracking: {
        workspaceId,
        skillId: 'agent-builder',
        phase: 'generate-sections',
      },
    });

    const raw = response.content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(raw);

    // Validate skill IDs against actual available skills
    const validSkillIds = new Set(availableSkills.map((s: any) => s.id));

    const validatedSections = parsed.sections.map((section: any, idx: number) => ({
      ...section,
      position: idx + 1,
      primary_skill_ids: (section.primary_skill_ids || []).filter((id: string) => validSkillIds.has(id)),
    }));

    console.log(`[AgentBuilder] Generated ${validatedSections.length} sections for agent ${agentId}`);

    return res.json({
      sections: validatedSections,
      goal_used: goal,
      questions_used: questions,
    });

  } catch (err: any) {
    console.error('[AgentBuilder] Section generation failed:', err);
    return res.status(500).json({
      error: 'Section generation failed',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

agentsWorkspaceRouter.get('/:workspaceId/agents/:agentId/issue-tree', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const { workspaceId, agentId } = req.params;
  try {
    if (!await verifyAgentOwnership(workspaceId, agentId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const result = await query(
      `SELECT node_id, title, standing_question, mece_category, primary_skill_ids,
              position, confirmed_pattern, pattern_summary,
              section_intent, action_format, data_extraction_config, reasoning_layers
       FROM agent_issue_tree
       WHERE agent_id = $1 AND workspace_id = $2
       ORDER BY position ASC`,
      [agentId, workspaceId]
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[IssueTree] GET failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/issue-tree', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const { workspaceId, agentId } = req.params;
  const {
    node_id, title, standing_question, mece_category, primary_skill_ids, position,
    section_intent, action_format, data_extraction_config, reasoning_layers
  } = req.body;
  try {
    if (!await verifyAgentOwnership(workspaceId, agentId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (!node_id || !title) {
      return res.status(400).json({ error: 'node_id and title are required' });
    }
    const result = await query(
      `INSERT INTO agent_issue_tree
         (agent_id, workspace_id, node_id, title, standing_question, mece_category, primary_skill_ids, position,
          section_intent, action_format, data_extraction_config, reasoning_layers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (agent_id, node_id) DO UPDATE SET
         title = EXCLUDED.title,
         standing_question = EXCLUDED.standing_question,
         mece_category = EXCLUDED.mece_category,
         primary_skill_ids = EXCLUDED.primary_skill_ids,
         position = EXCLUDED.position,
         section_intent = EXCLUDED.section_intent,
         action_format = EXCLUDED.action_format,
         data_extraction_config = EXCLUDED.data_extraction_config,
         reasoning_layers = EXCLUDED.reasoning_layers,
         updated_at = NOW()
       RETURNING node_id, title, standing_question, mece_category, primary_skill_ids,
                 position, confirmed_pattern, pattern_summary,
                 section_intent, action_format, data_extraction_config, reasoning_layers`,
      [
        agentId, workspaceId, node_id, title, standing_question ?? null,
        mece_category ?? 'custom', primary_skill_ids ?? [], position ?? 1,
        section_intent ?? null, action_format ?? 'deal_level',
        data_extraction_config ?? {}, reasoning_layers ?? ['cause', 'second_order', 'third_order', 'action']
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[IssueTree] POST failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.patch('/:workspaceId/agents/:agentId/issue-tree/reorder', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const { workspaceId, agentId } = req.params;
  const { positions } = req.body as { positions: { node_id: string; position: number }[] };
  try {
    if (!await verifyAgentOwnership(workspaceId, agentId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (!Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({ error: 'positions array is required' });
    }
    let updated = 0;
    for (const { node_id, position } of positions) {
      const r = await query(
        `UPDATE agent_issue_tree SET position = $1, updated_at = NOW()
         WHERE agent_id = $2 AND node_id = $3 AND workspace_id = $4`,
        [position, agentId, node_id, workspaceId]
      );
      updated += r.rowCount || 0;
    }
    res.json({ updated });
  } catch (err: any) {
    console.error('[IssueTree] Reorder failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.patch('/:workspaceId/agents/:agentId/issue-tree/:nodeId', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const { workspaceId, agentId, nodeId } = req.params;
  const {
    title, standing_question, mece_category, primary_skill_ids, position, confirmed_pattern, pattern_summary,
    section_intent, action_format, data_extraction_config, reasoning_layers
  } = req.body;
  try {
    if (!await verifyAgentOwnership(workspaceId, agentId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const updates: string[] = [];
    const values: any[] = [];
    let p = 0;
    if (title !== undefined) { updates.push(`title = $${++p}`); values.push(title); }
    if (standing_question !== undefined) { updates.push(`standing_question = $${++p}`); values.push(standing_question); }
    if (mece_category !== undefined) { updates.push(`mece_category = $${++p}`); values.push(mece_category); }
    if (primary_skill_ids !== undefined) { updates.push(`primary_skill_ids = $${++p}`); values.push(primary_skill_ids); }
    if (position !== undefined) { updates.push(`position = $${++p}`); values.push(position); }
    if (confirmed_pattern !== undefined) { updates.push(`confirmed_pattern = $${++p}`); values.push(confirmed_pattern); }
    if (pattern_summary !== undefined) { updates.push(`pattern_summary = $${++p}`); values.push(pattern_summary); }
    if (section_intent !== undefined) { updates.push(`section_intent = $${++p}`); values.push(section_intent); }
    if (action_format !== undefined) { updates.push(`action_format = $${++p}`); values.push(action_format); }
    if (data_extraction_config !== undefined) { updates.push(`data_extraction_config = $${++p}`); values.push(data_extraction_config); }
    if (reasoning_layers !== undefined) { updates.push(`reasoning_layers = $${++p}`); values.push(reasoning_layers); }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    updates.push(`updated_at = NOW()`);
    values.push(agentId, nodeId, workspaceId);
    const result = await query(
      `UPDATE agent_issue_tree SET ${updates.join(', ')}
       WHERE agent_id = $${++p} AND node_id = $${++p} AND workspace_id = $${++p}
       RETURNING node_id, title, standing_question, mece_category, primary_skill_ids,
                 position, confirmed_pattern, pattern_summary,
                 section_intent, action_format, data_extraction_config, reasoning_layers`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[IssueTree] PATCH failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

agentsWorkspaceRouter.delete('/:workspaceId/agents/:agentId/issue-tree/:nodeId', requirePermission('agents.view'), async (req: Request, res: Response) => {
  const { workspaceId, agentId, nodeId } = req.params;
  try {
    if (!await verifyAgentOwnership(workspaceId, agentId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const result = await query(
      `DELETE FROM agent_issue_tree
       WHERE agent_id = $1 AND node_id = $2 AND workspace_id = $3
       RETURNING node_id`,
      [agentId, nodeId, workspaceId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json({ deleted: true });
  } catch (err: any) {
    console.error('[IssueTree] DELETE failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function anonymizeText(text: string, nameMap: Map<string, string>): string {
  let result = text;
  nameMap.forEach((alias, realName) => {
    // Bug 3 fix: handle possessives — "Nate Phillips'" and "Nate Phillips's"
    const escaped = realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped + "'?s?", 'g'), alias);
  });
  return result;
}

function anonymizeRepNames(doc: any): any {
  const repNames = new Set<string>();
  (doc.actions || []).forEach((a: any) => {
    if (a.rep_name) repNames.add(a.rep_name);
    if (a.owner_email) {
      const name = a.owner_email.split('@')[0]
        .replace(/[._]/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      repNames.add(name);
    }
  });

  const nameList = Array.from(repNames);
  const nameMap = new Map<string, string>();
  nameList.forEach((name, i) => nameMap.set(name, `Rep ${i + 1}`));

  // Also map first names so standalone "Sara" matches as well as "Sara Bollman"
  nameList.forEach((fullName, i) => {
    const firstName = fullName.split(' ')[0];
    if (firstName && firstName.length > 3 && !nameMap.has(firstName)) {
      nameMap.set(firstName, `Rep ${i + 1}`);
    }
  });

  if (nameMap.size === 0) return doc;

  const sections = (doc.sections || []).map((section: any) => ({
    ...section,
    content: anonymizeText(section.content, nameMap),
  }));

  const actions = (doc.actions || []).map((action: any) => ({
    ...action,
    text: anonymizeText(action.text, nameMap),
    rep_name: action.rep_name ? (nameMap.get(action.rep_name) || action.rep_name) : action.rep_name,
  }));

  // Bug 1 fix: also anonymize recommended_next_steps
  const recommended_next_steps = anonymizeText(doc.recommended_next_steps || '', nameMap);

  return { ...doc, sections, actions, recommended_next_steps };
}

export { agentsGlobalRouter, agentsWorkspaceRouter };
