import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

const SEVERITY_ORDER: Record<string, number> = { act: 1, watch: 2, notable: 3, info: 4 };

router.get('/:workspaceId/findings/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;

    const groupedResult = await query(
      `SELECT severity, skill_id, category, count(*)::int as count
       FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL
       GROUP BY GROUPING SETS ((severity), (skill_id, severity), (category))`,
      [workspaceId]
    );

    const by_severity: Record<string, number> = { act: 0, watch: 0, notable: 0, info: 0 };
    const by_skill: Record<string, Record<string, number>> = {};
    const by_category: Record<string, number> = {};

    for (const row of groupedResult.rows) {
      if (row.category !== null && row.severity === null && row.skill_id === null) {
        by_category[row.category] = row.count;
      } else if (row.skill_id !== null && row.severity !== null && row.category === null) {
        if (!by_skill[row.skill_id]) by_skill[row.skill_id] = {};
        by_skill[row.skill_id][row.severity] = row.count;
      } else if (row.severity !== null && row.skill_id === null && row.category === null) {
        by_severity[row.severity] = row.count;
      }
    }

    const total_active = Object.values(by_severity).reduce((a, b) => a + b, 0);

    const trendResult = await query(
      `SELECT
         count(*) FILTER (WHERE resolved_at IS NULL)::int as current_count,
         count(*) FILTER (WHERE resolved_at IS NULL AND found_at <= now() - interval '7 days')::int as baseline_count,
         count(*) FILTER (WHERE found_at > now() - interval '7 days' AND resolved_at IS NULL)::int as new_this_week,
         count(*) FILTER (WHERE resolved_at > now() - interval '7 days')::int as resolved_this_week
       FROM findings
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const tr = trendResult.rows[0];
    const previous_week = tr.baseline_count + tr.resolved_this_week;
    const current = tr.current_count;
    const direction = current > previous_week ? 'up' : current < previous_week ? 'down' : 'stable';

    res.json({
      total_active,
      by_severity,
      by_skill,
      by_category,
      trend: { current, previous_week, direction },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[findings] Summary error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/findings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const q = req.query;

    const conditions: string[] = ['f.workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    let paramIdx = 2;

    const filtersApplied: Record<string, unknown> = {};

    const status = (q.status as string) || 'active';
    filtersApplied.status = status;
    if (status === 'active') {
      conditions.push('f.resolved_at IS NULL');
    } else if (status === 'resolved') {
      conditions.push('f.resolved_at IS NOT NULL');
    }

    if (q.severity) {
      const severities = normalizeSeverities(q.severity as string);
      conditions.push(`f.severity = ANY($${paramIdx})`);
      params.push(severities);
      paramIdx++;
      filtersApplied.severity = severities;
    }

    if (q.skill_id) {
      const skillIds = (q.skill_id as string).split(',').map(s => s.trim()).filter(Boolean);
      conditions.push(`f.skill_id = ANY($${paramIdx})`);
      params.push(skillIds);
      paramIdx++;
      filtersApplied.skill_id = skillIds;
    }

    if (q.category) {
      const categories = (q.category as string).split(',').map(s => s.trim()).filter(Boolean);
      conditions.push(`f.category = ANY($${paramIdx})`);
      params.push(categories);
      paramIdx++;
      filtersApplied.category = categories;
    }

    if (q.owner_email) {
      conditions.push(`f.owner_email = $${paramIdx}`);
      params.push(q.owner_email);
      paramIdx++;
      filtersApplied.owner_email = q.owner_email;
    }

    if (q.deal_id) {
      conditions.push(`f.deal_id = $${paramIdx}`);
      params.push(q.deal_id);
      paramIdx++;
      filtersApplied.deal_id = q.deal_id;
    }

    if (q.account_id) {
      conditions.push(`f.account_id = $${paramIdx}`);
      params.push(q.account_id);
      paramIdx++;
      filtersApplied.account_id = q.account_id;
    }

    if (q.from) {
      conditions.push(`f.found_at >= $${paramIdx}`);
      params.push(q.from);
      paramIdx++;
      filtersApplied.from = q.from;
    }

    if (q.to) {
      conditions.push(`f.found_at <= $${paramIdx}`);
      params.push(q.to);
      paramIdx++;
      filtersApplied.to = q.to;
    }

    const whereClause = conditions.join(' AND ');

    const sort = (q.sort as string) || 'severity';
    filtersApplied.sort = sort;

    let orderClause: string;
    if (sort === 'recency') {
      orderClause = 'f.found_at DESC NULLS LAST';
    } else {
      orderClause = `CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 WHEN 'info' THEN 4 ELSE 5 END ASC, f.found_at DESC NULLS LAST`;
    }

    const limit = Math.min(Math.max(parseInt(q.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset as string) || 0, 0);

    const countResult = await query(
      `SELECT count(*)::int as total FROM findings f WHERE ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    const dataParams = [...params, limit, offset];
    const dataResult = await query(
      `SELECT f.* FROM findings f
       WHERE ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      dataParams
    );

    res.json({
      findings: dataResult.rows,
      total,
      filters_applied: filtersApplied,
      pagination: { limit, offset, has_more: offset + limit < total },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[findings] List error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/pipeline/pipelines', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const result = await query(
      `SELECT
         COALESCE(pipeline, 'Unknown') as name,
         count(*)::int as deal_count,
         COALESCE(sum(amount), 0)::float as total_value
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       GROUP BY pipeline
       ORDER BY sum(amount) DESC NULLS LAST`,
      [workspaceId]
    );
    res.json({ pipelines: result.rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[findings] Pipelines list error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/pipeline/snapshot', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const pipelineFilter = req.query.pipeline as string | undefined;

    const params: any[] = [workspaceId];
    let pipelineClause = '';
    if (pipelineFilter && pipelineFilter !== 'all') {
      params.push(pipelineFilter);
      pipelineClause = ` AND d.pipeline = $${params.length}`;
    }

    const stageResult = await query(
      `SELECT
         COALESCE(d.stage, d.stage_normalized, 'Unknown') as stage,
         d.stage_normalized,
         count(*)::int as deal_count,
         COALESCE(sum(d.amount), 0)::float as total_value,
         COALESCE(sum(d.amount * COALESCE(d.probability, 0.5)), 0)::float as weighted_value
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ${pipelineClause}
       GROUP BY d.stage, d.stage_normalized
       ORDER BY sum(d.amount) DESC`,
      params
    );

    const total_pipeline = stageResult.rows.reduce((s, r) => s + r.total_value, 0);
    const total_deals = stageResult.rows.reduce((s, r) => s + r.deal_count, 0);
    const weighted_pipeline = stageResult.rows.reduce((s, r) => s + r.weighted_value, 0);

    const findingsParams: any[] = [workspaceId];
    let findingsPipelineClause = '';
    if (pipelineFilter && pipelineFilter !== 'all') {
      findingsParams.push(pipelineFilter);
      findingsPipelineClause = ` AND d.pipeline = $${findingsParams.length}`;
    }

    const findingsByStage = await query(
      `SELECT
         COALESCE(d.stage, d.stage_normalized, 'Unknown') as stage,
         f.severity,
         count(*)::int as count
       FROM findings f
       JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id
       WHERE f.workspace_id = $1
         AND f.resolved_at IS NULL
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ${findingsPipelineClause}
       GROUP BY d.stage, d.stage_normalized, f.severity`,
      findingsParams
    );

    const stageFindingsMap: Record<string, Record<string, number>> = {};
    for (const row of findingsByStage.rows) {
      if (!stageFindingsMap[row.stage]) stageFindingsMap[row.stage] = {};
      stageFindingsMap[row.stage][row.severity] = row.count;
    }

    const topFindingsResult = await query(
      `SELECT
         COALESCE(d.stage, d.stage_normalized, 'Unknown') as stage,
         f.severity,
         f.category,
         f.message,
         f.deal_id
       FROM findings f
       JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id
       WHERE f.workspace_id = $1
         AND f.resolved_at IS NULL
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ${findingsPipelineClause}
         AND f.severity IN ('act', 'watch')
       ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END, f.found_at DESC
       LIMIT 50`,
      findingsParams
    );

    const topFindingsByStage: Record<string, Array<{ severity: string; category: string; message: string; deal_id: string }>> = {};
    for (const row of topFindingsResult.rows) {
      if (!topFindingsByStage[row.stage]) topFindingsByStage[row.stage] = [];
      if (topFindingsByStage[row.stage].length < 5) {
        topFindingsByStage[row.stage].push({
          severity: row.severity,
          category: row.category,
          message: row.message,
          deal_id: row.deal_id,
        });
      }
    }

    const by_stage = stageResult.rows.map(row => {
      const sf = stageFindingsMap[row.stage] || {};
      return {
        stage: row.stage,
        stage_normalized: row.stage_normalized,
        deal_count: row.deal_count,
        total_value: row.total_value,
        weighted_value: row.weighted_value,
        findings: {
          act: sf.act || 0,
          watch: sf.watch || 0,
          notable: sf.notable || 0,
          top_findings: topFindingsByStage[row.stage] || [],
        },
      };
    });

    const winRateParams: any[] = [workspaceId];
    let winRatePipelineClause = '';
    if (pipelineFilter && pipelineFilter !== 'all') {
      winRateParams.push(pipelineFilter);
      winRatePipelineClause = ` AND pipeline = $${winRateParams.length}`;
    }

    const winRateResult = await query(
      `SELECT
         count(*) FILTER (WHERE stage_normalized = 'closed_won' AND close_date >= now() - interval '90 days')::int as won_90,
         count(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost') AND close_date >= now() - interval '90 days')::int as total_closed_90,
         count(*) FILTER (WHERE stage_normalized = 'closed_won' AND close_date >= now() - interval '120 days' AND close_date < now() - interval '30 days')::int as won_prev,
         count(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost') AND close_date >= now() - interval '120 days' AND close_date < now() - interval '30 days')::int as total_closed_prev
       FROM deals
       WHERE workspace_id = $1
         ${winRatePipelineClause}`,
      winRateParams
    );

    const wr = winRateResult.rows[0];
    const trailing_90d = wr.total_closed_90 > 0 ? wr.won_90 / wr.total_closed_90 : 0;
    const prev_rate = wr.total_closed_prev > 0 ? wr.won_prev / wr.total_closed_prev : 0;
    const win_trend = trailing_90d > prev_rate + 0.02 ? 'up' : trailing_90d < prev_rate - 0.02 ? 'down' : 'stable';

    res.json({
      total_pipeline,
      total_deals,
      weighted_pipeline,
      by_stage,
      coverage: { ratio: null, quota: null, pipeline: total_pipeline },
      win_rate: {
        trailing_90d: Math.round(trailing_90d * 1000) / 1000,
        trend: win_trend,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[findings] Pipeline snapshot error:', msg);
    res.status(500).json({ error: msg });
  }
});

const SEVERITY_ALIASES: Record<string, string> = {
  critical: 'act',
  warning: 'watch',
};

function normalizeSeverities(input: string): string[] {
  return input.split(',').map(s => {
    const trimmed = s.trim().toLowerCase();
    return SEVERITY_ALIASES[trimmed] || trimmed;
  }).filter(Boolean);
}

router.patch('/:workspaceId/findings/:findingId/resolve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, findingId } = req.params;
    const { resolution_method } = req.body || {};

    const validMethods = ['user_dismissed', 'action_taken', 'auto_cleared'];
    const method = validMethods.includes(resolution_method) ? resolution_method : 'user_dismissed';

    const result = await query(
      `UPDATE findings
       SET resolved_at = now(), resolution_method = $3
       WHERE id = $1 AND workspace_id = $2 AND resolved_at IS NULL
       RETURNING id, resolved_at, resolution_method, severity, category, message, deal_id, skill_id`,
      [findingId, workspaceId, method]
    );

    if (result.rows.length === 0) {
      const exists = await query(
        'SELECT id, resolved_at FROM findings WHERE id = $1 AND workspace_id = $2',
        [findingId, workspaceId]
      );
      if (exists.rows.length === 0) {
        res.status(404).json({ error: 'Finding not found' });
        return;
      }
      res.status(409).json({
        error: 'Finding already resolved',
        resolved_at: exists.rows[0].resolved_at,
      });
      return;
    }

    console.log(`[findings] Resolved finding ${findingId} via ${method}`);
    res.json(result.rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[findings] Resolve error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
