import { Router, Request, Response } from 'express';
import { JobQueue } from '../jobs/queue.js';
import { query } from '../db.js';
import type { InvestigationPath } from '../briefing/greeting-engine.js';

const router = Router();
const jobQueue = new JobQueue();

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

    // Create job with type 'investigate_skill'
    const jobId = await jobQueue.createJob({
      workspaceId,
      jobType: 'investigate_skill',
      payload: {
        skillId,
        investigationPath,
        metadata: metadata || {},
      },
      priority: investigationPath.priority === 'high' ? 10 : investigationPath.priority === 'medium' ? 5 : 0,
      maxAttempts: 1,  // Skills are expensive, don't retry automatically
      timeoutMs: 600000,  // 10 minutes
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

    // Query skill_runs table for formatted results
    const result = await query<{
      run_id: string;
      skill_id: string;
      status: string;
      output_text: string;
      output: any;
      result: any;
      steps: any;
      token_usage: any;
      duration_ms: number;
      error: string | null;
      completed_at: string;
    }>(
      `SELECT run_id, skill_id, status, output_text, output, result, steps, token_usage, duration_ms, error, completed_at
       FROM skill_runs
       WHERE run_id = $1 AND workspace_id = $2`,
      [runId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Investigation run not found' });
      return;
    }

    const run = result.rows[0];

    // Format response
    res.json({
      runId: run.run_id,
      skillId: run.skill_id,
      status: run.status,
      summary: run.output_text || 'Investigation completed',
      output: run.output,
      findings: run.result?.findings || [],
      evidence: run.output?.evidence || [],
      narrative: run.output?.narrative || '',
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

export default router;
