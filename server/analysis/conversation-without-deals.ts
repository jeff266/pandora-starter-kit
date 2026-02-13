/**
 * Conversations Without Deals (CWD) Detection
 *
 * Finds external conversations linked to accounts but not to deals.
 * Enriches with account context to strengthen the case for pipeline gaps.
 *
 * Spec: PANDORA_INTERNAL_FILTER_AND_CWD_SPEC.md (Part 2)
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ConversationsWithoutDeals');

// ============================================================================
// Types
// ============================================================================

export interface ConversationWithoutDeal {
  conversation_id: string;
  conversation_title: string;
  call_date: string;
  duration_seconds: number;
  rep_name: string | null;
  rep_email: string | null;

  // Account enrichment
  account_id: string;
  account_name: string;
  account_domain: string | null;
  account_industry: string | null;
  account_employee_count: number | null;

  // Account context (strengthens the case)
  open_deals_at_account: number;
  closed_deals_at_account: number;
  total_contacts_at_account: number;
  last_deal_closed_date: string | null;

  // Conversation context
  participant_count: number;
  external_participants: string[];
  call_type_inference: string | null;

  // Classification
  days_since_call: number;
  likely_cause: 'deal_not_created' | 'early_stage' | 'disqualified_not_logged' | 'unknown';
  severity: 'high' | 'medium' | 'low';
}

export interface CWDSummary {
  total_cwd: number;
  by_rep: Record<string, number>;
  by_severity: Record<string, number>;
  estimated_pipeline_gap: string;
}

export interface CWDResult {
  summary: CWDSummary;
  conversations: ConversationWithoutDeal[];
}

// ============================================================================
// Core Detection Function
// ============================================================================

/**
 * Find all external conversations linked to accounts but not deals
 * with full account context enrichment
 */
export async function findConversationsWithoutDeals(
  workspaceId: string,
  daysBack: number = 90
): Promise<CWDResult> {
  logger.info('Finding conversations without deals', { workspaceId, daysBack });

  const result = await query<{
    conversation_id: string;
    conversation_title: string;
    call_date: string;
    duration_seconds: number;
    participants: any;
    account_id: string;
    account_name: string;
    account_domain: string | null;
    account_industry: string | null;
    account_employee_count: number | null;
    open_deals_at_account: number;
    closed_deals_at_account: number;
    total_contacts_at_account: number;
    last_deal_closed_date: string | null;
  }>(
    `SELECT
      c.id as conversation_id,
      c.title as conversation_title,
      c.call_date::text as call_date,
      c.duration_seconds,
      c.participants,
      c.account_id,

      -- Account enrichment
      a.name as account_name,
      a.domain as account_domain,
      a.industry as account_industry,
      a.employee_count as account_employee_count,

      -- Account deal context
      (SELECT COUNT(*)::int FROM deals d
       WHERE d.account_id = c.account_id
       AND d.workspace_id = c.workspace_id
       AND (d.stage_normalized IS NULL OR d.stage_normalized NOT IN ('closed_won', 'closed_lost'))
      ) as open_deals_at_account,

      (SELECT COUNT(*)::int FROM deals d
       WHERE d.account_id = c.account_id
       AND d.workspace_id = c.workspace_id
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
      ) as closed_deals_at_account,

      (SELECT COUNT(*)::int FROM contacts ct
       WHERE ct.account_id = c.account_id
       AND ct.workspace_id = c.workspace_id
      ) as total_contacts_at_account,

      (SELECT MAX(d.close_date)::text FROM deals d
       WHERE d.account_id = c.account_id
       AND d.workspace_id = c.workspace_id
       AND d.stage_normalized = 'closed_won'
      ) as last_deal_closed_date

    FROM conversations c
    INNER JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id
    WHERE c.workspace_id = $1
      AND c.is_internal = FALSE
      AND c.account_id IS NOT NULL
      AND c.deal_id IS NULL
      AND c.call_date > NOW() - INTERVAL '${daysBack} days'
    ORDER BY c.call_date DESC`,
    [workspaceId]
  );

  const conversations: ConversationWithoutDeal[] = [];

  for (const row of result.rows) {
    const participants = Array.isArray(row.participants) ? row.participants : [];
    const isInternal = (p: any) =>
      p.is_internal === true || (typeof p.affiliation === 'string' && p.affiliation.toLowerCase() === 'internal');
    const internalParticipants = participants.filter(isInternal);
    const externalParticipants = participants.filter((p: any) => !isInternal(p));

    const repName = internalParticipants[0]?.name || null;
    const repEmail = internalParticipants[0]?.email || null;

    const externalNames = externalParticipants
      .map((p: any) => p.name)
      .filter((n: any) => n && typeof n === 'string');

    // Infer call type from title
    const callType = inferCallType(row.conversation_title);

    // Calculate days since call
    const callDate = new Date(row.call_date);
    const now = new Date();
    const daysSinceCall = Math.floor((now.getTime() - callDate.getTime()) / (1000 * 60 * 60 * 24));

    const cwd: ConversationWithoutDeal = {
      conversation_id: row.conversation_id,
      conversation_title: row.conversation_title || 'Untitled',
      call_date: row.call_date,
      duration_seconds: row.duration_seconds,
      rep_name: repName,
      rep_email: repEmail,
      account_id: row.account_id,
      account_name: row.account_name,
      account_domain: row.account_domain,
      account_industry: row.account_industry,
      account_employee_count: row.account_employee_count,
      open_deals_at_account: row.open_deals_at_account,
      closed_deals_at_account: row.closed_deals_at_account,
      total_contacts_at_account: row.total_contacts_at_account,
      last_deal_closed_date: row.last_deal_closed_date,
      participant_count: participants.length,
      external_participants: externalNames,
      call_type_inference: callType,
      days_since_call: daysSinceCall,
      likely_cause: 'unknown', // Set below
      severity: 'low', // Set below
    };

    // Classify severity and likely cause
    cwd.severity = classifyCWDSeverity(cwd);
    cwd.likely_cause = inferLikelyCause(cwd);

    conversations.push(cwd);
  }

  // Build summary
  const summary = buildCWDSummary(conversations);

  logger.info('Found conversations without deals', {
    workspaceId,
    totalCWD: conversations.length,
    highSeverity: summary.by_severity.high || 0,
  });

  return {
    summary,
    conversations,
  };
}

// ============================================================================
// Classification Functions
// ============================================================================

/**
 * Infer call type from conversation title
 */
function inferCallType(title: string | null): string | null {
  if (!title) return null;

  const lowerTitle = title.toLowerCase();

  if (
    lowerTitle.includes('intro') ||
    lowerTitle.includes('introduction') ||
    lowerTitle.includes('discovery')
  ) {
    return 'intro_demo';
  }

  if (lowerTitle.includes('demo') || lowerTitle.includes('product')) {
    return 'intro_demo';
  }

  if (lowerTitle.includes('follow') || lowerTitle.includes('next steps')) {
    return 'follow_up';
  }

  if (lowerTitle.includes('review') || lowerTitle.includes('check-in')) {
    return 'review';
  }

  return null;
}

/**
 * Classify CWD severity
 */
function classifyCWDSeverity(cwd: ConversationWithoutDeal): 'high' | 'medium' | 'low' {
  // HIGH: Demo/intro call with no deal created within 7+ days
  // This almost certainly means someone forgot to create the deal
  if (
    cwd.days_since_call >= 7 &&
    cwd.call_type_inference?.includes('demo') &&
    cwd.open_deals_at_account === 0
  ) {
    return 'high';
  }

  // HIGH: Multiple calls at an account with zero deals
  // Pattern: sustained engagement but nothing in CRM
  if (
    cwd.open_deals_at_account === 0 &&
    cwd.closed_deals_at_account === 0 &&
    cwd.participant_count >= 2 &&
    cwd.duration_seconds > 600
  ) {
    return 'high';
  }

  // MEDIUM: Recent call, deal may still be getting created
  // Or: account has other deals (this call might relate to an existing one)
  if (cwd.days_since_call < 7 || cwd.open_deals_at_account > 0) {
    return 'medium';
  }

  // LOW: Old call, short duration, or single participant
  // Might be a quick check-in that doesn't warrant a deal
  return 'low';
}

/**
 * Infer likely cause for CWD
 */
function inferLikelyCause(
  cwd: ConversationWithoutDeal
): 'deal_not_created' | 'early_stage' | 'disqualified_not_logged' | 'unknown' {
  if (cwd.open_deals_at_account > 0) {
    return 'deal_not_created';
  }

  if (cwd.duration_seconds < 300 && cwd.participant_count <= 2) {
    return 'early_stage';
  }

  if (cwd.days_since_call > 30 && cwd.duration_seconds > 1200) {
    return 'disqualified_not_logged';
  }

  if (cwd.duration_seconds >= 300 && cwd.days_since_call <= 30) {
    return 'deal_not_created';
  }

  return 'unknown';
}

// ============================================================================
// Summary Functions
// ============================================================================

/**
 * Build summary statistics for CWD
 */
function buildCWDSummary(conversations: ConversationWithoutDeal[]): CWDSummary {
  const byRep: Record<string, number> = {};
  const bySeverity: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const cwd of conversations) {
    // Count by rep
    const repKey = cwd.rep_email || cwd.rep_name || 'Unknown';
    byRep[repKey] = (byRep[repKey] || 0) + 1;

    // Count by severity
    bySeverity[cwd.severity]++;
  }

  // Estimate pipeline gap message
  const highSeverityCount = bySeverity.high || 0;
  const estimatedGap =
    highSeverityCount === 0
      ? 'No high-severity gaps detected'
      : highSeverityCount === 1
      ? '1 conversation suggests untracked pipeline'
      : `${highSeverityCount} conversations suggest untracked pipeline`;

  return {
    total_cwd: conversations.length,
    by_rep: byRep,
    by_severity: bySeverity,
    estimated_pipeline_gap: estimatedGap,
  };
}

/**
 * Get top CWD conversations by severity for reporting
 */
export function getTopCWDConversations(
  conversations: ConversationWithoutDeal[],
  limit: number = 5
): ConversationWithoutDeal[] {
  // Sort by severity (high > medium > low), then by days since call (most recent first)
  const severityOrder = { high: 3, medium: 2, low: 1 };

  return conversations
    .slice()
    .sort((a, b) => {
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;

      // Within same severity, prioritize recent calls
      return a.days_since_call - b.days_since_call;
    })
    .slice(0, limit);
}

/**
 * Get CWD by rep for Pipeline Coverage analysis
 */
export function getCWDByRep(conversations: ConversationWithoutDeal[]): Map<
  string,
  {
    rep_name: string | null;
    rep_email: string | null;
    cwd_count: number;
    high_severity_count: number;
    conversations: ConversationWithoutDeal[];
  }
> {
  const byRep = new Map<
    string,
    {
      rep_name: string | null;
      rep_email: string | null;
      cwd_count: number;
      high_severity_count: number;
      conversations: ConversationWithoutDeal[];
    }
  >();

  for (const cwd of conversations) {
    const repKey = cwd.rep_email || cwd.rep_name || 'Unknown';

    if (!byRep.has(repKey)) {
      byRep.set(repKey, {
        rep_name: cwd.rep_name,
        rep_email: cwd.rep_email,
        cwd_count: 0,
        high_severity_count: 0,
        conversations: [],
      });
    }

    const repData = byRep.get(repKey)!;
    repData.cwd_count++;
    if (cwd.severity === 'high') {
      repData.high_severity_count++;
    }
    repData.conversations.push(cwd);
  }

  return byRep;
}

/**
 * Format CWD for human-readable reporting
 */
export function formatCWDForReport(cwd: ConversationWithoutDeal): string {
  const durationMinutes = Math.round(cwd.duration_seconds / 60);
  const callDate = new Date(cwd.call_date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const callType = cwd.call_type_inference
    ? ` (${cwd.call_type_inference.replace('_', ' ')})`
    : '';

  const accountContext =
    cwd.open_deals_at_account > 0
      ? ` — ${cwd.open_deals_at_account} other open deal(s) at this account`
      : cwd.closed_deals_at_account > 0
      ? ` — ${cwd.closed_deals_at_account} historical deal(s) at this account`
      : ' — no deals exist at this account';

  return `${cwd.rep_name || 'Unknown'}: ${cwd.account_name} ${callType}, ${durationMinutes} min, ${callDate}${accountContext}. ${getCauseSuggestion(cwd)}`;
}

/**
 * Get human-readable suggestion based on likely cause
 */
function getCauseSuggestion(cwd: ConversationWithoutDeal): string {
  switch (cwd.likely_cause) {
    case 'deal_not_created':
      return 'Likely missing deal creation.';
    case 'early_stage':
      return 'Early-stage conversation, may not yet qualify as deal.';
    case 'disqualified_not_logged':
      return 'Long call with no follow-up — possibly disqualified but not logged.';
    default:
      return 'Recommended: Create deal or confirm disqualification.';
  }
}
