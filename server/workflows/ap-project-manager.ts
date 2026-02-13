/**
 * ActivePieces Project Manager
 *
 * Manages 1:1 mapping between Pandora workspaces and AP projects.
 * Handles project lifecycle: creation, lookup, and cleanup.
 */

import { Pool } from 'pg';
import { APClientInterface } from './workflow-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('APProjectManager');

/**
 * Ensure AP project exists for workspace (idempotent)
 */
export async function ensureAPProject(
  workspaceId: string,
  apClient: APClientInterface,
  db: Pool
): Promise<string> {
  logger.info('[APProjectManager] Ensuring AP project', { workspaceId });

  // Check workspace record for existing ap_project_id
  const wsResult = await db.query(
    `SELECT ap_project_id, name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (wsResult.rows.length === 0) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const workspace = wsResult.rows[0];

  // If ap_project_id exists, return it
  if (workspace.ap_project_id) {
    logger.debug('[APProjectManager] AP project already exists', {
      workspaceId,
      apProjectId: workspace.ap_project_id,
    });
    return workspace.ap_project_id;
  }

  // Try to find existing AP project by externalId
  let apProject = await apClient.getProjectByExternalId(workspaceId);

  if (apProject) {
    logger.info('[APProjectManager] Found existing AP project', {
      workspaceId,
      apProjectId: apProject.id,
    });

    // Store the mapping
    await db.query(
      `UPDATE workspaces SET ap_project_id = $1 WHERE id = $2`,
      [apProject.id, workspaceId]
    );

    return apProject.id;
  }

  // Create new AP project
  logger.info('[APProjectManager] Creating new AP project', { workspaceId });

  apProject = await apClient.createProject({
    displayName: workspace.name || 'Unnamed Workspace',
    externalId: workspaceId,
    metadata: {
      pandora_workspace_id: workspaceId,
      created_at: new Date().toISOString(),
    },
  });

  // Store the mapping
  await db.query(
    `UPDATE workspaces SET ap_project_id = $1 WHERE id = $2`,
    [apProject.id, workspaceId]
  );

  logger.info('[APProjectManager] AP project created', {
    workspaceId,
    apProjectId: apProject.id,
  });

  return apProject.id;
}

/**
 * Cleanup AP project when workspace is deleted/deactivated
 */
export async function cleanupAPProject(
  workspaceId: string,
  apClient: APClientInterface,
  db: Pool
): Promise<void> {
  logger.info('[APProjectManager] Cleaning up AP project', { workspaceId });

  try {
    // Get workspace's AP project ID
    const wsResult = await db.query(
      `SELECT ap_project_id FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const apProjectId = wsResult.rows[0]?.ap_project_id;

    if (!apProjectId) {
      logger.debug('[APProjectManager] No AP project to cleanup', { workspaceId });
      return;
    }

    // List and delete all flows for this project
    try {
      const flows = await apClient.listFlows(apProjectId);
      logger.debug('[APProjectManager] Deleting flows', {
        workspaceId,
        count: flows.length,
      });

      for (const flow of flows) {
        try {
          await apClient.deleteFlow(flow.id);
        } catch (error) {
          logger.error('[APProjectManager] Failed to delete flow', {
            flowId: flow.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error('[APProjectManager] Failed to list flows', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // List and delete all connections for this project
    try {
      const connections = await apClient.listConnections(apProjectId);
      logger.debug('[APProjectManager] Deleting connections', {
        workspaceId,
        count: connections.length,
      });

      for (const conn of connections) {
        try {
          await apClient.deleteConnection(conn.id);
        } catch (error) {
          logger.error('[APProjectManager] Failed to delete connection', {
            connectionId: conn.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error('[APProjectManager] Failed to list connections', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Clear ap_project_id from workspace record
    await db.query(
      `UPDATE workspaces SET ap_project_id = NULL WHERE id = $1`,
      [workspaceId]
    );

    // Clear workspace_ap_connections
    await db.query(
      `DELETE FROM workspace_ap_connections WHERE workspace_id = $1`,
      [workspaceId]
    );

    logger.info('[APProjectManager] AP project cleanup complete', { workspaceId });
  } catch (error) {
    logger.error('[APProjectManager] Cleanup failed (non-fatal)', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
