/**
 * Internal Meeting Filter
 *
 * Detects and filters out internal meetings from conversation intelligence analysis.
 * Uses dual-layer detection: participant domain check + title heuristics.
 *
 * Spec: PANDORA_INTERNAL_FILTER_AND_CWD_SPEC.md (Part 1)
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getConnectorCredentials } from '../lib/credential-store.js';

const logger = createLogger('InternalFilter');

// ============================================================================
// Types
// ============================================================================

export interface InternalClassificationResult {
  is_internal: boolean;
  classification_reason: string | null;
  internal_participant_count: number;
  external_participant_count: number;
  workspace_domains: string[];
}

export interface Participant {
  email?: string;
  name?: string;
  speaker_id?: string;
  is_internal?: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const GENERIC_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'mail.com',
];

const INTERNAL_TITLE_PATTERNS = [
  // Recurring internal meetings
  /\b(standup|stand-up|sync|alignment|retro|retrospective|sprint|scrum)\b/i,
  /\b(1[:\-]1|one[\-\s]on[\-\s]one|1 on 1)\b/i,
  /\b(team meeting|staff meeting|all[\-\s]hands|town[\-\s]hall)\b/i,
  /\b(weekly|bi-weekly|biweekly|monthly|daily)\b/i,
  /\b(planning|backlog|grooming|refinement)\b/i,

  // Internal programs
  /\b(fellowship|mentorship|training|onboarding|offsite)\b/i,

  // Pipeline/forecast reviews (internal about deals, not with deals)
  /\b(pipeline review|forecast review|deal review|QBR)\b/i,
  /\b(rev\s?ops|sales ops|marketing ops)\b/i,
];

// ============================================================================
// Domain Resolution
// ============================================================================

/**
 * Resolve workspace internal domain(s)
 * Strategy hierarchy:
 * 1. Check workspace config for explicit domains
 * 2. Infer from workspace owner's email
 * 3. Find most common domain in contact base (fallback)
 */
export async function resolveWorkspaceDomains(workspaceId: string): Promise<{ domains: string[]; source: 'config' | 'connector' | 'inferred' | 'none' }> {
  // Strategy 1: Check context_layer.definitions for explicit internal_domains
  const contextResult = await query<{ definitions: any }>(
    `SELECT definitions FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (contextResult.rows.length > 0) {
    const definitions = contextResult.rows[0].definitions || {};
    const internalDomains = definitions.internal_domains;
    if (Array.isArray(internalDomains)) {
      const domains = internalDomains.filter((d: any) => typeof d === 'string' && d.length > 0);
      if (domains.length > 0) {
        logger.debug('Resolved domains from context_layer config', { workspaceId, domains });
        return { domains, source: 'config' };
      }
    }
  }

  // Strategy 2: Extract domains from tracked users in conversation connectors (Gong, Fireflies)
  const convConnResult = await query<{ connector_name: string; metadata: any }>(
    `SELECT connector_name, metadata FROM connections
     WHERE workspace_id = $1
       AND connector_name IN ('gong', 'fireflies')
       AND status IN ('active', 'healthy')
     LIMIT 5`,
    [workspaceId]
  );

  const trackedDomains = new Set<string>();
  for (const conn of convConnResult.rows) {
    try {
      const tracked = conn.metadata?.tracked_users;
      if (Array.isArray(tracked)) {
        for (const user of tracked) {
          const email = user?.email;
          if (email && email.includes('@')) {
            const domain = email.split('@')[1].toLowerCase();
            if (!GENERIC_EMAIL_DOMAINS.includes(domain)) {
              trackedDomains.add(domain);
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  if (trackedDomains.size > 0) {
    const domains = Array.from(trackedDomains);
    logger.info('Resolved domains from tracked users', { workspaceId, domains });
    return { domains, source: 'connector' };
  }

  // Strategy 3: Infer from CRM connector credentials and metadata
  const crmConnResult = await query<{ connector_name: string; metadata: any }>(
    `SELECT connector_name, metadata FROM connections
     WHERE workspace_id = $1
       AND connector_name IN ('hubspot', 'salesforce')
       AND status IN ('active', 'healthy')
     LIMIT 5`,
    [workspaceId]
  );

  for (const conn of crmConnResult.rows) {
    let email: string | null = null;
    try {
      // Get credentials from credential store
      const credentials = await getConnectorCredentials(workspaceId, conn.connector_name);
      if (credentials && typeof credentials === 'object') {
        email = credentials.user_email || credentials.email || null;
      }
      // Also check metadata
      if (!email && conn.metadata && typeof conn.metadata === 'object') {
        email = conn.metadata.user_email || conn.metadata.authenticated_email || null;
      }
    } catch { /* ignore parse errors */ }

    if (email && email.includes('@')) {
      const domain = email.split('@')[1].toLowerCase();
      if (!GENERIC_EMAIL_DOMAINS.includes(domain)) {
        logger.info('Resolved domain from CRM connector credentials', { workspaceId, domain, connector: conn.connector_name });
        return { domains: [domain], source: 'connector' };
      }
    }
  }

  // Strategy 4: Most common email domain across synced contacts
  const domainResult = await query<{ domain: string; cnt: string }>(
    `SELECT domain, COUNT(*) as cnt FROM (
       SELECT LOWER(SPLIT_PART(email, '@', 2)) as domain
       FROM contacts
       WHERE workspace_id = $1
         AND email IS NOT NULL
         AND email LIKE '%@%'
     ) sub
     WHERE domain NOT IN ('gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','aol.com','protonmail.com')
     GROUP BY domain
     ORDER BY cnt DESC
     LIMIT 1`,
    [workspaceId]
  );

  if (domainResult.rows.length > 0) {
    const topDomain = domainResult.rows[0].domain;
    logger.info('Inferred workspace domain from contacts', {
      workspaceId,
      domain: topDomain,
      contactCount: domainResult.rows[0].cnt,
    });
    return { domains: [topDomain], source: 'inferred' };
  }

  logger.warn('Cannot resolve internal domain for workspace', { workspaceId });
  return { domains: [], source: 'none' };
}

/**
 * Check if an email domain matches any workspace domain
 */
function isInternalDomain(email: string | undefined, workspaceDomains: string[]): boolean {
  if (!email || workspaceDomains.length === 0) {
    return false;
  }

  const emailParts = email.toLowerCase().split('@');
  if (emailParts.length !== 2) {
    return false;
  }

  const emailDomain = emailParts[1];
  return workspaceDomains.some(wd => wd.toLowerCase() === emailDomain);
}

/**
 * Check if conversation title matches internal meeting patterns
 */
function matchesInternalTitlePattern(title: string | null): boolean {
  if (!title) {
    return false;
  }

  return INTERNAL_TITLE_PATTERNS.some(pattern => pattern.test(title));
}

// ============================================================================
// Classification Functions
// ============================================================================

/**
 * Classify a conversation as internal or external
 *
 * Decision matrix:
 * - All participants internal + title matches → internal (highest confidence)
 * - All participants internal + no title match → internal (participant check is definitive)
 * - Has external participants + title matches → external (external overrides title)
 * - Has external participants + no title match → external (normal)
 */
export async function classifyInternalMeeting(
  workspaceId: string,
  conversationTitle: string | null,
  participants: Participant[]
): Promise<InternalClassificationResult> {
  const resolved = await resolveWorkspaceDomains(workspaceId);
  const workspaceDomains = resolved.domains;

  if (workspaceDomains.length === 0) {
    return {
      is_internal: false,
      classification_reason: null,
      internal_participant_count: 0,
      external_participant_count: 0,
      workspace_domains: [],
    };
  }

  // Classify each participant
  let internalCount = 0;
  let externalCount = 0;
  let participantsWithEmail = 0;

  for (const participant of participants) {
    if (!participant.email) {
      // Skip participants without email (phone-in, unnamed speakers)
      continue;
    }

    participantsWithEmail++;

    if (isInternalDomain(participant.email, workspaceDomains)) {
      internalCount++;
    } else {
      externalCount++;
    }
  }

  // If no participants have emails, can't classify
  if (participantsWithEmail === 0) {
    return {
      is_internal: false,
      classification_reason: null,
      internal_participant_count: 0,
      external_participant_count: 0,
      workspace_domains: workspaceDomains,
    };
  }

  // Check if title matches internal patterns
  const titleMatches = matchesInternalTitlePattern(conversationTitle);

  // Decision matrix
  const allParticipantsInternal = externalCount === 0 && internalCount > 0;

  if (allParticipantsInternal) {
    // All participants are internal
    const reason = titleMatches
      ? 'all_internal_with_title_match'
      : 'all_participants_internal';

    return {
      is_internal: true,
      classification_reason: reason,
      internal_participant_count: internalCount,
      external_participant_count: externalCount,
      workspace_domains: workspaceDomains,
    };
  }

  // Has external participants → not internal (even if title matches)
  return {
    is_internal: false,
    classification_reason: null,
    internal_participant_count: internalCount,
    external_participant_count: externalCount,
    workspace_domains: workspaceDomains,
  };
}

/**
 * Batch classify conversations as internal/external
 */
export async function batchClassifyInternalMeetings(
  workspaceId: string,
  conversations: Array<{
    id: string;
    title: string | null;
    participants: Participant[];
  }>
): Promise<Map<string, InternalClassificationResult>> {
  logger.info('Batch classifying internal meetings', {
    workspaceId,
    conversationCount: conversations.length,
  });

  const resolved = await resolveWorkspaceDomains(workspaceId);
  const workspaceDomains = resolved.domains;

  if (workspaceDomains.length === 0) {
    logger.warn('No workspace domains resolved, cannot filter internal meetings', { workspaceId });
    return new Map();
  }

  const results = new Map<string, InternalClassificationResult>();

  for (const conversation of conversations) {
    // Classify participants
    let internalCount = 0;
    let externalCount = 0;
    let participantsWithEmail = 0;

    for (const participant of conversation.participants) {
      if (!participant.email) continue;
      participantsWithEmail++;

      if (isInternalDomain(participant.email, workspaceDomains)) {
        internalCount++;
      } else {
        externalCount++;
      }
    }

    // Handle edge cases
    if (participantsWithEmail === 0) {
      results.set(conversation.id, {
        is_internal: false,
        classification_reason: null,
        internal_participant_count: 0,
        external_participant_count: 0,
        workspace_domains: workspaceDomains,
      });
      continue;
    }

    const titleMatches = matchesInternalTitlePattern(conversation.title);
    const allParticipantsInternal = externalCount === 0 && internalCount > 0;

    if (allParticipantsInternal) {
      const reason = titleMatches
        ? 'all_internal_with_title_match'
        : 'all_participants_internal';

      results.set(conversation.id, {
        is_internal: true,
        classification_reason: reason,
        internal_participant_count: internalCount,
        external_participant_count: externalCount,
        workspace_domains: workspaceDomains,
      });
    } else {
      results.set(conversation.id, {
        is_internal: false,
        classification_reason: null,
        internal_participant_count: internalCount,
        external_participant_count: externalCount,
        workspace_domains: workspaceDomains,
      });
    }
  }

  const internalCount = Array.from(results.values()).filter(r => r.is_internal).length;

  logger.info('Batch classification complete', {
    workspaceId,
    totalConversations: conversations.length,
    internalMeetings: internalCount,
    externalCalls: conversations.length - internalCount,
  });

  return results;
}

/**
 * Update conversations table with internal classification
 * (For use in linker after classification)
 */
export async function updateConversationInternalStatus(
  conversationId: string,
  result: InternalClassificationResult
): Promise<void> {
  await query(
    `UPDATE conversations
     SET is_internal = $1,
         internal_classification_reason = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [result.is_internal, result.classification_reason, conversationId]
  );
}

export interface ClassifyBatchResult {
  classified: number;
  markedInternal: number;
  markedExternal: number;
  skipped: number;
  durationMs: number;
}

/**
 * Batch classify all unclassified conversations in a workspace
 * and persist results. Designed to run post-sync after the linker.
 */
export async function classifyAndUpdateInternalStatus(
  workspaceId: string
): Promise<ClassifyBatchResult> {
  const start = Date.now();

  const unclassified = await query<{
    id: string;
    title: string | null;
    participants: Participant[] | null;
  }>(
    `SELECT id, title, participants
     FROM conversations
     WHERE workspace_id = $1
       AND internal_classification_reason IS NULL`,
    [workspaceId]
  );

  if (unclassified.rows.length === 0) {
    return { classified: 0, markedInternal: 0, markedExternal: 0, skipped: 0, durationMs: Date.now() - start };
  }

  logger.info('Classifying unclassified conversations', {
    workspaceId,
    count: unclassified.rows.length,
  });

  const conversations = unclassified.rows.map(r => ({
    id: r.id,
    title: r.title,
    participants: Array.isArray(r.participants) ? r.participants : [],
  }));

  const classifications = await batchClassifyInternalMeetings(workspaceId, conversations);

  let markedInternal = 0;
  let markedExternal = 0;
  let skipped = 0;

  for (const [conversationId, classification] of classifications) {
    await updateConversationInternalStatus(conversationId, classification);
    if (classification.is_internal) {
      markedInternal++;
    } else {
      markedExternal++;
    }
  }

  skipped = conversations.length - classifications.size;

  logger.info('Internal classification complete', {
    workspaceId,
    classified: classifications.size,
    markedInternal,
    markedExternal,
    skipped,
  });

  return {
    classified: classifications.size,
    markedInternal,
    markedExternal,
    skipped,
    durationMs: Date.now() - start,
  };
}

/**
 * Get internal meeting statistics for a workspace
 */
export async function getInternalMeetingStats(workspaceId: string): Promise<{
  total_conversations: number;
  internal_meetings: number;
  external_calls: number;
  internal_percentage: number;
  by_classification_reason: Record<string, number>;
}> {
  const result = await query<{
    total: number;
    internal: number;
    all_participants_internal: number;
    all_internal_with_title_match: number;
  }>(
    `SELECT
       COUNT(*)::int as total,
       COUNT(*) FILTER (WHERE is_internal = TRUE)::int as internal,
       COUNT(*) FILTER (WHERE internal_classification_reason = 'all_participants_internal')::int as all_participants_internal,
       COUNT(*) FILTER (WHERE internal_classification_reason = 'all_internal_with_title_match')::int as all_internal_with_title_match
     FROM conversations
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const row = result.rows[0] || { total: 0, internal: 0, all_participants_internal: 0, all_internal_with_title_match: 0 };

  const total = row.total;
  const internal = row.internal;
  const external = total - internal;

  return {
    total_conversations: total,
    internal_meetings: internal,
    external_calls: external,
    internal_percentage: total > 0 ? Math.round((internal / total) * 100) : 0,
    by_classification_reason: {
      all_participants_internal: row.all_participants_internal,
      all_internal_with_title_match: row.all_internal_with_title_match,
    },
  };
}
