import cron from 'node-cron';
import { query } from '../db.js';
import { syncWorkspace } from './orchestrator.js';
import { backfillHubSpotAssociations } from './backfill.js';

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
    const overallStart = Date.now();

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

    console.log(`[Scheduler] Starting daily sync for ${workspaces.length} workspace(s)`);

    let completed = 0;

    for (const ws of workspaces) {
      console.log(`[Scheduler] Syncing workspace ${ws.name} (${ws.id})...`);
      const wsStart = Date.now();

      const logResult = await query<{ id: string }>(
        `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, started_at)
         VALUES ($1, 'all', 'scheduled', 'running', NOW())
         RETURNING id`,
        [ws.id]
      );
      const syncLogId = logResult.rows[0].id;

      try {
        const results = await syncWorkspace(ws.id);

        const successCount = results.filter((r) => r.status === 'success').length;
        const errorCount = results.filter((r) => r.status === 'error').length;
        const duration = Date.now() - wsStart;

        const totalRecords = results.reduce((sum, r) => {
          if (!r.counts) return sum;
          return sum + Object.values(r.counts).reduce((s, c) => s + c.dbInserted, 0);
        }, 0);

        const errors = results.filter((r) => r.status === 'error').map((r) => r.message || 'Unknown');

        await query(
          `UPDATE sync_log
           SET status = $1, records_synced = $2, errors = $3,
               duration_ms = $4, completed_at = NOW()
           WHERE id = $5`,
          [
            errorCount > 0 ? 'completed_with_errors' : 'completed',
            totalRecords,
            JSON.stringify(errors),
            duration,
            syncLogId,
          ]
        );

        console.log(
          `[Scheduler] Workspace ${ws.name} done in ${duration}ms — ` +
          `${successCount} synced, ${errorCount} errors`
        );

        await runPostSyncBackfill(ws.id);

        completed++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Scheduler] Workspace ${ws.name} (${ws.id}) failed: ${msg}`);

        await query(
          `UPDATE sync_log
           SET status = 'failed', errors = $1, duration_ms = $2, completed_at = NOW()
           WHERE id = $3`,
          [JSON.stringify([msg]), Date.now() - wsStart, syncLogId]
        ).catch(() => {});
      }
    }

    const totalDuration = Date.now() - overallStart;
    console.log(
      `[Scheduler] Daily sync complete: ${completed}/${workspaces.length} workspaces, ${totalDuration}ms`
    );
  }
}

async function runPostSyncBackfill(workspaceId: string): Promise<void> {
  const connResult = await query<{ credentials: any; sync_cursor: any }>(
    `SELECT credentials, sync_cursor FROM connections
     WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status IN ('connected', 'synced')`,
    [workspaceId]
  );

  if (connResult.rows.length === 0) return;

  const conn = connResult.rows[0];
  const metadata = conn.sync_cursor;
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
