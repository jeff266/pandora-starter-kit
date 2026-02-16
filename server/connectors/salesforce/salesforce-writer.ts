/**
 * Salesforce CRM Write Service
 *
 * Handles write-back operations to Salesforce CRM:
 * - updateDeal: update Opportunity fields (stage, amount, etc.)
 * - createTask: create follow-up tasks linked to opportunities/contacts
 * - updateContactField: update contact fields
 *
 * Uses the existing SalesforceClient and token refresh infrastructure.
 * Automatically retries on SalesforceSessionExpiredError.
 * All writes are audit-logged to crm_write_log.
 */

import { SalesforceClient, SalesforceSessionExpiredError } from './client.js';
import { getFreshCredentials, refreshToken } from '../../utils/salesforce-token-refresh.js';
import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('SalesforceWriter');

export interface CrmWriteResult {
  success: boolean;
  source_id: string | null;
  error?: string;
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function getClient(workspaceId: string): Promise<SalesforceClient> {
  const creds = await getFreshCredentials(workspaceId);
  return new SalesforceClient({
    accessToken: creds.accessToken,
    instanceUrl: creds.instanceUrl,
  });
}

/**
 * Execute a write operation with automatic retry on session expiry.
 */
async function withSessionRetry<T>(
  workspaceId: string,
  fn: (client: SalesforceClient) => Promise<T>
): Promise<T> {
  let client = await getClient(workspaceId);

  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof SalesforceSessionExpiredError) {
      logger.info('Session expired, refreshing token', { workspaceId });
      const creds = await getFreshCredentials(workspaceId);
      const refreshed = await refreshToken(workspaceId, creds);
      client = new SalesforceClient({
        accessToken: refreshed.accessToken,
        instanceUrl: refreshed.instanceUrl,
      });
      return await fn(client);
    }
    throw err;
  }
}

/**
 * Make a direct REST call for write operations (PATCH/POST).
 * SalesforceClient only exposes query methods, so we use fetch directly
 * while still leveraging the credential management.
 */
async function sfRequest(
  workspaceId: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const doRequest = async (creds: { accessToken: string; instanceUrl: string }) => {
    const url = `${creds.instanceUrl}/services/data/v59.0${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401) {
      throw new SalesforceSessionExpiredError();
    }

    // 204 No Content is success for PATCH/DELETE
    if (response.status === 204) {
      return { status: 204, data: null };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => response.statusText);
      const errorMsg = Array.isArray(errorData)
        ? errorData.map((e: any) => e.message).join('; ')
        : String(errorData);
      throw new Error(`Salesforce API ${response.status}: ${errorMsg}`);
    }

    const data = await response.json();
    return { status: response.status, data };
  };

  let creds = await getFreshCredentials(workspaceId);

  try {
    return await doRequest(creds);
  } catch (err) {
    if (err instanceof SalesforceSessionExpiredError) {
      logger.info('Session expired on write, refreshing token', { workspaceId });
      creds = await refreshToken(workspaceId, creds);
      return await doRequest(creds);
    }
    throw err;
  }
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
        workspaceId, 'salesforce', operation, objectType,
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
 * Update fields on a Salesforce Opportunity (deal).
 */
export async function updateDeal(
  workspaceId: string,
  salesforceOpportunityId: string,
  fields: Record<string, unknown>,
  opts?: { pandoraId?: string; triggeredBy?: string }
): Promise<CrmWriteResult> {
  const start = Date.now();
  try {
    await sfRequest(workspaceId, 'PATCH', `/sobjects/Opportunity/${salesforceOpportunityId}`, fields);

    const duration = Date.now() - start;
    await logWrite(workspaceId, 'update_deal', 'opportunity', salesforceOpportunityId, opts?.pandoraId ?? null, fields, true, null, null, duration, opts?.triggeredBy ?? 'system');

    return { success: true, source_id: salesforceOpportunityId };
  } catch (err) {
    const duration = Date.now() - start;
    const message = (err as Error).message;
    await logWrite(workspaceId, 'update_deal', 'opportunity', salesforceOpportunityId, opts?.pandoraId ?? null, fields, false, message, null, duration, opts?.triggeredBy ?? 'system');

    logger.error('updateDeal failed', undefined, { workspaceId, salesforceOpportunityId, error: message });
    return { success: false, source_id: null, error: message };
  }
}

/**
 * Create a Task in Salesforce and link to an opportunity and/or contact.
 */
export async function createTask(
  workspaceId: string,
  task: {
    subject: string;
    description?: string;
    activityDate?: string; // YYYY-MM-DD
    ownerId?: string;
    priority?: 'High' | 'Normal' | 'Low';
    status?: string;
    whatId?: string;  // Opportunity ID
    whoId?: string;   // Contact/Lead ID
  },
  opts?: { pandoraId?: string; triggeredBy?: string }
): Promise<CrmWriteResult> {
  const start = Date.now();
  const payload: Record<string, unknown> = {
    Subject: task.subject,
    Status: task.status ?? 'Not Started',
    Priority: task.priority ?? 'Normal',
  };
  if (task.description) payload.Description = task.description;
  if (task.activityDate) payload.ActivityDate = task.activityDate;
  if (task.ownerId) payload.OwnerId = task.ownerId;
  if (task.whatId) payload.WhatId = task.whatId;
  if (task.whoId) payload.WhoId = task.whoId;

  try {
    const result = await sfRequest(workspaceId, 'POST', '/sobjects/Task', payload);
    const taskId = (result.data as any)?.id ?? null;

    const duration = Date.now() - start;
    await logWrite(workspaceId, 'create_task', 'task', taskId, opts?.pandoraId ?? null, payload, true, null, result.data, duration, opts?.triggeredBy ?? 'system');

    return { success: true, source_id: taskId };
  } catch (err) {
    const duration = Date.now() - start;
    const message = (err as Error).message;
    await logWrite(workspaceId, 'create_task', 'task', null, opts?.pandoraId ?? null, payload, false, message, null, duration, opts?.triggeredBy ?? 'system');

    logger.error('createTask failed', undefined, { workspaceId, error: message });
    return { success: false, source_id: null, error: message };
  }
}

/**
 * Update fields on a Salesforce Contact.
 */
export async function updateContactField(
  workspaceId: string,
  salesforceContactId: string,
  fields: Record<string, unknown>,
  opts?: { pandoraId?: string; triggeredBy?: string }
): Promise<CrmWriteResult> {
  const start = Date.now();
  try {
    await sfRequest(workspaceId, 'PATCH', `/sobjects/Contact/${salesforceContactId}`, fields);

    const duration = Date.now() - start;
    await logWrite(workspaceId, 'update_contact', 'contact', salesforceContactId, opts?.pandoraId ?? null, fields, true, null, null, duration, opts?.triggeredBy ?? 'system');

    return { success: true, source_id: salesforceContactId };
  } catch (err) {
    const duration = Date.now() - start;
    const message = (err as Error).message;
    await logWrite(workspaceId, 'update_contact', 'contact', salesforceContactId, opts?.pandoraId ?? null, fields, false, message, null, duration, opts?.triggeredBy ?? 'system');

    logger.error('updateContactField failed', undefined, { workspaceId, salesforceContactId, error: message });
    return { success: false, source_id: null, error: message };
  }
}
