/**
 * PM Task Service
 *
 * Service layer for creating RevOps operator work items in PM tools.
 * Routes ops actions from skills to the appropriate PM tool adapter.
 */

import { query } from '../db.js';
import type { OpsWorkItem, PMConnectorConfig, PMTaskCreationResult } from '../connectors/pm-tools/types.js';
import { MondayPMAdapter } from '../connectors/pm-tools/monday/adapter.js';
import { getConnectorCredentials } from '../lib/credential-store.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PMTaskService');

/**
 * Create a RevOps work item task in the configured PM tool
 */
export async function createPMTask(
  workspaceId: string,
  workItem: OpsWorkItem
): Promise<PMTaskCreationResult> {
  try {
    // Get PM connector configuration
    const config = await getPMConnectorConfig(workspaceId);

    if (!config || !config.enabled) {
      logger.info('PM connector not configured or disabled', { workspaceId });
      return {
        success: false,
        error: 'PM connector not configured or disabled for this workspace',
      };
    }

    // Get credentials for PM tool
    const credentials = await getConnectorCredentials(workspaceId, `pm_${config.connectorType}`);
    if (!credentials) {
      logger.error('PM connector credentials not found', { workspaceId, connectorType: config.connectorType });
      return {
        success: false,
        error: `Credentials not found for PM connector: ${config.connectorType}`,
      };
    }

    // Merge config defaults with work item
    const enrichedWorkItem: OpsWorkItem = {
      ...workItem,
      projectId: workItem.projectId || config.defaultProjectId,
      sectionId: workItem.sectionId || resolveSectionId(config, workItem.category),
      labels: workItem.labels || config.labels || [],
    };

    // Get the appropriate adapter
    const adapter = getPMAdapter(config.connectorType);

    // Create the task
    const result = await adapter.createTask(credentials, enrichedWorkItem);

    // Log success
    logger.info('PM task created successfully', {
      workspaceId,
      connectorType: config.connectorType,
      category: workItem.category,
      externalId: result.externalId,
      url: result.url,
    });

    // Store reference in database for tracking
    if (result.externalId && workItem.sourceActionId) {
      await storePMTaskReference(workspaceId, workItem.sourceActionId, config.connectorType, result.externalId, result.url);
    }

    return {
      success: true,
      externalId: result.externalId,
      url: result.url,
    };
  } catch (error) {
    logger.error('Failed to create PM task', {
      workspaceId,
      category: workItem.category,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating PM task',
    };
  }
}

/**
 * Get PM connector configuration for a workspace
 */
async function getPMConnectorConfig(workspaceId: string): Promise<PMConnectorConfig | null> {
  const result = await query<{ settings: any }>(
    `SELECT settings FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const settings = result.rows[0].settings || {};
  return settings.pm_connector || null;
}

/**
 * Resolve section/group ID from category mapping
 */
function resolveSectionId(config: PMConnectorConfig, category: string): string | undefined {
  if (!config.categoryMapping) {
    return config.defaultSectionId;
  }

  return config.categoryMapping[category as keyof typeof config.categoryMapping] || config.defaultSectionId;
}

/**
 * Get PM adapter instance for connector type
 */
function getPMAdapter(connectorType: string) {
  switch (connectorType) {
    case 'monday':
      return new MondayPMAdapter();
    // Future: Add Asana, Linear, Jira, ClickUp adapters here
    default:
      throw new Error(`Unsupported PM connector type: ${connectorType}`);
  }
}

/**
 * Store PM task reference for tracking
 */
async function storePMTaskReference(
  workspaceId: string,
  sourceActionId: string,
  connectorType: string,
  externalId: string,
  url: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO pm_task_references (workspace_id, source_action_id, connector_type, external_id, url, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (workspace_id, source_action_id) DO UPDATE
       SET external_id = $4, url = $5, updated_at = NOW()`,
      [workspaceId, sourceActionId, connectorType, externalId, url]
    );
  } catch (error) {
    // Log but don't fail the task creation
    logger.warn('Failed to store PM task reference', {
      workspaceId,
      sourceActionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
