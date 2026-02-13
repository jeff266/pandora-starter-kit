/**
 * Connector Registry Service
 *
 * Queries and filters the connector registry based on workspace plan,
 * connection status, and gating rules.
 */

import { Pool } from 'pg';
import { ConnectorRegistryEntry, WorkflowTree } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ConnectorRegistryService');

const PLAN_TIERS: Record<string, number> = {
  starter: 1,
  growth: 2,
  enterprise: 3,
};

/**
 * Get available pieces for a workspace based on plan tier
 */
export async function getAvailablePieces(
  db: Pool,
  workspaceId: string
): Promise<ConnectorRegistryEntry[]> {
  // Get workspace plan
  const wsResult = await db.query(
    `SELECT plan FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  // Default to 'starter' if plan column doesn't exist or is null
  const workspacePlan = wsResult.rows[0]?.plan || 'starter';
  const workspaceTier = PLAN_TIERS[workspacePlan] || PLAN_TIERS.starter;

  logger.debug('[ConnectorRegistry] Getting available pieces', {
    workspaceId,
    workspacePlan,
    workspaceTier,
  });

  // Query registry
  const result = await db.query<ConnectorRegistryEntry>(
    `
    SELECT * FROM connector_registry
    WHERE gate_status != 'disabled'
    ORDER BY display_name
    `
  );

  // Filter by plan tier
  const available = result.rows.filter((piece) => {
    if (!piece.requires_plan) {
      return true; // Available to all
    }

    const requiredTier = PLAN_TIERS[piece.requires_plan];
    return workspaceTier >= requiredTier;
  });

  logger.debug('[ConnectorRegistry] Filtered available pieces', {
    total: result.rows.length,
    available: available.length,
  });

  return available;
}

/**
 * Get connected pieces for a workspace (pieces with active connections)
 */
export async function getConnectedPieces(
  db: Pool,
  workspaceId: string
): Promise<ConnectorRegistryEntry[]> {
  logger.debug('[ConnectorRegistry] Getting connected pieces', { workspaceId });

  // Get active connectors for workspace
  const connectorsResult = await db.query(
    `
    SELECT connector_type FROM connector_configs
    WHERE workspace_id = $1 AND status = 'connected'
    `,
    [workspaceId]
  );

  const connectedTypes = connectorsResult.rows.map((r: any) => r.connector_type);

  if (connectedTypes.length === 0) {
    return [];
  }

  // Query registry for pieces that map to these connector types
  const result = await db.query<ConnectorRegistryEntry>(
    `
    SELECT * FROM connector_registry
    WHERE pandora_connector_type = ANY($1::text[])
      AND gate_status IN ('available', 'beta')
    ORDER BY display_name
    `,
    [connectedTypes]
  );

  logger.debug('[ConnectorRegistry] Found connected pieces', {
    count: result.rows.length,
  });

  return result.rows;
}

/**
 * Get piece by name
 */
export async function getPieceByName(
  db: Pool,
  pieceName: string
): Promise<ConnectorRegistryEntry | null> {
  const result = await db.query<ConnectorRegistryEntry>(
    `SELECT * FROM connector_registry WHERE piece_name = $1`,
    [pieceName]
  );

  return result.rows[0] || null;
}

/**
 * Get required connections for a workflow tree
 */
export async function getRequiredConnectionsForTree(
  db: Pool,
  tree: WorkflowTree,
  workspaceId: string
): Promise<{ available: string[]; missing: string[] }> {
  logger.debug('[ConnectorRegistry] Checking required connections for tree', {
    workspaceId,
  });

  const requiredConnectors = new Set<string>();

  // Walk tree steps to collect required connectors
  function walkSteps(steps: any[]): void {
    for (const step of steps) {
      if (step.type === 'crm_update') {
        requiredConnectors.add(step.config.connector);
      } else if (step.type === 'slack_notify') {
        requiredConnectors.add('slack');
      } else if (step.type === 'piece') {
        // Look up pandora_connector_type for this piece
        requiredConnectors.add(step.config.piece_name);
      } else if (step.type === 'conditional') {
        if (step.config.if_true) walkSteps(step.config.if_true);
        if (step.config.if_false) walkSteps(step.config.if_false);
      }
    }
  }

  walkSteps(tree.steps);

  // Get connected pieces for workspace
  const connectedPieces = await getConnectedPieces(db, workspaceId);
  const connectedTypes = new Set(
    connectedPieces
      .map((p) => p.pandora_connector_type)
      .filter((t): t is string => t !== null)
  );

  // Also check for piece names directly (for non-Pandora pieces)
  const connectedPieceNames = new Set(connectedPieces.map((p) => p.piece_name));

  const available: string[] = [];
  const missing: string[] = [];

  for (const connector of requiredConnectors) {
    if (connectedTypes.has(connector) || connectedPieceNames.has(connector)) {
      available.push(connector);
    } else {
      missing.push(connector);
    }
  }

  logger.debug('[ConnectorRegistry] Required connections check', {
    required: Array.from(requiredConnectors),
    available,
    missing,
  });

  return { available, missing };
}
