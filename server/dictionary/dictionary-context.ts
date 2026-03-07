import { query } from '../db.js';

const cache = new Map<string, { context: string; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches data dictionary context for a workspace with caching.
 * Returns a formatted <workspace_terminology> block for inclusion in system prompts.
 *
 * The result is cached for 5 minutes to avoid repeated database queries.
 */
export async function getDictionaryContext(workspaceId: string): Promise<string> {
  const cached = cache.get(workspaceId);
  if (cached && cached.expires > Date.now()) {
    return cached.context;
  }

  const context = await fetchDictionaryContext(workspaceId);
  cache.set(workspaceId, { context, expires: Date.now() + CACHE_TTL });
  return context;
}

async function fetchDictionaryContext(workspaceId: string): Promise<string> {
  try {
    const result = await query<{ term: string; definition: string }>(
      `SELECT term, definition
       FROM data_dictionary
       WHERE workspace_id = $1 AND is_active = TRUE
       ORDER BY term ASC
       LIMIT 50`,
      [workspaceId]
    );

    if (result.rows.length === 0) return '';

    return (
      '\n<workspace_terminology>\n' +
      result.rows.map((r) => `${r.term}: ${r.definition}`).join('\n') +
      '\n</workspace_terminology>'
    );
  } catch (err) {
    console.warn('[dictionary-context] Failed to fetch dictionary:', err);
    return '';
  }
}
