import cron from 'node-cron';
import { query } from '../db.js';
import { syncWorkspace } from './orchestrator.js';
import { backfillHubSpotAssociations } from './backfill.js';
import { getJobQueue } from '../jobs/queue.js';
import { getActiveConsultantConnectors, updateConsultantConnector } from '../connectors/consultant-connector.js';
import { syncConsultantFireflies } from '../connectors/consultant-fireflies-sync.js';
import { hardDeleteExpiredAgents } from '../jobs/cleanup-agents.js';
import { cleanupExpiredRefreshTokens } from '../auth/cleanup.js';
import { recalculateAllWorkspacesQuality } from '../jobs/recalculate-training-quality.js';
import { syncGoogleCalendar } from '../connectors/google-calendar/adapter.js';
import { refreshBearingCalibrationAllWorkspaces } from '../jobs/refresh-bearing-calibration.js';

const INTERNAL_CONNECTORS = ['enrichment_config', 'csv_import'];

// Fixed-schedule connectors — only used for initial syncs or connectors that
// don't use per-workspace sync_interval_minutes (monday, google-drive).
// gong/fireflies initial syncs also fire here as fallback (dynamic heartbeat
// handles subsequent incremental syncs respecting sync_interval_minutes).
const SYNC_SCHEDULES: Array<{
  label: string;
  cron: string;
  connectorTypes: string[];
}> = [
  {
    label: 'Call Intelligence initial-sync fallback (every 12 hours)',
    cron: '0 */12 * * *',
    connectorTypes: ['gong', 'fireflies'],
  },
  {
    label: 'Task & Docs (daily at 3 AM UTC)',
    cron: '0 3 * * *',
    connectorTypes: ['monday', 'google-drive'],
  },
];

// Connectors eligible for the 15-min dynamic heartbeat that respects per-workspace
// sync_interval_minutes. CRM + call intelligence connectors all live here.
const DYNAMIC_SYNC_CONNECTORS = ['hubspot', 'salesforce', 'gong', 'fireflies'];

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

    // CRM sync eligibility heartbeat — runs every 15 minutes.
    // Fires incremental syncs for connectors whose last_sync_at + sync_interval_minutes <= NOW().
    // The actual sync may fire up to 15 minutes after it becomes due (acceptable).
    const crmHeartbeat = cron.schedule('*/15 * * * *', () => {
      this.checkSyncEligibility().catch((err) => {
        console.error('[Scheduler] Unhandled error in CRM sync eligibility check:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(crmHeartbeat);

    // Google Calendar sync — runs every 15 minutes
    // Syncs events from 7 days back to 14 days forward, resolves attendees to deals
    const calendarSyncTask = cron.schedule('*/15 * * * *', () => {
      this.runCalendarSync().catch((err) => {
        console.error('[Scheduler] Unhandled error in calendar sync:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(calendarSyncTask);

    // Consultant connector sync (every 6 hours)
    const consultantTask = cron.schedule('0 */6 * * *', () => {
      this.runConsultantSync().catch((err) => {
        console.error('[Scheduler] Unhandled error in consultant sync:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(consultantTask);

    // Agent cleanup (daily at 3:00 AM UTC)
    const agentCleanupTask = cron.schedule('0 3 * * *', () => {
      hardDeleteExpiredAgents().catch((err) => {
        console.error('[Scheduler] Unhandled error in agent cleanup:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(agentCleanupTask);

    // Refresh token cleanup (daily at 3:00 AM UTC)
    const refreshTokenCleanupTask = cron.schedule('0 3 * * *', () => {
      cleanupExpiredRefreshTokens().catch((err) => {
        console.error('[Scheduler] Unhandled error in refresh token cleanup:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(refreshTokenCleanupTask);

    // Market signals batch scan (weekly on Monday at 6:00 AM UTC)
    const marketSignalsTask = cron.schedule('0 6 * * 1', () => {
      runMarketSignalsBatchScan().catch((err) => {
        console.error('[Scheduler] Unhandled error in market signals batch scan:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(marketSignalsTask);

    // Forecast bearing calibration refresh (weekly on Monday at 6:05 AM UTC)
    // Runs after monte-carlo (6:00), before forecast-rollup (8:00).
    // Weights forecast triangulation bearings by workspace-specific historical accuracy.
    const bearingCalibrationTask = cron.schedule('5 6 * * 1', () => {
      refreshBearingCalibrationAllWorkspaces().catch((err) => {
        console.error('[Scheduler] Unhandled error in bearing calibration refresh:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(bearingCalibrationTask);

    // Webhook delivery log retention (daily at 3:00 AM UTC)
    // Removes rows older than 30 days from webhook_endpoint_deliveries.
    // At ~600 rows/scoring run daily, 30-day retention keeps the table under ~18k rows.
    const webhookCleanupTask = cron.schedule('0 3 * * *', async () => {
      try {
        const result = await query(
          `DELETE FROM webhook_endpoint_deliveries WHERE delivered_at < NOW() - INTERVAL '30 days'`
        );
        console.log(`[Scheduler] Webhook delivery cleanup: removed ${result.rowCount ?? 0} rows older than 30 days`);
      } catch (err) {
        console.error('[Scheduler] Webhook delivery cleanup failed:', err);
      }
    }, { timezone: 'UTC' });
    this.tasks.push(webhookCleanupTask);

    // Nightly training pair quality recalculation (daily at 2:00 AM UTC)
    const qualityRecalcTask = cron.schedule('0 2 * * *', () => {
      recalculateAllWorkspacesQuality().catch((err) => {
        console.error('[Scheduler] Nightly quality recalculation failed:', err);
      });
    }, { timezone: 'UTC' });
    this.tasks.push(qualityRecalcTask);

    const scheduleDescriptions = SYNC_SCHEDULES.map(s => s.label).join(', ');
    console.log(`[Scheduler] Sync schedules registered: ${scheduleDescriptions}, Dynamic heartbeat (${DYNAMIC_SYNC_CONNECTORS.join('/')} — respects sync_interval_minutes), Consultant (every 6 hours), Agent cleanup (daily at 3 AM), Refresh token cleanup (daily at 3 AM), Webhook delivery cleanup (daily at 3 AM), Market signals (weekly on Monday at 6 AM), Bearing calibration refresh (weekly on Monday at 6:05 AM)`);
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
             WHERE workspace_id = $1 AND connector_type = $2
               AND status IN ('pending', 'running')
               AND started_at > NOW() - INTERVAL '30 minutes'
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

  async checkSyncEligibility(): Promise<void> {
    const dueSyncs = await query<{
      workspace_id: string;
      connector_name: string;
      sync_interval_minutes: number;
    }>(
      `SELECT
         cc.workspace_id,
         cc.connector_name,
         cc.sync_interval_minutes
       FROM connections cc
       WHERE cc.connector_name = ANY($1)
         AND cc.status IN ('connected', 'synced', 'healthy')
         AND cc.last_sync_at IS NOT NULL
         AND (
           cc.last_sync_at + (cc.sync_interval_minutes || ' minutes')::interval
         ) <= NOW()
         AND NOT EXISTS (
           SELECT 1 FROM sync_log sl
           WHERE sl.workspace_id = cc.workspace_id
             AND sl.connector_type = cc.connector_name
             AND sl.status IN ('pending', 'running')
             AND sl.started_at > NOW() - INTERVAL '30 minutes'
         )`,
      [DYNAMIC_SYNC_CONNECTORS]
    ).catch(err => {
      console.error('[Scheduler] Eligibility check query failed:', err instanceof Error ? err.message : err);
      return { rows: [] as any[] };
    });

    if (dueSyncs.rows.length === 0) return;

    console.log(`[Scheduler] CRM heartbeat: ${dueSyncs.rows.length} connector(s) due for sync`);
    const jobQueue = getJobQueue();

    for (const row of dueSyncs.rows) {
      try {
        const logResult = await query<{ id: string }>(
          `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, started_at)
           VALUES ($1, $2, 'scheduled', 'pending', NOW())
           RETURNING id`,
          [row.workspace_id, row.connector_name]
        );
        const syncLogId = logResult.rows[0].id;

        const jobId = await jobQueue.createJob({
          workspaceId: row.workspace_id,
          jobType: 'sync',
          payload: { connectorType: row.connector_name, syncLogId },
          priority: 0,
        });

        console.log(`[Scheduler] Queued ${row.connector_name} sync for workspace ${row.workspace_id} (interval: ${row.sync_interval_minutes}min, job: ${jobId})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Failed to queue ${row.connector_name} for ${row.workspace_id}: ${msg}`);
      }
    }
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

  async runCalendarSync(): Promise<void> {
    // Get all workspaces with google-calendar connected
    const workspacesResult = await query<{ workspace_id: string }>(
      `SELECT workspace_id FROM connections
       WHERE connector_name = 'google-calendar' AND status != 'disconnected'`
    );

    if (workspacesResult.rows.length === 0) {
      return;
    }

    console.log(`[Scheduler] Calendar sync: processing ${workspacesResult.rows.length} workspace(s)`);

    for (const row of workspacesResult.rows) {
      try {
        const result = await syncGoogleCalendar(row.workspace_id);
        console.log(
          `[Scheduler] Calendar sync (${row.workspace_id}): ${result.synced} synced, ` +
          `${result.resolved} resolved to deals, ${result.errors.length} error(s)`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Calendar sync failed for ${row.workspace_id}: ${msg}`);
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

async function runMarketSignalsBatchScan(): Promise<void> {
    console.log('[Scheduler] Starting weekly market signals batch scan');

    try {
      // Get all workspaces with connected CRMs (they have accounts worth scanning)
      const workspacesResult = await query<{ workspace_id: string }>(
        `SELECT DISTINCT workspace_id FROM connector_configs
         WHERE status = 'connected' AND connector_type IN ('hubspot', 'salesforce')`
      );

      if (workspacesResult.rows.length === 0) {
        console.log('[Scheduler] No workspaces with connected CRMs found');
        return;
      }

      console.log(`[Scheduler] Found ${workspacesResult.rows.length} workspace(s) with connected CRMs`);

      // Import the market signals collector dynamically
      const { getMarketSignalsCollector } = await import('../connectors/serper/market-signals.js');
      const collector = getMarketSignalsCollector();

      if (!collector.isConfigured()) {
        console.log('[Scheduler] Market signals API not configured (SERPER_API_KEY missing), skipping');
        return;
      }

      let totalScanned = 0;
      let totalSignals = 0;
      let totalCost = 0;

      for (const ws of workspacesResult.rows) {
        try {
          // For each workspace, find accounts with active deals that haven't been scanned recently
          const accountsResult = await query<{ id: string; name: string }>(
            `SELECT DISTINCT a.id, a.name
             FROM accounts a
             JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
             WHERE a.workspace_id = $1
               AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
               AND d.amount >= 10000
               AND a.id NOT IN (
                 SELECT DISTINCT account_id FROM account_signals
                 WHERE workspace_id = $1
                   AND signal_type = 'market_news'
                   AND created_at > now() - interval '7 days'
               )
             LIMIT 50`,
            [ws.workspace_id]
          );

          console.log(`[Scheduler] Workspace ${ws.workspace_id}: ${accountsResult.rows.length} account(s) to scan`);

          for (const account of accountsResult.rows) {
            try {
              // Rate limit: 500ms between requests
              await new Promise(r => setTimeout(r, 500));

              const result = await collector.getSignalsForAccount(
                ws.workspace_id,
                account.id,
                { force_check: false } // Respect ICP tier filtering
              );

              // Store signals
              if (result.signals.length > 0) {
                await collector.storeSignals(ws.workspace_id, account.id, result.signals);
                console.log(`[Scheduler] ${account.name}: ${result.signals.length} signal(s) found (${result.signal_strength})`);
              }

              totalScanned++;
              totalSignals += result.signals.length;
              totalCost += 0.005; // $0.004 Serper + $0.001 DeepSeek
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[Scheduler] Failed to scan ${account.name}:`, msg);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Scheduler] Failed to process workspace ${ws.workspace_id}:`, msg);
        }
      }

      console.log(
        `[Scheduler] Market signals batch scan complete: ${totalScanned} account(s) scanned, ` +
        `${totalSignals} signal(s) found, cost: $${totalCost.toFixed(3)}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Scheduler] Market signals batch scan failed:', msg);
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
