/**
 * Consultant Call Distribution Engine — 4-Tier Matching
 *
 * Automatically assigns consultant calls to the correct workspace based on:
 * - Tier 1: Email match (participant emails → workspace contacts)
 * - Tier 2: Calendar correlation (call time → calendar events)
 * - Tier 3: Transcript content scan (mentions of workspace entities)
 * - Tier 4: Manual triage (unmatched calls shown in UI)
 *
 * After assignment, triggers the cross-entity linker for the target workspace.
 */

import { query } from '../db.js';
import {
  getConsultantConnector,
  getWorkspacesForUser,
  getUserEmail,
} from './consultant-connector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Match {
  workspaceId: string;
  method: 'email_match' | 'calendar_match' | 'transcript_scan' | 'manual';
  confidence: number;
  tier: 'tier1' | 'tier2' | 'tier3';
}

export interface DistributionResult {
  processed: number;
  tier1_email: number;
  tier2_calendar: number;
  tier3_transcript: number;
  unmatched: number;
  errors: string[];
}

interface Candidate {
  workspace_id: string;
  workspace_name: string;
  score: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Main Distribution Function
// ---------------------------------------------------------------------------

export async function distributeConsultantCalls(
  connectorId: string
): Promise<DistributionResult> {
  // Get unassigned, non-skipped calls
  const unassigned = await query<{
    assignment_id: string;
    conversation_id: string;
    participants: any;
    call_date: string | null;
    title: string | null;
    source_id: string;
    created_at: string;
  }>(
    `SELECT cca.id as assignment_id, cca.conversation_id,
            c.participants, c.call_date, c.title, c.source_id, c.created_at
     FROM consultant_call_assignments cca
     JOIN conversations c ON c.id = cca.conversation_id
     WHERE cca.consultant_connector_id = $1
       AND cca.workspace_id IS NULL
       AND cca.skipped = FALSE
     ORDER BY c.call_date DESC NULLS LAST`,
    [connectorId]
  );

  if (unassigned.rows.length === 0) {
    return { processed: 0, tier1_email: 0, tier2_calendar: 0, tier3_transcript: 0, unmatched: 0, errors: [] };
  }

  const connector = await getConsultantConnector(connectorId);
  if (!connector) {
    throw new Error(`Connector ${connectorId} not found`);
  }

  const workspaces = await getWorkspacesForUser(connector.user_id);
  if (workspaces.length === 0) {
    console.log(`[ConsultantDistributor] User ${connector.user_id} has no workspaces`);
    return { processed: unassigned.rows.length, tier1_email: 0, tier2_calendar: 0, tier3_transcript: 0, unmatched: unassigned.rows.length, errors: [] };
  }

  // Get consultant's own email to exclude from matching
  const consultantEmail = await getUserEmail(connector.user_id);

  const result: DistributionResult = {
    processed: unassigned.rows.length,
    tier1_email: 0,
    tier2_calendar: 0,
    tier3_transcript: 0,
    unmatched: 0,
    errors: [],
  };

  for (const call of unassigned.rows) {
    try {
      const match =
        (await tryTier1EmailMatch(call, workspaces, consultantEmail)) ||
        (await tryTier2CalendarMatch(call, workspaces, connector.user_id)) ||
        (await tryTier3TranscriptScan(call, workspaces));

      if (match) {
        await assignCallToWorkspace(
          call.conversation_id,
          match.workspaceId,
          match.method,
          match.confidence
        );

        if (match.tier === 'tier1') result.tier1_email++;
        else if (match.tier === 'tier2') result.tier2_calendar++;
        else if (match.tier === 'tier3') result.tier3_transcript++;
      } else {
        // Collect candidate workspaces for triage UI
        const candidates = await collectCandidates(call, workspaces, consultantEmail);
        await query(
          `UPDATE consultant_call_assignments
           SET candidate_workspaces = $1
           WHERE conversation_id = $2`,
          [JSON.stringify(candidates), call.conversation_id]
        );
        result.unmatched++;
      }
    } catch (err: any) {
      result.errors.push(`Call ${call.conversation_id}: ${err.message}`);
    }
  }

  console.log(
    `[ConsultantDistributor] Processed ${result.processed}: ` +
    `T1=${result.tier1_email} T2=${result.tier2_calendar} T3=${result.tier3_transcript} ` +
    `unmatched=${result.unmatched} errors=${result.errors.length}`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Tier 1: Email Match
// ---------------------------------------------------------------------------

async function tryTier1EmailMatch(
  call: any,
  workspaces: Array<{ id: string; name: string }>,
  consultantEmail: string | null
): Promise<Match | null> {
  const emails = extractParticipantEmails(call.participants);
  if (emails.length === 0) return null;

  // Filter out the consultant's own email
  const filteredEmails = consultantEmail
    ? emails.filter(e => e !== consultantEmail.toLowerCase())
    : emails;

  if (filteredEmails.length === 0) return null;

  const matchScores: Array<{ workspaceId: string; matchCount: number }> = [];

  for (const ws of workspaces) {
    const result = await query<{ match_count: string }>(
      `SELECT COUNT(DISTINCT email) as match_count
       FROM contacts
       WHERE workspace_id = $1
         AND LOWER(email) = ANY($2::text[])`,
      [ws.id, filteredEmails]
    );

    const matchCount = parseInt(result.rows[0]?.match_count || '0');
    if (matchCount > 0) {
      matchScores.push({ workspaceId: ws.id, matchCount });
    }
  }

  if (matchScores.length === 0) return null;

  if (matchScores.length === 1) {
    return {
      workspaceId: matchScores[0].workspaceId,
      method: 'email_match',
      confidence: 0.95,
      tier: 'tier1',
    };
  }

  // Multiple workspaces matched — pick highest match count
  matchScores.sort((a, b) => b.matchCount - a.matchCount);

  // If top two are equal, don't auto-assign (ambiguous)
  if (matchScores[0].matchCount === matchScores[1].matchCount) {
    return null;
  }

  return {
    workspaceId: matchScores[0].workspaceId,
    method: 'email_match',
    confidence: 0.8,
    tier: 'tier1',
  };
}

// ---------------------------------------------------------------------------
// Tier 2: Calendar Correlation
// ---------------------------------------------------------------------------

async function tryTier2CalendarMatch(
  call: any,
  workspaces: Array<{ id: string; name: string }>,
  userId: string
): Promise<Match | null> {
  // Check if calendar_events table exists
  const hasCalendar = await query<{ exists: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'calendar_events'
    ) as exists`
  );

  if (!hasCalendar.rows[0]?.exists) return null;

  const callTime = new Date(call.call_date || call.created_at);
  if (isNaN(callTime.getTime())) return null;

  const windowStart = new Date(callTime.getTime() - 15 * 60 * 1000); // -15 min
  const windowEnd = new Date(callTime.getTime() + 15 * 60 * 1000);   // +15 min

  const events = await query<{ title: string; description: string; attendees: any }>(
    `SELECT title, description, attendees
     FROM calendar_events
     WHERE user_id = $1
       AND start_time >= $2
       AND start_time <= $3
     LIMIT 5`,
    [userId, windowStart.toISOString(), windowEnd.toISOString()]
  );

  if (events.rows.length === 0) return null;

  for (const event of events.rows) {
    const eventTitle = (event.title || '').toLowerCase();

    // Strategy A: Check if event title contains a workspace name
    for (const ws of workspaces) {
      const wsNameLower = ws.name.toLowerCase();
      if (wsNameLower.length > 3 && eventTitle.includes(wsNameLower)) {
        return {
          workspaceId: ws.id,
          method: 'calendar_match',
          confidence: 0.85,
          tier: 'tier2',
        };
      }
    }

    // Strategy B: Check event attendee emails against workspace contacts
    if (event.attendees) {
      const attendeeEmails = extractAttendeesEmails(event.attendees);
      if (attendeeEmails.length > 0) {
        for (const ws of workspaces) {
          const result = await query<{ cnt: string }>(
            `SELECT COUNT(*) as cnt FROM contacts
             WHERE workspace_id = $1 AND LOWER(email) = ANY($2::text[])`,
            [ws.id, attendeeEmails]
          );
          if (parseInt(result.rows[0]?.cnt || '0') > 0) {
            return {
              workspaceId: ws.id,
              method: 'calendar_match',
              confidence: 0.85,
              tier: 'tier2',
            };
          }
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tier 3: Transcript Content Scan
// ---------------------------------------------------------------------------

async function tryTier3TranscriptScan(
  call: any,
  workspaces: Array<{ id: string; name: string }>
): Promise<Match | null> {
  const convo = await query<{ transcript_text: string | null; summary: string | null; source_data: any }>(
    `SELECT transcript_text, summary, source_data
     FROM conversations WHERE id = $1`,
    [call.conversation_id]
  );

  if (!convo.rows[0]) return null;

  const row = convo.rows[0];
  let text = row.transcript_text || row.summary || '';

  if (!text && row.source_data) {
    const sd = typeof row.source_data === 'string' ? JSON.parse(row.source_data) : row.source_data;
    text = sd.summary?.overview || sd.title || '';
  }

  if (!text || text.length < 50) return null;

  // Use first 3000 characters to keep scanning fast
  const scanText = text.substring(0, 3000).toLowerCase();

  const scores: Array<{ workspaceId: string; score: number; signals: string[] }> = [];

  for (const ws of workspaces) {
    let score = 0;
    const matchedSignals: string[] = [];

    // Signal 1: Workspace name (5 points)
    if (ws.name.length > 3 && scanText.includes(ws.name.toLowerCase())) {
      score += 5;
      matchedSignals.push(`workspace_name:${ws.name}`);
    }

    // Signal 2: Account names (3 points each)
    const accounts = await query<{ name: string }>(
      `SELECT DISTINCT name FROM accounts
       WHERE workspace_id = $1 AND name IS NOT NULL
       ORDER BY updated_at DESC LIMIT 20`,
      [ws.id]
    );
    for (const acct of accounts.rows) {
      if (acct.name && acct.name.length > 3 && scanText.includes(acct.name.toLowerCase())) {
        score += 3;
        matchedSignals.push(`account:${acct.name}`);
      }
    }

    // Signal 3: Deal names (3 points each)
    const deals = await query<{ name: string }>(
      `SELECT DISTINCT name FROM deals
       WHERE workspace_id = $1 AND name IS NOT NULL
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       ORDER BY updated_at DESC LIMIT 20`,
      [ws.id]
    );
    for (const deal of deals.rows) {
      if (deal.name && deal.name.length > 5 && scanText.includes(deal.name.toLowerCase())) {
        score += 3;
        matchedSignals.push(`deal:${deal.name}`);
      }
    }

    // Signal 4: Contact full names (2 points each)
    const contacts = await query<{ full_name: string }>(
      `SELECT DISTINCT
         CONCAT(first_name, ' ', last_name) as full_name
       FROM contacts
       WHERE workspace_id = $1
         AND first_name IS NOT NULL
         AND last_name IS NOT NULL
       ORDER BY updated_at DESC LIMIT 20`,
      [ws.id]
    );
    for (const contact of contacts.rows) {
      if (contact.full_name && contact.full_name.length > 5
          && scanText.includes(contact.full_name.toLowerCase())) {
        score += 2;
        matchedSignals.push(`contact:${contact.full_name}`);
      }
    }

    if (score > 0) {
      scores.push({ workspaceId: ws.id, score, signals: matchedSignals });
    }
  }

  if (scores.length === 0) return null;

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];

  // Require minimum score of 3 (at least one account/deal name match)
  if (top.score < 3) return null;

  // Require clear winner (top score >= 2x second, or no second)
  if (second && top.score < second.score * 2) return null;

  console.log(
    `[Tier3] Call "${call.title}" → ${top.workspaceId} ` +
    `(score: ${top.score}, signals: ${top.signals.join(', ')})`
  );

  return {
    workspaceId: top.workspaceId,
    method: 'transcript_scan',
    confidence: Math.min(0.7 + (top.score * 0.03), 0.9),
    tier: 'tier3',
  };
}

// ---------------------------------------------------------------------------
// Assignment + Workspace Wiring
// ---------------------------------------------------------------------------

export async function assignCallToWorkspace(
  conversationId: string,
  workspaceId: string,
  method: string,
  confidence: number,
  assignedBy: string = 'auto'
): Promise<void> {
  // 1. Move conversation into the workspace
  await query(
    `UPDATE conversations
     SET workspace_id = $1, source_type = 'consultant'
     WHERE id = $2`,
    [workspaceId, conversationId]
  );

  // 2. Update assignment record
  await query(
    `UPDATE consultant_call_assignments
     SET workspace_id = $1, assignment_method = $2,
         assignment_confidence = $3, assigned_at = NOW(), assigned_by = $4
     WHERE conversation_id = $5`,
    [workspaceId, method, confidence, assignedBy, conversationId]
  );

  // 3. Run cross-entity linker to connect to accounts/deals within the workspace
  //    Fire and forget — don't block assignment on linking
  try {
    const { linkConversations } = await import('../linker/entity-linker.js');
    linkConversations(workspaceId)
      .then((r: any) => console.log(`[ConsultantDistributor] Linked in ${workspaceId}: T1=${r.linked.tier1_email} T2=${r.linked.tier2_native} T3=${r.linked.tier3_inferred}`))
      .catch((e: any) => console.error(`[ConsultantDistributor] Linker error:`, e.message));
  } catch (err: any) {
    console.error('[ConsultantDistributor] Could not trigger linker:', err.message);
  }

  // 4. Extract signals for the newly assigned call (10s delay — let linker finish)
  setTimeout(() => {
    import('../conversations/signal-extractor.js').then(({ extractConversationSignals }) => {
      extractConversationSignals(workspaceId, { limit: 5 })
        .catch((e: any) => console.error(`[ConsultantDistributor] Signal extraction error:`, e.message));
    }).catch(() => {});
  }, 10000);
}

export async function skipCall(
  conversationId: string,
  reason: string = 'irrelevant'
): Promise<void> {
  await query(
    `UPDATE consultant_call_assignments
     SET skipped = TRUE, skip_reason = $1
     WHERE conversation_id = $2`,
    [reason, conversationId]
  );
}

// ---------------------------------------------------------------------------
// Candidate Collection (for triage UI)
// ---------------------------------------------------------------------------

async function collectCandidates(
  call: any,
  workspaces: Array<{ id: string; name: string }>,
  consultantEmail: string | null
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  // Check emails loosely
  const emails = extractParticipantEmails(call.participants);
  const filteredEmails = consultantEmail
    ? emails.filter(e => e !== consultantEmail.toLowerCase())
    : emails;

  for (const ws of workspaces) {
    if (filteredEmails.length > 0) {
      const result = await query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM contacts
         WHERE workspace_id = $1 AND LOWER(email) = ANY($2::text[])`,
        [ws.id, filteredEmails]
      );
      if (parseInt(result.rows[0]?.cnt || '0') > 0) {
        candidates.push({
          workspace_id: ws.id,
          workspace_name: ws.name,
          score: 5,
          reason: 'Participant email matches a contact',
        });
      }
    }
  }

  // Check workspace names in call title
  const titleLower = (call.title || '').toLowerCase();
  for (const ws of workspaces) {
    if (ws.name.length > 3 && titleLower.includes(ws.name.toLowerCase())) {
      candidates.push({
        workspace_id: ws.id,
        workspace_name: ws.name,
        score: 3,
        reason: 'Workspace name mentioned in call title',
      });
    }
  }

  // Deduplicate by workspace_id, keeping highest score
  const deduped = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!deduped.has(c.workspace_id) || deduped.get(c.workspace_id)!.score < c.score) {
      deduped.set(c.workspace_id, c);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractParticipantEmails(participants: any): string[] {
  if (!participants) return [];

  const emails: string[] = [];
  const participantList = Array.isArray(participants) ? participants : [];

  for (const p of participantList) {
    const email = p.email || p.emailAddress || p.email_address;
    if (email && typeof email === 'string' && email.includes('@')) {
      emails.push(email.toLowerCase().trim());
    }
  }

  return [...new Set(emails)];
}

function extractAttendeesEmails(attendees: any): string[] {
  if (!attendees) return [];

  const emails: string[] = [];
  const list = Array.isArray(attendees) ? attendees : [];

  for (const a of list) {
    const email = typeof a === 'string' ? a : a?.email || a?.emailAddress;
    if (email && typeof email === 'string' && email.includes('@')) {
      emails.push(email.toLowerCase().trim());
    }
  }

  return [...new Set(emails)];
}
