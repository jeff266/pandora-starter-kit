/**
 * Webhook Service — CRUD for webhook_endpoints
 *
 * Creates, lists, deletes, and tests webhook endpoints.
 * The signing secret is returned exactly once on creation — never in list responses.
 */

import crypto from 'node:crypto';
import { query } from '../db.js';
import { deliverWebhook, type WebhookEvent } from './delivery.js';

export interface WebhookEndpoint {
  id: string;
  workspace_id: string;
  url: string;
  enabled: boolean;
  event_types: string[] | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  secret: string;
}

export interface DeliveryLogEntry {
  id: string;
  event_type: string;
  event_id: string;
  success: boolean;
  status_code: number | null;
  attempt: number;
  error: string | null;
  duration_ms: number | null;
  delivered_at: string;
}

/**
 * Create a new webhook endpoint for a workspace.
 * Generates a random 32-byte hex secret.
 * Returns the full row INCLUDING the secret — this is the only time it is returned.
 */
export async function createWebhookEndpoint(
  workspaceId: string,
  data: { url: string; eventTypes?: string[] }
): Promise<WebhookEndpointWithSecret> {
  const secret = crypto.randomBytes(32).toString('hex');

  const result = await query<WebhookEndpoint>(
    `INSERT INTO webhook_endpoints
       (workspace_id, url, secret, event_types)
     VALUES ($1, $2, $3, $4)
     RETURNING id, workspace_id, url, enabled, event_types,
               last_success_at, last_failure_at, consecutive_failures,
               disabled_reason, created_at, updated_at`,
    [workspaceId, data.url, secret, data.eventTypes ?? null]
  );

  return { ...result.rows[0], secret };
}

/**
 * List all endpoints for a workspace.
 * Never returns the secret.
 */
export async function listWebhookEndpoints(
  workspaceId: string
): Promise<WebhookEndpoint[]> {
  const result = await query<WebhookEndpoint>(
    `SELECT id, workspace_id, url, enabled, event_types,
            last_success_at, last_failure_at, consecutive_failures,
            disabled_reason, created_at, updated_at
     FROM webhook_endpoints
     WHERE workspace_id = $1
     ORDER BY created_at DESC`,
    [workspaceId]
  );
  return result.rows;
}

/**
 * Delete a webhook endpoint. Scoped to workspace to prevent cross-tenant deletion.
 * Returns true if a row was deleted, false if not found.
 */
export async function deleteWebhookEndpoint(
  workspaceId: string,
  endpointId: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`,
    [endpointId, workspaceId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Send a single test delivery to verify the endpoint is reachable.
 * Uses deliverWebhook (single shot, not retried).
 * Throws 404 if endpoint not found or doesn't belong to workspace.
 */
export async function testWebhookEndpoint(
  workspaceId: string,
  endpointId: string
) {
  const result = await query<{ id: string; url: string; secret: string }>(
    `SELECT id, url, secret FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`,
    [endpointId, workspaceId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Endpoint not found') as Error & { status: number };
    err.status = 404;
    throw err;
  }

  const endpoint = result.rows[0];

  const testEvent: WebhookEvent = {
    event: 'webhook.test',
    event_id: `evt_test_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    workspace_id: workspaceId,
    api_version: '2026-03-01',
    data: {
      message: 'This is a test webhook from Pandora.',
      workspace_id: workspaceId,
    },
  };

  return deliverWebhook(endpoint, testEvent, 1);
}

/**
 * Fetch the last N deliveries for a given endpoint.
 * Verifies endpoint ownership via JOIN to prevent cross-tenant reads.
 */
export async function getEndpointDeliveries(
  workspaceId: string,
  endpointId: string,
  limit = 20
): Promise<DeliveryLogEntry[]> {
  const result = await query<DeliveryLogEntry>(
    `SELECT d.id, d.event_type, d.event_id, d.success, d.status_code,
            d.attempt, d.error, d.duration_ms, d.delivered_at
     FROM webhook_endpoint_deliveries d
     JOIN webhook_endpoints e ON d.endpoint_id = e.id
     WHERE d.endpoint_id = $1 AND e.workspace_id = $2
     ORDER BY d.delivered_at DESC
     LIMIT $3`,
    [endpointId, workspaceId, Math.min(limit, 100)]
  );
  return result.rows;
}
