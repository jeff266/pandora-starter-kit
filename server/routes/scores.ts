import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';

const router = Router();

router.get('/:id/scores', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const { entity_type, grade, min_score, limit = '50', offset = '0' } = req.query;

  try {
    const conditions: string[] = ['ls.workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    let paramIdx = 2;

    if (entity_type) {
      conditions.push(`ls.entity_type = $${paramIdx++}`);
      params.push(entity_type);
    }

    if (grade) {
      conditions.push(`ls.score_grade = $${paramIdx++}`);
      params.push(grade);
    }

    if (min_score) {
      const minScoreNum = Number(min_score);
      if (isNaN(minScoreNum)) {
        res.status(400).json({ error: 'min_score must be a number' });
        return;
      }
      conditions.push(`ls.total_score >= $${paramIdx++}`);
      params.push(minScoreNum);
    }

    if (entity_type && !['contact', 'deal'].includes(entity_type as string)) {
      res.status(400).json({ error: 'entity_type must be "contact" or "deal"' });
      return;
    }

    if (grade && !['A', 'B', 'C', 'D', 'F'].includes((grade as string).toUpperCase())) {
      res.status(400).json({ error: 'grade must be A, B, C, D, or F' });
      return;
    }

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM lead_scores ls WHERE ${conditions.join(' AND ')}`,
      params
    );

    const limitVal = Math.max(1, Math.min(Number(limit) || 50, 200));
    const offsetVal = Math.max(0, Number(offset) || 0);

    const result = await query(
      `SELECT
        ls.id,
        ls.entity_type,
        ls.entity_id,
        ls.total_score,
        ls.score_breakdown,
        ls.score_grade,
        ls.icp_fit_score,
        ls.icp_fit_details,
        ls.icp_profile_id,
        ls.scoring_method,
        ls.scored_at,
        ls.previous_score,
        ls.score_change,
        CASE
          WHEN ls.entity_type = 'contact' THEN c.first_name || ' ' || c.last_name
          WHEN ls.entity_type = 'deal' THEN d.name
        END as entity_name,
        CASE
          WHEN ls.entity_type = 'contact' THEN c.email
          WHEN ls.entity_type = 'deal' THEN d.stage_normalized
        END as entity_detail
      FROM lead_scores ls
      LEFT JOIN contacts c ON ls.entity_type = 'contact' AND ls.entity_id = c.id
      LEFT JOIN deals d ON ls.entity_type = 'deal' AND ls.entity_id = d.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ls.total_score DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limitVal, offsetVal]
    );

    res.json({
      scores: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit: limitVal,
      offset: offsetVal,
    });
  } catch (err) {
    console.error('[scores] Error listing scores:', err);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

router.get('/:id/scores/:entityType/:entityId', async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId, entityType, entityId } = req.params;

  try {
    const result = await query(
      `SELECT
        ls.*,
        ip.version as profile_version,
        ip.status as profile_status,
        ip.scoring_method as profile_scoring_method
      FROM lead_scores ls
      LEFT JOIN icp_profiles ip ON ls.icp_profile_id = ip.id
      WHERE ls.workspace_id = $1
        AND ls.entity_type = $2
        AND ls.entity_id = $3`,
      [workspaceId, entityType, entityId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Score not found for this entity' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[scores] Error fetching score:', err);
    res.status(500).json({ error: 'Failed to fetch score' });
  }
});

export default router;
