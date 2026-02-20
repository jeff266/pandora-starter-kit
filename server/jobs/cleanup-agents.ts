/**
 * Agent Cleanup Job
 *
 * Hard deletes archived agents whose recovery window has expired.
 * Runs nightly at 3:00 AM via cron scheduler.
 */

import { query } from '../db.js';

interface DeletedAgent {
  id: string;
  name: string;
  workspace_id: string;
}

/**
 * Hard delete agents that have been archived and are past their recovery window
 */
export async function hardDeleteExpiredAgents(): Promise<void> {
  try {
    const result = await query<DeletedAgent>(`
      DELETE FROM agents
      WHERE status = 'archived'
        AND recoverable_until < NOW()
      RETURNING id, name, workspace_id
    `);

    const deletedAgents = result.rows;

    if (deletedAgents.length === 0) {
      console.log('[cleanup-agents] No expired archived agents to delete');
      return;
    }

    // Log each deleted agent
    for (const agent of deletedAgents) {
      console.log('[cleanup-agents] Hard deleted agent:', {
        id: agent.id,
        name: agent.name,
        workspace_id: agent.workspace_id,
        deleted_at: new Date().toISOString(),
      });
    }

    console.log(`[cleanup-agents] Successfully deleted ${deletedAgents.length} expired archived agents`);
  } catch (err) {
    console.error('[cleanup-agents] Error deleting expired agents:', err instanceof Error ? err.message : err);
    throw err;
  }
}
