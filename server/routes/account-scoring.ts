import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { enrichAccount } from '../enrichment/account-enrichment.js';
import { enrichAndScoreAccountsBatch, getAccountScoringStatus } from '../enrichment/account-enrichment-batch.js';
import { scoreAccount } from '../scoring/account-scorer.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface AccountParams {
  workspaceId: string;
  accountId: string;
}

router.get('/:workspaceId/accounts/scoring/status', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const status = await getAccountScoringStatus(workspaceId);
    res.json(status);
  } catch (err: any) {
    console.error('[AccountScoring] Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/accounts/enrich/batch', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { limit, forceRefresh, concurrency } = req.body || {};

    const result = await enrichAndScoreAccountsBatch(workspaceId, {
      limit: Math.min(parseInt(limit) || 50, 200),
      forceRefresh: forceRefresh === true,
      concurrency: Math.min(parseInt(concurrency) || 3, 5),
    });

    res.json(result);
  } catch (err: any) {
    console.error('[AccountScoring] Batch enrichment error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/accounts/:accountId/enrich', async (req: Request<AccountParams>, res: Response) => {
  try {
    const { workspaceId, accountId } = req.params;
    const { forceRefresh } = req.body || {};

    const result = await enrichAccount(workspaceId, accountId, { forceRefresh: forceRefresh === true });
    res.json(result);
  } catch (err: any) {
    console.error('[AccountScoring] Single enrichment error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/accounts/:accountId/score', async (req: Request<AccountParams>, res: Response) => {
  try {
    const { workspaceId, accountId } = req.params;
    const result = await scoreAccount(workspaceId, accountId);
    res.json(result);
  } catch (err: any) {
    console.error('[AccountScoring] Scoring error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/accounts/:accountId/score', async (req: Request<AccountParams>, res: Response) => {
  try {
    const { workspaceId, accountId } = req.params;

    const result = await query<{
      total_score: number; grade: string;
      firmographic_score: number; engagement_score: number;
      signal_score: number; relationship_score: number;
      breakdown: any; scored_at: Date;
    }>(
      `SELECT total_score, grade, firmographic_score, engagement_score,
              signal_score, relationship_score, breakdown, scored_at
       FROM account_scores
       WHERE workspace_id = $1 AND account_id = $2`,
      [workspaceId, accountId]
    );

    if (result.rows.length === 0) {
      res.json({ scored: false });
      return;
    }

    const row = result.rows[0];
    res.json({
      scored: true,
      totalScore: row.total_score,
      grade: row.grade,
      firmographicScore: row.firmographic_score,
      engagementScore: row.engagement_score,
      signalScore: row.signal_score,
      relationshipScore: row.relationship_score,
      breakdown: row.breakdown,
      scoredAt: row.scored_at,
    });
  } catch (err: any) {
    console.error('[AccountScoring] Get score error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/accounts/scores/list', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { sortBy, sortDir, grade, limit: rawLimit, offset: rawOffset } = req.query;

    const validSorts = new Set(['total_score', 'grade', 'scored_at', 'firmographic_score', 'engagement_score', 'signal_score', 'relationship_score']);
    const sort = validSorts.has(sortBy as string) ? sortBy as string : 'total_score';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    const lim = Math.min(Math.max(parseInt(rawLimit as string) || 50, 1), 200);
    const off = Math.max(parseInt(rawOffset as string) || 0, 0);

    let gradeFilter = '';
    const params: any[] = [workspaceId];

    if (grade && typeof grade === 'string' && ['A', 'B', 'C', 'D', 'F'].includes(grade)) {
      gradeFilter = ` AND acs.grade = $2`;
      params.push(grade);
    }

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM account_scores acs WHERE acs.workspace_id = $1${gradeFilter}`,
      params
    );

    const idx = params.length + 1;
    const dataResult = await query(
      `SELECT
        a.id, a.name, a.domain, a.industry, a.employee_count, a.annual_revenue,
        acs.total_score, acs.grade, acs.firmographic_score, acs.engagement_score,
        acs.signal_score, acs.relationship_score, acs.scored_at,
        asi.data_quality, asi.company_type, asi.signal_summary
       FROM account_scores acs
       JOIN accounts a ON a.id = acs.account_id AND a.workspace_id = acs.workspace_id
       LEFT JOIN account_signals asi ON asi.account_id = acs.account_id AND asi.workspace_id = acs.workspace_id
       WHERE acs.workspace_id = $1${gradeFilter}
       ORDER BY acs.${sort} ${dir}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, lim, off]
    );

    res.json({
      total: parseInt(countResult.rows[0].count),
      scores: dataResult.rows,
      limit: lim,
      offset: off,
    });
  } catch (err: any) {
    console.error('[AccountScoring] List scores error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
