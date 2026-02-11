/**
 * Conversation Intelligence Feature Extraction
 *
 * Extracts behavioral signals from Gong/Fireflies conversations to enrich ICP Discovery.
 * Supports graceful degradation based on conversation coverage.
 *
 * Spec: PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ConversationFeatures');

// ============================================================================
// Types
// ============================================================================

export interface ConversationMetadata {
  call_count: number;
  total_duration_minutes: number;
  avg_duration_minutes: number;
  avg_sentiment_score: number | null;
  avg_talk_ratio: number | null;
  competitor_mention_count: number;
  objection_count: number;
  action_item_count: number;
  unique_participants: number;
  internal_participants: number;
  external_participants: number;
  earliest_call_date: string | null;
  latest_call_date: string | null;
  days_span: number | null;
}

export interface DealConversationLink {
  deal_id: string;
  conversation_ids: string[];
  link_method: 'direct' | 'fuzzy_account' | 'fuzzy_contact';
}

export interface TranscriptExcerpt {
  conversation_id: string;
  excerpt: string;
  token_count: number;
  source: string;
  call_date: string | null;
}

export interface ConversationCoverage {
  workspace_id: string;
  total_closed_won_deals: number;
  deals_with_conversations: number;
  coverage_percent: number;
  tier: 0 | 1 | 2 | 3;
  tier_label: 'none' | 'sparse' | 'moderate' | 'strong';
}

export interface ConversationFeatures {
  deal_id: string;
  has_conversations: boolean;
  metadata: ConversationMetadata | null;
  transcript_excerpts: TranscriptExcerpt[];
}

// ============================================================================
// Feature Extraction Functions
// ============================================================================

/**
 * Build conversation features for a set of deals
 * Sub-step A + B: Link conversations to deals and aggregate metadata
 */
export async function buildConversationFeatures(
  workspaceId: string,
  dealIds: string[]
): Promise<ConversationFeatures[]> {
  if (dealIds.length === 0) {
    return [];
  }

  logger.debug('Building conversation features', { workspaceId, dealCount: dealIds.length });

  // Link conversations to deals
  const links = await linkConversationsToDeals(workspaceId, dealIds);
  const linkMap = new Map(links.map(l => [l.deal_id, l.conversation_ids]));

  // Aggregate metadata for each deal
  const features: ConversationFeatures[] = [];

  for (const dealId of dealIds) {
    const conversationIds = linkMap.get(dealId) || [];

    if (conversationIds.length === 0) {
      features.push({
        deal_id: dealId,
        has_conversations: false,
        metadata: null,
        transcript_excerpts: [],
      });
      continue;
    }

    // Aggregate metadata
    const metadata = await aggregateConversationMetadata(workspaceId, conversationIds);

    // Extract transcript excerpts (limit to ~1500 tokens per deal)
    const excerpts = await extractTranscriptExcerpts(workspaceId, conversationIds, 1500);

    features.push({
      deal_id: dealId,
      has_conversations: true,
      metadata,
      transcript_excerpts: excerpts,
    });
  }

  logger.info('Built conversation features', {
    workspaceId,
    totalDeals: dealIds.length,
    dealsWithConversations: features.filter(f => f.has_conversations).length
  });

  return features;
}

/**
 * Link conversations to deals using direct and fuzzy matching
 * Sub-step A: COMPUTE
 */
export async function linkConversationsToDeals(
  workspaceId: string,
  dealIds: string[]
): Promise<DealConversationLink[]> {
  if (dealIds.length === 0) {
    return [];
  }

  const links: DealConversationLink[] = [];

  // Step 1: Direct links (conversation.deal_id matches)
  const directResult = await query<{ deal_id: string; conversation_ids: string[] }>(
    `SELECT
       deal_id,
       ARRAY_AGG(id) as conversation_ids
     FROM conversations
     WHERE workspace_id = $1
       AND deal_id = ANY($2)
       AND deal_id IS NOT NULL
     GROUP BY deal_id`,
    [workspaceId, dealIds]
  );

  const directMap = new Map(directResult.rows.map(r => [r.deal_id, r.conversation_ids]));

  for (const dealId of dealIds) {
    const directConversationIds = directMap.get(dealId) || [];
    if (directConversationIds.length > 0) {
      links.push({
        deal_id: dealId,
        conversation_ids: directConversationIds,
        link_method: 'direct',
      });
    }
  }

  // Step 2: Fuzzy links via account_id (for deals without direct links)
  const dealsWithoutDirectLinks = dealIds.filter(id => !directMap.has(id));
  let fuzzyAccountRows: { deal_id: string; conversation_ids: string[] }[] = [];

  if (dealsWithoutDirectLinks.length > 0) {
    const fuzzyAccountResult = await query<{ deal_id: string; conversation_ids: string[] }>(
      `SELECT
         d.id as deal_id,
         ARRAY_AGG(DISTINCT c.id) as conversation_ids
       FROM deals d
       INNER JOIN conversations c ON c.account_id = d.account_id AND c.workspace_id = d.workspace_id
       WHERE d.workspace_id = $1
         AND d.id = ANY($2)
         AND d.account_id IS NOT NULL
         AND c.deal_id IS NULL
       GROUP BY d.id`,
      [workspaceId, dealsWithoutDirectLinks]
    );

    fuzzyAccountRows = fuzzyAccountResult.rows;

    for (const row of fuzzyAccountRows) {
      links.push({
        deal_id: row.deal_id,
        conversation_ids: row.conversation_ids,
        link_method: 'fuzzy_account',
      });
    }
  }

  // Step 3: Fuzzy links via contacts (for deals still without links)
  // This is more expensive, so only do it for deals that still need conversations
  const dealsStillWithoutLinks = dealsWithoutDirectLinks.filter(
    id => !fuzzyAccountRows.some(r => r.deal_id === id)
  );
  let fuzzyContactRows: { deal_id: string; conversation_ids: string[] }[] = [];

  if (dealsStillWithoutLinks.length > 0) {
    const fuzzyContactResult = await query<{ deal_id: string; conversation_ids: string[] }>(
      `SELECT
         d.id as deal_id,
         ARRAY_AGG(DISTINCT c.id) as conversation_ids
       FROM deals d
       INNER JOIN contacts ct ON ct.account_id = d.account_id AND ct.workspace_id = d.workspace_id
       INNER JOIN conversations c ON c.workspace_id = d.workspace_id
       WHERE d.workspace_id = $1
         AND d.id = ANY($2)
         AND ct.email IS NOT NULL
         AND c.participants::text ILIKE '%' || ct.email || '%'
       GROUP BY d.id
       HAVING COUNT(DISTINCT c.id) <= 20`,
      [workspaceId, dealsStillWithoutLinks]
    );

    fuzzyContactRows = fuzzyContactResult.rows;

    for (const row of fuzzyContactRows) {
      links.push({
        deal_id: row.deal_id,
        conversation_ids: row.conversation_ids,
        link_method: 'fuzzy_contact',
      });
    }
  }

  logger.debug('Linked conversations to deals', {
    workspaceId,
    totalDeals: dealIds.length,
    directLinks: directResult.rows.length,
    fuzzyAccountLinks: fuzzyAccountRows.length,
    fuzzyContactLinks: fuzzyContactRows.length,
  });

  return links;
}

/**
 * Aggregate conversation metadata for a set of conversations
 * Sub-step B: COMPUTE
 */
async function aggregateConversationMetadata(
  workspaceId: string,
  conversationIds: string[]
): Promise<ConversationMetadata> {
  if (conversationIds.length === 0) {
    return {
      call_count: 0,
      total_duration_minutes: 0,
      avg_duration_minutes: 0,
      avg_sentiment_score: null,
      avg_talk_ratio: null,
      competitor_mention_count: 0,
      objection_count: 0,
      action_item_count: 0,
      unique_participants: 0,
      internal_participants: 0,
      external_participants: 0,
      earliest_call_date: null,
      latest_call_date: null,
      days_span: null,
    };
  }

  const result = await query<{
    call_count: number;
    total_duration_seconds: number;
    avg_duration_seconds: number;
    avg_sentiment_score: number | null;
    avg_talk_ratio: number | null;
    competitor_mention_count: number;
    objection_count: number;
    action_item_count: number;
    earliest_call_date: string | null;
    latest_call_date: string | null;
  }>(
    `SELECT
       COUNT(*)::int as call_count,
       COALESCE(SUM(duration_seconds), 0)::int as total_duration_seconds,
       COALESCE(AVG(duration_seconds), 0)::int as avg_duration_seconds,
       AVG(sentiment_score) as avg_sentiment_score,
       AVG((talk_listen_ratio->>'talk_ratio')::numeric) as avg_talk_ratio,
       COALESCE(SUM(jsonb_array_length(COALESCE(competitor_mentions, '[]'::jsonb))), 0)::int as competitor_mention_count,
       COALESCE(SUM(jsonb_array_length(COALESCE(objections, '[]'::jsonb))), 0)::int as objection_count,
       COALESCE(SUM(jsonb_array_length(COALESCE(action_items, '[]'::jsonb))), 0)::int as action_item_count,
       MIN(call_date)::text as earliest_call_date,
       MAX(call_date)::text as latest_call_date
     FROM conversations
     WHERE workspace_id = $1 AND id = ANY($2)`,
    [workspaceId, conversationIds]
  );

  const row = result.rows[0];

  // Count unique participants
  const participantsResult = await query<{ unique_count: number; internal_count: number; external_count: number }>(
    `SELECT
       COUNT(DISTINCT p->>'email') as unique_count,
       COUNT(DISTINCT p->>'email') FILTER (WHERE (p->>'is_internal')::boolean = true) as internal_count,
       COUNT(DISTINCT p->>'email') FILTER (WHERE (p->>'is_internal')::boolean = false) as external_count
     FROM conversations,
       jsonb_array_elements(COALESCE(participants, '[]'::jsonb)) as p
     WHERE workspace_id = $1 AND id = ANY($2)`,
    [workspaceId, conversationIds]
  );

  const participants = participantsResult.rows[0] || { unique_count: 0, internal_count: 0, external_count: 0 };

  // Calculate days span
  let days_span: number | null = null;
  if (row.earliest_call_date && row.latest_call_date) {
    const earliest = new Date(row.earliest_call_date);
    const latest = new Date(row.latest_call_date);
    days_span = Math.ceil((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    call_count: row.call_count,
    total_duration_minutes: Math.round(row.total_duration_seconds / 60),
    avg_duration_minutes: Math.round(row.avg_duration_seconds / 60),
    avg_sentiment_score: row.avg_sentiment_score !== null ? parseFloat(String(row.avg_sentiment_score)) : null,
    avg_talk_ratio: row.avg_talk_ratio !== null ? parseFloat(String(row.avg_talk_ratio)) : null,
    competitor_mention_count: row.competitor_mention_count,
    objection_count: row.objection_count,
    action_item_count: row.action_item_count,
    unique_participants: parseInt(String(participants.unique_count), 10),
    internal_participants: parseInt(String(participants.internal_count), 10),
    external_participants: parseInt(String(participants.external_count), 10),
    earliest_call_date: row.earliest_call_date,
    latest_call_date: row.latest_call_date,
    days_span,
  };
}

/**
 * Extract transcript excerpts from conversations
 * Sub-step C prep: Extract text for DeepSeek classification
 *
 * @param tokensPerExcerpt - Total token budget for all excerpts (default: 1500)
 */
export async function extractTranscriptExcerpts(
  workspaceId: string,
  conversationIds: string[],
  tokensPerExcerpt: number = 1500
): Promise<TranscriptExcerpt[]> {
  if (conversationIds.length === 0) {
    return [];
  }

  // Retrieve conversations with transcripts
  const result = await query<{
    id: string;
    transcript_text: string | null;
    summary: string | null;
    source: string;
    call_date: string | null;
  }>(
    `SELECT id, transcript_text, summary, source, call_date::text
     FROM conversations
     WHERE workspace_id = $1 AND id = ANY($2)
     ORDER BY call_date DESC`,
    [workspaceId, conversationIds]
  );

  const conversations = result.rows;

  if (conversations.length === 0) {
    return [];
  }

  // Distribute token budget across conversations
  const tokensPerConversation = Math.floor(tokensPerExcerpt / conversations.length);
  const charsPerConversation = tokensPerConversation * 4; // ~4 chars per token

  const excerpts: TranscriptExcerpt[] = [];

  for (const conv of conversations) {
    // Prefer transcript_text, fallback to summary
    const text = conv.transcript_text || conv.summary || '';

    if (!text) {
      continue;
    }

    // Truncate to budget
    const excerpt = text.length > charsPerConversation
      ? text.substring(0, charsPerConversation) + '...'
      : text;

    const estimatedTokens = Math.ceil(excerpt.length / 4);

    excerpts.push({
      conversation_id: conv.id,
      excerpt,
      token_count: estimatedTokens,
      source: conv.source,
      call_date: conv.call_date,
    });
  }

  logger.debug('Extracted transcript excerpts', {
    workspaceId,
    conversationCount: conversationIds.length,
    excerptCount: excerpts.length,
    totalEstimatedTokens: excerpts.reduce((sum, e) => sum + e.token_count, 0),
  });

  return excerpts;
}

/**
 * Compute conversation coverage for a workspace
 * Determines graceful degradation tier (0-3)
 */
export async function computeConversationCoverage(
  workspaceId: string
): Promise<ConversationCoverage> {
  // Count total closed-won deals
  const dealsResult = await query<{ total: number }>(
    `SELECT COUNT(*)::int as total
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'`,
    [workspaceId]
  );

  const totalClosedWonDeals = dealsResult.rows[0]?.total || 0;

  if (totalClosedWonDeals === 0) {
    return {
      workspace_id: workspaceId,
      total_closed_won_deals: 0,
      deals_with_conversations: 0,
      coverage_percent: 0,
      tier: 0,
      tier_label: 'none',
    };
  }

  // Count closed-won deals with conversations (direct or fuzzy)
  const coveredResult = await query<{ covered: number }>(
    `SELECT COUNT(DISTINCT d.id)::int as covered
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized = 'closed_won'
       AND (
         -- Direct link
         EXISTS (
           SELECT 1 FROM conversations c
           WHERE c.workspace_id = d.workspace_id AND c.deal_id = d.id
         )
         -- Fuzzy link via account
         OR (
           d.account_id IS NOT NULL AND
           EXISTS (
             SELECT 1 FROM conversations c
             WHERE c.workspace_id = d.workspace_id AND c.account_id = d.account_id
           )
         )
       )`,
    [workspaceId]
  );

  const dealsWithConversations = coveredResult.rows[0]?.covered || 0;
  const coveragePercent = Math.round((dealsWithConversations / totalClosedWonDeals) * 100);

  // Determine tier based on coverage
  let tier: 0 | 1 | 2 | 3;
  let tierLabel: 'none' | 'sparse' | 'moderate' | 'strong';

  if (coveragePercent === 0) {
    tier = 0;
    tierLabel = 'none';
  } else if (coveragePercent < 30) {
    tier = 1;
    tierLabel = 'sparse';
  } else if (coveragePercent < 70) {
    tier = 2;
    tierLabel = 'moderate';
  } else {
    tier = 3;
    tierLabel = 'strong';
  }

  logger.info('Computed conversation coverage', {
    workspaceId,
    totalClosedWonDeals,
    dealsWithConversations,
    coveragePercent,
    tier,
    tierLabel,
  });

  return {
    workspace_id: workspaceId,
    total_closed_won_deals: totalClosedWonDeals,
    deals_with_conversations: dealsWithConversations,
    coverage_percent: coveragePercent,
    tier,
    tier_label: tierLabel,
  };
}

// ============================================================================
// Mock Data Utilities (for development)
// ============================================================================

/**
 * Generate mock conversation metadata for testing
 * Use this during development before real conversation data is available
 */
export function generateMockConversationMetadata(): ConversationMetadata {
  return {
    call_count: Math.floor(Math.random() * 10) + 1,
    total_duration_minutes: Math.floor(Math.random() * 300) + 60,
    avg_duration_minutes: Math.floor(Math.random() * 60) + 20,
    avg_sentiment_score: Math.random() * 2 - 1, // -1 to 1
    avg_talk_ratio: Math.random() * 0.4 + 0.3, // 0.3 to 0.7
    competitor_mention_count: Math.floor(Math.random() * 5),
    objection_count: Math.floor(Math.random() * 8),
    action_item_count: Math.floor(Math.random() * 15) + 3,
    unique_participants: Math.floor(Math.random() * 8) + 2,
    internal_participants: Math.floor(Math.random() * 3) + 1,
    external_participants: Math.floor(Math.random() * 5) + 1,
    earliest_call_date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
    latest_call_date: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    days_span: Math.floor(Math.random() * 60) + 14,
  };
}

/**
 * Generate mock transcript excerpts for testing
 */
export function generateMockTranscriptExcerpts(conversationCount: number = 3): TranscriptExcerpt[] {
  const mockExcerpts: string[] = [
    "We're currently evaluating multiple vendors for this solution. Our main concern is the integration with our existing Salesforce instance. Can you walk me through how that works? We've had issues with previous vendors where the data sync was unreliable.",
    "I need to get buy-in from our VP of Engineering before we can move forward. He's concerned about the technical architecture and whether it can scale to handle our volume. We process about 50,000 transactions per day.",
    "Your competitor mentioned they can deliver this in half the time. What makes your implementation timeline longer? We're under pressure to get this live before Q4. Budget is approved, but timing is critical.",
    "This looks promising, but I'll need to see a demo with our actual data before presenting to the executive team. Can we schedule that for next week? Also, what's your pricing for the enterprise tier?",
  ];

  const excerpts: TranscriptExcerpt[] = [];

  for (let i = 0; i < conversationCount; i++) {
    const excerpt = mockExcerpts[i % mockExcerpts.length];
    excerpts.push({
      conversation_id: `mock-conversation-${i + 1}`,
      excerpt,
      token_count: Math.ceil(excerpt.length / 4),
      source: 'mock',
      call_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return excerpts;
}
