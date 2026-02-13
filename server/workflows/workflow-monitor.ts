import cron from 'node-cron';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { APClientInterface } from './workflow-service.js';

const logger = createLogger('WorkflowMonitor');

let monitorJob: cron.ScheduledTask | null = null;
let apClientRef: APClientInterface | undefined;

export async function pollRunningWorkflows(): Promise<void> {
  try {
    const result = await query<{ id: string; workflow_id: string; ap_run_id: string | null; started_at: Date }>(
      `SELECT id, workflow_id, ap_run_id, started_at FROM workflow_runs WHERE status = 'running'`
    );

    if (result.rows.length === 0) {
      return;
    }

    logger.debug('[WorkflowMonitor] Found running workflows', { count: result.rows.length });

    const staleThreshold = Date.now() - (30 * 60 * 1000);

    for (const run of result.rows) {
      try {
        if (apClientRef && run.ap_run_id) {
          try {
            const apRun = await apClientRef.getFlowRun(run.ap_run_id);

            const statusMap: Record<string, string> = {
              RUNNING: 'running',
              SUCCEEDED: 'succeeded',
              FAILED: 'failed',
              TIMEOUT: 'timeout',
              PAUSED: 'running',
              STOPPED: 'failed',
              INTERNAL_ERROR: 'failed',
            };

            const mappedStatus = statusMap[apRun.status] || 'failed';

            if (mappedStatus !== 'running') {
              await query(
                `UPDATE workflow_runs
                 SET status = $1, completed_at = $2, duration_ms = $3,
                     result = $4, steps_completed = $5, error_message = $6, error_step = $7
                 WHERE id = $8`,
                [
                  mappedStatus,
                  apRun.finishTime ? new Date(apRun.finishTime) : new Date(),
                  apRun.duration || null,
                  apRun.steps ? JSON.stringify(apRun.steps) : null,
                  apRun.stepsCount || 0,
                  apRun.error?.message || null,
                  apRun.error?.step || null,
                  run.id,
                ]
              );
              logger.info('[WorkflowMonitor] Reconciled run from AP', { runId: run.id, status: mappedStatus });
            }
            continue;
          } catch (apErr) {
            logger.warn('[WorkflowMonitor] AP status check failed, falling back to timeout detection', {
              runId: run.id,
              error: apErr instanceof Error ? apErr.message : String(apErr),
            });
          }
        }

        if (new Date(run.started_at).getTime() < staleThreshold) {
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

export function startWorkflowMonitor(apClient?: APClientInterface): void {
  apClientRef = apClient;
  monitorJob = cron.schedule('* * * * *', async () => {
    await pollRunningWorkflows();
  }, { timezone: 'UTC' });

  logger.info('[WorkflowMonitor] Started (every minute)', { apReconciliation: !!apClient });
}

export function stopWorkflowMonitor(): void {
  if (monitorJob) {
    monitorJob.stop();
    monitorJob = null;
    logger.info('[WorkflowMonitor] Stopped');
  }
}
