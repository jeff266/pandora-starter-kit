import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/:id/icp/profiles', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const { status } = req.query;

  try {
    const conditions: string[] = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];

    if (status) {
      if (status === 'active') {
        conditions.push("status = 'active'");
      } else if (status === 'archived') {
        conditions.push("status = 'superseded'");
      }
    }

    const result = await query(
      `SELECT
        id,
        version,
        status,
        personas,
        buying_committees,
        company_profile,
        scoring_weights,
        scoring_method,
        model_accuracy,
        model_metadata,
        deals_analyzed,
        won_deals,
        lost_deals,
        contacts_enriched,
        generated_at,
        generated_by,
        created_at
      FROM icp_profiles
      WHERE ${conditions.join(' AND ')}
      ORDER BY version DESC`,
      params
    );

    res.json({
      profiles: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('[icp] Error listing profiles:', err);
    res.status(500).json({ error: 'Failed to fetch ICP profiles' });
  }
});

router.get('/:id/icp/profiles/:profileId', async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId, profileId } = req.params;

  try {
    const result = await query(
      `SELECT *
      FROM icp_profiles
      WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, profileId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'ICP profile not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[icp] Error fetching profile:', err);
    res.status(500).json({ error: 'Failed to fetch ICP profile' });
  }
});

export default router;
