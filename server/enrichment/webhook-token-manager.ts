/**
 * Webhook Token Manager
 *
 * Manages rotatable authentication tokens for inbound webhook endpoints.
 * Each workspace has one active token at a time, embedded in the webhook URL path.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('Webhook Token Manager');

export interface WebhookToken {
  id: string;
  workspace_id: string;
  token: string;
  is_active: boolean;
  created_at: Date;
  rotated_at: Date | null;
}

/**
 * Generate a secure URL-safe random token.
 */
export function generateSecureToken(): string {
  return 'tk_' + crypto.randomBytes(32).toString('base64url');
}

/**
 * Get the active webhook token for a workspace.
 * Creates one if it doesn't exist.
 */
export async function getActiveToken(workspaceId: string): Promise<WebhookToken> {
  try {
    // Try to find existing active token
    const existing = await query<WebhookToken>(
      `SELECT * FROM webhook_tokens
       WHERE workspace_id = $1
         AND is_active = true
       LIMIT 1`,
      [workspaceId]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Create new token if none exists
    const token = generateSecureToken();
    const created = await query<WebhookToken>(
      `INSERT INTO webhook_tokens (workspace_id, token, is_active)
       VALUES ($1, $2, true)
       RETURNING *`,
      [workspaceId, token]
    );

    logger.info('Created new webhook token', {
      workspace_id: workspaceId,
      token_id: created.rows[0].id,
    });

    return created.rows[0];
  } catch (error) {
    logger.error('Failed to get active token', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Rotate the webhook token for a workspace.
 * Deactivates the old token and creates a new one.
 */
export async function rotateToken(workspaceId: string): Promise<WebhookToken> {
  try {
    // Deactivate existing active token
    await query(
      `UPDATE webhook_tokens
       SET is_active = false,
           rotated_at = NOW()
       WHERE workspace_id = $1
         AND is_active = true`,
      [workspaceId]
    );

    // Create new active token
    const token = generateSecureToken();
    const created = await query<WebhookToken>(
      `INSERT INTO webhook_tokens (workspace_id, token, is_active)
       VALUES ($1, $2, true)
       RETURNING *`,
      [workspaceId, token]
    );

    logger.info('Rotated webhook token', {
      workspace_id: workspaceId,
      new_token_id: created.rows[0].id,
    });

    return created.rows[0];
  } catch (error) {
    logger.error('Failed to rotate token', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Validate a webhook token.
 * Returns workspace_id if valid and active, null otherwise.
 */
export async function validateToken(token: string): Promise<string | null> {
  try {
    const result = await query<{ workspace_id: string }>(
      `SELECT workspace_id
       FROM webhook_tokens
       WHERE token = $1
         AND is_active = true
       LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      logger.warn('Invalid or inactive webhook token attempted', { token: token.substring(0, 10) + '...' });
      return null;
    }

    return result.rows[0].workspace_id;
  } catch (error) {
    logger.error('Token validation error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get webhook URL for a workspace.
 */
export async function getWebhookUrl(workspaceId: string, baseUrl: string = 'https://app.pandora.io'): Promise<string> {
  const activeToken = await getActiveToken(workspaceId);
  return `${baseUrl}/webhooks/enrich/${workspaceId}/${activeToken.token}`;
}

/**
 * Get token history for a workspace.
 */
export async function getTokenHistory(workspaceId: string): Promise<WebhookToken[]> {
  try {
    const result = await query<WebhookToken>(
      `SELECT * FROM webhook_tokens
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [workspaceId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Failed to get token history', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
