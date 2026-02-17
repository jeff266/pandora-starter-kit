/**
 * Transcript Search
 *
 * Full-text search over call transcript content. Used by the chat
 * `search_call_transcripts` tool to answer questions that require
 * exact quotes or detailed transcript context beyond the pre-extracted signals.
 */

import { query } from '../db.js';

export interface TranscriptSearchResult {
  id: string;
  title: string | null;
  call_date: string | null;
  deal_name: string | null;
  account_name: string | null;
  summary: string | null;
  excerpt: string;
  participants: any;
}

export async function searchTranscripts(
  workspaceId: string,
  searchQuery: string,
  options?: {
    account_name?: string;
    deal_name?: string;
    limit?: number;
  }
): Promise<TranscriptSearchResult[]> {
  const conditions: string[] = [
    `c.workspace_id = $1`,
    `c.is_internal = FALSE`,
    `c.source_type IS DISTINCT FROM 'consultant'`,
  ];
  const params: any[] = [workspaceId];
  let paramIdx = 2;

  // Filter by account/deal if specified
  if (options?.account_name) {
    conditions.push(`a.name ILIKE $${paramIdx}`);
    params.push(`%${options.account_name}%`);
    paramIdx++;
  }

  if (options?.deal_name) {
    conditions.push(`d.name ILIKE $${paramIdx}`);
    params.push(`%${options.deal_name}%`);
    paramIdx++;
  }

  // Full-text match: search in transcript, summary, or title
  conditions.push(`(
    (c.transcript_text IS NOT NULL AND c.transcript_text ILIKE $${paramIdx}) OR
    (c.summary IS NOT NULL AND c.summary ILIKE $${paramIdx}) OR
    (c.title IS NOT NULL AND c.title ILIKE $${paramIdx})
  )`);
  params.push(`%${searchQuery}%`);
  paramIdx++;

  const limitVal = options?.limit ?? 5;

  const results = await query<{
    id: string;
    title: string | null;
    call_date: string | null;
    transcript_text: string | null;
    summary: string | null;
    participants: any;
    deal_name: string | null;
    account_name: string | null;
  }>(
    `SELECT c.id, c.title, c.call_date, c.transcript_text, c.summary,
            c.participants, d.name as deal_name, a.name as account_name
     FROM conversations c
     LEFT JOIN deals d ON c.deal_id = d.id
     LEFT JOIN accounts a ON c.account_id = a.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.call_date DESC NULLS LAST
     LIMIT $${paramIdx}`,
    [...params, limitVal]
  );

  return results.rows.map(row => ({
    id: row.id,
    title: row.title,
    call_date: row.call_date,
    deal_name: row.deal_name,
    account_name: row.account_name,
    summary: row.summary,
    excerpt: extractExcerpt(row.transcript_text || row.summary || '', searchQuery, 600),
    participants: row.participants,
  }));
}

function extractExcerpt(text: string, searchQuery: string, contextChars: number): string {
  if (!text) return '';

  const lowerText = text.toLowerCase();
  const lowerQuery = searchQuery.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    // Query not found verbatim — return beginning of text
    return text.substring(0, contextChars) + (text.length > contextChars ? '...' : '');
  }

  const half = Math.floor(contextChars / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(text.length, index + searchQuery.length + half);

  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt = excerpt + '...';

  return excerpt;
}
