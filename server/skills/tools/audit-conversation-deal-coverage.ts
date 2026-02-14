/**
 * Audit Conversation-Deal Coverage (CWD)
 *
 * Finds conversations linked to accounts but not deals, classifies severity,
 * and returns a structured step output for data-quality-audit and pipeline-hygiene.
 *
 * Delegates to server/analysis/conversation-without-deals.ts for core detection,
 * then reshapes the output into the CWDStepOutput interface that skills consume.
 *
 * Used by: data-quality-audit (step: audit-conversation-deal-coverage)
 */

import {
  findConversationsWithoutDeals,
  getTopCWDConversations,
  type ConversationWithoutDeal,
} from '../../analysis/conversation-without-deals.js';
import { checkWorkspaceHasConversations } from './check-workspace-has-conversations.js';

// ============================================================================
// Types
// ============================================================================

export interface CWDStepOutput {
  has_conversation_data: boolean;
  summary: {
    total_cwd: number;
    by_rep: Record<string, number>;
    by_severity: { high: number; medium: number; low: number };
    estimated_pipeline_gap: string;
  } | null;
  top_examples: CWDExample[];
}

export interface CWDExample {
  conversation_id: string;
  title: string;
  account_name: string;
  account_id: string;
  rep_name: string;
  rep_email: string;
  started_at: string;
  duration_seconds: number;
  participant_count: number;
  days_since_call: number;
  severity: 'high' | 'medium' | 'low';
  likely_cause: string;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Audit conversation-deal coverage for a workspace.
 *
 * 1. Checks if conversation data exists
 * 2. If so, runs full CWD detection with severity classification
 * 3. Returns structured output with summary + top examples
 */
export async function auditConversationDealCoverage(
  workspaceId: string,
  daysBack: number = 90
): Promise<CWDStepOutput> {
  // Quick check — skip expensive query if no conversation data
  const check = await checkWorkspaceHasConversations(workspaceId);

  if (!check.has_conversations) {
    return {
      has_conversation_data: false,
      summary: null,
      top_examples: [],
    };
  }

  // Run full CWD detection
  const cwdResult = await findConversationsWithoutDeals(workspaceId, daysBack);

  // Get top examples by severity
  const topRaw = getTopCWDConversations(cwdResult.conversations, 5);
  const topExamples = topRaw.map(mapToExample);

  return {
    has_conversation_data: true,
    summary: {
      total_cwd: cwdResult.summary.total_cwd,
      by_rep: cwdResult.summary.by_rep,
      by_severity: {
        high: cwdResult.summary.by_severity.high || 0,
        medium: cwdResult.summary.by_severity.medium || 0,
        low: cwdResult.summary.by_severity.low || 0,
      },
      estimated_pipeline_gap: cwdResult.summary.estimated_pipeline_gap,
    },
    top_examples: topExamples,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function mapToExample(cwd: ConversationWithoutDeal): CWDExample {
  return {
    conversation_id: cwd.conversation_id,
    title: cwd.conversation_title,
    account_name: cwd.account_name,
    account_id: cwd.account_id,
    rep_name: cwd.rep_name || 'Unknown',
    rep_email: cwd.rep_email || '',
    started_at: cwd.call_date,
    duration_seconds: cwd.duration_seconds,
    participant_count: cwd.participant_count,
    days_since_call: cwd.days_since_call,
    severity: cwd.severity,
    likely_cause: cwd.likely_cause,
  };
}
