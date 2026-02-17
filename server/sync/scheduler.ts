import cron from 'node-cron';
import { query } from '../db.js';
import { syncWorkspace } from './orchestrator.js';
import { backfillHubSpotAssociations } from './backfill.js';
import { getJobQueue } from '../jobs/queue.js';
import { getActiveConsultantConnectors, updateConsultantConnector } from '../connectors/consultant-connector.js';
import { syncConsultantFireflies } from '../connectors/consultant-fireflies-sync.js';

const INTERNAL_CONNECTORS = ['enrichment_config', 'csv_import'];

const SYNC_SCHEDULES: Array<{
  label: string;
  cron: string;
  connectorTypes: string[];
}> = [
  {
    label: 'CRM (every 4 hours)',
    cron: '0 */4 * * *',
    connectorTypes: ['hubspot', 'salesforce'],
  },
  {
    label: 'Call Intelligence (every 12 hours)',
    cron: '0 */12 * * *',
    connectorTypes: ['gong', 'fireflies'],
  },
  {
    label: 'Task & Docs (daily at 3 AM UTC)',
    cron: '0 3 * * *',
    connectorTypes: ['monday', 'google-drive'],
  },
];

export class SyncScheduler {
  private tasks: cron.ScheduledTask[] = [];

  start(): void {
    for (const schedule of SYNC_SCHEDULES) {
      const task = cron.schedule(schedule.cron, () => {
        this.runConnectorSync(schedule.connectorTypes, schedule.label).catch((err) => {
          console.error(`[Scheduler] Unhandled error in ${schedule.label} sync:`, err);
        });
      }, {
        timezone: 'UTC',
      });
      this.tasks.push(task);
    }

    // Consultant connector sync (every 6 hours)
    const consultantTask = cron.schedule('0 */6 * * *', () => {
      this.runConsultantSync().catch((err) => {
        console.error('[Scheduler] Unhandled error in consultant sync:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(consultantTask);

    const scheduleDescriptions = SYNC_SCHEDULES.map(s => s.label).join(', ');
    console.log(`[Scheduler] Sync schedules registered: ${scheduleDescriptions}, Consultant (every 6 hours)`);
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    console.log('[Scheduler] Stopped');
  }

  async runConnectorSync(connectorTypes: string[], label: string): Promise<void> {
    const workspacesResult = await query<{ id: string; name: string; connector_name: string }>(
      `SELECT DISTINCT w.id, w.name, c.connector_name
       FROM workspaces w
       INNER JOIN connections c ON c.workspace_id = w.id
       WHERE c.status IN ('connected', 'synced', 'healthy', 'error')
         AND c.connector_name = ANY($1)
       ORDER BY w.name`,
      [connectorTypes]
    );

    const rows = workspacesResult.rows;
    if (rows.length === 0) {
      console.log(`[Scheduler] ${label}: no workspaces with matching connectors — skipping`);
      return;
    }

    const byWorkspace = new Map<string, { name: string; connectors: string[] }>();
    for (const row of rows) {
      if (!byWorkspace.has(row.id)) {
        byWorkspace.set(row.id, { name: row.name, connectors: [] });
      }
      byWorkspace.get(row.id)!.connectors.push(row.connector_name);
    }

    console.log(`[Scheduler] ${label}: queueing sync for ${byWorkspace.size} workspace(s)`);

    const jobQueue = getJobQueue();
    let queued = 0;

    for (const [wsId, { name, connectors }] of byWorkspace) {
      for (const connectorType of connectors) {
        try {
          const runningResult = await query<{ id: string }>(
            `SELECT id FROM sync_log
             WHERE workspace_id = $1 AND connector_type = $2 AND status IN ('pending', 'running')
             LIMIT 1`,
            [wsId, connectorType]
          );

          if (runningResult.rows.length > 0) {
            console.log(`[Scheduler] Skipping ${name}/${connectorType} — sync already in progress`);
            continue;
          }

          const logResult = await query<{ id: string }>(
            `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, started_at)
             VALUES ($1, $2, 'scheduled', 'pending', NOW())
             RETURNING id`,
            [wsId, connectorType]
          );
          const syncLogId = logResult.rows[0].id;

          const jobId = await jobQueue.createJob({
            workspaceId: wsId,
            jobType: 'sync',
            payload: {
              connectorType,
              syncLogId,
            },
            priority: 0,
          });

          queued++;
          console.log(`[Scheduler] Queued ${connectorType} sync for ${name} (job: ${jobId})`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[Scheduler] Failed to queue ${connectorType} job for ${name}: ${msg}`);
        }
      }
    }

    console.log(`[Scheduler] ${label}: ${queued} sync job(s) queued`);
  }

  async runConsultantSync(): Promise<void> {
    let consultantConnectors;
    try {
      consultantConnectors = await getActiveConsultantConnectors();
    } catch (err) {
      // Table may not exist yet if migration hasn't run
      console.log('[Scheduler] Consultant connectors table not available, skipping');
      return;
    }

    if (consultantConnectors.length === 0) {
      console.log('[Scheduler] Consultant sync: no active connectors — skipping');
      return;
    }

    console.log(`[Scheduler] Consultant sync: processing ${consultantConnectors.length} connector(s)`);

    for (const cc of consultantConnectors) {
      try {
        if (cc.source === 'fireflies') {
          const result = await syncConsultantFireflies(cc.id);
          console.log(
            `[Scheduler] Consultant ${cc.source} (${cc.id}): ${result.synced} synced, ` +
            `T1=${result.distributed.tier1_email} T2=${result.distributed.tier2_calendar} T3=${result.distributed.tier3_transcript} ` +
            `unmatched=${result.distributed.unmatched}`
          );
        }
      } catch (err: any) {
        console.error(`[Scheduler] Consultant ${cc.id} failed: ${err.message}`);
        try {
          await updateConsultantConnector(cc.id, { status: 'error' });
        } catch {
          // ignore update error
        }
      }
    }
  }

  async runDailySync(): Promise<void> {
    const allConnectorTypes = SYNC_SCHEDULES.flatMap(s => s.connectorTypes);
    await this.runConnectorSync(allConnectorTypes, 'Daily full sync');
  }
}

async function runPostSyncBackfill(workspaceId: string): Promise<void> {
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
