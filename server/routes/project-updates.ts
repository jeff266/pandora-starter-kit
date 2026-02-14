import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

// POST /api/workspaces/:workspaceId/project-updates
// Upsert project updates for a given week
router.post('/:workspaceId/project-updates', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { week_of, updates, notes } = req.body;

  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates is required and must be an array' });
  }

  // Auto-set week_of to Monday of current week if not provided
  const weekDate = week_of || getMondayOfWeek(new Date()).toISOString().split('T')[0];

  try {
    const result = await query(
      `INSERT INTO project_updates (workspace_id, week_of, updates, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, week_of) DO UPDATE SET
         updates = $3,
         notes = $4,
         updated_at = now()
       RETURNING *`,
      [workspaceId, weekDate, JSON.stringify(updates), notes || null]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[ProjectUpdates] Error saving update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workspaces/:workspaceId/project-updates
// Get updates for a specific week (defaults to current week)
router.get('/:workspaceId/project-updates', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const weekOf = req.query.week_of as string || getMondayOfWeek(new Date()).toISOString().split('T')[0];

  try {
    const result = await query(
      `SELECT * FROM project_updates WHERE workspace_id = $1 AND week_of = $2`,
      [workspaceId, weekOf]
    );
    if (result.rows.length === 0) {
      return res.json({ message: 'No project updates for this week', week_of: weekOf });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workspaces/:workspaceId/project-updates/latest
// Get the most recent update regardless of week
router.get('/:workspaceId/project-updates/latest', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;

  try {
    const result = await query(
      `SELECT * FROM project_updates WHERE workspace_id = $1 ORDER BY week_of DESC LIMIT 1`,
      [workspaceId]
    );
    if (result.rows.length === 0) {
      return res.json({ message: 'No project updates found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default router;
