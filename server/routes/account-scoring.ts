import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { enrichAccount } from '../enrichment/account-enrichment.js';
import { scoreAccount } from '../scoring/account-scorer.js';
import { runAccountEnrichmentBatch, runAccountScoringBatch } from '../enrichment/account-enrichment-batch.js';
import { getOrGenerateSynthesis } from '../scoring/account-synthesis.js';

const router = Router();

/**
 * GET /:workspaceId/accounts/scores
 * Returns all accounts with their scores, sorted by score desc.
 * Query params: ?grade=A,B&limit=50&offset=0
 */
router.get('/:workspaceId/accounts/scores', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const gradeFilter = req.query.grade ? String(req.query.grade).split(',') : null;
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
    const offset = parseInt(String(req.query.offset || '0'));

    const gradeCondition = gradeFilter?.length
      ? `AND acs.grade = ANY($3::text[])`
      : '';
    const params: any[] = [workspaceId, workspaceId];
    if (gradeFilter?.length) params.push(gradeFilter);

    const result = await query(
      `SELECT a.id, a.name, a.domain, a.industry, a.owner,
         acs.total_score, acs.grade, acs.score_delta, acs.data_confidence, acs.scored_at,
         acs.score_breakdown,
         asig.signals, asig.signal_score, asig.signal_summary,
         asig.industry AS signal_industry, asig.growth_stage, asig.classification_confidence, asig.scrape_status
       FROM accounts a
       LEFT JOIN account_scores acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
       LEFT JOIN account_signals asig ON asig.account_id = a.id AND asig.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1 ${gradeCondition}
       ORDER BY acs.total_score DESC NULLS LAST, a.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const total = await query(
      `SELECT COUNT(*) AS cnt FROM accounts WHERE workspace_id = $1`,
      [workspaceId]
    );

    return res.json({
      accounts: result.rows,
      total: parseInt(total.rows[0]?.cnt || '0'),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[account-scoring] scores list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/accounts/:accountId/score
 * Returns full score breakdown + signals for one account.
 */
router.get('/:workspaceId/accounts/:accountId/score', async (req, res) => {
  try {
    const { workspaceId, accountId } = req.params;

    const result = await query(
      `SELECT a.id, a.name, a.domain, a.industry, a.owner,
         acs.total_score, acs.grade, acs.score_delta, acs.previous_score, acs.data_confidence,
         acs.score_breakdown, acs.icp_fit_details, acs.scoring_mode, acs.scored_at, acs.stale_after,
         asig.signals, asig.signal_score, asig.signal_summary, asig.industry AS signal_industry,
         asig.business_model, asig.employee_range, asig.growth_stage,
         asig.classification_confidence, asig.scrape_status, asig.enriched_at
       FROM accounts a
       LEFT JOIN account_scores acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
       LEFT JOIN account_signals asig ON asig.account_id = a.id AND asig.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1 AND a.id = $2`,
      [workspaceId, accountId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Account not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[account-scoring] score detail error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/accounts/:accountId/score/why
 * Returns a short LLM synthesis of why this account scores well/poorly.
 * Cached per account per day in account_scores.synthesis_text.
 */
router.get('/:workspaceId/accounts/:accountId/score/why', async (req, res) => {
  try {
    const { workspaceId, accountId } = req.params;

    const exists = await query(
      `SELECT id FROM accounts WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, accountId]
    );
    if (!exists.rows.length) return res.status(404).json({ error: 'Account not found' });

    const why = await getOrGenerateSynthesis(workspaceId, accountId);
    return res.json({ why });
  } catch (err) {
    console.error('[account-scoring] score why error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:workspaceId/accounts/:accountId/enrich
 * Triggers enrichment + scoring for a single account.
 */
router.post('/:workspaceId/accounts/:accountId/enrich', async (req, res) => {
  try {
    const { workspaceId, accountId } = req.params;
    const { forceApollo } = req.body || {};

    const enrichResult = await enrichAccount(workspaceId, accountId, { forceApollo: !!forceApollo });
    const scoreResult = await scoreAccount(workspaceId, accountId);

    return res.json({
      enrichment: enrichResult,
      score: scoreResult,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[account-scoring] enrich error:', err);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /:workspaceId/accounts/enrich/batch
 * Triggers batch enrichment job.
 */
router.post('/:workspaceId/accounts/enrich/batch', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { limit, forceRefresh, accountIds } = req.body || {};

    // Return immediately — run batch in background
    res.json({ ok: true, message: 'Batch enrichment started' });

    runAccountEnrichmentBatch(workspaceId, { limit, forceRefresh, accountIds }).catch(err =>
      console.error('[account-scoring] batch error:', err)
    );
  } catch (err) {
    console.error('[account-scoring] batch start error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/accounts/enrich/status
 * Returns enrichment coverage stats.
 */
router.get('/:workspaceId/accounts/enrich/status', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const [totals, byMethod, scoreDistrib, avgConf] = await Promise.all([
      query(
        `SELECT
           COUNT(a.id) AS total,
           COUNT(asig.id) AS enriched,
           COUNT(CASE WHEN asig.id IS NULL OR asig.scrape_status = 'pending' THEN 1 END) AS pending,
           COUNT(CASE WHEN asig.stale_after < now() AND asig.id IS NOT NULL THEN 1 END) AS stale
         FROM accounts a
         LEFT JOIN account_signals asig ON asig.account_id = a.id AND asig.workspace_id = a.workspace_id
         WHERE a.workspace_id = $1`,
        [workspaceId]
      ),
      query(
        `SELECT enrichment_method, COUNT(*) AS cnt
         FROM account_signals WHERE workspace_id = $1 AND scrape_status NOT IN ('pending', 'serper_failed')
         GROUP BY enrichment_method`,
        [workspaceId]
      ),
      query(
        `SELECT grade, COUNT(*) AS cnt FROM account_scores WHERE workspace_id = $1 GROUP BY grade`,
        [workspaceId]
      ),
      query(
        `SELECT AVG(classification_confidence)::integer AS avg_conf FROM account_signals WHERE workspace_id = $1`,
        [workspaceId]
      ),
    ]);

    const byMethodMap: Record<string, number> = {};
    for (const row of byMethod.rows) {
      byMethodMap[row.enrichment_method || 'unknown'] = parseInt(row.cnt);
    }

    const scoreDistribMap: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const row of scoreDistrib.rows) {
      scoreDistribMap[row.grade] = parseInt(row.cnt);
    }

    const t = totals.rows[0];
    return res.json({
      total: parseInt(t.total),
      enriched: parseInt(t.enriched),
      pending: parseInt(t.pending),
      stale: parseInt(t.stale),
      byMethod: byMethodMap,
      avgConfidence: avgConf.rows[0]?.avg_conf ?? 0,
      scoreDistribution: scoreDistribMap,
    });
  } catch (err) {
    console.error('[account-scoring] status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
