import cron from 'node-cron';
import { query } from '../db.js';
import { syncWorkspace } from './orchestrator.js';
import { backfillHubSpotAssociations } from './backfill.js';
import { getJobQueue } from '../jobs/queue.js';

export class SyncScheduler {
  private task: cron.ScheduledTask | null = null;

  start(): void {
    this.task = cron.schedule('0 2 * * *', () => {
      this.runDailySync().catch((err) => {
        console.error('[Scheduler] Unhandled error in daily sync:', err);
      });
    }, {
      timezone: 'UTC',
    });

    console.log('[Scheduler] Daily sync scheduled for 2:00 AM UTC');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[Scheduler] Stopped');
    }
  }

  async runDailySync(): Promise<void> {
    const workspacesResult = await query<{ id: string; name: string }>(
      `SELECT DISTINCT w.id, w.name
       FROM workspaces w
       INNER JOIN connections c ON c.workspace_id = w.id
       WHERE c.status IN ('connected', 'synced', 'error')
       ORDER BY w.name`
    );

    const workspaces = workspacesResult.rows;

    if (workspaces.length === 0) {
      console.log('[Scheduler] No workspaces with connected sources — skipping daily sync');
      return;
    }

    console.log(`[Scheduler] Queueing daily sync jobs for ${workspaces.length} workspace(s)`);

    const jobQueue = getJobQueue();
    const jobIds: string[] = [];

    // Create jobs for all workspaces (fire-and-forget, non-blocking)
    for (const ws of workspaces) {
      try {
        // Check if sync already running for this workspace
        const runningResult = await query<{ id: string }>(
          `SELECT id FROM sync_log
           WHERE workspace_id = $1 AND status IN ('pending', 'running')
           LIMIT 1`,
          [ws.id]
        );

        if (runningResult.rows.length > 0) {
          console.log(`[Scheduler] Skipping ${ws.name} — sync already in progress`);
          continue;
        }

        // Create sync_log entry
        const logResult = await query<{ id: string }>(
          `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, started_at)
           VALUES ($1, 'all', 'scheduled', 'pending', NOW())
           RETURNING id`,
          [ws.id]
        );
        const syncLogId = logResult.rows[0].id;

        // Create background job
        const jobId = await jobQueue.createJob({
          workspaceId: ws.id,
          jobType: 'sync',
          payload: {
            connectorType: undefined, // sync all connectors
            syncLogId,
          },
          priority: 0, // Scheduled syncs have normal priority
        });

        jobIds.push(jobId);
        console.log(`[Scheduler] Queued sync job for ${ws.name} (job: ${jobId})`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Scheduler] Failed to queue job for ${ws.name}: ${msg}`);
      }
    }

    console.log(`[Scheduler] Daily sync jobs queued: ${jobIds.length}/${workspaces.length} workspaces`);
  }
}

async function runPostSyncBackfill(workspaceId: string): Promise<void> {
  // Check if HubSpot connection exists and needs backfill
  const connResult = await query<{ sync_cursor: any }>(
    `SELECT sync_cursor FROM connections
     WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status IN ('connected', 'synced')`,
    [workspaceId]
  );

  if (connResult.rows.length === 0) return;

  const metadata = connResult.rows[0].sync_cursor;
  if (!metadata?.usedExportApi) return;

  console.log(`[Scheduler] Running HubSpot association backfill for workspace ${workspaceId}`);

  try {
    const result = await backfillHubSpotAssociations(workspaceId);
    console.log(
      `[Scheduler] Backfill complete: ${result.dealsProcessed} deals, ` +
      `${result.contactLinksCreated} contact links, ${result.accountLinksCreated} account links`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Scheduler] Backfill failed for workspace ${workspaceId}: ${msg}`);
  }
}

let schedulerInstance: SyncScheduler | null = null;

export function startScheduler(): SyncScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new SyncScheduler();
  }
  schedulerInstance.start();
  return schedulerInstance;
}

export function getScheduler(): SyncScheduler | null {
  return schedulerInstance;
}
