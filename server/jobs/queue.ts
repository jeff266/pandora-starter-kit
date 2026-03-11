/**
 * Background Job Queue Manager
 *
 * Postgres-based job queue with progress tracking and retry logic
 */

import { query, getClient } from '../db.js';
import { syncWorkspace } from '../sync/orchestrator.js';
import { syncSalesforce } from '../connectors/salesforce/sync.js';
import { hubspotConnector } from '../connectors/hubspot/index.js';
import { getConnectorCredentials } from '../lib/credential-store.js';
import pRetry from 'p-retry';
import { notifyProgress, notifyCompleted, notifyFailed } from '../utils/webhook-notifier.js';

async function prewarmSurvivalCache(workspaceId: string): Promise<void> {
  try {
    const { buildSurvivalCurves, invalidateSurvivalCache } = await import('../analysis/survival-data.js');
    invalidateSurvivalCache(workspaceId);
    await Promise.all([
      buildSurvivalCurves({ workspaceId, lookbackMonths: 24, groupBy: 'none' }),
      buildSurvivalCurves({ workspaceId, lookbackMonths: 24, groupBy: 'stage_reached', minSegmentSize: 20 }),
      buildSurvivalCurves({ workspaceId, lookbackMonths: 24, groupBy: 'source', minSegmentSize: 20 }),
      buildSurvivalCurves({ workspaceId, lookbackMonths: 24, groupBy: 'owner', minSegmentSize: 15 }),
    ]);
    console.log(`[SurvivalCache] Pre-warmed for workspace ${workspaceId}`);
  } catch (err) {
    console.warn(`[SurvivalCache] Pre-warm failed (non-fatal):`, err instanceof Error ? err.message : err);
  }
}

// ============================================================================
// Types
// ============================================================================

export interface Job {
  id: string;
  workspace_id: string;
  job_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  payload: Record<string, any>;
  progress: {
    current?: number;
    total?: number;
    message?: string;
  } | null;
  result: any;
  error: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  run_after: Date;
  timeout_ms: number;
}

export interface JobProgress {
  current: number;
  total: number;
  message: string;
}

export interface CreateJobOptions {
  workspaceId: string;
  jobType: string;
  payload?: Record<string, any>;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
  timeoutMs?: number;
}

// ============================================================================
// Job Queue Manager
// ============================================================================

export class JobQueue {
  private pollingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private pollIntervalMs = 2000; // Check for jobs every 2 seconds

  // --------------------------------------------------------------------------
  // Job Creation
  // --------------------------------------------------------------------------

  async createJob(options: CreateJobOptions): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO jobs (
        workspace_id, job_type, payload, priority, max_attempts, run_after, timeout_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        options.workspaceId,
        options.jobType,
        JSON.stringify(options.payload || {}),
        options.priority || 0,
        options.maxAttempts || 3,
        options.runAfter || new Date(),
        options.timeoutMs || 600000, // 10 minutes
      ]
    );

    const jobId = result.rows[0].id;
    console.log(`[JobQueue] Created job ${jobId} (${options.jobType}) for workspace ${options.workspaceId}`);
    return jobId;
  }

  // --------------------------------------------------------------------------
  // Job Status & Progress
  // --------------------------------------------------------------------------

  async getJob(jobId: string): Promise<Job | null> {
    const result = await query<Job>(
      `SELECT * FROM jobs WHERE id = $1`,
      [jobId]
    );
    return result.rows[0] || null;
  }

  async getJobsByWorkspace(workspaceId: string, limit = 20): Promise<Job[]> {
    const result = await query<Job>(
      `SELECT * FROM jobs
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit]
    );
    return result.rows;
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    await query(
      `UPDATE jobs
       SET progress = $1
       WHERE id = $2`,
      [JSON.stringify(progress), jobId]
    );

    // Send webhook notification (fire-and-forget)
    const job = await this.getJob(jobId);
    if (job) {
      notifyProgress(job.workspace_id, jobId, job.job_type, progress);
    }
  }

  private async markRunning(jobId: string): Promise<void> {
    await query(
      `UPDATE jobs
       SET status = 'running', started_at = NOW(), attempts = attempts + 1
       WHERE id = $1`,
      [jobId]
    );
  }

  private async markCompleted(jobId: string, result: any): Promise<void> {
    await query(
      `UPDATE jobs
       SET status = 'completed', result = $1, completed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(result), jobId]
    );

    // Send webhook notification (fire-and-forget)
    const job = await this.getJob(jobId);
    if (job) {
      notifyCompleted(job.workspace_id, jobId, job.job_type, result);
    }
  }

  private async markFailed(jobId: string, error: string): Promise<void> {
    await query(
      `UPDATE jobs
       SET status = 'failed', error = $1, last_error = $1, completed_at = NOW()
       WHERE id = $2`,
      [error, jobId]
    );

    // Send webhook notification (fire-and-forget)
    const job = await this.getJob(jobId);
    if (job) {
      notifyFailed(job.workspace_id, jobId, job.job_type, error);
    }
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const result = await query(
      `UPDATE jobs
       SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'running')`,
      [jobId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // --------------------------------------------------------------------------
  // Job Processing
  // --------------------------------------------------------------------------

  start(): void {
    if (this.pollingInterval) {
      console.log('[JobQueue] Already running');
      return;
    }

    // Reset any jobs stuck in 'running' for over 30 minutes on startup
    // (handles ghost-running records left by crashed workers)
    query(
      `UPDATE jobs SET status = 'pending', run_after = NOW()
       WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes'`
    ).then(r => {
      if (r.rowCount && r.rowCount > 0) {
        console.log(`[JobQueue] Reset ${r.rowCount} stuck job(s) to pending on startup`);
      }
    }).catch(err => {
      console.warn('[JobQueue] Failed to reset stuck jobs on startup:', err);
    });

    console.log(`[JobQueue] Starting job queue (polling every ${this.pollIntervalMs}ms)`);
    this.pollingInterval = setInterval(() => {
      this.processNextJob().catch(err => {
        console.error('[JobQueue] Error processing job:', err);
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[JobQueue] Stopped');
    }
  }

  private async processNextJob(): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing a job
    }

    this.isProcessing = true;

    try {
      // Get next pending job (highest priority, oldest first)
      const result = await query<Job>(
        `SELECT * FROM jobs
         WHERE status = 'pending' AND run_after <= NOW()
         ORDER BY priority DESC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
      );

      if (result.rows.length === 0) {
        return; // No jobs to process
      }

      const job = result.rows[0];
      await this.executeJob(job);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeJob(job: Job): Promise<void> {
    console.log(`[JobQueue] Executing job ${job.id} (${job.job_type}, attempt ${job.attempts + 1}/${job.max_attempts}, timeout: ${job.timeout_ms}ms)`);

    try {
      await this.markRunning(job.id);
    } catch (err: any) {
      if (err?.code === '23505') {
        // Another job of the same type is already running for this workspace.
        // Defer this job 30s so it won't be immediately re-selected.
        console.log(`[JobQueue] Deferring job ${job.id} (${job.job_type}): another job of same type is already running for workspace ${job.workspace_id}`);
        await query(
          `UPDATE jobs SET run_after = NOW() + interval '30 seconds' WHERE id = $1`,
          [job.id]
        );
        return;
      }
      throw err;
    }

    try {
      // Wrap execution with timeout enforcement
      const result = await this.withTimeout(
        pRetry(
          async () => {
            return await this.runJobHandler(job);
          },
          {
            retries: job.max_attempts - 1,
            onFailedAttempt: (error) => {
              console.warn(`[JobQueue] Job ${job.id} attempt ${error.attemptNumber} failed:`, (error as any).message);
              this.updateProgress(job.id, {
                current: 0,
                total: 0,
                message: `Retry ${error.attemptNumber}/${job.max_attempts}: ${(error as any).message}`,
              }).catch(() => {});
            },
          }
        ),
        job.timeout_ms,
        `Job ${job.id} exceeded timeout of ${job.timeout_ms}ms`
      );

      await this.markCompleted(job.id, result);
      console.log(`[JobQueue] Job ${job.id} completed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markFailed(job.id, message);
      console.error(`[JobQueue] Job ${job.id} failed after ${job.max_attempts} attempts:`, message);
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  }

  private async runJobHandler(job: Job): Promise<any> {
    switch (job.job_type) {
      case 'sync':
        return await this.handleSyncJob(job);
      case 'salesforce_sync':
        return await this.handleSalesforceSyncJob(job);
      case 'investigate_skill':
        return await this.handleInvestigateSkillJob(job);
      case 'crm_write_retry':
        return await this.handleCrmWriteRetry(job);
      default:
        throw new Error(`Unknown job type: ${job.job_type}`);
    }
  }

  // --------------------------------------------------------------------------
  // Job Handlers
  // --------------------------------------------------------------------------

  private async handleSyncJob(job: Job): Promise<any> {
    const { connectorType, mode } = job.payload;

    // Update progress: Starting
    await this.updateProgress(job.id, {
      current: 0,
      total: 100,
      message: 'Initializing sync...',
    });

    // HubSpot is not in the generic adapter registry — call its sync directly
    if (connectorType === 'hubspot') {
      return await this.handleHubSpotSyncJob(job);
    }

    const results = await syncWorkspace(job.workspace_id, {
      connectors: connectorType ? [connectorType] : undefined,
      mode,
    });

    const totalRecords = results.reduce((sum, r) => {
      if (!r.counts) return sum;
      return sum + Object.values(r.counts).reduce((s, c) => s + c.dbInserted, 0);
    }, 0);

    const errors = results
      .filter((r) => r.status === 'error')
      .map((r) => r.message || 'Unknown error');

    // Update progress: Completed
    await this.updateProgress(job.id, {
      current: 100,
      total: 100,
      message: 'Sync completed',
    });

    // Update sync_log table
    await query(
      `UPDATE sync_log
       SET status = $1, records_synced = $2, errors = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        errors.length > 0 ? 'completed_with_errors' : 'completed',
        totalRecords,
        JSON.stringify(errors),
        job.payload.syncLogId,
      ]
    ).catch(() => {});

    // Pre-warm survival curve cache (fire-and-forget)
    prewarmSurvivalCache(job.workspace_id).catch(() => {});

    // Re-score prospects after sync (fire-and-forget)
    import('../skills/compute/lead-scoring.js').then(({ scoreLeads }) =>
      scoreLeads(job.workspace_id)
    ).catch((err) =>
      console.warn('[JobQueue] Post-sync scoring failed', { workspaceId: job.workspace_id, err })
    );

    return {
      results,
      totalRecords,
      errors,
    };
  }

  private async handleHubSpotSyncJob(job: Job): Promise<any> {
    const workspaceId = job.workspace_id;
    const syncLogId = job.payload.syncLogId;

    try {
      // Fetch connection record
      const connResult = await query<{
        id: string;
        status: string;
        last_sync_at: Date | null;
      }>(
        `SELECT id, status, last_sync_at FROM connections
         WHERE workspace_id = $1 AND connector_name = 'hubspot'`,
        [workspaceId]
      );

      if (connResult.rows.length === 0) {
        throw new Error('HubSpot connection not found for workspace');
      }

      const conn = connResult.rows[0];
      if (conn.status === 'disconnected') {
        throw new Error('HubSpot connection is disconnected');
      }

      // Get stored credentials
      const credentials = await getConnectorCredentials(workspaceId, 'hubspot');
      if (!credentials) {
        throw new Error('HubSpot credentials not found in credential store');
      }

      const connection = {
        id: conn.id,
        workspaceId,
        connectorName: 'hubspot' as const,
        status: conn.status as 'active' | 'disconnected' | 'error',
        credentials,
      };

      // Determine sync mode: incremental if we have a prior sync timestamp
      let result;
      if (conn.last_sync_at) {
        const since = new Date(conn.last_sync_at);
        console.log(`[HubSpot Job] Starting incremental sync for workspace ${workspaceId} since ${since.toISOString()}`);
        result = await hubspotConnector.incrementalSync(connection as any, workspaceId, since);
      } else {
        console.log(`[HubSpot Job] Starting initial sync for workspace ${workspaceId}`);
        result = await hubspotConnector.initialSync(connection as any, workspaceId);
      }

      const recordsStored = result.recordsStored ?? 0;
      console.log(`[HubSpot Job] Sync complete — ${recordsStored} records stored`);

      await this.updateProgress(job.id, { current: 100, total: 100, message: 'Sync completed' });

      await query(
        `UPDATE sync_log
         SET status = 'completed', records_synced = $1, errors = '[]', completed_at = NOW()
         WHERE id = $2`,
        [recordsStored, syncLogId]
      ).catch(() => {});

      // Post-sync tasks (fire-and-forget)
      prewarmSurvivalCache(workspaceId).catch(() => {});
      import('../skills/compute/lead-scoring.js').then(({ scoreLeads }) =>
        scoreLeads(workspaceId)
      ).catch((err) =>
        console.warn('[JobQueue] Post-HubSpot-sync scoring failed', { workspaceId, err })
      );

      // Check for material changes and trigger brief reassembly if needed
      try {
        const recentClosedWon = await query<{ cnt: string }>(
          `SELECT COUNT(*)::text as cnt FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND updated_at >= NOW() - INTERVAL '5 minutes'`,
          [workspaceId]
        );
        const closedWonCount = parseInt(recentClosedWon.rows[0]?.cnt || '0');
        
        const { evaluateRecommendationOutcomes } = await import('../documents/recommendation-tracker.js');
        const materialChanges = closedWonCount > 0
          ? [{ type: 'deal_closed_won' as const, dealId: '', dealName: `${closedWonCount} deal(s)`, before: {}, after: {} }]
          : [];
        
        await evaluateRecommendationOutcomes(workspaceId, materialChanges);

        if (closedWonCount > 0 || recordsStored > 0) {
          const { triggerBriefReassembly } = await import('../briefing/brief-reassembly-trigger.js');
          const reason = closedWonCount > 0 ? `hubspot_sync:${closedWonCount}_closed_won` : 'hubspot_sync:records_updated';
          triggerBriefReassembly(workspaceId, reason, materialChanges);
        }
      } catch (briefErr) {
        console.warn(`[HubSpot Job] Brief reassembly check failed (non-fatal):`, briefErr instanceof Error ? briefErr.message : briefErr);
      }

      return { recordsStored };
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      console.error(`[HubSpot Job] Sync failed for workspace ${workspaceId}:`, errorMsg);

      await this.updateProgress(job.id, { current: 100, total: 100, message: 'Sync failed' });

      await query(
        `UPDATE sync_log
         SET status = 'failed', errors = $1, completed_at = NOW()
         WHERE id = $2`,
        [JSON.stringify([errorMsg]), syncLogId]
      ).catch(() => {});

      throw err;
    }
  }

  private async handleSalesforceSyncJob(job: Job): Promise<any> {
    const { credentials, syncLogId, mode = 'full' } = job.payload;

    // Update progress: Starting
    await this.updateProgress(job.id, {
      current: 0,
      total: 100,
      message: `Initializing Salesforce sync (${mode})...`,
    });

    const result = await syncSalesforce(job.workspace_id, credentials, mode);

    const totalRecords = result.accounts.stored + result.contacts.stored + result.deals.stored;

    // Update progress: Completed
    await this.updateProgress(job.id, {
      current: 100,
      total: 100,
      message: 'Salesforce sync completed',
    });

    // Update sync_log table
    await query(
      `UPDATE sync_log
       SET status = $1, records_synced = $2, errors = $3,
           duration_ms = $4, completed_at = NOW()
       WHERE id = $5`,
      [
        result.success ? 'completed' : 'completed_with_errors',
        totalRecords,
        JSON.stringify(result.errors || []),
        result.duration,
        syncLogId,
      ]
    ).catch(() => {});

    // Update connection status (last_sync_at already updated by sync function)
    await query(
      `UPDATE connections
       SET status = 'synced'
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [job.workspace_id]
    ).catch(() => {});

    // Pre-warm survival curve cache (fire-and-forget)
    prewarmSurvivalCache(job.workspace_id).catch(() => {});

    // Re-score prospects after sync (fire-and-forget)
    import('../skills/compute/lead-scoring.js').then(({ scoreLeads }) =>
      scoreLeads(job.workspace_id)
    ).catch((err) =>
      console.warn('[JobQueue] Post-sync scoring failed', { workspaceId: job.workspace_id, err })
    );

    return {
      success: result.success,
      totalRecords,
      accounts: result.accounts,
      contacts: result.contacts,
      deals: result.deals,
      computedFields: result.computedFields,
      duration: result.duration,
      errors: result.errors,
    };
  }

  private async handleInvestigateSkillJob(job: Job): Promise<any> {
    const { skillId, investigationPath, metadata } = job.payload;

    console.log(`[jobs] Executing investigation skill: ${skillId}`, {
      question: investigationPath.question,
      priority: investigationPath.priority,
    });

    // Update progress: Starting
    await this.updateProgress(job.id, {
      current: 0,
      total: 100,
      message: `Starting investigation: ${investigationPath.question.substring(0, 60)}...`,
    });

    // Import skill runtime and registry
    const { getSkillRuntime } = await import('../skills/runtime.js');
    const { getSkillRegistry } = await import('../skills/registry.js');

    const runtime = getSkillRuntime();
    const registry = getSkillRegistry();

    // Get skill definition
    const skill = registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    // Update progress: Running
    await this.updateProgress(job.id, {
      current: 50,
      total: 100,
      message: `Running ${skillId} skill...`,
    });

    // Execute skill with investigation context
    const result = await runtime.executeSkill(
      skill,
      job.workspace_id,
      {
        // Pass investigation context as params
        investigationContext: {
          question: investigationPath.question,
          reasoning: investigationPath.reasoning,
          priority: investigationPath.priority,
          ...metadata,
        },
      },
      metadata.userId  // Optional user context
    );

    // Update progress: Completed
    await this.updateProgress(job.id, {
      current: 100,
      total: 100,
      message: 'Investigation completed',
    });

    console.log(`[jobs] Investigation skill completed: ${skillId}`, {
      runId: result.runId,
      status: result.status,
      duration_ms: result.totalDuration_ms,
    });

    return {
      runId: result.runId,
      skillId: skillId,
      status: result.status,
      output_text: result.output?.narrative || 'Investigation completed',
      error: result.errors?.[0]?.error ?? null,
    };
  }

  private async handleCrmWriteRetry(job: Job): Promise<any> {
    const { logId } = job.payload;

    console.log(`[CrmWriteRetry] Processing retry for log entry ${logId}`);

    await this.updateProgress(job.id, {
      current: 0,
      total: 100,
      message: 'Retrying failed CRM write...',
    });

    // Fetch the failed write log entry
    const logResult = await query<{
      id: string;
      workspace_id: string;
      crm_type: string;
      crm_object_type: string;
      crm_record_id: string;
      crm_property_name: string;
      value_written: string;
      retry_count: number;
      workflow_rule_id: string | null;
    }>(
      `SELECT id, workspace_id, crm_type, crm_object_type, crm_record_id,
              crm_property_name, value_written, retry_count, workflow_rule_id
       FROM crm_write_log
       WHERE id = $1`,
      [logId]
    );

    if (logResult.rows.length === 0) {
      throw new Error(`CRM write log entry not found: ${logId}`);
    }

    const log = logResult.rows[0];
    const value = JSON.parse(log.value_written);

    // Import CRM writers
    const { updateDeal: updateHubSpotDeal } = await import('../connectors/hubspot/hubspot-writer.js');
    const { updateDeal: updateSalesforceDeal } = await import('../connectors/salesforce/salesforce-writer.js');

    const startTime = Date.now();

    try {
      // Retry the CRM write
      if (log.crm_type === 'hubspot') {
        await updateHubSpotDeal(log.workspace_id, log.crm_record_id, {
          [log.crm_property_name]: value,
        });
      } else if (log.crm_type === 'salesforce') {
        await updateSalesforceDeal(log.workspace_id, log.crm_record_id, {
          [log.crm_property_name]: value,
        });
      } else {
        throw new Error(`Unknown CRM type: ${log.crm_type}`);
      }

      const duration = Date.now() - startTime;

      // Mark as successful
      await query(
        `UPDATE crm_write_log
         SET status = 'success',
             retry_count = retry_count + 1,
             duration_ms = $1,
             error_message = NULL,
             next_retry_at = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [duration, logId]
      );

      await this.updateProgress(job.id, {
        current: 100,
        total: 100,
        message: 'CRM write succeeded',
      });

      console.log(`[CrmWriteRetry] Successfully retried write for log ${logId}`);

      return {
        success: true,
        logId,
        retryCount: log.retry_count + 1,
      };
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      const duration = Date.now() - startTime;
      const newRetryCount = log.retry_count + 1;

      console.error(`[CrmWriteRetry] Retry failed for log ${logId} (attempt ${newRetryCount}):`, errorMessage);

      if (newRetryCount >= 3) {
        // Max retries reached - mark as permanently failed
        await query(
          `UPDATE crm_write_log
           SET status = 'failed_permanent',
               retry_count = $1,
               error_message = $2,
               duration_ms = $3,
               next_retry_at = NULL,
               updated_at = NOW()
           WHERE id = $4`,
          [newRetryCount, errorMessage, duration, logId]
        );

        // If this write came from a workflow rule, create a pending action for HITL
        if (log.workflow_rule_id) {
          await this.createFailedWriteAction(log, errorMessage);
        }

        throw new Error(`CRM write permanently failed after ${newRetryCount} retries: ${errorMessage}`);
      } else {
        // Schedule next retry with exponential backoff
        const backoffMinutes = newRetryCount === 1 ? 5 : newRetryCount === 2 ? 15 : 45;

        await query(
          `UPDATE crm_write_log
           SET status = 'failed',
               retry_count = $1,
               error_message = $2,
               duration_ms = $3,
               next_retry_at = NOW() + interval '${backoffMinutes} minutes',
               updated_at = NOW()
           WHERE id = $4`,
          [newRetryCount, errorMessage, duration, logId]
        );

        throw new Error(`CRM write retry failed (attempt ${newRetryCount}/3): ${errorMessage}`);
      }
    }
  }

  private async createFailedWriteAction(
    log: {
      workspace_id: string;
      crm_object_type: string;
      crm_record_id: string;
      crm_property_name: string;
      value_written: string;
      workflow_rule_id: string | null;
    },
    errorMessage: string
  ): Promise<void> {
    try {
      // Find the deal ID from CRM record ID
      const dealResult = await query<{ id: string }>(
        `SELECT id FROM deals
         WHERE workspace_id = $1 AND crm_id = $2
         LIMIT 1`,
        [log.workspace_id, log.crm_record_id]
      );

      if (dealResult.rows.length === 0) {
        console.warn(`[CrmWriteRetry] Could not find deal for CRM record ${log.crm_record_id}`);
        return;
      }

      const dealId = dealResult.rows[0].id;

      // Create pending action
      await query(
        `INSERT INTO actions
          (workspace_id, target_deal_id, workflow_rule_id, action_type, severity,
           title, summary, execution_payload, execution_status, approval_status)
         VALUES ($1, $2, $3, 'crm_field_write', 'critical', $4, $5, $6, 'open', 'pending')`,
        [
          log.workspace_id,
          dealId,
          log.workflow_rule_id,
          'CRM Write Failed - Manual Action Required',
          `Failed to write ${log.crm_property_name} after 3 retries. Error: ${errorMessage}`,
          JSON.stringify({
            field: log.crm_property_name,
            to_value: JSON.parse(log.value_written),
            error: errorMessage,
            requires_manual_retry: true,
          }),
        ]
      );

      console.log(`[CrmWriteRetry] Created pending action for failed write (log ${log.workspace_id})`);
    } catch (err) {
      console.error(`[CrmWriteRetry] Failed to create pending action:`, err);
    }
  }
}


// ============================================================================
// Singleton Instance
// ============================================================================

let queueInstance: JobQueue | null = null;

export function getJobQueue(): JobQueue {
  if (!queueInstance) {
    queueInstance = new JobQueue();
  }
  return queueInstance;
}

export function startJobQueue(): JobQueue {
  const queue = getJobQueue();
  queue.start();
  return queue;
}
