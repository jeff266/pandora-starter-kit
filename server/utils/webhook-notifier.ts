/**
 * Webhook Notifier
 *
 * Sends progress updates and sync completion events to configured webhooks
 */

import { query } from '../db.js';

export interface WebhookPayload {
  event: 'sync.progress' | 'sync.completed' | 'sync.failed';
  workspaceId: string;
  jobId?: string;
  syncId?: string;
  timestamp: string;
  data: {
    jobType?: string;
    status?: string;
    progress?: {
      current: number;
      total: number;
      message: string;
    };
    result?: any;
    error?: string;
  };
}

interface WebhookConfig {
  url: string;
  secret?: string;
}

/**
 * Get webhook configuration for a workspace
 */
async function getWebhookConfig(workspaceId: string): Promise<WebhookConfig | null> {
  const result = await query<{ webhook_url: string | null; webhook_secret: string | null }>(
    `SELECT webhook_url, webhook_secret FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row || !row.webhook_url) {
    return null;
  }

  return {
    url: row.webhook_url,
    secret: row.webhook_secret || undefined,
  };
}

/**
 * Send webhook notification (non-blocking, failures logged but don't throw)
 */
export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  try {
    const config = await getWebhookConfig(payload.workspaceId);
    if (!config) {
      return; // No webhook configured
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Pandora-Sync/1.0',
    };

    // Add signature if secret is configured
    if (config.secret) {
      const signature = await createSignature(JSON.stringify(payload), config.secret);
      headers['X-Webhook-Signature'] = signature;
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      console.warn(
        `[Webhook] Failed to send ${payload.event} to ${config.url}: ${response.status} ${response.statusText}`
      );
    } else {
      console.log(`[Webhook] Sent ${payload.event} to ${config.url}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Webhook] Error sending ${payload.event}:`, msg);
    // Don't throw - webhook failures should not break sync operations
  }
}

/**
 * Create HMAC SHA-256 signature for webhook payload
 */
async function createSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hashHex}`;
}

/**
 * Notify webhook of sync progress update
 */
export function notifyProgress(
  workspaceId: string,
  jobId: string,
  jobType: string,
  progress: { current: number; total: number; message: string }
): void {
  // Fire and forget - don't await
  sendWebhook({
    event: 'sync.progress',
    workspaceId,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      jobType,
      progress,
    },
  }).catch(() => {}); // Ignore errors
}

/**
 * Notify webhook of sync completion
 */
export function notifyCompleted(
  workspaceId: string,
  jobId: string,
  jobType: string,
  result: any
): void {
  sendWebhook({
    event: 'sync.completed',
    workspaceId,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      jobType,
      status: 'completed',
      result,
    },
  }).catch(() => {});
}

/**
 * Notify webhook of sync failure
 */
export function notifyFailed(
  workspaceId: string,
  jobId: string,
  jobType: string,
  error: string
): void {
  sendWebhook({
    event: 'sync.failed',
    workspaceId,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      jobType,
      status: 'failed',
      error,
    },
  }).catch(() => {});
}
