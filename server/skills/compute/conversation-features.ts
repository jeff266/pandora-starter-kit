/**
 * Conversation Feature Extraction for ICP Discovery
 *
 * Extracts conversation-level signals from Gong/Fireflies data
 * and merges them into the ICP feature matrix.
 *
 * Spec: PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md
 */

import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ConversationFeatures');

// ============================================================================
// Types
// ============================================================================

export interface ConversationMetadata {
  dealId: string;

  // Volume metrics
  total_call_minutes: number;
  call_count_with_transcript: number;
  avg_call_duration_minutes: number;

  // Speaker metrics
  unique_customer_speakers: number;
  unique_rep_speakers: number;

  // Timing metrics
  days_between_calls_avg: number | null;
  first_call_timing: number | null; // days from deal created to first call
  last_call_to_close: number | null; // days from last call to close
  call_density: number; // calls per day active

  // Gong-specific metrics (null if not available)
  talk_ratio_avg: number | null;
  longest_monologue_avg: number | null;
  question_rate_avg: number | null;
  interactivity_avg: number | null;

  // Fireflies-specific metrics (null if not available)
  action_items_total: number | null;
  action_items_per_call: number | null;
}

// ConversationSignal type moved to conversation-classification.ts to avoid circular dependency

export interface ConversationLinkage {
  dealId: string;
  conversationIds: string[];
  linkMethod: 'direct' | 'fuzzy_email' | 'fuzzy_title';
  confidence: number;
}

export interface ConversationCoverage {
  dealsWithConversations: number;
  dealsWithoutConversations: number;
  conversationCoverage: number; // percentage
  totalConversationsLinked: number;
  avgConversationsPerDeal: number;
  gongDeals: number;
  firefliesDeals: number;
  bothSourceDeals: number;
  tier: 0 | 1 | 2 | 3; // Degradation tier
}

export interface TranscriptExcerpt {
  conversationId: string;
  dealId: string;
  title: string;
  excerptStart: string; // first 400 tokens
  excerptEnd: string; // last 400 tokens
  fullSummary: string | null; // fallback if no transcript
}

// ============================================================================
// Step A: Link Conversations to Deals
// ============================================================================

/**
 * Link conversations to closed deals using direct link or fuzzy matching
 */
export async function linkConversationsToDeals(
  workspaceId: string,
  dealIds: string[]
): Promise<ConversationLinkage[]> {
  logger.info('Linking conversations to deals', { workspaceId, dealCount: dealIds.length });

  const linkages: ConversationLinkage[] = [];

  for (const dealId of dealIds) {
    // Try direct link first
    const directLink = await query<{ id: string }>(
      `SELECT id FROM conversations
       WHERE workspace_id = $1 AND deal_id = $2`,
      [workspaceId, dealId]
    );

    if (directLink.rows.length > 0) {
      linkages.push({
        dealId,
        conversationIds: directLink.rows.map(r => r.id),
        linkMethod: 'direct',
        confidence: 1.0,
      });
      continue;
    }

    // Fallback to fuzzy matching
    const fuzzyLink = await fuzzyMatchConversations(workspaceId, dealId);
    if (fuzzyLink.conversationIds.length > 0) {
      linkages.push(fuzzyLink);
    }
  }

  logger.info('Conversation linkage complete', {
    workspaceId,
    linkedDeals: linkages.length,
    totalDeals: dealIds.length,
  });

  return linkages;
}

/**
 * Fuzzy match conversations to a deal based on timing and participants
 */
async function fuzzyMatchConversations(
  workspaceId: string,
  dealId: string
): Promise<ConversationLinkage> {
  // Get deal date range and associated contacts
  const dealData = await query<{
    created_date: string;
    close_date: string;
    account_id: string;
  }>(
    `SELECT created_date, close_date, account_id
     FROM deals
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, dealId]
  );

  if (dealData.rows.length === 0) {
    return { dealId, conversationIds: [], linkMethod: 'fuzzy_email', confidence: 0 };
  }

  const { created_date, close_date, account_id } = dealData.rows[0];

  // Get contact emails associated with the deal
  const contactEmails = await query<{ email: string }>(
    `SELECT DISTINCT c.email
     FROM contacts c
     JOIN deal_contacts dc ON dc.contact_id = c.id
     WHERE dc.workspace_id = $1 AND dc.deal_id = $2 AND c.email IS NOT NULL`,
    [workspaceId, dealId]
  );

  const emails = contactEmails.rows.map(r => r.email.toLowerCase());

  if (emails.length === 0) {
    // No emails to match - try account name in title
    const titleMatch = await query<{ id: string }>(
      `SELECT c.id
       FROM conversations c
       JOIN accounts a ON a.id = $3
       WHERE c.workspace_id = $1
         AND c.call_date BETWEEN $4::date AND $5::date
         AND c.is_internal = FALSE
         AND c.account_id = a.id
       ORDER BY c.call_date`,
      [workspaceId, dealId, account_id, created_date, close_date]
    );

    return {
      dealId,
      conversationIds: titleMatch.rows.map(r => r.id),
      linkMethod: 'fuzzy_title',
      confidence: 0.5,
    };
  }

  // Match by participant email
  const emailMatch = await query<{ id: string }>(
    `SELECT DISTINCT c.id
     FROM conversations c
     WHERE c.workspace_id = $1
       AND c.call_date BETWEEN $2::date AND $3::date
       AND c.is_internal = FALSE
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(c.participants) AS p
         WHERE LOWER(p->>'email') = ANY($4::text[])
       )
     ORDER BY c.call_date`,
    [workspaceId, created_date, close_date, emails]
  );

  return {
    dealId,
    conversationIds: emailMatch.rows.map(r => r.id),
    linkMethod: 'fuzzy_email',
    confidence: 0.8,
  };
}

// ============================================================================
// Step B: Aggregate Conversation Metadata
// ============================================================================

/**
 * Compute conversation metadata for deals with linked conversations
 */
export async function aggregateConversationMetadata(
  workspaceId: string,
  linkages: ConversationLinkage[]
): Promise<Map<string, ConversationMetadata>> {
  logger.info('Aggregating conversation metadata', {
    workspaceId,
    dealCount: linkages.length,
  });

  const metadataMap = new Map<string, ConversationMetadata>();

  for (const linkage of linkages) {
    if (linkage.conversationIds.length === 0) continue;

    const metadata = await computeMetadataForDeal(
      workspaceId,
      linkage.dealId,
      linkage.conversationIds
    );

    metadataMap.set(linkage.dealId, metadata);
  }

  logger.info('Metadata aggregation complete', {
    workspaceId,
    dealsWithMetadata: metadataMap.size,
  });

  return metadataMap;
}

/**
 * Compute metadata for a single deal's conversations
 */
async function computeMetadataForDeal(
  workspaceId: string,
  dealId: string,
  conversationIds: string[]
): Promise<ConversationMetadata> {
  // Get deal timing for context
  const dealTiming = await query<{
    created_date: string;
    close_date: string;
    sales_cycle_days: number;
  }>(
    `SELECT
       created_date,
       close_date,
       EXTRACT(DAY FROM close_date - created_date)::int as sales_cycle_days
     FROM deals
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, dealId]
  );

  const dealCreated = dealTiming.rows[0]?.created_date
    ? new Date(dealTiming.rows[0].created_date)
    : null;
  const dealClosed = dealTiming.rows[0]?.close_date
    ? new Date(dealTiming.rows[0].close_date)
    : null;
  const salesCycleDays = dealTiming.rows[0]?.sales_cycle_days || 0;

  // Get conversation data
  const conversations = await query<{
    id: string;
    call_date: string;
    duration_seconds: number;
    participants: any;
    source: string;
    source_data: any;
    transcript_text: string | null;
  }>(
    `SELECT id, call_date, duration_seconds, participants, source, source_data, transcript_text
     FROM conversations
     WHERE workspace_id = $1 AND id = ANY($2::uuid[])
     ORDER BY call_date`,
    [workspaceId, conversationIds]
  );

  const rows = conversations.rows;

  if (rows.length === 0) {
    return createEmptyMetadata(dealId);
  }

  // Calculate volume metrics
  const total_call_minutes = rows.reduce((sum, r) => sum + (r.duration_seconds / 60), 0);
  const call_count_with_transcript = rows.filter(r => r.transcript_text).length;
  const avg_call_duration_minutes = total_call_minutes / rows.length;

  // Calculate speaker metrics
  const allParticipants = rows.flatMap(r => (Array.isArray(r.participants) ? r.participants : []));
  const customerSpeakers = new Set(
    allParticipants
      .filter((p: any) => !p.is_internal && p.email)
      .map((p: any) => p.email.toLowerCase())
  );
  const repSpeakers = new Set(
    allParticipants
      .filter((p: any) => p.is_internal && p.email)
      .map((p: any) => p.email.toLowerCase())
  );

  // Calculate timing metrics
  const callDates = rows.map(r => new Date(r.call_date)).sort((a, b) => a.getTime() - b.getTime());

  let days_between_calls_avg: number | null = null;
  if (callDates.length > 1) {
    const gaps = [];
    for (let i = 1; i < callDates.length; i++) {
      const gap = (callDates[i].getTime() - callDates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
      gaps.push(gap);
    }
    days_between_calls_avg = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  }

  const first_call_timing =
    dealCreated && callDates[0]
      ? (callDates[0].getTime() - dealCreated.getTime()) / (1000 * 60 * 60 * 24)
      : null;

  const last_call_to_close =
    dealClosed && callDates[callDates.length - 1]
      ? (dealClosed.getTime() - callDates[callDates.length - 1].getTime()) / (1000 * 60 * 60 * 24)
      : null;

  const call_density = salesCycleDays > 0 ? rows.length / salesCycleDays : 0;

  // Calculate Gong-specific metrics
  const gongCalls = rows.filter(r => r.source === 'gong' && r.source_data);
  let talk_ratio_avg: number | null = null;
  let longest_monologue_avg: number | null = null;
  let question_rate_avg: number | null = null;
  let interactivity_avg: number | null = null;

  if (gongCalls.length > 0) {
    const talkRatios = gongCalls
      .map(r => r.source_data?.talk_ratio)
      .filter((v: any) => typeof v === 'number');
    const monologues = gongCalls
      .map(r => r.source_data?.longest_monologue_seconds)
      .filter((v: any) => typeof v === 'number');
    const questionCounts = gongCalls.map(r => ({
      count: r.source_data?.question_count || 0,
      duration: r.duration_seconds / 60,
    }));
    const interactivities = gongCalls
      .map(r => r.source_data?.interactivity)
      .filter((v: any) => typeof v === 'number');

    if (talkRatios.length > 0) {
      talk_ratio_avg = talkRatios.reduce((sum: number, v: number) => sum + v, 0) / talkRatios.length;
    }
    if (monologues.length > 0) {
      longest_monologue_avg = monologues.reduce((sum: number, v: number) => sum + v, 0) / monologues.length;
    }
    if (questionCounts.length > 0) {
      const totalQuestions = questionCounts.reduce((sum, q) => sum + q.count, 0);
      const totalDuration = questionCounts.reduce((sum, q) => sum + q.duration, 0);
      question_rate_avg = totalDuration > 0 ? totalQuestions / totalDuration : null;
    }
    if (interactivities.length > 0) {
      interactivity_avg = interactivities.reduce((sum: number, v: number) => sum + v, 0) / interactivities.length;
    }
  }

  // Calculate Fireflies-specific metrics
  const firefliesCalls = rows.filter(r => r.source === 'fireflies' && r.source_data);
  let action_items_total: number | null = null;
  let action_items_per_call: number | null = null;

  if (firefliesCalls.length > 0) {
    const actionItemCounts = firefliesCalls.map(
      r => (Array.isArray(r.source_data?.action_items) ? r.source_data.action_items.length : 0)
    );
    const totalItems = actionItemCounts.reduce((sum, count) => sum + count, 0);
    action_items_total = totalItems;
    action_items_per_call = totalItems > 0 ? totalItems / firefliesCalls.length : 0;

    // If Gong didn't provide talk_ratio, compute from Fireflies sentences
    if (talk_ratio_avg === null && firefliesCalls.some(r => r.source_data?.sentences)) {
      const talkRatios = firefliesCalls
        .filter(r => r.source_data?.sentences)
        .map(r => computeTalkRatioFromSentences(r.source_data.sentences))
        .filter(v => v !== null);

      if (talkRatios.length > 0) {
        talk_ratio_avg = talkRatios.reduce((sum, v) => sum + v!, 0) / talkRatios.length;
      }
    }
  }

  return {
    dealId,
    total_call_minutes,
    call_count_with_transcript,
    avg_call_duration_minutes,
    unique_customer_speakers: customerSpeakers.size,
    unique_rep_speakers: repSpeakers.size,
    days_between_calls_avg,
    first_call_timing,
    last_call_to_close,
    call_density,
    talk_ratio_avg,
    longest_monologue_avg,
    question_rate_avg,
    interactivity_avg,
    action_items_total,
    action_items_per_call,
  };
}

/**
 * Compute talk ratio from Fireflies sentences data
 */
function computeTalkRatioFromSentences(sentences: any[]): number | null {
  if (!Array.isArray(sentences) || sentences.length === 0) return null;

  let repTime = 0;
  let totalTime = 0;

  for (const sentence of sentences) {
    const duration = sentence.duration_seconds || 0;
    totalTime += duration;

    // Assume internal speakers are reps (Fireflies marks them)
    if (sentence.speaker_affiliation === 'internal') {
      repTime += duration;
    }
  }

  return totalTime > 0 ? repTime / totalTime : null;
}

function createEmptyMetadata(dealId: string): ConversationMetadata {
  return {
    dealId,
    total_call_minutes: 0,
    call_count_with_transcript: 0,
    avg_call_duration_minutes: 0,
    unique_customer_speakers: 0,
    unique_rep_speakers: 0,
    days_between_calls_avg: null,
    first_call_timing: null,
    last_call_to_close: null,
    call_density: 0,
    talk_ratio_avg: null,
    longest_monologue_avg: null,
    question_rate_avg: null,
    interactivity_avg: null,
    action_items_total: null,
    action_items_per_call: null,
  };
}

// ============================================================================
// Step C: Extract Transcript Excerpts for DeepSeek
// ============================================================================

/**
 * Extract transcript excerpts for DeepSeek classification
 */
export async function extractTranscriptExcerpts(
  workspaceId: string,
  linkages: ConversationLinkage[],
  tokensPerExcerpt: number = 400
): Promise<TranscriptExcerpt[]> {
  logger.info('Extracting transcript excerpts', {
    workspaceId,
    dealCount: linkages.length,
  });

  const excerpts: TranscriptExcerpt[] = [];

  for (const linkage of linkages) {
    if (linkage.conversationIds.length === 0) continue;

    // Select up to 5 conversations per deal (most recent, prioritize longest)
    const conversations = await query<{
      id: string;
      title: string;
      transcript_text: string | null;
      summary: string | null;
      duration_seconds: number;
      call_date: string;
    }>(
      `SELECT id, title, transcript_text, summary, duration_seconds, call_date
       FROM conversations
       WHERE workspace_id = $1 AND id = ANY($2::uuid[])
       ORDER BY call_date DESC, duration_seconds DESC
       LIMIT 5`,
      [workspaceId, linkage.conversationIds]
    );

    for (const conv of conversations.rows) {
      const excerpt = extractExcerptFromConversation(
        conv,
        linkage.dealId,
        tokensPerExcerpt
      );
      if (excerpt) {
        excerpts.push(excerpt);
      }
    }
  }

  logger.info('Excerpt extraction complete', {
    workspaceId,
    excerptCount: excerpts.length,
  });

  return excerpts;
}

/**
 * Extract first/last N tokens from a single conversation
 */
function extractExcerptFromConversation(
  conversation: {
    id: string;
    title: string;
    transcript_text: string | null;
    summary: string | null;
    duration_seconds: number;
  },
  dealId: string,
  tokensPerExcerpt: number
): TranscriptExcerpt | null {
  const { id, title, transcript_text, summary } = conversation;

  // If no transcript, use summary as fallback
  if (!transcript_text) {
    if (!summary) return null;

    return {
      conversationId: id,
      dealId,
      title: title || 'Untitled',
      excerptStart: summary.substring(0, tokensPerExcerpt * 4), // rough char estimate
      excerptEnd: '',
      fullSummary: summary,
    };
  }

  // Extract first and last N tokens (approximate by characters)
  // Rough estimate: 1 token ≈ 4 characters
  const charLimit = tokensPerExcerpt * 4;

  const excerptStart = transcript_text.substring(0, charLimit);
  const excerptEnd = transcript_text.substring(Math.max(0, transcript_text.length - charLimit));

  return {
    conversationId: id,
    dealId,
    title: title || 'Untitled',
    excerptStart,
    excerptEnd,
    fullSummary: summary,
  };
}

// ============================================================================
// Step D: Compute Coverage and Tier Classification
// ============================================================================

/**
 * Compute conversation coverage and determine degradation tier
 */
export function computeConversationCoverage(
  totalDeals: number,
  linkages: ConversationLinkage[],
  metadataMap: Map<string, ConversationMetadata>
): ConversationCoverage {
  const dealsWithConversations = linkages.filter(l => l.conversationIds.length > 0).length;
  const dealsWithoutConversations = totalDeals - dealsWithConversations;
  const conversationCoverage = totalDeals > 0 ? (dealsWithConversations / totalDeals) * 100 : 0;

  const totalConversationsLinked = linkages.reduce((sum, l) => sum + l.conversationIds.length, 0);
  const avgConversationsPerDeal =
    dealsWithConversations > 0 ? totalConversationsLinked / dealsWithConversations : 0;

  // Count by source (requires querying conversations again)
  let gongDeals = 0;
  let firefliesDeals = 0;
  let bothSourceDeals = 0;

  // TODO: Query to count source distribution

  // Determine tier based on coverage
  let tier: 0 | 1 | 2 | 3;
  if (conversationCoverage === 0) {
    tier = 0; // No conversation data
  } else if (conversationCoverage < 30) {
    tier = 1; // Sparse coverage
  } else if (conversationCoverage < 70) {
    tier = 2; // Moderate coverage
  } else {
    tier = 3; // Strong coverage
  }

  return {
    dealsWithConversations,
    dealsWithoutConversations,
    conversationCoverage,
    totalConversationsLinked,
    avgConversationsPerDeal,
    gongDeals,
    firefliesDeals,
    bothSourceDeals,
    tier,
  };
}
