/**
 * Workflow Run Monitor
 *
 * Polls running workflows and syncs status from ActivePieces.
 * Detects timeouts for runs stuck in 'running' state.
 */

import { Pool } from 'pg';
import { WorkflowService } from './workflow-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RunMonitor');

const TIMEOUT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Poll running workflows and sync their status
 */
export async function pollRunningWorkflows(
  workflowService: WorkflowService
): Promise<void> {
  logger.debug('[RunMonitor] Starting poll');

  const db = (workflowService as any).db as Pool;

  // Get running workflows from last 24 hours
  const result = await db.query(
    `
    SELECT id, started_at FROM workflow_runs
    WHERE status = 'running'
      AND started_at > now() - interval '24 hours'
    ORDER BY started_at ASC
    `
  );

  const runs = result.rows;
  logger.info('[RunMonitor] Found running workflows', { count: runs.length });

  if (runs.length === 0) {
    return;
  }

  let updated = 0;
  let errors = 0;
  let timedOut = 0;

  for (const run of runs) {
    try {
      // Check for timeout (running > 1 hour)
      const runtimeMs = Date.now() - new Date(run.started_at).getTime();

      if (runtimeMs > TIMEOUT_THRESHOLD_MS) {
        logger.warn('[RunMonitor] Run timeout detected', {
          runId: run.id,
          runtimeMs,
        });

        // Mark as timeout
        await db.query(
          `
          UPDATE workflow_runs
          SET status = 'timeout',
              completed_at = now(),
              duration_ms = $1,
              error_message = 'Workflow execution exceeded 1 hour timeout'
          WHERE id = $2
          `,
          [runtimeMs, run.id]
        );

        timedOut++;
        continue;
      }

      // Sync status from AP
      await workflowService.syncRunStatus(run.id);
      updated++;
    } catch (error) {
      logger.error('[RunMonitor] Failed to sync run status', {
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
      errors++;
    }
  }

  logger.info('[RunMonitor] Poll complete', {
    total: runs.length,
    updated,
    timedOut,
    errors,
  });
}
