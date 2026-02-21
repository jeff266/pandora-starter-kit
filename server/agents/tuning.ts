/**
 * Tuning Pairs Reader
 *
 * Reads tuning pairs from the context_layer table for a specific agent + workspace.
 * These get injected into the editorial synthesis prompt to improve outputs based on feedback.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import type { TuningPair } from './editorial-types.js';

const logger = createLogger('Tuning');

/**
 * Get all tuning pairs for a specific agent in a workspace
 */
export async function getTuningPairs(
  agentId: string,
  workspaceId: string
): Promise<TuningPair[]> {
  logger.info('[Tuning] Fetching tuning pairs', { agent_id: agentId, workspace_id: workspaceId });

  const result = await query(
    `SELECT key, value, metadata
     FROM context_layer
     WHERE workspace_id = $1
       AND category = 'agent_tuning'
       AND key LIKE $2
     ORDER BY updated_at DESC`,
    [workspaceId, `${agentId}:%`]
  );

  const pairs: TuningPair[] = result.rows.map(row => {
    const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;

    return {
      key: row.key.replace(`${agentId}:`, ''),
      value,
      source: metadata?.source || 'system',
      confidence: metadata?.confidence || 0.5,
    };
  });

  logger.info('[Tuning] Tuning pairs loaded', {
    agent_id: agentId,
    workspace_id: workspaceId,
    pair_count: pairs.length,
  });

  return pairs;
}

/**
 * Save a tuning pair to the context_layer table
 */
export async function saveTuningPair(
  agentId: string,
  workspaceId: string,
  key: string,
  value: any,
  metadata: {
    source: string;
    confidence: number;
    feedback_id?: string;
  }
): Promise<void> {
  const fullKey = `${agentId}:${key}`;

  logger.info('[Tuning] Saving tuning pair', {
    agent_id: agentId,
    workspace_id: workspaceId,
    key: fullKey,
    source: metadata.source,
    confidence: metadata.confidence,
  });

  await query(
    `INSERT INTO context_layer (workspace_id, category, key, value, metadata, updated_at)
     VALUES ($1, 'agent_tuning', $2, $3, $4, NOW())
     ON CONFLICT (workspace_id, category, key)
     DO UPDATE SET value = $3, metadata = $4, updated_at = NOW()`,
    [
      workspaceId,
      fullKey,
      JSON.stringify(value),
      JSON.stringify(metadata),
    ]
  );

  logger.info('[Tuning] Tuning pair saved', { key: fullKey });
}

/**
 * Remove a tuning pair
 */
export async function removeTuningPair(
  agentId: string,
  workspaceId: string,
  key: string
): Promise<void> {
  const fullKey = `${agentId}:${key}`;

  logger.info('[Tuning] Removing tuning pair', {
    agent_id: agentId,
    workspace_id: workspaceId,
    key: fullKey,
  });

  await query(
    `DELETE FROM context_layer
     WHERE workspace_id = $1
       AND category = 'agent_tuning'
       AND key = $2`,
    [workspaceId, fullKey]
  );

  logger.info('[Tuning] Tuning pair removed', { key: fullKey });
}

/**
 * Get all tuning pairs for a workspace (across all agents)
 */
export async function getAllTuningPairs(workspaceId: string): Promise<Record<string, TuningPair[]>> {
  logger.info('[Tuning] Fetching all tuning pairs for workspace', { workspace_id: workspaceId });

  const result = await query(
    `SELECT key, value, metadata
     FROM context_layer
     WHERE workspace_id = $1
       AND category = 'agent_tuning'
     ORDER BY updated_at DESC`,
    [workspaceId]
  );

  // Group by agent ID
  const byAgent: Record<string, TuningPair[]> = {};

  for (const row of result.rows) {
    const [agentId, ...keyParts] = row.key.split(':');
    const shortKey = keyParts.join(':');

    const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;

    const pair: TuningPair = {
      key: shortKey,
      value,
      source: metadata?.source || 'system',
      confidence: metadata?.confidence || 0.5,
    };

    if (!byAgent[agentId]) {
      byAgent[agentId] = [];
    }
    byAgent[agentId].push(pair);
  }

  logger.info('[Tuning] All tuning pairs loaded', {
    workspace_id: workspaceId,
    agent_count: Object.keys(byAgent).length,
    total_pairs: result.rows.length,
  });

  return byAgent;
}
