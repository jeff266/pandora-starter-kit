/**
 * Speaker Identity Resolution Service
 *
 * Determines who is internal (rep) vs external (buyer) on each conversation.
 * Uses a 5-level cascade from deterministic matching to heuristic inference.
 *
 * Runs after sync + cross-entity linker to leverage CRM data for matching.
 */

import { query, getClient } from '../db.js';
import type { PoolClient } from 'pg';

export interface ResolvedParticipant {
  name: string;
  email: string | null;
  role: 'internal' | 'external' | 'unknown';
  confidence: number;           // 0.0 - 1.0
  resolution_method: string;    // which cascade level resolved this
  crm_contact_id?: string;      // if matched to CRM contact
  crm_user_id?: string;         // if matched to deal owner/rep
  talk_pct?: number;            // 0-100, if sentence timing available
}

export interface ResolutionResult {
  processed: number;
  resolved_internal: number;
  resolved_external: number;
  low_confidence: number;
  unknown: number;
  duration_ms: number;
}

interface InternalDomains {
  domains: string[];
  source: 'auto_detected' | 'config';
}

interface RawParticipant {
  name?: string;
  email?: string;
  affiliation?: string;  // Gong-specific field
}

/**
 * Main entry point: Resolve participants for all conversations with empty resolved_participants
 */
export async function resolveConversationParticipants(
  workspaceId: string
): Promise<ResolutionResult> {
  const startTime = Date.now();
  const client = await getClient();

  try {
    // Get internal domains for this workspace
    const internalDomains = await getInternalDomains(workspaceId, client);

    // Fetch conversations needing resolution
    const conversationsResult = await query<{
      id: string;
      participants: any;
      source: string;
      source_data: any;
      deal_id: string | null;
      account_id: string | null;
    }>(
      `SELECT id, participants, source, source_data, deal_id, account_id
       FROM conversations
       WHERE workspace_id = $1
         AND (resolved_participants = '[]' OR resolved_participants IS NULL)
       ORDER BY call_date DESC
       LIMIT 1000`,
      [workspaceId]
    );

    const conversations = conversationsResult.rows;
    if (conversations.length === 0) {
      return {
        processed: 0,
        resolved_internal: 0,
        resolved_external: 0,
        low_confidence: 0,
        unknown: 0,
        duration_ms: Date.now() - startTime,
      };
    }

    // Build cross-call inference cache (participants appearing across 3+ accounts)
    const crossCallCache = await buildCrossCallInferenceCache(workspaceId, client);

    // Build account domain cache for external matching
    const accountDomains = await buildAccountDomainCache(workspaceId, client);

    let totalResolved = { internal: 0, external: 0, low_confidence: 0, unknown: 0 };

    // Process each conversation
    for (const conv of conversations) {
      const rawParticipants: RawParticipant[] = conv.participants || [];
      if (rawParticipants.length === 0) continue;

      const resolved = await resolveParticipantsForConversation(
        rawParticipants,
        internalDomains,
        crossCallCache,
        accountDomains,
        workspaceId,
        conv.deal_id,
        conv.source,
        conv.source_data,
        client
      );

      // Update conversation with resolved participants
      await client.query(
        `UPDATE conversations
         SET resolved_participants = $1, updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3`,
        [JSON.stringify(resolved), conv.id, workspaceId]
      );

      // Count resolution results
      for (const p of resolved) {
        if (p.role === 'internal') totalResolved.internal++;
        else if (p.role === 'external') totalResolved.external++;
        else totalResolved.unknown++;

        if (p.confidence < 0.7) totalResolved.low_confidence++;
      }
    }

    return {
      processed: conversations.length,
      resolved_internal: totalResolved.internal,
      resolved_external: totalResolved.external,
      low_confidence: totalResolved.low_confidence,
      unknown: totalResolved.unknown,
      duration_ms: Date.now() - startTime,
    };
  } finally {
    client.release();
  }
}

/**
 * Resolve participants for a single conversation using cascade logic
 */
async function resolveParticipantsForConversation(
  rawParticipants: RawParticipant[],
  internalDomains: InternalDomains,
  crossCallCache: Set<string>,
  accountDomains: Set<string>,
  workspaceId: string,
  dealId: string | null,
  source: string,
  sourceData: any,
  client: PoolClient
): Promise<ResolvedParticipant[]> {
  const resolved: ResolvedParticipant[] = [];

  for (const raw of rawParticipants) {
    const name = raw.name || 'Unknown';
    const email = raw.email?.toLowerCase() || null;

    // Level 1: Deterministic (confidence 1.0)
    const level1 = await resolveLevelOne(
      email,
      name,
      raw.affiliation,
      internalDomains,
      workspaceId,
      client
    );
    if (level1) {
      resolved.push({ name, email, ...level1 });
      continue;
    }

    // Level 2: High confidence (confidence 0.85)
    const level2 = await resolveLevelTwo(email, accountDomains);
    if (level2) {
      resolved.push({ name, email, ...level2 });
      continue;
    }

    // Level 3: Cross-call inference (confidence 0.75)
    const level3 = resolveLevelThree(email, crossCallCache);
    if (level3) {
      resolved.push({ name, email, ...level3 });
      continue;
    }

    // Level 4: Heuristic (confidence 0.6)
    // Will be applied after all participants processed
    resolved.push({
      name,
      email,
      role: 'unknown',
      confidence: 0,
      resolution_method: 'unresolved',
    });
  }

  // Level 4: Apply heuristics to unresolved participants
  applyHeuristics(resolved);

  // Compute talk percentages if available
  if (source === 'fireflies' && sourceData?.sentences) {
    computeTalkPercentages(sourceData.sentences, resolved);
  } else if (source === 'gong' && sourceData?.talk_ratio) {
    // Gong provides overall talk ratio - assign to primary internal speaker
    const primaryInternal = resolved.find(p => p.role === 'internal');
    if (primaryInternal) {
      primaryInternal.talk_pct = sourceData.talk_ratio;
    }
  }

  return resolved;
}

/**
 * Level 1: Deterministic matching (confidence 1.0 or 0.95)
 */
async function resolveLevelOne(
  email: string | null,
  name: string,
  affiliation: string | undefined,
  internalDomains: InternalDomains,
  workspaceId: string,
  client: PoolClient
): Promise<Omit<ResolvedParticipant, 'name' | 'email'> | null> {
  // 1a. Email domain matches internal domains
  if (email) {
    const domain = email.split('@')[1];
    if (domain && internalDomains.domains.includes(domain)) {
      return {
        role: 'internal',
        confidence: 1.0,
        resolution_method: 'internal_domain',
      };
    }

    // 1b. Email matches a deal owner (best-effort — column name varies by schema)
    try {
      const ownerResult = await client.query(
        `SELECT id FROM deals
         WHERE workspace_id = $1 AND LOWER(owner_email) = $2
         LIMIT 1`,
        [workspaceId, email]
      );
      if (ownerResult.rows.length > 0) {
        return {
          role: 'internal',
          confidence: 1.0,
          resolution_method: 'deal_owner_match',
          crm_user_id: ownerResult.rows[0].id,
        };
      }
    } catch {
      // owner_email column doesn't exist in this schema — skip this check
    }

    // 1c. Email matches a CRM contact
    const contactResult = await client.query(
      `SELECT id FROM contacts
       WHERE workspace_id = $1 AND LOWER(email) = $2
       LIMIT 1`,
      [workspaceId, email]
    );
    if (contactResult.rows.length > 0) {
      return {
        role: 'external',
        confidence: 1.0,
        resolution_method: 'crm_contact_match',
        crm_contact_id: contactResult.rows[0].id,
      };
    }
  }

  // 1d. Gong affiliation field
  if (affiliation) {
    const aff = affiliation.toLowerCase();
    if (aff.includes('internal')) {
      return {
        role: 'internal',
        confidence: 0.95,
        resolution_method: 'gong_affiliation_internal',
      };
    }
    if (aff.includes('external')) {
      return {
        role: 'external',
        confidence: 0.95,
        resolution_method: 'gong_affiliation_external',
      };
    }
  }

  return null;
}

/**
 * Level 2: High confidence matching (confidence 0.85)
 */
async function resolveLevelTwo(
  email: string | null,
  accountDomains: Set<string>
): Promise<Omit<ResolvedParticipant, 'name' | 'email'> | null> {
  if (!email) return null;

  const domain = email.split('@')[1];
  if (!domain) return null;

  // Email domain matches a CRM account domain
  if (accountDomains.has(domain)) {
    return {
      role: 'external',
      confidence: 0.85,
      resolution_method: 'account_domain_match',
    };
  }

  return null;
}

/**
 * Level 3: Cross-call inference (confidence 0.75)
 */
function resolveLevelThree(
  email: string | null,
  crossCallCache: Set<string>
): Omit<ResolvedParticipant, 'name' | 'email'> | null {
  if (!email) return null;

  // Participant appears across 3+ different accounts → internal
  if (crossCallCache.has(email)) {
    return {
      role: 'internal',
      confidence: 0.75,
      resolution_method: 'cross_call_inference',
    };
  }

  return null;
}

/**
 * Level 4: Heuristics (confidence 0.6)
 * Apply after all participants processed to use context
 */
function applyHeuristics(participants: ResolvedParticipant[]): void {
  const unresolved = participants.filter(p => p.role === 'unknown');
  if (unresolved.length === 0) return;

  const resolved = participants.filter(p => p.role !== 'unknown');

  // Heuristic 1: On a 2-person call, if one is resolved, the other is opposite
  if (participants.length === 2 && resolved.length === 1 && unresolved.length === 1) {
    const known = resolved[0];
    const unknown = unresolved[0];
    unknown.role = known.role === 'internal' ? 'external' : 'internal';
    unknown.confidence = 0.6;
    unknown.resolution_method = 'two_person_call_inference';
    return;
  }

  // Heuristic 2: On multi-person call, majority email domain = internal team
  const emailDomains = participants
    .map(p => p.email?.split('@')[1])
    .filter(Boolean) as string[];

  if (emailDomains.length > 0) {
    const domainCounts = new Map<string, number>();
    for (const domain of emailDomains) {
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }

    const majorityDomain = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1])[0][0];

    const majorityCount = domainCounts.get(majorityDomain) || 0;
    if (majorityCount > emailDomains.length / 2) {
      // Majority domain is likely internal
      for (const p of unresolved) {
        const domain = p.email?.split('@')[1];
        if (domain === majorityDomain) {
          p.role = 'internal';
          p.confidence = 0.6;
          p.resolution_method = 'majority_domain_heuristic';
        } else if (domain) {
          p.role = 'external';
          p.confidence = 0.6;
          p.resolution_method = 'minority_domain_heuristic';
        }
      }
    }
  }
}

/**
 * Compute talk percentages from Fireflies sentence timing
 */
function computeTalkPercentages(
  sentences: Array<{ speaker_name: string; start_time: number; end_time: number }>,
  participants: ResolvedParticipant[]
): void {
  if (!sentences || sentences.length === 0) return;

  // Calculate total duration per speaker
  const speakerDurations = new Map<string, number>();
  let totalDuration = 0;

  for (const sentence of sentences) {
    const duration = (sentence.end_time || 0) - (sentence.start_time || 0);
    if (duration > 0) {
      const normalizedName = normalizeName(sentence.speaker_name);
      speakerDurations.set(
        normalizedName,
        (speakerDurations.get(normalizedName) || 0) + duration
      );
      totalDuration += duration;
    }
  }

  if (totalDuration === 0) return;

  // Match speaker names to participants and assign talk_pct
  for (const p of participants) {
    const normalizedParticipantName = normalizeName(p.name);

    // Try exact match first
    let duration = speakerDurations.get(normalizedParticipantName);

    // Try fuzzy match if no exact match
    if (!duration) {
      for (const [speakerName, dur] of speakerDurations.entries()) {
        if (fuzzyNameMatch(normalizedParticipantName, speakerName)) {
          duration = dur;
          break;
        }
      }
    }

    if (duration) {
      p.talk_pct = Math.round((duration / totalDuration) * 100);
    }
  }
}

/**
 * Normalize name for matching (lowercase, remove spaces)
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '');
}

/**
 * Fuzzy match two normalized names (e.g., "jamesshannon" matches "jamess")
 */
function fuzzyNameMatch(name1: string, name2: string): boolean {
  const shorter = name1.length < name2.length ? name1 : name2;
  const longer = name1.length < name2.length ? name2 : name1;
  return longer.includes(shorter) && shorter.length >= 4;
}

/**
 * Get internal domains for workspace (auto-detect or from config)
 */
async function getInternalDomains(
  workspaceId: string,
  client: PoolClient
): Promise<InternalDomains> {
  // Check workspace_config for stored internal_domains (table may not exist in all deployments)
  try {
    const configResult = await client.query(
      `SELECT config_value FROM workspace_config
       WHERE workspace_id = $1 AND config_key = 'internal_domains'`,
      [workspaceId]
    );

    if (configResult.rows.length > 0) {
      const domains = configResult.rows[0].config_value as string[];
      return { domains, source: 'config' };
    }
  } catch {
    // workspace_config table doesn't exist — fall through to auto-detection
  }

  const domains: string[] = [];

  // Auto-detect from connector auth emails (best-effort — table name varies by deployment)
  try {
    const connectorResult = await client.query(
      `SELECT DISTINCT SPLIT_PART(auth_email, '@', 2) as domain
       FROM data_connectors
       WHERE workspace_id = $1 AND auth_email IS NOT NULL`,
      [workspaceId]
    );

    for (const row of connectorResult.rows) {
      const domain = row.domain;
      if (domain && !domains.includes(domain)) {
        domains.push(domain);
      }
    }
  } catch {
    // data_connectors table doesn't exist in this schema — skip
  }

  // Auto-detect from internal participant affiliation in Gong data
  // (participants with affiliation=Internal give us the internal domain directly)
  if (domains.length === 0) {
    try {
      const gongInternalResult = await client.query<{ domain: string; n: string }>(
        `SELECT SPLIT_PART(p->>'email', '@', 2) as domain, COUNT(*) as n
         FROM conversations c,
              jsonb_array_elements(c.participants) p
         WHERE c.workspace_id = $1
           AND p->>'affiliation' = 'Internal'
           AND p->>'email' IS NOT NULL
           AND p->>'email' <> ''
         GROUP BY 1
         ORDER BY 2 DESC
         LIMIT 3`,
        [workspaceId]
      );

      for (const row of gongInternalResult.rows) {
        const domain = row.domain;
        if (domain && !domains.includes(domain)) {
          domains.push(domain);
        }
      }
    } catch {
      // participants column not in expected shape — skip
    }
  }

  // Store detected domains in config for next run (best-effort, table may not exist)
  if (domains.length > 0) {
    try {
      await client.query(
        `INSERT INTO workspace_config (workspace_id, config_key, config_value, created_at)
         VALUES ($1, 'internal_domains', $2, NOW())
         ON CONFLICT (workspace_id, config_key)
         DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
        [workspaceId, JSON.stringify(domains)]
      );
    } catch {
      // workspace_config table doesn't exist — skip caching
    }
  }

  return { domains, source: 'auto_detected' };
}

/**
 * Build cache of participants appearing across 3+ different accounts
 */
async function buildCrossCallInferenceCache(
  workspaceId: string,
  client: PoolClient
): Promise<Set<string>> {
  const result = await client.query<{ email: string }>(
    `SELECT p->>'email' as email
     FROM conversations c, jsonb_array_elements(c.participants) p
     WHERE c.workspace_id = $1
       AND c.account_id IS NOT NULL
       AND p->>'email' IS NOT NULL
     GROUP BY p->>'email'
     HAVING COUNT(DISTINCT c.account_id) >= 3`,
    [workspaceId]
  );

  return new Set(result.rows.map(r => r.email.toLowerCase()));
}

/**
 * Build cache of account domains for external matching
 */
async function buildAccountDomainCache(
  workspaceId: string,
  client: PoolClient
): Promise<Set<string>> {
  const result = await client.query<{ domain: string }>(
    `SELECT DISTINCT domain
     FROM accounts
     WHERE workspace_id = $1 AND domain IS NOT NULL`,
    [workspaceId]
  );

  return new Set(result.rows.map(r => r.domain.toLowerCase()));
}
