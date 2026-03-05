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
 * Build a realistic dummy WebhookEvent for a given event type.
 * Used by testWebhookEndpoint to send event-specific payloads.
 * Falls back to a generic webhook.test ping for unrecognised types.
 */
function buildTestEvent(workspaceId: string, eventType?: string): WebhookEvent {
  const now = new Date().toISOString();
  const uid = () => crypto.randomUUID();
  const base = {
    timestamp: now,
    workspace_id: workspaceId,
    api_version: '2026-03-01' as const,
  };

  switch (eventType) {
    case 'prospect.scored':
      return {
        ...base,
        event: 'prospect.scored',
        event_id: `evt_test_ps_${uid()}`,
        data: {
          workspace_name: 'Acme Corp',
          prospect: {
            pandora_id: 'd9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a',
            entity_type: 'deal',
            source: 'hubspot',
            source_object: 'deal',
            source_id: 'hs_deal_8472910',
            name: 'Acme Corp – Enterprise Platform',
            pandora_prospect_score: 82,
            pandora_prospect_grade: 'A',
            pandora_fit_score: 74,
            pandora_engagement_score: 91,
            pandora_intent_score: 80,
            pandora_timing_score: 85,
            pandora_score_method: 'icp_point_based',
            pandora_score_confidence: 0.87,
            pandora_scored_at: now,
            pandora_score_summary: 'Strong engagement and tight timeline. Champion identified.',
            pandora_top_positive_factor: '3 calls with transcript in the last 14 days',
            pandora_top_negative_factor: 'No mutual action plan documented',
            pandora_recommended_action: 'Share a mutual action plan before next call',
            pandora_score_factors: [],
            previous_score: 71,
            score_change: 11,
          },
        },
      };

    case 'deal.stage_changed':
      return {
        ...base,
        event: 'deal.stage_changed',
        event_id: `evt_test_dsc_${uid()}`,
        data: {
          workspace_name: 'Acme Corp',
          deal: {
            pandora_id: 'd9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a',
            name: 'Acme Corp – Enterprise Platform',
            amount: 240000,
            owner_email: 'sarah.chen@acmecorp.io',
            source: 'hubspot',
            source_id: 'hs_deal_8472910',
            from_stage: 'Demo Scheduled',
            from_stage_normalized: 'demo',
            to_stage: 'Proposal Sent',
            to_stage_normalized: 'proposal',
            changed_at: now,
          },
        },
      };

    case 'deal.flagged':
      return {
        ...base,
        event: 'deal.flagged',
        event_id: `evt_test_df_${uid()}`,
        data: {
          workspace_name: 'Acme Corp',
          finding: {
            id: uid(),
            deal_id: 'd9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a',
            deal_name: 'Globex Industries – Growth',
            category: 'single_threaded',
            severity: 'act',
            message: 'Only 1 contact mapped — no economic buyer or champion identified',
            source_skill: 'single-thread-alert',
            skill_run_id: `run_${uid()}`,
            owner_email: 'james.wright@globex.io',
            metadata: {
              contact_count: 1,
              roles_present: [],
              risk_level: 'critical',
              likely_cause: 'Relationship concentrated in a single mid-level contact',
            },
          },
        },
      };

    case 'action.created':
      return {
        ...base,
        event: 'action.created',
        event_id: `evt_test_ac_${uid()}`,
        data: {
          workspace_name: 'Acme Corp',
          action: {
            id: 'c5d6e7f8-a9b0-1c2d-3e4f-5a6b7c8d9e0f',
            action_type: 're_engage_deal',
            severity: 'critical',
            title: 'Re-engage Globex Industries – Growth immediately',
            summary: 'No activity logged in 34 days. Deal is drifting toward stale.',
            recommended_steps: [
              'Send a personal video message to the primary contact this week',
              'Loop in an exec sponsor to elevate the conversation',
              'Confirm the proposed close date is still realistic',
            ],
            target_deal_id: 'd9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a',
            target_entity_name: 'Globex Industries – Growth',
            owner_email: 'james.wright@globex.io',
            impact_amount: 85000,
            urgency_label: '34 days stale',
            source_skill: 'pipeline-hygiene',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: now,
          },
        },
      };

    case 'action.completed':
      return {
        ...base,
        event: 'action.completed',
        event_id: `evt_test_acp_${uid()}`,
        data: {
          workspace_name: 'Acme Corp',
          action: {
            id: 'c5d6e7f8-a9b0-1c2d-3e4f-5a6b7c8d9e0f',
            action_type: 're_engage_deal',
            severity: 'critical',
            title: 'Re-engage Globex Industries – Growth immediately',
            target_deal_id: 'd9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a',
            target_entity_name: 'Globex Industries – Growth',
            owner_email: 'james.wright@globex.io',
            impact_amount: 85000,
            source_skill: 'pipeline-hygiene',
            executed_by: 'james.wright@globex.io',
            executed_at: now,
          },
        },
      };

    case 'action.expired':
      return {
        ...base,
        event: 'action.expired',
        event_id: `evt_test_aex_${uid()}`,
        data: {
          workspace_name: 'Acme Corp',
          action: {
            id: 'c5d6e7f8-a9b0-1c2d-3e4f-5a6b7c8d9e0f',
            action_type: 're_engage_deal',
            severity: 'critical',
            title: 'Re-engage Globex Industries – Growth immediately',
            target_deal_id: 'd9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a',
            target_entity_name: 'Globex Industries – Growth',
            owner_email: 'james.wright@globex.io',
            impact_amount: 85000,
            source_skill: 'pipeline-hygiene',
            expired_at: now,
            days_open: 7,
          },
        },
      };

    default:
      return {
        ...base,
        event: 'webhook.test',
        event_id: `evt_test_${uid()}`,
        data: {
          message: 'This is a test webhook from Pandora.',
          workspace_id: workspaceId,
        },
      };
  }
}

/**
 * Send a single test delivery to verify the endpoint is reachable.
 * Accepts an optional eventType to send a realistic dummy payload for that event.
 * Falls back to a generic webhook.test ping when eventType is absent or unrecognised.
 * Uses deliverWebhook (single shot, not retried).
 * Throws 404 if endpoint not found or doesn't belong to workspace.
 */
export async function testWebhookEndpoint(
  workspaceId: string,
  endpointId: string,
  eventType?: string
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
  const testEvent = buildTestEvent(workspaceId, eventType);
  return deliverWebhook(endpoint, testEvent, 1);
}

export interface TestUrlResult {
  event_type: string;
  success: boolean;
  status_code: number | null;
  duration_ms: number | null;
  error: string | null;
}

/**
 * Fire test payloads to an arbitrary URL without creating an endpoint.
 * Sends payloads unsigned (no HMAC) — useful for testing reachability before registering.
 * Payloads are sent sequentially — one per event type, or a single generic ping.
 */
export async function testUrl(
  workspaceId: string,
  url: string,
  eventTypes?: string[]
): Promise<{ results: TestUrlResult[] }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error('Webhook URL must use HTTP or HTTPS') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const typesToTest: (string | undefined)[] =
    eventTypes && eventTypes.length > 0 ? eventTypes : [undefined];

  const results: TestUrlResult[] = [];

  for (const eventType of typesToTest) {
    const event = buildTestEvent(workspaceId, eventType);
    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pandora-Event': event.event,
          'X-Pandora-Event-Id': event.event_id,
          'X-Pandora-Timestamp': event.timestamp,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      });
      results.push({
        event_type: event.event,
        success: response.ok,
        status_code: response.status,
        duration_ms: Date.now() - start,
        error: null,
      });
    } catch (err: any) {
      results.push({
        event_type: event.event,
        success: false,
        status_code: null,
        duration_ms: Date.now() - start,
        error: err?.message ?? 'Request failed',
      });
    }
  }

  return { results };
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
