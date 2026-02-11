/**
 * Background Job Queue Manager
 *
 * Postgres-based job queue with progress tracking and retry logic
 */

import { query, getClient } from '../db.js';
import { syncWorkspace } from '../sync/orchestrator.js';
import { syncSalesforce } from '../connectors/salesforce/sync.js';
import pRetry from 'p-retry';

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
  }

  private async markFailed(jobId: string, error: string): Promise<void> {
    await query(
      `UPDATE jobs
       SET status = 'failed', error = $1, last_error = $1, completed_at = NOW()
       WHERE id = $2`,
      [error, jobId]
    );
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const result = await query(
      `UPDATE jobs
       SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'running')`,
      [jobId]
    );
    return result.rowCount > 0;
  }

  // --------------------------------------------------------------------------
  // Job Processing
  // --------------------------------------------------------------------------

  start(): void {
    if (this.pollingInterval) {
      console.log('[JobQueue] Already running');
      return;
    }

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
    console.log(`[JobQueue] Executing job ${job.id} (${job.job_type}, attempt ${job.attempts + 1}/${job.max_attempts})`);

    await this.markRunning(job.id);

    try {
      // Use p-retry for automatic retries with exponential backoff
      const result = await pRetry(
        async () => {
          return await this.runJobHandler(job);
        },
        {
          retries: job.max_attempts - 1,
          onFailedAttempt: (error) => {
            console.warn(`[JobQueue] Job ${job.id} attempt ${error.attemptNumber} failed:`, error.message);
            this.updateProgress(job.id, {
              current: 0,
              total: 0,
              message: `Retry ${error.attemptNumber}/${job.max_attempts}: ${error.message}`,
            }).catch(() => {});
          },
        }
      );

      await this.markCompleted(job.id, result);
      console.log(`[JobQueue] Job ${job.id} completed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markFailed(job.id, message);
      console.error(`[JobQueue] Job ${job.id} failed after ${job.max_attempts} attempts:`, message);
    }
  }

  private async runJobHandler(job: Job): Promise<any> {
    switch (job.job_type) {
      case 'sync':
        return await this.handleSyncJob(job);
      case 'salesforce_sync':
        return await this.handleSalesforceSyncJob(job);
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

    return {
      results,
      totalRecords,
      errors,
    };
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
