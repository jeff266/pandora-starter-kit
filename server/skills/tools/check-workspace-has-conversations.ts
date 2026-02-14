/**
 * Check Workspace Has Conversations
 *
 * Quick check: does this workspace have external conversation data?
 * Returns count, sources, and basic linkage stats.
 *
 * Used by: data-quality-audit (step: check-conversation-data)
 */

import { query } from '../../db.js';

export interface ConversationCheckResult {
  has_conversations: boolean;
  conversation_count: number;
  sources: string[];
}

/**
 * Check if workspace has external (non-internal) conversation data.
 * Returns count and which sources (gong, fireflies) contributed.
 *
 * If the conversations table or is_internal column doesn't exist,
 * gracefully returns { has_conversations: false }.
 */
export async function checkWorkspaceHasConversations(
  workspaceId: string
): Promise<ConversationCheckResult> {
  try {
    const result = await query<{
      count: string;
      sources: string[] | null;
    }>(
      `SELECT
         COUNT(*) as count,
         ARRAY_AGG(DISTINCT source) FILTER (WHERE source IS NOT NULL) as sources
       FROM conversations
       WHERE workspace_id = $1
         AND is_internal = FALSE`,
      [workspaceId]
    );

    const row = result.rows[0];
    const count = parseInt(row?.count || '0', 10);

    return {
      has_conversations: count > 0,
      conversation_count: count,
      sources: row?.sources?.filter(Boolean) || [],
    };
  } catch {
    // conversations table or is_internal column may not exist
    // Fall back to unfiltered query
    try {
      const result = await query<{ count: string; sources: string[] | null }>(
        `SELECT
           COUNT(*) as count,
           ARRAY_AGG(DISTINCT source) FILTER (WHERE source IS NOT NULL) as sources
         FROM conversations
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      const row = result.rows[0];
      const count = parseInt(row?.count || '0', 10);

      return {
        has_conversations: count > 0,
        conversation_count: count,
        sources: row?.sources?.filter(Boolean) || [],
      };
    } catch {
      // Table doesn't exist at all
      return {
        has_conversations: false,
        conversation_count: 0,
        sources: [],
      };
    }
  }
}
