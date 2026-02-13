/**
 * ActivePieces Connection Provisioner
 *
 * Syncs Pandora connector credentials → AP predefined connections.
 * Auto-provisions connections when users connect services in Pandora.
 */

import { Pool } from 'pg';
import { APClientInterface } from './workflow-service.js';
import { ensureAPProject } from './ap-project-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('APConnectionProvisioner');

interface PieceConnectionMapping {
  pieceName: string;
  authType: 'PLATFORM_OAUTH2' | 'SECRET_TEXT' | 'BASIC_AUTH' | 'CUSTOM_AUTH';
  displayName: string;
  extractProps: (credentials: any) => Record<string, any>;
}

export const CONNECTOR_TO_PIECE_MAP: Record<string, PieceConnectionMapping> = {
  hubspot: {
    pieceName: '@activepieces/piece-hubspot',
    authType: 'PLATFORM_OAUTH2',
    displayName: 'HubSpot (via Pandora)',
    extractProps: (creds) => ({
      access_token: creds.accessToken,
      refresh_token: creds.refreshToken,
      expires_in: creds.expiresIn,
      token_type: creds.tokenType || 'Bearer',
    }),
  },
  salesforce: {
    pieceName: '@activepieces/piece-salesforce',
    authType: 'PLATFORM_OAUTH2',
    displayName: 'Salesforce (via Pandora)',
    extractProps: (creds) => ({
      access_token: creds.accessToken,
      refresh_token: creds.refreshToken,
      instance_url: creds.instanceUrl,
    }),
  },
  slack: {
    pieceName: '@activepieces/piece-slack',
    authType: 'PLATFORM_OAUTH2',
    displayName: 'Slack (via Pandora)',
    extractProps: (creds) => ({
      access_token: creds.botToken || creds.accessToken,
    }),
  },
  // Future connectors added as they get Pandora integrations:
  // gong: { ... },
  // fireflies: { ... },
  // monday: { ... },
  // google_drive: { ... },
};

export interface ProvisionResult {
  created: string[];    // connector types that got new connections
  updated: string[];    // connector types that got refreshed
  skipped: string[];    // connector types with no piece mapping
  errors: { connector: string; error: string }[];
}

/**
 * Provision connections for all connected connectors in workspace
 */
export async function provisionConnections(
  workspaceId: string,
  apProjectId: string,
  apClient: APClientInterface,
  db: Pool
): Promise<ProvisionResult> {
  logger.info('[APConnectionProvisioner] Provisioning connections', {
    workspaceId,
    apProjectId,
  });

  const result: ProvisionResult = {
    created: [],
    updated: [],
    skipped: [],
    errors: [],
  };

  // Query connector_configs for all active connectors
  const connectorsResult = await db.query(
    `
    SELECT connector_type, credentials
    FROM connector_configs
    WHERE workspace_id = $1 AND status = 'connected'
    `,
    [workspaceId]
  );

  logger.debug('[APConnectionProvisioner] Found connected connectors', {
    count: connectorsResult.rows.length,
  });

  for (const connector of connectorsResult.rows) {
    const connectorType = connector.connector_type;

    try {
      // Check if we have a mapping for this connector
      const mapping = CONNECTOR_TO_PIECE_MAP[connectorType];

      if (!mapping) {
        logger.debug('[APConnectionProvisioner] No piece mapping', { connectorType });
        result.skipped.push(connectorType);
        continue;
      }

      // Generate externalId
      const externalId = `pandora_${connectorType}_${workspaceId}`;

      // Check if connection already exists in AP
      const existingConnections = await apClient.listConnections(apProjectId);
      const existingConn = existingConnections.find((c) => c.externalId === externalId);

      // Extract credentials
      const credentials = connector.credentials;
      const connValue = mapping.extractProps(credentials);

      if (existingConn) {
        // Update existing connection
        logger.info('[APConnectionProvisioner] Updating connection', {
          connectorType,
          connectionId: existingConn.id,
        });

        await apClient.updateConnection(existingConn.id, { value: connValue });

        // Update tracking table
        await db.query(
          `
          UPDATE workspace_ap_connections
          SET last_synced_at = now()
          WHERE workspace_id = $1 AND connector_type = $2
          `,
          [workspaceId, connectorType]
        );

        result.updated.push(connectorType);
      } else {
        // Create new connection
        logger.info('[APConnectionProvisioner] Creating connection', {
          connectorType,
          pieceName: mapping.pieceName,
        });

        const connection = await apClient.createConnection({
          projectId: apProjectId,
          externalId,
          displayName: mapping.displayName,
          pieceName: mapping.pieceName,
          type: mapping.authType,
          value: connValue,
          scope: 'PLATFORM',
        });

        // Store in tracking table
        await db.query(
          `
          INSERT INTO workspace_ap_connections (
            workspace_id, connector_type, ap_connection_id,
            ap_project_id, piece_name, external_id
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (workspace_id, connector_type)
          DO UPDATE SET
            ap_connection_id = $3,
            external_id = $6,
            last_synced_at = now()
          `,
          [
            workspaceId,
            connectorType,
            connection.id,
            apProjectId,
            mapping.pieceName,
            externalId,
          ]
        );

        result.created.push(connectorType);
      }
    } catch (error) {
      logger.error('[APConnectionProvisioner] Failed to provision connection', {
        connectorType,
        error: error instanceof Error ? error.message : String(error),
      });

      result.errors.push({
        connector: connectorType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('[APConnectionProvisioner] Provisioning complete', {
    created: result.created.length,
    updated: result.updated.length,
    skipped: result.skipped.length,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Refresh connection credentials (called on OAuth token refresh)
 */
export async function refreshConnection(
  workspaceId: string,
  connectorType: string,
  newCredentials: Record<string, any>,
  apClient: APClientInterface,
  db: Pool
): Promise<void> {
  logger.info('[APConnectionProvisioner] Refreshing connection', {
    workspaceId,
    connectorType,
  });

  try {
    // Check if we have a mapping for this connector
    const mapping = CONNECTOR_TO_PIECE_MAP[connectorType];

    if (!mapping) {
      logger.debug('[APConnectionProvisioner] No piece mapping for refresh', {
        connectorType,
      });
      return;
    }

    // Look up the AP connection from tracking table
    const trackingResult = await db.query(
      `
      SELECT ap_connection_id, ap_project_id
      FROM workspace_ap_connections
      WHERE workspace_id = $1 AND connector_type = $2
      `,
      [workspaceId, connectorType]
    );

    if (trackingResult.rows.length === 0) {
      // Connection not found - provision it
      logger.info('[APConnectionProvisioner] Connection not found, provisioning', {
        workspaceId,
        connectorType,
      });

      // Ensure AP project exists
      const apProjectId = await ensureAPProject(workspaceId, apClient, db);

      // Update connector_configs with new credentials
      await db.query(
        `
        UPDATE connector_configs
        SET credentials = $1
        WHERE workspace_id = $2 AND connector_type = $3
        `,
        [JSON.stringify(newCredentials), workspaceId, connectorType]
      );

      // Provision the connection
      await provisionConnections(workspaceId, apProjectId, apClient, db);
      return;
    }

    const tracking = trackingResult.rows[0];

    // Extract credentials
    const connValue = mapping.extractProps(newCredentials);

    // Update AP connection
    await apClient.updateConnection(tracking.ap_connection_id, { value: connValue });

    // Update tracking table
    await db.query(
      `
      UPDATE workspace_ap_connections
      SET last_synced_at = now()
      WHERE workspace_id = $1 AND connector_type = $2
      `,
      [workspaceId, connectorType]
    );

    logger.info('[APConnectionProvisioner] Connection refreshed', {
      workspaceId,
      connectorType,
      connectionId: tracking.ap_connection_id,
    });
  } catch (error) {
    logger.error('[APConnectionProvisioner] Failed to refresh connection', {
      workspaceId,
      connectorType,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Handle connector connection event
 */
export async function onConnectorConnected(
  workspaceId: string,
  connectorType: string,
  credentials: Record<string, any>,
  apClient: APClientInterface,
  db: Pool
): Promise<void> {
  logger.info('[APConnectionProvisioner] Connector connected', {
    workspaceId,
    connectorType,
  });

  try {
    // Ensure AP project exists
    const apProjectId = await ensureAPProject(workspaceId, apClient, db);

    // Provision the connection
    await provisionConnections(workspaceId, apProjectId, apClient, db);
  } catch (error) {
    logger.error('[APConnectionProvisioner] Failed to handle connector connected', {
      workspaceId,
      connectorType,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is a background task
  }
}

/**
 * Handle connector disconnection event
 */
export async function onConnectorDisconnected(
  workspaceId: string,
  connectorType: string,
  apClient: APClientInterface,
  db: Pool
): Promise<void> {
  logger.info('[APConnectionProvisioner] Connector disconnected', {
    workspaceId,
    connectorType,
  });

  try {
    // Look up the AP connection
    const trackingResult = await db.query(
      `
      SELECT ap_connection_id
      FROM workspace_ap_connections
      WHERE workspace_id = $1 AND connector_type = $2
      `,
      [workspaceId, connectorType]
    );

    if (trackingResult.rows.length === 0) {
      logger.debug('[APConnectionProvisioner] No AP connection to delete', {
        workspaceId,
        connectorType,
      });
      return;
    }

    const connectionId = trackingResult.rows[0].ap_connection_id;

    // Delete from AP
    try {
      await apClient.deleteConnection(connectionId);
    } catch (error) {
      logger.warn('[APConnectionProvisioner] Failed to delete AP connection (may not exist)', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Remove from tracking table
    await db.query(
      `
      DELETE FROM workspace_ap_connections
      WHERE workspace_id = $1 AND connector_type = $2
      `,
      [workspaceId, connectorType]
    );

    logger.info('[APConnectionProvisioner] Connection removed', {
      workspaceId,
      connectorType,
      connectionId,
    });
  } catch (error) {
    logger.error('[APConnectionProvisioner] Failed to handle connector disconnected', {
      workspaceId,
      connectorType,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is a background task
  }
}
