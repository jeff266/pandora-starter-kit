import { Router, type Request, type Response } from 'express';
import { linkConversations, getLinkerStatus } from '../linker/entity-linker.js';

const router = Router();

interface WorkspaceParams {
  id: string;
}

router.post('/:id/linker/run', async (req: Request<WorkspaceParams>, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    console.log(`[Linker Route] Manual run for workspace ${workspaceId}`);
    const result = await linkConversations(workspaceId);

    const totalLinked = result.linked.tier1_email + result.linked.tier2_native + result.linked.tier3_inferred;
    console.log(`[Linker Route] Done: ${totalLinked} linked, ${result.stillUnlinked} unlinked (${result.durationMs}ms)`);

    res.json(result);
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
    res.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Linker Route] Status error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
