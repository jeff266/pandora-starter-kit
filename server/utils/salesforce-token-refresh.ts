/**
 * Salesforce Token Refresh Utility
 *
 * Handles automatic token refresh for Salesforce connections.
 * Tokens expire after ~2 hours, so we refresh if > 90 minutes old.
 */

import { query } from '../db.js';
import { SalesforceClient } from '../connectors/salesforce/client.js';
import { createLogger } from './logger.js';

const logger = createLogger('SalesforceTokenRefresh');

const TOKEN_EXPIRY_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes

export interface SalesforceCredentials {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  issuedAt?: number;
}

/**
 * Get Salesforce credentials and refresh if needed
 * @param workspaceId - The workspace ID
 * @returns Fresh credentials ready for use
 */
export async function getFreshCredentials(workspaceId: string): Promise<SalesforceCredentials> {
  // Get current credentials from database
  const result = await query<{ credentials: SalesforceCredentials; updated_at: Date }>(
    `SELECT credentials, updated_at FROM connections
     WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    throw new Error('Salesforce connection not found');
  }

  const { credentials, updated_at } = result.rows[0];

  // Check if token needs refresh (older than 90 minutes)
  const tokenAge = Date.now() - new Date(updated_at).getTime();
  const needsRefresh = tokenAge > TOKEN_EXPIRY_THRESHOLD_MS;

  if (!needsRefresh) {
    logger.debug('Token still fresh', { workspaceId, tokenAge: Math.round(tokenAge / 1000 / 60) + 'min' });
    return credentials;
  }

  logger.info('Token needs refresh', { workspaceId, tokenAge: Math.round(tokenAge / 1000 / 60) + 'min' });

  // Refresh the token
  return await refreshToken(workspaceId, credentials);
}

/**
 * Refresh Salesforce access token
 * @param workspaceId - The workspace ID
 * @param credentials - Current credentials with refresh token
 * @returns New credentials with fresh access token
 */
export async function refreshToken(
  workspaceId: string,
  credentials: SalesforceCredentials
): Promise<SalesforceCredentials> {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET must be set');
  }

  try {
    // Call Salesforce to refresh the token
    const refreshed = await SalesforceClient.refreshAccessToken(
      credentials.refreshToken,
      clientId,
      clientSecret
    );

    const newCredentials: SalesforceCredentials = {
      accessToken: refreshed.accessToken,
      refreshToken: credentials.refreshToken, // Refresh token stays the same
      instanceUrl: refreshed.instanceUrl, // May change
      issuedAt: Date.now(),
    };

    // Update database with new credentials
    await query(
      `UPDATE connections
       SET credentials = $1, updated_at = NOW()
       WHERE workspace_id = $2 AND connector_name = 'salesforce'`,
      [JSON.stringify(newCredentials), workspaceId]
    );

    logger.info('Token refreshed successfully', { workspaceId });

    return newCredentials;
  } catch (error) {
    logger.error('Token refresh failed', { workspaceId, error });
    throw new Error(`Failed to refresh Salesforce token: ${(error as Error).message}`);
  }
}

/**
 * Test if credentials are valid (for health checks)
 */
export async function testCredentials(credentials: SalesforceCredentials): Promise<boolean> {
  try {
    const client = new SalesforceClient({
      accessToken: credentials.accessToken,
      instanceUrl: credentials.instanceUrl,
    });

    const result = await client.testConnection();
    return result.success;
  } catch {
    return false;
  }
}
