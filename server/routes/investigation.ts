import { Router, Request, Response } from 'express';
import { getJobQueue } from '../jobs/queue.js';
import { query } from '../db.js';
import type { InvestigationPath } from '../briefing/greeting-engine.js';

const router = Router();
const jobQueue = getJobQueue();

router.post('/:workspaceId/investigation/trigger-skill', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { skillId, investigationPath, metadata } = req.body;

    if (!skillId) {
      res.status(400).json({ error: 'skillId is required' });
      return;
    }

    if (!investigationPath || !investigationPath.question) {
      res.status(400).json({ error: 'investigationPath with question is required' });
      return;
    }

    const jobId = await jobQueue.createJob({
      workspaceId,
      jobType: 'investigate_skill',
      payload: {
        skillId,
        investigationPath,
        metadata: metadata || {},
      },
      priority: investigationPath.priority === 'high' ? 10 : investigationPath.priority === 'medium' ? 5 : 0,
      maxAttempts: 1,
      timeoutMs: 600000,
    });

    res.json({
      jobId,
      message: `Investigation job queued for skill: ${skillId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[investigation] trigger-skill error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/investigation/results/:runId', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const runId = req.params.runId as string;

    const result = await query<{
      run_id: string;
      skill_id: string;
      status: string;
      output_text: string | null;
      output: any;
      result: any;
      token_usage: any;
      duration_ms: number;
      error: string | null;
      completed_at: string;
    }>(
      `SELECT run_id, skill_id, status, output_text, output, result, token_usage, duration_ms, error, completed_at
       FROM skill_runs
       WHERE run_id = $1 AND workspace_id = $2`,
      [runId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Investigation run not found' });
      return;
    }

    const run = result.rows[0];
    const evidence = run.output?.evidence || {};

    // Map evaluated_records → findings array
    const evaluatedRecords: any[] = evidence.evaluated_records || [];
    const findings = evaluatedRecords.map((rec: any) => ({
      entity_name: rec.entity_name || rec.fields?.deal_name || 'Unknown deal',
      entity_type: rec.entity_type || 'deal',
      severity: rec.severity === 'healthy' ? 'low' : rec.severity === 'warning' ? 'medium' : rec.severity || 'low',
      message: buildFindingMessage(rec),
      amount: rec.fields?.amount ? Number(rec.fields.amount) : null,
      stage: rec.fields?.stage || null,
      owner: rec.owner_name || rec.fields?.owner || null,
      risk_score: rec.fields?.risk_score ? Number(rec.fields.risk_score) : null,
      close_date: rec.fields?.close_date || null,
    }));

    // Parse narrative — skill returns a ```json ... ``` code block
    let narrativeItems: any[] = [];
    const rawNarrative: string = run.output?.narrative || '';
    if (rawNarrative) {
      try {
        const stripped = rawNarrative.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        narrativeItems = JSON.parse(stripped);
      } catch {
        // not parseable — treat as plain text, leave narrativeItems empty
      }
    }

    // Build human-readable summary
    const total = evaluatedRecords.length;
    const atRisk = evaluatedRecords.filter((r: any) => r.severity === 'warning' || r.severity === 'critical').length;
    const criticalCount = narrativeItems.filter((n: any) => n.risk === 'high').length;
    let summary = run.output_text || '';
    if (!summary && total > 0) {
      const parts: string[] = [`${total} deal${total !== 1 ? 's' : ''} reviewed.`];
      if (criticalCount > 0) parts.push(`${criticalCount} at high risk.`);
      if (atRisk - criticalCount > 0) parts.push(`${atRisk - criticalCount} at medium risk.`);
      if (total - atRisk > 0) parts.push(`${total - atRisk} healthy.`);
      summary = parts.join(' ');
    }
    if (!summary) summary = 'Investigation completed';

    // Data sources for evidence metadata
    const dataSources: any[] = evidence.data_sources || [];

    res.json({
      runId: run.run_id,
      skillId: run.skill_id,
      status: run.status,
      summary,
      findings,
      narrativeItems,
      dataSources,
      tokenUsage: run.token_usage,
      durationMs: run.duration_ms,
      error: run.error,
      completedAt: run.completed_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[investigation] results error:', msg);
    res.status(500).json({ error: msg });
  }
});

function buildFindingMessage(rec: any): string {
  const fields = rec.fields || {};
  const parts: string[] = [];
  if (fields.stage) parts.push(fields.stage.trim());
  if (fields.days_since_activity !== undefined && fields.days_since_activity !== null) {
    parts.push(`${fields.days_since_activity}d since activity`);
  }
  if (fields.contact_count !== undefined) {
    parts.push(`${fields.contact_count} contact${fields.contact_count !== 1 ? 's' : ''}`);
  }
  return parts.join(' · ');
}

export default router;
