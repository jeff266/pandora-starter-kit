/**
 * Outbound Webhook Handler
 *
 * Sends enriched account data to third-party webhook endpoints (Clay, Zapier, Make, etc.).
 * Implements retry logic with exponential backoff and dead letter queue for failed deliveries.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getClosedWonAccountDomains } from './account-matcher.js';
import crypto from 'crypto';

const logger = createLogger('Webhook Outbound');

const WEBHOOK_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 7;

// Retry schedule per spec: 30s, 2m, 10m, 30m, 2h, 6h
const RETRY_DELAYS_MS = [
  30 * 1000,        // Attempt 2: 30 seconds
  2 * 60 * 1000,    // Attempt 3: 2 minutes
  10 * 60 * 1000,   // Attempt 4: 10 minutes
  30 * 60 * 1000,   // Attempt 5: 30 minutes
  2 * 60 * 60 * 1000,  // Attempt 6: 2 hours
  6 * 60 * 60 * 1000,  // Attempt 7: 6 hours
];

// Error codes that should NOT be retried (configuration errors)
const NO_RETRY_STATUS_CODES = new Set([400, 401, 403, 404, 410, 422]);

export interface OutboundPayload {
  pandora_batch_id: string;
  workspace_id: string;
  triggered_at: string;
  account_count: number;
  accounts: Array<{
    domain: string;
    company_name: string;
    crm_account_id: string;
    close_date?: string;
    deal_value?: number;
  }>;
}

export interface DeliveryResult {
  success: boolean;
  batch_id: string;
  status_code?: number;
  error?: string;
  retry_scheduled?: boolean;
  moved_to_dlq?: boolean;
}

/**
 * Generate a unique batch ID for idempotency.
 */
export function generateBatchId(): string {
  return 'batch_' + crypto.randomBytes(16).toString('hex');
}

/**
 * Send outbound webhook with account data.
 */
export async function sendOutboundWebhook(
  workspaceId: string,
  endpointUrl: string,
  attemptNumber: number = 1
): Promise<DeliveryResult> {
  try {
    // Get closed-won accounts
    const accounts = await getClosedWonAccountDomains(workspaceId);

    if (accounts.length === 0) {
      logger.warn('No closed-won accounts to send', { workspace_id: workspaceId });
      return {
        success: false,
        batch_id: '',
        error: 'No closed-won accounts found',
      };
    }

    // Build payload
    const batchId = generateBatchId();
    const payload: OutboundPayload = {
      pandora_batch_id: batchId,
      workspace_id: workspaceId,
      triggered_at: new Date().toISOString(),
      account_count: accounts.length,
      accounts: accounts.map(acc => ({
        domain: acc.domain,
        company_name: acc.company_name,
        crm_account_id: acc.crm_account_id,
      })),
    };

    // Log delivery attempt
    await logDeliveryAttempt(workspaceId, batchId, endpointUrl, payload, attemptNumber);

    // Send HTTP POST
    const result = await deliverPayload(endpointUrl, payload, attemptNumber);

    // Update delivery log
    await updateDeliveryLog(workspaceId, batchId, attemptNumber, result);

    // Handle result
    if (result.success) {
      logger.info('Webhook delivered successfully', {
        workspace_id: workspaceId,
        batch_id: batchId,
        endpoint: endpointUrl,
        account_count: accounts.length,
      });
      return { success: true, batch_id: batchId, status_code: result.status_code };
    }

    // Determine if retry is needed
    const shouldRetry = shouldRetryDelivery(result.status_code, attemptNumber);

    if (shouldRetry && attemptNumber < MAX_RETRY_ATTEMPTS) {
      const retryDelay = RETRY_DELAYS_MS[attemptNumber - 1]; // attemptNumber is 1-indexed
      const retryAt = new Date(Date.now() + retryDelay);

      await scheduleRetry(workspaceId, batchId, endpointUrl, payload, attemptNumber + 1, retryAt);

      logger.warn('Webhook delivery failed, retry scheduled', {
        workspace_id: workspaceId,
        batch_id: batchId,
        attempt: attemptNumber,
        next_attempt: attemptNumber + 1,
        retry_at: retryAt.toISOString(),
        status_code: result.status_code,
        error: result.error,
      });

      return {
        success: false,
        batch_id: batchId,
        status_code: result.status_code,
        error: result.error,
        retry_scheduled: true,
      };
    }

    // Move to dead letter queue
    await moveToDeadLetterQueue(workspaceId, batchId, endpointUrl, payload, result, attemptNumber);

    logger.error('Webhook delivery failed permanently', {
      workspace_id: workspaceId,
      batch_id: batchId,
      total_attempts: attemptNumber,
      final_error: result.error,
      final_status: result.status_code,
    });

    return {
      success: false,
      batch_id: batchId,
      status_code: result.status_code,
      error: result.error,
      moved_to_dlq: true,
    };
  } catch (error) {
    logger.error('Outbound webhook error', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Deliver payload to endpoint via HTTP POST.
 */
async function deliverPayload(
  endpointUrl: string,
  payload: OutboundPayload,
  attemptNumber: number
): Promise<{ success: boolean; status_code?: number; response_body?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Pandora-Webhook/1.0',
        'X-Pandora-Batch-ID': payload.pandora_batch_id,
        'X-Pandora-Attempt': String(attemptNumber),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseBody = await response.text();

    if (response.ok) {
      return { success: true, status_code: response.status, response_body: responseBody };
    }

    return {
      success: false,
      status_code: response.status,
      response_body: responseBody,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error: any) {
    // Handle timeout
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timeout (30s)' };
    }

    // Handle network errors
    if (error.cause?.code === 'ENOTFOUND') {
      return { success: false, error: 'DNS failure: Cannot reach webhook URL' };
    }

    if (error.cause?.code === 'ECONNREFUSED') {
      return { success: false, error: 'Connection refused: Endpoint may be down' };
    }

    // SSL errors
    if (error.message?.includes('SSL') || error.message?.includes('certificate')) {
      return { success: false, error: 'SSL error: Endpoint must use valid HTTPS certificate' };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Determine if delivery should be retried based on status code and attempt number.
 */
function shouldRetryDelivery(statusCode: number | undefined, attemptNumber: number): boolean {
  // Don't retry if max attempts reached
  if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
    return false;
  }

  // Don't retry configuration errors
  if (statusCode && NO_RETRY_STATUS_CODES.has(statusCode)) {
    return false;
  }

  // Retry on timeout, 5xx errors, 429, network errors
  if (!statusCode) {
    return true; // Network error, timeout, etc.
  }

  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
    return true;
  }

  return false;
}

/**
 * Log initial delivery attempt.
 */
async function logDeliveryAttempt(
  workspaceId: string,
  batchId: string,
  endpointUrl: string,
  payload: OutboundPayload,
  attemptNumber: number
): Promise<void> {
  await query(
    `INSERT INTO webhook_delivery_log
     (workspace_id, batch_id, endpoint_url, payload, attempt_number)
     VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, batchId, endpointUrl, JSON.stringify(payload), attemptNumber]
  );
}

/**
 * Update delivery log with result.
 */
async function updateDeliveryLog(
  workspaceId: string,
  batchId: string,
  attemptNumber: number,
  result: { success: boolean; status_code?: number; response_body?: string; error?: string }
): Promise<void> {
  await query(
    `UPDATE webhook_delivery_log
     SET status_code = $1,
         response_body = $2,
         error_message = $3,
         delivered_at = CASE WHEN $4 THEN NOW() ELSE NULL END
     WHERE workspace_id = $5
       AND batch_id = $6
       AND attempt_number = $7`,
    [
      result.status_code || null,
      result.response_body || null,
      result.error || null,
      result.success,
      workspaceId,
      batchId,
      attemptNumber,
    ]
  );
}

/**
 * Schedule retry attempt.
 */
async function scheduleRetry(
  workspaceId: string,
  batchId: string,
  endpointUrl: string,
  payload: OutboundPayload,
  nextAttempt: number,
  retryAt: Date
): Promise<void> {
  // Log the scheduled retry
  await query(
    `INSERT INTO webhook_delivery_log
     (workspace_id, batch_id, endpoint_url, payload, attempt_number, retry_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, batchId, endpointUrl, JSON.stringify(payload), nextAttempt, retryAt]
  );
}

/**
 * Move failed delivery to dead letter queue.
 */
async function moveToDeadLetterQueue(
  workspaceId: string,
  batchId: string,
  endpointUrl: string,
  payload: OutboundPayload,
  result: { status_code?: number; error?: string },
  totalAttempts: number
): Promise<void> {
  await query(
    `INSERT INTO webhook_dead_letter_queue
     (workspace_id, batch_id, endpoint_url, payload, final_error, final_status_code, total_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      workspaceId,
      batchId,
      endpointUrl,
      JSON.stringify(payload),
      result.error || 'Unknown error',
      result.status_code || null,
      totalAttempts,
    ]
  );
}

/**
 * Process pending retries (called by background job).
 */
export async function processPendingRetries(): Promise<void> {
  try {
    const pending = await query<{
      workspace_id: string;
      batch_id: string;
      endpoint_url: string;
      payload: any;
      attempt_number: number;
    }>(
      `SELECT workspace_id, batch_id, endpoint_url, payload, attempt_number
       FROM webhook_delivery_log
       WHERE retry_at IS NOT NULL
         AND retry_at <= NOW()
         AND delivered_at IS NULL
       LIMIT 100`
    );

    logger.info('Processing pending webhook retries', { count: pending.rows.length });

    for (const retry of pending.rows) {
      try {
        const payload = typeof retry.payload === 'string' ? JSON.parse(retry.payload) : retry.payload;
        const result = await deliverPayload(retry.endpoint_url, payload, retry.attempt_number);

        await updateDeliveryLog(retry.workspace_id, retry.batch_id, retry.attempt_number, result);

        if (!result.success) {
          const shouldRetry = shouldRetryDelivery(result.status_code, retry.attempt_number);

          if (shouldRetry && retry.attempt_number < MAX_RETRY_ATTEMPTS) {
            const retryDelay = RETRY_DELAYS_MS[retry.attempt_number - 1];
            const retryAt = new Date(Date.now() + retryDelay);
            await scheduleRetry(
              retry.workspace_id,
              retry.batch_id,
              retry.endpoint_url,
              payload,
              retry.attempt_number + 1,
              retryAt
            );
          } else {
            await moveToDeadLetterQueue(
              retry.workspace_id,
              retry.batch_id,
              retry.endpoint_url,
              payload,
              result,
              retry.attempt_number
            );
          }
        }
      } catch (error) {
        logger.error('Retry processing error', {
          batch_id: retry.batch_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('Failed to process pending retries', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Replay a dead letter queue item.
 */
export async function replayDeadLetter(workspaceId: string, dlqId: string): Promise<DeliveryResult> {
  try {
    const dlqItem = await query<{
      batch_id: string;
      endpoint_url: string;
      payload: any;
    }>(
      `SELECT batch_id, endpoint_url, payload
       FROM webhook_dead_letter_queue
       WHERE id = $1
         AND workspace_id = $2
         AND replayed = false
       LIMIT 1`,
      [dlqId, workspaceId]
    );

    if (dlqItem.rows.length === 0) {
      throw new Error('Dead letter item not found or already replayed');
    }

    const item = dlqItem.rows[0];
    const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;

    // Attempt delivery
    const result = await deliverPayload(item.endpoint_url, payload, 1);

    // Mark as replayed
    await query(
      `UPDATE webhook_dead_letter_queue
       SET replayed = true,
           replayed_at = NOW(),
           replay_result = $1
       WHERE id = $2`,
      [result.success ? 'success' : result.error || 'failed', dlqId]
    );

    logger.info('Replayed dead letter item', {
      workspace_id: workspaceId,
      dlq_id: dlqId,
      success: result.success,
    });

    return {
      success: result.success,
      batch_id: item.batch_id,
      status_code: result.status_code,
      error: result.error,
    };
  } catch (error) {
    logger.error('Failed to replay dead letter item', {
      workspace_id: workspaceId,
      dlq_id: dlqId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
