import { Router, type Request, type Response } from 'express';
import { linkConversations, getLinkerStatus } from '../linker/entity-linker.js';
import {
  classifyAndUpdateInternalStatus,
  getInternalMeetingStats,
} from '../analysis/conversation-internal-filter.js';
import {
  findConversationsWithoutDeals,
  getTopCWDConversations,
  getCWDByRep,
} from '../analysis/conversation-without-deals.js';

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
    console.log(`[Linker Route] Done: ${totalLinked} linked, ${linkResult.stillUnlinked} unlinked (${linkResult.durationMs}ms)`);

    const classifyResult = await classifyAndUpdateInternalStatus(workspaceId);
    console.log(`[Linker Route] Internal filter: ${classifyResult.markedInternal} internal, ${classifyResult.markedExternal} external (${classifyResult.durationMs}ms)`);

    res.json({
      linker: linkResult,
      internalFilter: classifyResult,
    });
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

router.get('/:id/conversations-without-deals', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const daysBack = parseInt(req.query.days_back as string, 10) || 90;

  try {
    const cwdResult = await findConversationsWithoutDeals(workspaceId, daysBack);
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
      all_conversations: cwdResult.conversations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CWD Route] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
