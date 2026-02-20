import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { getSalesRoster } from '../connectors/shared/tracked-users.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

router.get('/:workspaceId/sales-roster', requirePermission('data.reps_view_all'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const roster = await getSalesRoster(workspaceId);
    res.json(roster);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sales Roster] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
