import { Router, type Request, type Response } from 'express';
import { captureGoalSnapshots } from '../goals/snapshot-engine.js';
import { query } from '../db.js';

const router = Router({ mergeParams: true });

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const { from, to } = req.query as Record<string, string>;

    const conditions: string[] = ['gs.workspace_id = $1'];
    const params: any[] = [workspaceId];
    let idx = 2;

    if (from) {
      conditions.push(`gs.snapshot_date >= $${idx}`);
      params.push(from);
      idx++;
    }
    if (to) {
      conditions.push(`gs.snapshot_date <= $${idx}`);
      params.push(to);
      idx++;
    }

    const result = await query(
      `SELECT gs.*, g.label as goal_label, g.metric_type, g.target_value, g.period
       FROM goal_snapshots gs
       JOIN goals g ON g.id = gs.goal_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY gs.snapshot_date DESC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GoalSnapshots] List error:', err);
    res.status(500).json({ error: 'Failed to list goal snapshots' });
  }
});

router.post('/capture', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const captured = await captureGoalSnapshots(workspaceId);
    res.json({ captured });
  } catch (err) {
    console.error('[GoalSnapshots] Capture error:', err);
    res.status(500).json({ error: 'Failed to capture goal snapshots' });
  }
});

export default router;
