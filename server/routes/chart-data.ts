import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { query } from '../db.js';

const router = Router();

const CHARTABLE_SKILLS = [
  'deal-risk-review',
  'pipeline-hygiene',
  'pipeline-coverage',
  'forecast-rollup',
];

router.get('/:workspaceId/chart-data/sources', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const result = await query(`
      SELECT DISTINCT ON (skill_id)
        skill_id,
        id as run_id,
        created_at,
        jsonb_array_length(
          output->'evidence'->'evaluated_records'
        ) as record_count
      FROM skill_runs
      WHERE workspace_id = $1
        AND status = 'completed'
        AND skill_id = ANY($2)
        AND output->'evidence'->'evaluated_records' IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY skill_id, created_at DESC
    `, [workspaceId, CHARTABLE_SKILLS]);

    res.json({ sources: result.rows });
  } catch (err: any) {
    console.error('[ChartData] Failed to get sources:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/chart-data/:skillId', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, skillId } = req.params;

    if (!CHARTABLE_SKILLS.includes(skillId)) {
      return res.status(400).json({ error: 'Skill not chartable' });
    }

    const result = await query(`
      SELECT
        output->'evidence'->'evaluated_records' as records,
        output->'evidence'->'claims' as claims,
        created_at
      FROM skill_runs
      WHERE workspace_id = $1
        AND skill_id = $2
        AND status = 'completed'
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 1
    `, [workspaceId, skillId]);

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'No recent skill run found' });
    }

    res.json({
      records: result.rows[0].records || [],
      claims: result.rows[0].claims || [],
      fetched_at: result.rows[0].created_at,
    });
  } catch (err: any) {
    console.error('[ChartData] Failed to get records:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
