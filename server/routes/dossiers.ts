import { Router, type Request, type Response } from 'express';
import { assembleDealDossier } from '../dossiers/deal-dossier.js';
import { assembleAccountDossier } from '../dossiers/account-dossier.js';

const router = Router();

router.get('/:workspaceId/deals/:dealId/dossier', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, dealId } = req.params;
    const dossier = await assembleDealDossier(workspaceId, dealId);
    res.json(dossier);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }
    console.error('[dossiers] Deal dossier error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/accounts/:accountId/dossier', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, accountId } = req.params;
    const dossier = await assembleAccountDossier(workspaceId, accountId);
    res.json(dossier);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }
    console.error('[dossiers] Account dossier error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
