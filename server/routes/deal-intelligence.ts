import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getDealRiskScore } from '../tools/deal-risk-score.js';
import { getPipelineRiskSummary } from '../tools/pipeline-risk-summary.js';

const router = Router();

router.get('/:workspaceId/deals/:dealId/risk-score', async (req, res) => {
  try {
    const { workspaceId, dealId } = req.params;
    const result = await getDealRiskScore(workspaceId, dealId);
    if (result === null) {
      res.json({ success: true, data: { deal_id: dealId, score: null, grade: null, signals: [], signal_counts: { act: 0, watch: 0, notable: 0, info: 0 }, skills_evaluated: [], skills_missing: [], data_freshness: null, scored_at: new Date().toISOString(), message: 'No skills have been evaluated for this deal yet' } });
      return;
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[deal-intelligence] Risk score error:', err.message);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ success: false, error: err.message });
  }
});

router.get('/:workspaceId/pipeline/risk-summary', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { rep_email, sort_by, limit } = req.query;
    const result = await getPipelineRiskSummary(workspaceId, {
      repEmail: rep_email as string | undefined,
      sortBy: (sort_by as 'score' | 'amount' | 'close_date') || undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[deal-intelligence] Pipeline risk error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
