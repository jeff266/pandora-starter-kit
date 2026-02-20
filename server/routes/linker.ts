import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { linkConversations, getLinkerStatus } from '../linker/entity-linker.js';
import {
  classifyAndUpdateInternalStatus,
  getInternalMeetingStats,
  resolveWorkspaceDomains,
} from '../analysis/conversation-internal-filter.js';
import {
  findConversationsWithoutDeals,
  getTopCWDConversations,
  getCWDByRep,
} from '../analysis/conversation-without-deals.js';
import { query } from '../db.js';

const router = Router();

interface WorkspaceParams {
  id: string;
}

router.post('/:id/linker/run', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    console.log(`[Linker Route] Manual run for workspace ${workspaceId}`);
    const linkResult = await linkConversations(workspaceId);

    const totalLinked = linkResult.linked.tier1_email + linkResult.linked.tier2_native + linkResult.linked.tier3_inferred;
    console.log(`[Linker Route] Done: ${totalLinked} linked, ${linkResult.internalFiltered} internal, ${linkResult.stillUnlinked} unlinked (${linkResult.durationMs}ms)`);

    res.json(linkResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Linker Route] Error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:id/linker/status', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    const status = await getLinkerStatus(workspaceId);
    const internalStats = await getInternalMeetingStats(workspaceId);
    res.json({ ...status, internalFilter: internalStats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Linker Route] Status error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:id/internal-filter/run', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    console.log(`[InternalFilter Route] Manual run for workspace ${workspaceId}`);
    const result = await classifyAndUpdateInternalStatus(workspaceId);
    console.log(`[InternalFilter Route] Done: ${result.markedInternal} internal, ${result.markedExternal} external (${result.durationMs}ms)`);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[InternalFilter Route] Error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:id/internal-filter/stats', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    const stats = await getInternalMeetingStats(workspaceId);
    res.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[InternalFilter Route] Stats error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:id/config/internal-domains', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    const resolved = await resolveWorkspaceDomains(workspaceId);

    const statsResult = await query<{
      total: number;
      classified_internal: number;
      classified_external: number;
      unclassified: number;
    }>(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE is_internal = TRUE)::int as classified_internal,
        COUNT(*) FILTER (WHERE is_internal = FALSE)::int as classified_external,
        COUNT(*) FILTER (WHERE is_internal IS NULL)::int as unclassified
      FROM conversations
      WHERE workspace_id = $1`,
      [workspaceId]
    );

    const stats = statsResult.rows[0] || { total: 0, classified_internal: 0, classified_external: 0, unclassified: 0 };

    res.json({
      domains: resolved.domains,
      source: resolved.source,
      conversation_stats: stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config] Internal domains error:', message);
    res.status(500).json({ error: message });
  }
});

router.put('/:id/config/internal-domains', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    const { domains } = req.body;
    if (!Array.isArray(domains)) {
      res.status(400).json({ error: 'domains must be an array of strings' });
      return;
    }

    const validDomains = domains.filter((d: any) => typeof d === 'string' && d.length > 0).map((d: string) => d.toLowerCase());

    const existing = await query<{ id: string; definitions: any }>(
      `SELECT id, definitions FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    if (existing.rows.length > 0) {
      const definitions = existing.rows[0].definitions || {};
      definitions.internal_domains = validDomains;
      await query(
        `UPDATE context_layer SET definitions = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(definitions), existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO context_layer (workspace_id, definitions) VALUES ($1, $2)`,
        [workspaceId, JSON.stringify({ internal_domains: validDomains })]
      );
    }

    await query(
      `UPDATE conversations SET is_internal = NULL, internal_classification_reason = NULL WHERE workspace_id = $1`,
      [workspaceId]
    );

    const reclassifyCount = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM conversations WHERE workspace_id = $1`,
      [workspaceId]
    );

    res.json({
      success: true,
      domains: validDomains,
      conversations_to_reclassify: parseInt(reclassifyCount.rows[0].count, 10),
      message: 'Domains saved. All conversations reset for re-classification on next linker run.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config] Set internal domains error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:id/conversations-without-deals', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const daysBack = parseInt(req.query.days_back as string, 10) || 90;
  const severity = req.query.severity as string | undefined;
  const rep = req.query.rep as string | undefined;
  const limit = parseInt(req.query.limit as string, 10) || 50;

  try {
    const cwdResult = await findConversationsWithoutDeals(workspaceId, daysBack);
    let conversations = cwdResult.conversations;

    if (severity) {
      conversations = conversations.filter(c => c.severity === severity);
    }
    if (rep) {
      conversations = conversations.filter(c => c.rep_email === rep);
    }
    conversations = conversations.slice(0, limit);

    const topConversations = getTopCWDConversations(cwdResult.conversations, 10);
    const byRepMap = getCWDByRep(cwdResult.conversations);

    const byRep = Array.from(byRepMap.entries()).map(([email, data]) => ({
      rep_email: email,
      rep_name: data.rep_name,
      cwd_count: data.cwd_count,
      high_severity_count: data.high_severity_count,
    }));

    res.json({
      summary: cwdResult.summary,
      top_conversations: topConversations,
      by_rep: byRep,
      conversations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CWD Route] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
