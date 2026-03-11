/**
 * CRM Write Retry Scheduler
 *
 * Runs every 5 minutes to retry failed CRM writes with exponential backoff.
 * After 3 failed retries, marks write as permanently failed and creates
 * a pending action for manual review if triggered by a workflow rule.
 */

import type { Pool } from 'pg';
import { getJobQueue } from './queue.js';

export function startCrmRetryScheduler(db: Pool): void {
  console.log('[CRM Retry Scheduler] Starting CRM write retry scheduler (runs every 5 minutes)');

  // Run immediately on startup, then every 5 minutes
  runRetryCheck(db);

  setInterval(async () => {
    await runRetryCheck(db);
  }, 5 * 60 * 1000); // every 5 minutes
}

async function runRetryCheck(db: Pool): Promise<void> {
  try {
    // Query failed CRM writes that are ready for retry
    const retryResult = await db.query<{
      id: string;
      workspace_id: string;
      retry_count: number;
    }>(`
      SELECT id, workspace_id, retry_count
      FROM crm_write_log
      WHERE status = 'failed'
        AND retry_count < 3
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at ASC
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    `);

    if (retryResult.rows.length === 0) {
      return; // No writes to retry
    }

    console.log(`[CRM Retry Scheduler] Found ${retryResult.rows.length} failed CRM writes to retry`);

    const jobQueue = getJobQueue();

    // Create retry jobs for each failed write
    for (const row of retryResult.rows) {
      try {
        await jobQueue.createJob({
          workspaceId: row.workspace_id,
          jobType: 'crm_write_retry',
          payload: { logId: row.id },
          priority: 5, // Higher priority than sync jobs
          maxAttempts: 1, // Job itself doesn't retry (the write log tracks retries)
          timeoutMs: 30000, // 30 second timeout per retry
        });

        console.log(`[CRM Retry Scheduler] Created retry job for write log ${row.id} (attempt ${row.retry_count + 1}/3)`);
      } catch (err) {
        console.error(`[CRM Retry Scheduler] Failed to create retry job for log ${row.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[CRM Retry Scheduler] Error during retry check:', err);
  }
}
