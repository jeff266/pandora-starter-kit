import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { runProspectScoring } from '../scoring/prospect-scorer.js';

const router = Router();

// ── GET /:id/prospect-scores ──────────────────────────────────────────────────
// Returns paginated, filtered, sorted list of scored prospects + aggregate stats.

router.get('/:workspaceId/prospect-scores', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId;
  const {
    grade,
    action,
    search,
    sort = 'score_desc',
    limit = '50',
    offset = '0',
  } = req.query as Record<string, string>;

  try {
    const limitVal = Math.max(1, Math.min(Number(limit) || 50, 200));
    const offsetVal = Math.max(0, Number(offset) || 0);

    const conditions: string[] = [`ls.workspace_id = $1`, `ls.entity_type = 'contact'`];
    const params: unknown[] = [workspaceId];
    let paramIdx = 2;

    if (grade && grade !== 'all') {
      conditions.push(`ls.score_grade = $${paramIdx++}`);
      params.push(grade.toUpperCase());
    }

    if (action) {
      conditions.push(`ls.recommended_action = $${paramIdx++}`);
      params.push(action);
    }

    if (search) {
      const likeParam = `%${search}%`;
      conditions.push(
        `(c.first_name ILIKE $${paramIdx} OR c.last_name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx} OR a.name ILIKE $${paramIdx})`
      );
      params.push(likeParam);
      paramIdx++;
    }

    const orderMap: Record<string, string> = {
      score_desc: 'ls.total_score DESC',
      score_asc: 'ls.total_score ASC',
      change_desc: 'ls.score_change DESC NULLS LAST',
      name_asc: 'c.first_name ASC, c.last_name ASC',
    };
    const orderBy = orderMap[sort] || 'ls.total_score DESC';

    const where = conditions.join(' AND ');

    const [countResult, dataResult, distResult, statsResult] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM lead_scores ls
         JOIN contacts c ON c.id = ls.entity_id AND c.workspace_id = $1
         LEFT JOIN accounts a ON a.id = c.account_id
         WHERE ${where}`,
        params
      ),

      query(
        `SELECT
          ls.entity_id AS contact_id,
          ls.total_score AS score,
          ls.previous_score AS prev_score,
          ls.score_change,
          ls.score_grade AS grade,
          ls.fit_score AS fit,
          ls.engagement_score_component AS engagement,
          ls.intent_score AS intent,
          ls.timing_score AS timing,
          ls.recommended_action,
          ls.top_positive_factor,
          ls.top_negative_factor,
          ls.score_summary AS summary,
          ls.segment_label,
          ls.segment_benchmarks,
          ls.score_factors AS factors,
          ls.score_confidence AS confidence,
          ls.scoring_method AS method,
          ls.source_object AS source,
          ls.scored_at,
          c.first_name, c.last_name, c.email, c.title, c.seniority, c.department,
          a.name AS company,
          COALESCE(asig.industry_verified, a.source_data->>'industry') AS industry,
          asig.employee_count
         FROM lead_scores ls
         JOIN contacts c ON c.id = ls.entity_id AND c.workspace_id = $1
         LEFT JOIN accounts a ON a.id = c.account_id
         LEFT JOIN account_signals asig ON asig.account_id = c.account_id AND asig.workspace_id = $1
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limitVal, offsetVal]
      ),

      query<{ grade: string; count: string }>(
        `SELECT score_grade AS grade, COUNT(*) AS count
         FROM lead_scores
         WHERE workspace_id = $1 AND entity_type = 'contact'
         GROUP BY score_grade`,
        [workspaceId]
      ),

      query<{
        avg_score: string;
        a_grade_count: string;
        unworked_ab: string;
        trending_up: string;
        last_run: string;
        total_scored: string;
      }>(
        `SELECT
          AVG(total_score)::numeric(5,1) AS avg_score,
          COUNT(*) FILTER (WHERE score_grade = 'A') AS a_grade_count,
          COUNT(*) FILTER (WHERE score_grade IN ('A','B') AND recommended_action = 'prospect') AS unworked_ab,
          COUNT(*) FILTER (WHERE score_change > 0) AS trending_up,
          MAX(scored_at) AS last_run,
          COUNT(*) AS total_scored
         FROM lead_scores
         WHERE workspace_id = $1 AND entity_type = 'contact'`,
        [workspaceId]
      ),
    ]);

    const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const r of distResult.rows) gradeDistribution[r.grade] = parseInt(r.count, 10);

    const s = statsResult.rows[0] ?? {};
    const stats = {
      avg_score: parseFloat(s.avg_score || '0'),
      a_grade_count: parseInt(s.a_grade_count || '0', 10),
      unworked_ab_count: parseInt(s.unworked_ab || '0', 10),
      trending_up_count: parseInt(s.trending_up || '0', 10),
    };

    const prospects = dataResult.rows.map(r => ({
      contact_id: r.contact_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Unknown',
      email: r.email,
      title: r.title,
      company: r.company,
      industry: r.industry,
      employee_count: r.employee_count,
      source: r.source || 'crm',
      score: Math.round(Number(r.score) || 0),
      prev_score: r.prev_score !== null ? Math.round(Number(r.prev_score)) : null,
      score_change: r.score_change !== null ? Math.round(Number(r.score_change)) : null,
      grade: r.grade,
      fit: r.fit ?? 0,
      engagement: r.engagement ?? 0,
      intent: r.intent ?? 0,
      timing: r.timing ?? 0,
      recommended_action: r.recommended_action,
      top_positive_factor: r.top_positive_factor,
      top_negative_factor: r.top_negative_factor,
      summary: r.summary,
      segment: r.segment_label,
      segment_benchmarks: r.segment_benchmarks,
      factors: r.factors,
      confidence: r.confidence,
      method: r.method,
      scored_at: r.scored_at,
    }));

    res.json({
      prospects,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
      limit: limitVal,
      offset: offsetVal,
      grade_distribution: gradeDistribution,
      stats,
      scored_count: parseInt(s.total_scored || '0', 10),
      last_run_at: s.last_run || null,
      scoring_tier: 1,
    });
  } catch (err) {
    console.error('[prospect-scores] List error:', err);
    res.status(500).json({ error: 'Failed to fetch prospect scores' });
  }
});

// ── POST /:id/prospect-scores/run ─────────────────────────────────────────────
// Triggers a fresh scoring run for the workspace.

router.post('/:workspaceId/prospect-scores/run', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId;
  try {
    const result = await runProspectScoring(workspaceId);
    res.json(result);
  } catch (err) {
    console.error('[prospect-scores] Run error:', err);
    res.status(500).json({ error: 'Scoring run failed' });
  }
});

export default router;
