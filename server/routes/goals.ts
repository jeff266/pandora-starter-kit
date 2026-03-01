import { Router, type Request, type Response } from 'express';
import { goalService } from '../goals/goal-service.js';
import { query } from '../db.js';

const router = Router({ mergeParams: true });

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const { motion_id, level, period_start } = req.query as Record<string, string>;
    const goals = await goalService.list(workspaceId, { motion_id, level, period_start });
    res.json(goals);
  } catch (err) {
    console.error('[Goals] List error:', err);
    res.status(500).json({ error: 'Failed to list goals' });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const { metric_type, label, level, owner_type, owner_id, target_value, period, period_start, period_end } = req.body;
    if (!metric_type || !label || !level || !owner_type || !owner_id || target_value == null || !period || !period_start || !period_end) {
      res.status(400).json({ error: 'metric_type, label, level, owner_type, owner_id, target_value, period, period_start, period_end are required' });
      return;
    }
    const goal = await goalService.create(workspaceId, { ...req.body, workspace_id: workspaceId });
    res.status(201).json(goal);
  } catch (err) {
    console.error('[Goals] Create error:', err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

router.get('/:goalId/tree', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, goalId } = req.params as { workspaceId: string; goalId: string };
    const tree = await goalService.getTree(workspaceId, goalId);
    res.json(tree);
  } catch (err) {
    console.error('[Goals] Tree error:', err);
    res.status(500).json({ error: 'Failed to get goal tree' });
  }
});

router.post('/:goalId/infer-downstream', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, goalId } = req.params as { workspaceId: string; goalId: string };
    const goals = await goalService.inferDownstreamGoals(workspaceId, goalId);
    res.status(201).json(goals);
  } catch (err) {
    console.error('[Goals] Infer downstream error:', err);
    res.status(500).json({ error: 'Failed to infer downstream goals' });
  }
});

router.get('/:goalId/current', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, goalId } = req.params as { workspaceId: string; goalId: string };
    const goal = await goalService.getById(goalId);
    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }
    const current = await goalService.computeCurrentValue(workspaceId, goal);
    res.json(current);
  } catch (err) {
    console.error('[Goals] Current value error:', err);
    res.status(500).json({ error: 'Failed to compute current value' });
  }
});

router.get('/:goalId/trend', async (req: Request, res: Response): Promise<void> => {
  try {
    const { goalId } = req.params as { goalId: string };
    const snaps = await query(
      `SELECT * FROM goal_snapshots WHERE goal_id = $1 ORDER BY snapshot_date DESC LIMIT 90`,
      [goalId],
    );
    res.json(snaps.rows);
  } catch (err) {
    console.error('[Goals] Trend error:', err);
    res.status(500).json({ error: 'Failed to get trend data' });
  }
});

router.put('/:goalId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { goalId } = req.params as { goalId: string };
    const goal = await goalService.update(goalId, req.body);
    res.json(goal);
  } catch (err) {
    console.error('[Goals] Update error:', err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

router.delete('/:goalId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { goalId } = req.params as { goalId: string };
    await goalService.softDelete(goalId);
    res.status(204).end();
  } catch (err) {
    console.error('[Goals] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

export default router;
