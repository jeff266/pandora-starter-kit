/**
 * Webhook Delivery Engine
 *
 * Delivers signed webhook events to registered endpoints.
 * HMAC signing reuses signPayload from push/formatters/webhook-formatter.
 * Retries are in-process (3 attempts, exponential backoff).
 * Circuit breaker disables endpoints after 10 consecutive failures.
 */

import { query } from '../db.js';
import { signPayload } from '../push/formatters/webhook-formatter.js';

export interface WebhookEvent {
  event: string;
  event_id: string;
  timestamp: string;
  workspace_id: string;
  api_version: string;
  data: Record<string, unknown>;
}

export interface DeliveryResult {
  endpointId: string;
  success: boolean;
  statusCode?: number;
  attempt: number;
  error?: string;
  durationMs: number;
}

/**
 * Deliver a webhook event to a single endpoint.
 * Returns result regardless of success/failure — never throws.
 */
export async function deliverWebhook(
  endpoint: { id: string; url: string; secret: string },
  event: WebhookEvent,
  attempt = 1
): Promise<DeliveryResult> {
  const body = JSON.stringify(event);
  const signature = signPayload(body, endpoint.secret);
  const start = Date.now();

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pandora-Signature': signature,
        'X-Pandora-Event': event.event,
        'X-Pandora-Event-Id': event.event_id,
        'X-Pandora-Timestamp': event.timestamp,
        'User-Agent': 'Pandora-Webhooks/1.0',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    return {
      endpointId: endpoint.id,
      success: response.ok,
      statusCode: response.status,
      attempt,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      endpointId: endpoint.id,
      success: false,
      error: message,
      attempt,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Deliver with retry. 3 attempts, delays: immediate → 1min → 5min.
 * Logs each attempt to webhook_endpoint_deliveries.
 * Updates endpoint health counters on success/failure.
 * NOTE: Retries are in-process — lost on server restart. Acceptable for v1.
 */
export async function deliverWithRetry(
  endpoint: { id: string; url: string; secret: string },
  event: WebhookEvent,
  maxAttempts = 3
): Promise<DeliveryResult> {
  const delays = [0, 60_000, 300_000];
  let lastResult: DeliveryResult = {
    endpointId: endpoint.id,
    success: false,
    attempt: 1,
    durationMs: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt - 1] ?? 300_000));
    }

    lastResult = await deliverWebhook(endpoint, event, attempt);
    await logDelivery(endpoint.id, event, lastResult);

    if (lastResult.success) {
      await query(
        `UPDATE webhook_endpoints
         SET consecutive_failures = 0, last_success_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [endpoint.id]
      ).catch(() => {});
      return lastResult;
    }
  }

  // All attempts failed — increment consecutive failures, circuit-break at 10
  await query(
    `UPDATE webhook_endpoints
     SET consecutive_failures = consecutive_failures + 1,
         last_failure_at = NOW(),
         updated_at = NOW(),
         enabled = CASE WHEN consecutive_failures + 1 >= 10 THEN false ELSE enabled END,
         disabled_reason = CASE WHEN consecutive_failures + 1 >= 10 THEN 'consecutive_failures' ELSE disabled_reason END
     WHERE id = $1`,
    [endpoint.id]
  ).catch(() => {});

  return lastResult;
}

async function logDelivery(
  endpointId: string,
  event: WebhookEvent,
  result: DeliveryResult
): Promise<void> {
  await query(
    `INSERT INTO webhook_endpoint_deliveries
       (endpoint_id, workspace_id, event_type, event_id, payload,
        status_code, success, attempt, error, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      endpointId,
      event.workspace_id,
      event.event,
      event.event_id,
      JSON.stringify(event.data),
      result.statusCode ?? null,
      result.success,
      result.attempt,
      result.error ?? null,
      result.durationMs,
    ]
  ).catch(() => {});
}
