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
      const buf = await renderDocx(finalDoc);
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
