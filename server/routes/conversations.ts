/**
 * Conversations API
 *
 * Signal extraction endpoints — backfill, status, and manual re-extraction.
 *
 * Mounted under /api/workspaces/:workspaceId (via workspaceApiRouter)
 */

import { Router, type Request, type Response } from 'express';
import { extractConversationSignals } from '../conversations/signal-extractor.js';
import { query } from '../db.js';

const router = Router({ mergeParams: true });

/**
 * POST /api/workspaces/:workspaceId/conversations/extract-signals
 *
 * Trigger signal extraction for unprocessed conversations.
 * Pass `force: true` to re-extract already-extracted conversations (backfill).
 *
 * Body: { force?: boolean, limit?: number }
 */
router.post('/conversations/extract-signals', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const force = req.body.force === true;
    const limit = typeof req.body.limit === 'number' ? req.body.limit : 100;

    const result = await extractConversationSignals(workspaceId, { force, limit });

    res.json({
      ...result,
      message: `${result.extracted} conversations extracted, ${result.skipped} skipped`,
    });
  } catch (err) {
    console.error('[ConversationSignals]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/conversations/signal-status
 *
 * Returns extraction coverage stats.
 */
router.get('/conversations/signal-status', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };

    const [countRow, statsRow, lastExtractionRow] = await Promise.all([
      // Total counts and extracted
      query<{
        total: string;
        extracted: string;
        pending: string;
        pricing_count: string;
        competitor_count: string;
        risk_count: string;
      }>(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE signals_extracted_at IS NOT NULL) as extracted,
           COUNT(*) FILTER (WHERE signals_extracted_at IS NULL
             AND (summary IS NOT NULL OR transcript_text IS NOT NULL)) as pending,
           COUNT(*) FILTER (WHERE pricing_discussed = TRUE) as pricing_count,
           COUNT(*) FILTER (
             WHERE competitive_context IS NOT NULL
               AND competitive_context != '{}'::jsonb
               AND (competitive_context->>'evaluating_others')::boolean = TRUE
           ) as competitor_count,
           COUNT(*) FILTER (WHERE risk_signals IS NOT NULL AND risk_signals != '[]'::jsonb) as risk_count
         FROM conversations
         WHERE workspace_id = $1
           AND is_internal = FALSE
           AND source_type IS DISTINCT FROM 'consultant'`,
        [workspaceId]
      ),

      // Disposition and engagement breakdown
      query<{ call_disposition: string | null; engagement_quality: string | null; cnt: string }>(
        `SELECT call_disposition, engagement_quality, COUNT(*) as cnt
         FROM conversations
         WHERE workspace_id = $1
           AND signals_extracted_at IS NOT NULL
           AND is_internal = FALSE
         GROUP BY call_disposition, engagement_quality`,
        [workspaceId]
      ),

      // Last extraction timestamp and version
      query<{ signals_extracted_at: string; signals_extraction_version: string }>(
        `SELECT signals_extracted_at, signals_extraction_version
         FROM conversations
         WHERE workspace_id = $1 AND signals_extracted_at IS NOT NULL
         ORDER BY signals_extracted_at DESC LIMIT 1`,
        [workspaceId]
      ),
    ]);

    const r = countRow.rows[0] || { total: '0', extracted: '0', pending: '0', pricing_count: '0', competitor_count: '0', risk_count: '0' };

    // Build disposition and engagement breakdowns
    const by_disposition: Record<string, number> = {};
    const by_engagement: Record<string, number> = {};
    for (const row of statsRow.rows) {
      if (row.call_disposition) {
        by_disposition[row.call_disposition] = (by_disposition[row.call_disposition] || 0) + parseInt(row.cnt);
      }
      if (row.engagement_quality) {
        by_engagement[row.engagement_quality] = (by_engagement[row.engagement_quality] || 0) + parseInt(row.cnt);
      }
    }

    res.json({
      total_conversations: parseInt(r.total),
      extracted: parseInt(r.extracted),
      pending: parseInt(r.pending),
      extraction_version: lastExtractionRow.rows[0]?.signals_extraction_version || null,
      last_extraction: lastExtractionRow.rows[0]?.signals_extracted_at || null,
      pricing_discussed_count: parseInt(r.pricing_count),
      competitors_mentioned_count: parseInt(r.competitor_count),
      risk_signals_count: parseInt(r.risk_count),
      by_disposition,
      by_engagement,
    });
  } catch (err) {
    console.error('[ConversationSignalStatus]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
