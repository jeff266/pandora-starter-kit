import { Router, Request, Response } from 'express';
import { getJobQueue } from '../jobs/queue.js';
import { query } from '../db.js';
import type { InvestigationPath } from '../briefing/greeting-engine.js';
import { compareInvestigationRuns } from '../briefing/investigation-delta.js';
import { exportInvestigationCSV, exportInvestigationXLSX } from '../utils/investigation-export.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';

const router = Router();
const jobQueue = getJobQueue();

// Download storage for exports (same pattern as downloads.ts)
const downloadStore = new Map<string, {
  filepath: string;
  filename: string;
  format: string;
  createdAt: number;
}>();

// Cleanup expired downloads every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, ref] of downloadStore.entries()) {
    if (now - ref.createdAt > 3600000) { // 1 hour
      downloadStore.delete(id);
      if (fs.existsSync(ref.filepath)) {
        fs.unlink(ref.filepath, () => {});
      }
    }
  }
}, 15 * 60 * 1000);

function generateDownloadId(): string {
  return `dl_${randomUUID()}`;
}

function storeDownloadReference(
  id: string,
  filepath: string,
  filename: string,
  format: string
): void {
  downloadStore.set(id, {
    filepath,
    filename,
    format,
    createdAt: Date.now(),
  });
}

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

router.get('/:workspaceId/investigation/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const skillId = req.query.skill_id as string | undefined;
    const status = req.query.status as string | undefined;
    const fromDate = req.query.from_date as string | undefined;
    const toDate = req.query.to_date as string | undefined;

    // Build query with filters
    const params: any[] = [workspaceId];
    let paramIndex = 2;

    const conditions: string[] = ['workspace_id = $1'];

    if (skillId) {
      conditions.push(`skill_id = $${paramIndex}`);
      params.push(skillId);
      paramIndex++;
    }

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (fromDate) {
      conditions.push(`completed_at >= $${paramIndex}`);
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      conditions.push(`completed_at <= $${paramIndex}`);
      params.push(toDate);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM skill_runs WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0');

    // Get paginated results
    const result = await query<{
      run_id: string;
      skill_id: string;
      status: string;
      output: any;
      completed_at: string;
      started_at: string;
      created_at: string;
      duration_ms: number;
      error: string | null;
    }>(
      `SELECT run_id, skill_id, status, output, completed_at, started_at, created_at, duration_ms, error
       FROM skill_runs
       WHERE ${whereClause}
       ORDER BY completed_at DESC NULLS LAST
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    // Process runs to extract summaries
    const runs = result.rows.map(run => {
      const evaluatedRecords = run.output?.evidence?.evaluated_records || [];
      const totalRecords = evaluatedRecords.length;
      const criticalCount = evaluatedRecords.filter((r: any) => r.severity === 'critical').length;
      const warningCount = evaluatedRecords.filter((r: any) => r.severity === 'warning').length;
      const atRiskCount = criticalCount + warningCount;

      return {
        runId: run.run_id,
        skillId: run.skill_id,
        status: run.status,
        completedAt: run.completed_at,
        startedAt: run.started_at,
        createdAt: run.created_at,
        durationMs: run.duration_ms,
        error: run.error,
        summary: {
          totalRecords,
          atRiskCount,
          criticalCount,
          warningCount,
        },
      };
    });

    res.json({
      runs,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[investigation] history error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/investigation/timeline', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const skillId = req.query.skill_id as string;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);

    if (!skillId) {
      res.status(400).json({ error: 'skill_id is required' });
      return;
    }

    // Get all completed runs for this skill in the time range
    const result = await query<{
      run_id: string;
      completed_at: string;
      output: any;
    }>(
      `SELECT run_id, completed_at, output
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = $2
         AND status = 'completed'
         AND completed_at >= NOW() - INTERVAL '1 day' * $3
       ORDER BY completed_at ASC`,
      [workspaceId, skillId, days]
    );

    const runs = result.rows;
    const points: any[] = [];
    let previousRun: { output: any } | null = null;

    for (const run of runs) {
      const evaluatedRecords = run.output?.evidence?.evaluated_records || [];
      const totalRecords = evaluatedRecords.length;
      const criticalCount = evaluatedRecords.filter((r: any) => r.severity === 'critical').length;
      const warningCount = evaluatedRecords.filter((r: any) => r.severity === 'warning').length;
      const healthyCount = evaluatedRecords.filter((r: any) => r.severity === 'healthy').length;
      const atRiskCount = criticalCount + warningCount;

      // Calculate delta from previous run
      let deltaFromPrevious = { newAtRisk: 0, improved: 0 };
      if (previousRun) {
        const currentHighRisk = evaluatedRecords
          .filter((r: any) => r.severity === 'warning' || r.severity === 'critical')
          .map((r: any) => r.entity_name);

        const previousHighRisk = (previousRun.output?.evidence?.evaluated_records || [])
          .filter((r: any) => r.severity === 'warning' || r.severity === 'critical')
          .map((r: any) => r.entity_name);

        const newAtRisk = currentHighRisk.filter((name: string) => !previousHighRisk.includes(name)).length;
        const improved = previousHighRisk.filter((name: string) => !currentHighRisk.includes(name)).length;

        deltaFromPrevious = { newAtRisk, improved };
      }

      points.push({
        timestamp: run.completed_at,
        runId: run.run_id,
        totalRecords,
        atRiskCount,
        criticalCount,
        warningCount,
        healthyCount,
        deltaFromPrevious,
      });

      previousRun = run;
    }

    // Calculate trend direction using simple linear regression
    let trendDirection: 'improving' | 'worsening' | 'stable' = 'stable';
    if (points.length >= 3) {
      const atRiskValues = points.map(p => p.atRiskCount);
      const n = atRiskValues.length;
      const xMean = (n - 1) / 2;
      const yMean = atRiskValues.reduce((sum, val) => sum + val, 0) / n;

      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < n; i++) {
        numerator += (i - xMean) * (atRiskValues[i] - yMean);
        denominator += (i - xMean) * (i - xMean);
      }

      const slope = denominator !== 0 ? numerator / denominator : 0;

      if (slope > 0.1) trendDirection = 'worsening';
      else if (slope < -0.1) trendDirection = 'improving';
    }

    const averageAtRisk = points.length > 0
      ? points.reduce((sum, p) => sum + p.atRiskCount, 0) / points.length
      : 0;

    res.json({
      skillId,
      points,
      summary: {
        totalRuns: points.length,
        averageAtRisk: Math.round(averageAtRisk * 10) / 10,
        trendDirection,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[investigation] timeline error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/investigation/deal-timeline/:dealName', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const dealName = decodeURIComponent(req.params.dealName as string);

    // Find all runs where this deal appears in evaluated_records
    const result = await query<{
      run_id: string;
      skill_id: string;
      completed_at: string;
      output: any;
    }>(
      `SELECT run_id, skill_id, completed_at, output
       FROM skill_runs
       WHERE workspace_id = $1
         AND status = 'completed'
         AND output->'evidence'->'evaluated_records' @> $2::jsonb
       ORDER BY completed_at ASC
       LIMIT 50`,
      [workspaceId, JSON.stringify([{ entity_name: dealName }])]
    );

    if (result.rows.length === 0) {
      res.json({
        dealName,
        timeline: [],
        summary: {
          firstFlagged: null,
          daysFlagged: 0,
          timesAppeared: 0,
          isRecurring: false,
        },
      });
      return;
    }

    const timeline: any[] = [];
    let previousSeverity: string | null = null;

    for (const run of result.rows) {
      const evaluatedRecords = run.output?.evidence?.evaluated_records || [];
      const dealRecord = evaluatedRecords.find((r: any) => r.entity_name === dealName);

      if (dealRecord) {
        const severity = dealRecord.severity || 'healthy';
        let severityChange: 'escalated' | 'de-escalated' | 'unchanged' = 'unchanged';

        if (previousSeverity) {
          if (previousSeverity === 'healthy' && severity === 'warning') severityChange = 'escalated';
          else if (previousSeverity === 'healthy' && severity === 'critical') severityChange = 'escalated';
          else if (previousSeverity === 'warning' && severity === 'critical') severityChange = 'escalated';
          else if (previousSeverity === 'critical' && severity === 'warning') severityChange = 'de-escalated';
          else if (previousSeverity === 'warning' && severity === 'healthy') severityChange = 'de-escalated';
          else if (previousSeverity === 'critical' && severity === 'healthy') severityChange = 'de-escalated';
        }

        timeline.push({
          timestamp: run.completed_at,
          runId: run.run_id,
          skillId: run.skill_id,
          severity,
          finding: buildFindingMessage(dealRecord),
          severityChange,
        });

        previousSeverity = severity;
      }
    }

    const firstFlagged = timeline[0]?.timestamp || null;
    const daysFlagged = firstFlagged
      ? Math.floor((Date.now() - new Date(firstFlagged).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const timesAppeared = timeline.length;
    const isRecurring = timesAppeared >= 3;

    res.json({
      dealName,
      timeline,
      summary: {
        firstFlagged,
        daysFlagged,
        timesAppeared,
        isRecurring,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[investigation] deal-timeline error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.post('/:workspaceId/investigation/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { runId, format } = req.body;

    if (!runId) {
      res.status(400).json({ error: 'runId is required' });
      return;
    }

    if (!format || !['csv', 'xlsx'].includes(format)) {
      res.status(400).json({ error: 'format must be csv or xlsx' });
      return;
    }

    // Export investigation
    let result: { buffer: Buffer; filename: string };
    if (format === 'csv') {
      result = await exportInvestigationCSV(workspaceId, runId);
    } else {
      result = await exportInvestigationXLSX(workspaceId, runId);
    }

    // Write buffer to temp file
    const filepath = path.join(os.tmpdir(), result.filename);
    fs.writeFileSync(filepath, result.buffer);

    // Store download reference
    const downloadId = generateDownloadId();
    storeDownloadReference(downloadId, filepath, result.filename, format);

    res.json({
      downloadUrl: `/api/workspaces/${workspaceId}/investigation/downloads/${downloadId}`,
      filename: result.filename,
      format,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[investigation] export error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/investigation/downloads/:downloadId', async (req: Request, res: Response): Promise<void> => {
  try {
    const downloadId = req.params.downloadId as string;
    const ref = downloadStore.get(downloadId);

    if (!ref) {
      res.status(404).json({ error: 'Download not found or expired' });
      return;
    }

    // Check if expired (1 hour)
    if (Date.now() - ref.createdAt > 3600000) {
      downloadStore.delete(downloadId);
      if (fs.existsSync(ref.filepath)) {
        fs.unlink(ref.filepath, () => {});
      }
      res.status(410).json({ error: 'Download expired - please regenerate export' });
      return;
    }

    if (!fs.existsSync(ref.filepath)) {
      downloadStore.delete(downloadId);
      res.status(410).json({ error: 'File not found - please regenerate export' });
      return;
    }

    // Set headers for download
    const mimeTypes: Record<string, string> = {
      csv: 'text/csv',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    res.setHeader('Content-Type', mimeTypes[ref.format] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${ref.filename}"`);

    // Stream file to client
    const stream = fs.createReadStream(ref.filepath);
    stream.pipe(res);
    stream.on('end', () => {
      // Clean up temp file after download
      fs.unlink(ref.filepath, () => {});
      downloadStore.delete(downloadId);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[investigation] download error:', msg);
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
