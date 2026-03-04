import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

/**
 * GET /:workspaceId/scores/:entityType/:entityId/factors
 * Returns score_factors JSONB array for this entity
 * Purpose: "Show your math" drill-through from UI
 */
router.get('/:workspaceId/scores/:entityType/:entityId/factors', async (req, res) => {
  try {
    const { workspaceId, entityType, entityId } = req.params;

    if (!['deal', 'contact', 'account'].includes(entityType)) {
      return res.status(400).json({ error: 'Invalid entity type. Must be deal, contact, or account.' });
    }

    const result = await query(
      `SELECT
        score_factors,
        total_score,
        score_grade,
        fit_score,
        engagement_score_component,
        intent_score,
        timing_score,
        top_positive_factor,
        top_negative_factor,
        score_summary,
        available_pillars,
        effective_weights,
        score_confidence,
        scored_at
       FROM lead_scores
       WHERE workspace_id = $1
         AND entity_type = $2
         AND entity_id = $3`,
      [workspaceId, entityType, entityId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Score not found for this entity' });
    }

    const scoreData = result.rows[0];

    return res.json({
      factors: scoreData.score_factors || [],
      totalScore: scoreData.total_score,
      grade: scoreData.score_grade,
      componentScores: {
        fit: scoreData.fit_score,
        engagement: scoreData.engagement_score_component,
        intent: scoreData.intent_score,
        timing: scoreData.timing_score,
      },
      topPositiveFactor: scoreData.top_positive_factor,
      topNegativeFactor: scoreData.top_negative_factor,
      summary: scoreData.score_summary,
      availablePillars: scoreData.available_pillars || [],
      effectiveWeights: scoreData.effective_weights || {},
      confidence: scoreData.score_confidence,
      scoredAt: scoreData.scored_at,
    });
  } catch (error) {
    console.error('[Prospect Scores] Factor fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch score factors' });
  }
});

/**
 * GET /:workspaceId/scores/:entityType/:entityId/history
 * Returns rows from prospect_score_history for this entity
 * Query params: ?since=ISO_DATE&limit=50
 * Purpose: "How has this score changed over time?"
 */
router.get('/:workspaceId/scores/:entityType/:entityId/history', async (req, res) => {
  try {
    const { workspaceId, entityType, entityId } = req.params;
    const since = req.query.since ? String(req.query.since) : null;
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);

    if (!['deal', 'contact', 'account'].includes(entityType)) {
      return res.status(400).json({ error: 'Invalid entity type. Must be deal, contact, or account.' });
    }

    const sinceCondition = since ? `AND scored_at >= $4::timestamptz` : '';
    const params: any[] = [workspaceId, entityType, entityId];
    if (since) params.push(since);

    const result = await query(
      `SELECT
        id,
        total_score,
        grade,
        fit_score,
        engagement_score,
        intent_score,
        timing_score,
        segment_id,
        score_method,
        scored_at,
        created_at
       FROM prospect_score_history
       WHERE workspace_id = $1
         AND entity_type = $2
         AND entity_id = $3
         ${sinceCondition}
       ORDER BY scored_at DESC
       LIMIT ${limit}`,
      params
    );

    return res.json({
      history: result.rows,
      entityType,
      entityId,
    });
  } catch (error) {
    console.error('[Prospect Scores] History fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch score history' });
  }
});

/**
 * GET /:workspaceId/scores/summary
 * Returns workspace-wide scoring summary
 * Purpose: Dashboard summary widget
 */
router.get('/:workspaceId/scores/summary', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // Total scored and grade distribution
    const gradeDistribution = await query(
      `SELECT
        COUNT(*) as total_scored,
        score_grade,
        COUNT(*) FILTER (WHERE score_grade = 'A') as grade_a,
        COUNT(*) FILTER (WHERE score_grade = 'B') as grade_b,
        COUNT(*) FILTER (WHERE score_grade = 'C') as grade_c,
        COUNT(*) FILTER (WHERE score_grade = 'D') as grade_d,
        COUNT(*) FILTER (WHERE score_grade = 'F') as grade_f
       FROM lead_scores
       WHERE workspace_id = $1
       GROUP BY score_grade`,
      [workspaceId]
    );

    const totalScored = gradeDistribution.rows.reduce((sum, row) => sum + parseInt(row.total_scored || '0'), 0);

    // Average scores
    const averages = await query(
      `SELECT
        ROUND(AVG(total_score)) as avg_score,
        ROUND(AVG(fit_score)) as avg_fit,
        ROUND(AVG(engagement_score_component)) as avg_engagement,
        ROUND(AVG(intent_score)) as avg_intent,
        ROUND(AVG(timing_score)) as avg_timing
       FROM lead_scores
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    // Data completeness
    const completeness = await query(
      `SELECT
        COUNT(*) FILTER (WHERE fit_score IS NOT NULL) as has_fit,
        COUNT(*) FILTER (WHERE engagement_score_component IS NOT NULL) as has_engagement,
        COUNT(*) FILTER (WHERE intent_score IS NOT NULL) as has_intent,
        COUNT(*) FILTER (WHERE timing_score IS NOT NULL) as has_timing,
        MAX(scored_at) as last_scored_at,
        ARRAY_AGG(DISTINCT scoring_method) as scoring_methods
       FROM lead_scores
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const completenessRow = completeness.rows[0] || {};
    const avgRow = averages.rows[0] || {};

    return res.json({
      totalScored,
      gradeDistribution: {
        A: parseInt(gradeDistribution.rows.find(r => r.score_grade === 'A')?.total_scored || '0'),
        B: parseInt(gradeDistribution.rows.find(r => r.score_grade === 'B')?.total_scored || '0'),
        C: parseInt(gradeDistribution.rows.find(r => r.score_grade === 'C')?.total_scored || '0'),
        D: parseInt(gradeDistribution.rows.find(r => r.score_grade === 'D')?.total_scored || '0'),
        F: parseInt(gradeDistribution.rows.find(r => r.score_grade === 'F')?.total_scored || '0'),
      },
      avgScore: parseInt(avgRow.avg_score || '0'),
      pillarAverages: {
        fit: parseInt(avgRow.avg_fit || '0'),
        engagement: parseInt(avgRow.avg_engagement || '0'),
        intent: parseInt(avgRow.avg_intent || '0'),
        timing: parseInt(avgRow.avg_timing || '0'),
      },
      scoringMethod: completenessRow.scoring_methods?.[0] || 'point_based',
      lastScoredAt: completenessRow.last_scored_at,
      dataCompleteness: {
        hasFit: parseInt(completenessRow.has_fit || '0') > 0,
        hasEngagement: parseInt(completenessRow.has_engagement || '0') > 0,
        hasIntent: parseInt(completenessRow.has_intent || '0') > 0,
        hasTiming: parseInt(completenessRow.has_timing || '0') > 0,
      },
    });
  } catch (error) {
    console.error('[Prospect Scores] Summary fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch score summary' });
  }
});

/**
 * GET /:workspaceId/scores/movers
 * Query params: ?direction=up|down&limit=10&since=ISO_DATE
 * Returns: Prospects with biggest score changes
 * Source: Compare current lead_scores.total_score vs previous_score
 * Purpose: "Who moved this week?" briefing
 */
router.get('/:workspaceId/scores/movers', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const direction = req.query.direction === 'down' ? 'down' : 'up';
    const limit = Math.min(parseInt(String(req.query.limit || '10')), 50);
    const since = req.query.since ? String(req.query.since) : null;

    const sinceCondition = since ? `AND scored_at >= $2::timestamptz` : '';
    const orderDirection = direction === 'up' ? 'DESC' : 'ASC';
    const scoreChangeFilter = direction === 'up'
      ? 'AND score_change > 0'
      : 'AND score_change < 0';

    const params: any[] = [workspaceId];
    if (since) params.push(since);

    const result = await query(
      `SELECT
        ls.entity_type,
        ls.entity_id,
        ls.total_score,
        ls.score_grade,
        ls.previous_score,
        ls.score_change,
        ls.fit_score,
        ls.engagement_score_component,
        ls.intent_score,
        ls.timing_score,
        ls.top_positive_factor,
        ls.top_negative_factor,
        ls.score_summary,
        ls.scored_at,
        CASE
          WHEN ls.entity_type = 'deal' THEN d.name
          WHEN ls.entity_type = 'contact' THEN c.full_name
          WHEN ls.entity_type = 'account' THEN a.name
        END as entity_name,
        CASE
          WHEN ls.entity_type = 'deal' THEN d.amount
          ELSE NULL
        END as deal_amount
       FROM lead_scores ls
       LEFT JOIN deals d ON d.id = ls.entity_id AND ls.entity_type = 'deal'
       LEFT JOIN contacts c ON c.id = ls.entity_id AND ls.entity_type = 'contact'
       LEFT JOIN accounts a ON a.id = ls.entity_id AND ls.entity_type = 'account'
       WHERE ls.workspace_id = $1
         ${scoreChangeFilter}
         ${sinceCondition}
       ORDER BY ABS(ls.score_change) ${orderDirection}
       LIMIT ${limit}`,
      params
    );

    return res.json({
      movers: result.rows,
      direction,
      limit,
      since,
    });
  } catch (error) {
    console.error('[Prospect Scores] Movers fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch score movers' });
  }
});

export default router;
