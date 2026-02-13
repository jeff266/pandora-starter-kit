import cron from 'node-cron';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WorkflowMonitor');

let monitorJob: cron.ScheduledTask | null = null;

export async function pollRunningWorkflows(): Promise<void> {
  try {
    const result = await query<{ id: string; workflow_id: string; ap_run_id: string }>(
      `SELECT id, workflow_id, ap_run_id FROM workflow_runs WHERE status = 'running' AND ap_run_id IS NOT NULL`
    );

    if (result.rows.length === 0) {
      return;
    }

    logger.debug('[WorkflowMonitor] Found running workflows', { count: result.rows.length });

    const staleThreshold = Date.now() - (30 * 60 * 1000);

    for (const run of result.rows) {
      try {
        const runResult = await query<{ started_at: Date }>(
          `SELECT started_at FROM workflow_runs WHERE id = $1`,
          [run.id]
        );

        if (runResult.rows[0] && new Date(runResult.rows[0].started_at).getTime() < staleThreshold) {
          await query(
            `UPDATE workflow_runs SET status = 'timeout', completed_at = now(), error_message = 'Timed out after 30 minutes' WHERE id = $1`,
            [run.id]
          );
          logger.warn('[WorkflowMonitor] Marked stale run as timeout', { runId: run.id });
        }
      } catch (err) {
        logger.error('[WorkflowMonitor] Error checking run', {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error('[WorkflowMonitor] Poll failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startWorkflowMonitor(): void {
  monitorJob = cron.schedule('* * * * *', async () => {
    await pollRunningWorkflows();
  }, { timezone: 'UTC' });

  logger.info('[WorkflowMonitor] Started (every minute)');
}

export function stopWorkflowMonitor(): void {
  if (monitorJob) {
    monitorJob.stop();
    monitorJob = null;
    logger.info('[WorkflowMonitor] Stopped');
  }
}
