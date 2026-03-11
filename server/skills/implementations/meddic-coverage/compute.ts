/**
 * MEDDIC Coverage — Compute Phase
 *
 * Assembles the full activity corpus for a deal:
 * - Calls with transcripts
 * - Emails
 * - CRM notes
 *
 * Applies bookend pattern if > 10 calls (earliest 2 + most recent 8).
 * Implements data sufficiency gate.
 */

import { query } from '../../../db.js';
import { getMethodologyConfigResolver } from '../../../methodology/config-resolver.js';
import type { MergedMethodologyConfig } from '../../../methodology/config-resolver.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('meddic-coverage-compute');

export interface ActivitySource {
  id: string;
  date: string;
  source_type: 'call' | 'email' | 'note';
  content: string;
  metadata: Record<string, any>;
}

export interface DealMetadata {
  id: string;
  name: string;
  stage: string;
  stage_normalized: string;
  age_days: number;
  owner_id: string;
  owner_name: string;
  close_date: string | null;
  amount: number | null;
  workspace_id: string;
}

export interface CorpusData {
  deal: DealMetadata;
  methodology: MergedMethodologyConfig;
  activities: ActivitySource[];
  corpus_stats: {
    total_calls: number;
    total_emails: number;
    total_notes: number;
    calls_kept: number;
    emails_kept: number;
    notes_kept: number;
    bookend_applied: boolean;
  };
  limited_evidence: boolean;
  insufficient_data: boolean;
  insufficient_data_reason?: string;
}

/**
 * Assemble full activity corpus for a deal
 */
export async function assembleCorpus(
  workspaceId: string,
  dealId: string
): Promise<CorpusData> {
  logger.info('Assembling corpus for deal', { workspaceId, dealId });

  // Fetch deal metadata
  const deal = await fetchDealMetadata(workspaceId, dealId);
  if (!deal) {
    throw new Error(`Deal not found: ${dealId}`);
  }

  // Fetch methodology config
  const resolver = getMethodologyConfigResolver();
  const resolvedConfig = await resolver.resolve(workspaceId, {
    segment: deal.stage_normalized,
  });
  const methodology = await resolver.getMergedConfig(resolvedConfig.id);

  // Fetch activities
  const calls = await fetchCalls(workspaceId, dealId);
  const emails = await fetchEmails(workspaceId, dealId);
  const notes = await fetchNotes(workspaceId, dealId);

  logger.info('Raw corpus counts', {
    calls: calls.length,
    emails: emails.length,
    notes: notes.length,
  });

  // Apply data sufficiency gate
  const insufficientData = calls.length === 0 && emails.length === 0;
  const limitedEvidence = calls.length < 2;

  if (insufficientData) {
    logger.warn('Insufficient data for MEDDIC coverage analysis', {
      dealId,
      calls: calls.length,
      emails: emails.length,
    });

    return {
      deal,
      methodology,
      activities: [],
      corpus_stats: {
        total_calls: calls.length,
        total_emails: emails.length,
        total_notes: notes.length,
        calls_kept: 0,
        emails_kept: 0,
        notes_kept: 0,
        bookend_applied: false,
      },
      limited_evidence: false,
      insufficient_data: true,
      insufficient_data_reason: 'No calls or emails found for this deal',
    };
  }

  // Apply bookend pattern if > 10 calls
  let keptCalls = calls;
  let bookendApplied = false;

  if (calls.length > 10) {
    keptCalls = [
      ...calls.slice(0, 2),  // earliest 2
      ...calls.slice(-8),    // most recent 8
    ];
    bookendApplied = true;
    logger.info('Applied bookend pattern', {
      original: calls.length,
      kept: keptCalls.length,
    });
  }

  // Combine all activities in chronological order
  const activities: ActivitySource[] = [
    ...keptCalls,
    ...emails,
    ...notes,
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return {
    deal,
    methodology,
    activities,
    corpus_stats: {
      total_calls: calls.length,
      total_emails: emails.length,
      total_notes: notes.length,
      calls_kept: keptCalls.length,
      emails_kept: emails.length,
      notes_kept: notes.length,
      bookend_applied,
    },
    limited_evidence: limitedEvidence,
    insufficient_data: false,
  };
}

/**
 * Fetch deal metadata
 */
async function fetchDealMetadata(
  workspaceId: string,
  dealId: string
): Promise<DealMetadata | null> {
  const result = await query<any>(
    `SELECT
      d.id,
      d.name,
      d.stage,
      d.stage_normalized,
      EXTRACT(DAY FROM NOW() - d.created_at)::int AS age_days,
      d.owner_id,
      u.name AS owner_name,
      d.close_date,
      d.amount,
      d.workspace_id
    FROM deals d
    LEFT JOIN users u ON u.id = d.owner_id
    WHERE d.id = $1 AND d.workspace_id = $2`,
    [dealId, workspaceId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Fetch calls with transcripts
 */
async function fetchCalls(
  workspaceId: string,
  dealId: string
): Promise<ActivitySource[]> {
  const result = await query<any>(
    `SELECT
      c.id,
      c.call_date,
      c.duration_seconds,
      c.participants,
      c.transcript_summary,
      c.sentiment_score,
      c.topics
    FROM conversations c
    WHERE c.deal_id = $1
      AND c.workspace_id = $2
      AND c.transcript_summary IS NOT NULL
    ORDER BY c.call_date ASC`,
    [dealId, workspaceId]
  );

  return result.rows.map(row => ({
    id: row.id,
    date: row.call_date,
    source_type: 'call' as const,
    content: row.transcript_summary,
    metadata: {
      duration_seconds: row.duration_seconds,
      participants: row.participants,
      sentiment_score: row.sentiment_score,
      topics: row.topics,
    },
  }));
}

/**
 * Fetch emails
 */
async function fetchEmails(
  workspaceId: string,
  dealId: string
): Promise<ActivitySource[]> {
  const result = await query<any>(
    `SELECT
      a.id,
      a.activity_date,
      a.subject,
      a.body_text,
      a.direction,
      a.contact_email
    FROM activities a
    WHERE a.deal_id = $1
      AND a.workspace_id = $2
      AND a.activity_type = 'email'
      AND a.body_text IS NOT NULL
    ORDER BY a.activity_date ASC`,
    [dealId, workspaceId]
  );

  return result.rows.map(row => ({
    id: row.id,
    date: row.activity_date,
    source_type: 'email' as const,
    content: row.body_text,
    metadata: {
      subject: row.subject,
      direction: row.direction,
      contact_email: row.contact_email,
    },
  }));
}

/**
 * Fetch CRM notes
 */
async function fetchNotes(
  workspaceId: string,
  dealId: string
): Promise<ActivitySource[]> {
  const result = await query<any>(
    `SELECT
      n.id,
      n.created_at,
      n.body,
      n.created_by
    FROM deal_notes n
    WHERE n.deal_id = $1
      AND n.workspace_id = $2
    ORDER BY n.created_at ASC`,
    [dealId, workspaceId]
  );

  return result.rows.map(row => ({
    id: row.id,
    date: row.created_at,
    source_type: 'note' as const,
    content: row.body,
    metadata: {
      created_by: row.created_by,
    },
  }));
}
