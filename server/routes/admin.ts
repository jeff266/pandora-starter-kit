import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { retroAccuracyBootstrap } from '../jobs/retro-accuracy-bootstrap.js';

const router = Router();

router.post(
  '/:workspaceId/admin/retro-accuracy-bootstrap',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    try {
      console.log(`[Admin] Retro accuracy bootstrap triggered for workspace ${workspaceId}`);
      const result = await retroAccuracyBootstrap(workspaceId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[Admin] Retro accuracy bootstrap failed:', err?.message);
      res.status(500).json({ error: 'Bootstrap failed', message: err?.message });
    }
  }
);

export default router;
