/**
 * Google Docs Feedback Loop
 *
 * Reads back exported Google Docs to detect human edits and use them
 * to inform subsequent report generation.
 */

import { query } from '../db.js';
import { GoogleDriveClient, type GoogleDriveCredentials } from '../connectors/google-drive/client.js';
import { getCredentials } from '../connectors/adapters/credentials.js';
import { callLLM } from '../utils/llm-router.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('GoogleDocsFeedback');

export interface DocFeedback {
  doc_id: string;
  original_export: string;    // what was exported
  current_content: string;    // what the doc contains now
  diff_summary: string;       // Claude-generated summary of changes
  has_meaningful_changes: boolean;
  word_count_delta: number;
}

/**
 * Fast approximate change ratio between two strings.
 * Compares first 5000 characters to avoid large memory allocation on long docs.
 * Returns a ratio 0.0–1.0 where 0 = identical, 1 = completely different.
 */
function changeRatio(a: string, b: string): number {
  const aShort = a.slice(0, 5000);
  const bShort = b.slice(0, 5000);
  const maxLen = Math.max(aShort.length, bShort.length);
  if (maxLen === 0) return 0;
  let diffs = 0;
  const minLen = Math.min(aShort.length, bShort.length);
  for (let i = 0; i < minLen; i++) {
    if (aShort[i] !== bShort[i]) diffs++;
  }
  diffs += Math.abs(aShort.length - bShort.length);
  return diffs / maxLen;
}

/**
 * Read back a Google Doc to detect human edits since export.
 * Returns null if:
 * - Document was never exported to Google Docs
 * - Google Drive is not connected
 * - Export/read fails
 */
export async function readGoogleDocFeedback(
  workspaceId: string,
  documentId: string
): Promise<DocFeedback | null> {
  try {
    // 1. Load report_documents row — check google_doc_id exists
    const docResult = await query<{
      google_doc_id: string;
      google_doc_url: string;
      google_doc_original_text: string;
    }>(
      `SELECT google_doc_id, google_doc_url, google_doc_original_text
       FROM report_documents
       WHERE id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );

    if (docResult.rows.length === 0) {
      logger.warn('Document not found', { documentId, workspaceId });
      return null;
    }

    const doc = docResult.rows[0];

    if (!doc.google_doc_id) {
      logger.info('Document never exported to Google Docs', { documentId });
      return null;
    }

    if (!doc.google_doc_original_text) {
      logger.warn('Original text not stored — cannot compute diff', { documentId });
      return null;
    }

    // 2. Get Google Drive credentials for workspace
    const conn = await getCredentials(workspaceId, 'google-drive');
    if (!conn) {
      logger.info('Google Drive not connected', { workspaceId });
      return null;
    }

    // 3. Read current doc content via Drive API export
    const client = new GoogleDriveClient();
    const currentText = await client.exportDocument(
      conn.credentials as GoogleDriveCredentials,
      doc.google_doc_id
    );

    // 4. Update google_doc_last_read_at
    await query(
      `UPDATE report_documents
       SET google_doc_last_read_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );

    // 5. Compute diff
    const original = doc.google_doc_original_text;
    const originalWords = original.split(/\s+/).length;
    const currentWords = currentText.split(/\s+/).length;
    const wordDelta = currentWords - originalWords;

    // Change ratio > 5% = meaningful changes
    const ratio = changeRatio(original, currentText);
    const hasMeaningfulChanges = ratio > 0.05;

    let diffSummary = 'No significant changes detected.';

    // 6. If meaningful changes, call Claude to summarize the diff
    if (hasMeaningfulChanges) {
      try {
        const systemPrompt = `The following two versions of a RevOps report exist.

Original (machine-generated):
${original.slice(0, 3000)}

Current (human-edited):
${currentText.slice(0, 3000)}

Summarize what the human changed in 3-5 bullet points.
Focus on: sections removed, sections added, tone changes, numbers corrected, emphasis shifts.
Be specific. Under 150 words.`;

        const response = await callLLM(workspaceId, 'generate', {
          systemPrompt,
          messages: [{ role: 'user', content: 'Summarize the changes made to this report.' }],
          maxTokens: 250,
          temperature: 0.3,
        });

        diffSummary = response.content.trim();
      } catch (err) {
        logger.error('Failed to generate diff summary', { error: err instanceof Error ? err.message : String(err) });
        diffSummary = `Changes detected (${Math.round(ratio * 100)}% of content modified) but summary generation failed.`;
      }
    }

    logger.info('Google Doc feedback collected', {
      documentId,
      wordDelta,
      changeRatio: Math.round(ratio * 100) + '%',
      hasMeaningfulChanges,
    });

    // 7. Return DocFeedback object
    return {
      doc_id: doc.google_doc_id,
      original_export: original,
      current_content: currentText,
      diff_summary: diffSummary,
      has_meaningful_changes: hasMeaningfulChanges,
      word_count_delta: wordDelta,
    };
  } catch (err) {
    logger.error('Failed to read Google Doc feedback', err instanceof Error ? err : undefined);
    return null;
  }
}
