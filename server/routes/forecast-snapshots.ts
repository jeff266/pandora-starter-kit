import { Router } from 'express';
import { query } from '../db.js';
import { WorkspaceConfigLoader } from '../config/workspace-config-loader.js';

const router = Router();
const configLoader = new WorkspaceConfigLoader();

router.get('/:id/forecast/snapshots', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;
    const { limit: limitParam } = req.query;
    const limit = Math.min(parseInt(limitParam as string) || 13, 26);

    const config = await configLoader.getConfig(workspaceId);
    const fiscalYearStartMonth = config.cadence?.fiscal_year_start_month || 1;

    const runs = await query(
      `SELECT run_id, completed_at, result, output, params
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'forecast-rollup'
         AND status = 'completed'
         AND result IS NOT NULL
       ORDER BY completed_at DESC
       LIMIT $2`,
      [workspaceId, limit]
    );

    // Fetch latest Monte Carlo results
    const mcResult = await query(
      `SELECT result
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'monte-carlo-forecast'
         AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [workspaceId]
    );
    const mcData = mcResult.rows[0]?.result;
    const mcCommandCenter = mcData?.commandCenter || null;

    const snapshots = runs.rows.map((row: any) => {
      const result = row.result || {};
      const output = row.output || {};
      const params = row.params || {};
      const team = result.forecast_data?.team || {};
      const byRep = result.forecast_data?.byRep || [];
      const annotations = output.annotations || result.final_annotations || [];
      const quotaConfig = result.quota_config || {};
      const wowDelta = result.wow_delta || {};

      return {
        run_id: row.run_id,
        snapshot_date: row.completed_at,
        scope_id: params.scope_id || null,
        stage_weighted_forecast: team.weightedForecast || null,
        category_weighted_forecast: team.baseCase || null,
        monte_carlo_p50: mcCommandCenter?.p50 || null,
        monte_carlo_p25: mcCommandCenter?.p25 || null,
        monte_carlo_p75: mcCommandCenter?.p75 || null,
        monte_carlo_p10: mcCommandCenter?.p10 || null,
        monte_carlo_p90: mcCommandCenter?.p90 || null,
        attainment: team.closedWon || null,
        quota: team.teamQuota || quotaConfig.team_quota || null,
        total_pipeline: team.pipeline || null,
        weighted_pipeline: team.weightedForecast || null,
        deal_count: byRep.reduce((sum: number, r: any) => sum + (r.dealCount || 0), 0) || null,
        commit: team.commit || 0,
        best_case: team.bestCase || 0,
        bear_case: team.bearCase || null,
        bull_case: team.bullCase || null,
        attainment_pct: team.attainment || null,
        pipe_gen_this_week: wowDelta.pipeline_delta || null,
        pipe_gen_avg: null,
        coverage_ratio: team.teamQuota ? (team.pipeline || 0) / team.teamQuota : null,
        by_rep: byRep.map((r: any) => ({
          rep_name: r.name || 'Unknown',
          rep_email: r.email || '',
          deals: r.dealCount || 0,
          pipeline: r.pipeline || 0,
          stage_weighted: r.weightedForecast || 0,
          category_weighted: r.baseCase || 0,
          closed_won: r.closedWon || 0,
          commit: r.commit || 0,
          best_case: r.bestCase || 0,
          quota: r.quota || 0,
          attainment: r.attainment || 0,
          status: r.status || null,
        })),
        annotation_count: annotations.length,
      };
    });

    snapshots.reverse();

    res.json({
      snapshots,
      total: snapshots.length,
      workspace_id: workspaceId,
      fiscal_year_start_month: fiscalYearStartMonth,
    });
  } catch (err: any) {
    console.error('[ForecastSnapshots] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch forecast snapshots' });
  }
});

export default router;
