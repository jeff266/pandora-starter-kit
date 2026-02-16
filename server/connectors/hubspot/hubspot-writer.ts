/**
 * HubSpot CRM Write Service
 *
 * Handles write-back operations to HubSpot CRM:
 * - updateDeal: update deal properties (stage, amount, etc.)
 * - createTask: create follow-up tasks with deal associations
 * - updateContactProperty: update contact properties
 *
 * Uses existing OAuth credentials from the credential store.
 * Automatically retries on 401 by refreshing the access token.
 * All writes are audit-logged to crm_write_log.
 */

import { getConnectorCredentials, updateCredentialFields } from '../../lib/credential-store.js';
import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('HubSpotWriter');

const HUBSPOT_API = 'https://api.hubapi.com';

export interface CrmWriteResult {
  success: boolean;
  source_id: string | null;
  error?: string;
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function getAccessToken(workspaceId: string): Promise<string> {
  const creds = await getConnectorCredentials(workspaceId, 'hubspot');
  if (!creds?.accessToken) {
    throw new Error('HubSpot connection not found or missing access token');
  }
  return creds.accessToken;
}

async function refreshAccessToken(workspaceId: string): Promise<string> {
  const creds = await getConnectorCredentials(workspaceId, 'hubspot');
  if (!creds?.refreshToken) {
    throw new Error('HubSpot refresh token not available');
  }

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET must be set');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.refreshToken,
  });

  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot token refresh failed: ${errorText}`);
  }

  const data = await response.json() as { access_token: string; refresh_token: string };

  await updateCredentialFields(workspaceId, 'hubspot', {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  });

  logger.info('Token refreshed successfully', { workspaceId });
  return data.access_token;
}

/**
 * Execute an API call with automatic 401 retry via token refresh.
 */
async function hubspotRequest<T>(
  workspaceId: string,
  path: string,
  options: RequestInit
): Promise<T> {
  let token = await getAccessToken(workspaceId);

  const attempt = async (accessToken: string): Promise<Response> => {
    return fetch(`${HUBSPOT_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  };

  let response = await attempt(token);

  if (response.status === 401) {
    logger.info('Got 401, refreshing token', { workspaceId, path });
    token = await refreshAccessToken(workspaceId);
    response = await attempt(token);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot API ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Log a write operation to the crm_write_log table.
 */
async function logWrite(
  workspaceId: string,
  operation: string,
  objectType: string,
  sourceId: string | null,
  pandoraId: string | null,
  payload: Record<string, unknown>,
  success: boolean,
  error: string | null,
  response: unknown,
  durationMs: number,
  triggeredBy: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO crm_write_log
        (workspace_id, connector_name, operation, object_type, source_id, pandora_id, payload, success, error, response, duration_ms, triggered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        workspaceId, 'hubspot', operation, objectType,
        sourceId, pandoraId,
        JSON.stringify(payload), success,
        error, response ? JSON.stringify(response) : null,
        durationMs, triggeredBy,
      ]
    );
  } catch (err) {
    logger.error('Failed to log write', err as Error);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Update properties on a HubSpot deal.
 */
export async function updateDeal(
  workspaceId: string,
  hubspotDealId: string,
  properties: Record<string, string>,
  opts?: { pandoraId?: string; triggeredBy?: string }
): Promise<CrmWriteResult> {
  const start = Date.now();
  try {
    const result = await hubspotRequest<{ id: string }>(
      workspaceId,
      `/crm/v3/objects/deals/${hubspotDealId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      }
    );

    const duration = Date.now() - start;
    await logWrite(workspaceId, 'update_deal', 'deal', hubspotDealId, opts?.pandoraId ?? null, properties, true, null, result, duration, opts?.triggeredBy ?? 'system');

    return { success: true, source_id: result.id };
  } catch (err) {
    const duration = Date.now() - start;
    const message = (err as Error).message;
    await logWrite(workspaceId, 'update_deal', 'deal', hubspotDealId, opts?.pandoraId ?? null, properties, false, message, null, duration, opts?.triggeredBy ?? 'system');

    logger.error('updateDeal failed', undefined, { workspaceId, hubspotDealId, error: message });
    return { success: false, source_id: null, error: message };
  }
}

/**
 * Create a task in HubSpot and associate it with a deal.
 */
export async function createTask(
  workspaceId: string,
  task: {
    subject: string;
    body?: string;
    dueDate?: string; // YYYY-MM-DD
    ownerId?: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    associateDealId?: string;
  },
  opts?: { pandoraId?: string; triggeredBy?: string }
): Promise<CrmWriteResult> {
  const start = Date.now();
  const properties: Record<string, string> = {
    hs_task_subject: task.subject,
    hs_task_status: 'NOT_STARTED',
  };
  if (task.body) properties.hs_task_body = task.body;
  if (task.dueDate) properties.hs_timestamp = new Date(task.dueDate).getTime().toString();
  if (task.ownerId) properties.hubspot_owner_id = task.ownerId;
  if (task.priority) properties.hs_task_priority = task.priority;

  const payload: Record<string, unknown> = { properties };

  if (task.associateDealId) {
    payload.associations = [
      {
        to: { id: task.associateDealId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 216 }],
      },
    ];
  }

  try {
    const result = await hubspotRequest<{ id: string }>(
      workspaceId,
      '/crm/v3/objects/tasks',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    const duration = Date.now() - start;
    await logWrite(workspaceId, 'create_task', 'task', result.id, opts?.pandoraId ?? null, payload as Record<string, unknown>, true, null, result, duration, opts?.triggeredBy ?? 'system');

    return { success: true, source_id: result.id };
  } catch (err) {
    const duration = Date.now() - start;
    const message = (err as Error).message;
    await logWrite(workspaceId, 'create_task', 'task', null, opts?.pandoraId ?? null, payload as Record<string, unknown>, false, message, null, duration, opts?.triggeredBy ?? 'system');

    logger.error('createTask failed', undefined, { workspaceId, error: message });
    return { success: false, source_id: null, error: message };
  }
}

/**
 * Update a property on a HubSpot contact.
 */
export async function updateContactProperty(
  workspaceId: string,
  hubspotContactId: string,
  properties: Record<string, string>,
  opts?: { pandoraId?: string; triggeredBy?: string }
): Promise<CrmWriteResult> {
  const start = Date.now();
  try {
    const result = await hubspotRequest<{ id: string }>(
      workspaceId,
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      }
    );

    const duration = Date.now() - start;
    await logWrite(workspaceId, 'update_contact', 'contact', hubspotContactId, opts?.pandoraId ?? null, properties, true, null, result, duration, opts?.triggeredBy ?? 'system');

    return { success: true, source_id: result.id };
  } catch (err) {
    const duration = Date.now() - start;
    const message = (err as Error).message;
    await logWrite(workspaceId, 'update_contact', 'contact', hubspotContactId, opts?.pandoraId ?? null, properties, false, message, null, duration, opts?.triggeredBy ?? 'system');

    logger.error('updateContactProperty failed', undefined, { workspaceId, hubspotContactId, error: message });
    return { success: false, source_id: null, error: message };
  }
}
