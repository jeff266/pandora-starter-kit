/**
 * CWD (Conversations Without Deals) Compute Functions
 *
 * Detects conversations that exist in the system but aren't linked to any deal.
 * These represent potential pipeline opportunities (meetings/calls happening
 * with prospects that haven't been formally entered as deals).
 *
 * Used by:
 * - data-quality-audit (to surface unlinked conversations as a quality gap)
 * - pipeline-hygiene (to flag potential pipeline missing from CRM)
 * - Agent Builder "Instant Audit" (auto-run on CRM connect)
 */

import { query } from '../../db.js';

// ============================================================================
// Check Workspace Has Conversations
// ============================================================================

export interface ConversationCheckResult {
  has_conversations: boolean;
  conversation_count: number;
  sources: string[];
  linked_to_deals: number;
  unlinked: number;
  coverage_pct: number;
}

/**
 * Quick check: does this workspace have conversation data at all?
 * Also returns basic linkage stats (how many are linked to deals vs orphaned).
 */
export async function checkWorkspaceHasConversations(
  workspaceId: string
): Promise<ConversationCheckResult> {
  try {
    const result = await query<{
      total: string;
      linked: string;
      sources: string[];
    }>(
      `SELECT
         COUNT(*) as total,
         COUNT(deal_id) FILTER (WHERE deal_id IS NOT NULL) as linked,
         ARRAY_AGG(DISTINCT source) FILTER (WHERE source IS NOT NULL) as sources
       FROM conversations
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const row = result.rows[0];
    const total = parseInt(row?.total || '0', 10);
    const linked = parseInt(row?.linked || '0', 10);
    const unlinked = total - linked;

    return {
      has_conversations: total > 0,
      conversation_count: total,
      sources: row?.sources?.filter(Boolean) || [],
      linked_to_deals: linked,
      unlinked,
      coverage_pct: total > 0 ? Math.round((linked / total) * 100) : 0,
    };
  } catch {
    // conversations table may not exist
    return {
      has_conversations: false,
      conversation_count: 0,
      sources: [],
      linked_to_deals: 0,
      unlinked: 0,
      coverage_pct: 0,
    };
  }
}

// ============================================================================
// Get Conversations Without Deals (CWD)
// ============================================================================

export interface CWDConversation {
  id: string;
  title: string;
  call_date: string;
  duration_seconds: number;
  source: string;
  participant_count: number;
  external_participants: string[];
  account_name: string | null;
  summary: string | null;
  has_action_items: boolean;
}

export interface CWDResult {
  conversations: CWDConversation[];
  total_unlinked: number;
  by_source: Record<string, number>;
  by_month: Record<string, number>;
  avg_duration_seconds: number;
  potential_pipeline_signals: number;
}

/**
 * Get conversations that aren't linked to any deal.
 * Returns enriched records with participant info and account linkage.
 *
 * These are potential pipeline opportunities:
 * - External calls with customers that should have a deal
 * - Discovery calls where no opportunity was created
 * - Meetings with accounts that have no active pipeline
 */
export async function getConversationsWithoutDeals(
  workspaceId: string,
  options?: {
    limit?: number;
    minDurationSeconds?: number;
    daysBack?: number;
  }
): Promise<CWDResult> {
  const limit = options?.limit || 50;
  const minDuration = options?.minDurationSeconds || 60; // Skip very short calls
  const daysBack = options?.daysBack || 90;

  try {
    // Get unlinked conversations with external participants
    const result = await query<{
      id: string;
      title: string;
      call_date: string;
      duration_seconds: number;
      source: string;
      participants: any;
      account_id: string | null;
      summary: string | null;
      action_items: any;
    }>(
      `SELECT c.id, c.title, c.call_date, c.duration_seconds, c.source,
              c.participants, c.account_id, c.summary, c.action_items
       FROM conversations c
       WHERE c.workspace_id = $1
         AND c.deal_id IS NULL
         AND c.duration_seconds >= $2
         AND c.call_date >= NOW() - ($3 || ' days')::interval
       ORDER BY c.call_date DESC
       LIMIT $4`,
      [workspaceId, minDuration, daysBack, limit]
    );

    // Get account names for linked conversations
    const accountIds = result.rows
      .map((r: { account_id: string | null }) => r.account_id)
      .filter(Boolean);

    let accountNameMap = new Map<string, string>();
    if (accountIds.length > 0) {
      const accountResult = await query<{ id: string; name: string }>(
        `SELECT id, name FROM accounts WHERE workspace_id = $1 AND id = ANY($2)`,
        [workspaceId, accountIds]
      );
      for (const row of accountResult.rows) {
        accountNameMap.set(row.id, row.name);
      }
    }

    const conversations: CWDConversation[] = result.rows.map((row: any) => {
      const participants = Array.isArray(row.participants) ? row.participants : [];
      const externalParticipants = participants
        .filter((p: any) => !p.is_internal && p.type !== 'rep')
        .map((p: any) => p.name || p.email || 'Unknown');

      const actionItems = Array.isArray(row.action_items) ? row.action_items : [];

      return {
        id: row.id,
        title: row.title || 'Untitled Call',
        call_date: row.call_date,
        duration_seconds: row.duration_seconds,
        source: row.source,
        participant_count: participants.length,
        external_participants: externalParticipants,
        account_name: row.account_id ? (accountNameMap.get(row.account_id) || null) : null,
        summary: row.summary ? row.summary.slice(0, 200) : null,
        has_action_items: actionItems.length > 0,
      };
    });

    // Aggregate stats
    const totalResult = await query<{ total: string }>(
      `SELECT COUNT(*) as total FROM conversations
       WHERE workspace_id = $1 AND deal_id IS NULL AND duration_seconds >= $2`,
      [workspaceId, minDuration]
    );
    const totalUnlinked = parseInt(totalResult.rows[0]?.total || '0', 10);

    // By source breakdown
    const sourceResult = await query<{ source: string; count: string }>(
      `SELECT source, COUNT(*) as count FROM conversations
       WHERE workspace_id = $1 AND deal_id IS NULL AND duration_seconds >= $2
       GROUP BY source`,
      [workspaceId, minDuration]
    );
    const bySource: Record<string, number> = {};
    for (const row of sourceResult.rows) {
      bySource[row.source] = parseInt(row.count, 10);
    }

    // By month breakdown
    const monthResult = await query<{ month: string; count: string }>(
      `SELECT TO_CHAR(call_date, 'YYYY-MM') as month, COUNT(*) as count
       FROM conversations
       WHERE workspace_id = $1 AND deal_id IS NULL AND duration_seconds >= $2
         AND call_date >= NOW() - ($3 || ' days')::interval
       GROUP BY TO_CHAR(call_date, 'YYYY-MM')
       ORDER BY month DESC`,
      [workspaceId, minDuration, daysBack]
    );
    const byMonth: Record<string, number> = {};
    for (const row of monthResult.rows) {
      byMonth[row.month] = parseInt(row.count, 10);
    }

    // Average duration
    const avgResult = await query<{ avg_duration: string }>(
      `SELECT AVG(duration_seconds)::int as avg_duration FROM conversations
       WHERE workspace_id = $1 AND deal_id IS NULL AND duration_seconds >= $2`,
      [workspaceId, minDuration]
    );
    const avgDuration = parseInt(avgResult.rows[0]?.avg_duration || '0', 10);

    // Conversations with external participants and action items are strong pipeline signals
    const potentialSignals = conversations.filter(
      c => c.external_participants.length > 0 && (c.has_action_items || c.duration_seconds > 900)
    ).length;

    return {
      conversations,
      total_unlinked: totalUnlinked,
      by_source: bySource,
      by_month: byMonth,
      avg_duration_seconds: avgDuration,
      potential_pipeline_signals: potentialSignals,
    };
  } catch {
    return {
      conversations: [],
      total_unlinked: 0,
      by_source: {},
      by_month: {},
      avg_duration_seconds: 0,
      potential_pipeline_signals: 0,
    };
  }
}
