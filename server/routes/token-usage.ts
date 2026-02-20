import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';

const router = Router();

function parsePeriod(period?: string): string {
  switch (period) {
    case '7d': return '7 days';
    case '90d': return '90 days';
    case '30d':
    default: return '30 days';
  }
}

router.get('/:workspaceId/token-usage/summary', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const period = parsePeriod(req.query.period as string | undefined);
    const periodLabel = req.query.period as string || '30d';

    const totalsResult = await query<{
      total_input: string;
      total_output: string;
      total_tokens: string;
      total_cost: string;
    }>(
      `SELECT
        COALESCE(SUM(input_tokens), 0) AS total_input,
        COALESCE(SUM(output_tokens), 0) AS total_output,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS total_cost
      FROM token_usage
      WHERE workspace_id = $1 AND created_at > NOW() - $2::interval`,
      [workspaceId, period]
    );

    const bySkillResult = await query<{
      skill_id: string;
      runs: string;
      avg_input: string;
      avg_output: string;
      total_cost: string;
      cost_per_run: string;
      first_half_tokens: string;
      second_half_tokens: string;
    }>(
      `WITH skill_stats AS (
        SELECT
          skill_id,
          COUNT(DISTINCT skill_run_id) AS runs,
          ROUND(AVG(input_tokens)) AS avg_input,
          ROUND(AVG(output_tokens)) AS avg_output,
          SUM(estimated_cost_usd) AS total_cost
        FROM token_usage
        WHERE workspace_id = $1 AND created_at > NOW() - $2::interval AND skill_id IS NOT NULL
        GROUP BY skill_id
      ),
      trend AS (
        SELECT
          skill_id,
          COALESCE(SUM(CASE WHEN created_at < NOW() - ($2::interval / 2) THEN total_tokens ELSE 0 END), 0) AS first_half_tokens,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - ($2::interval / 2) THEN total_tokens ELSE 0 END), 0) AS second_half_tokens
        FROM token_usage
        WHERE workspace_id = $1 AND created_at > NOW() - $2::interval AND skill_id IS NOT NULL
        GROUP BY skill_id
      )
      SELECT
        s.skill_id, s.runs::text, s.avg_input::text, s.avg_output::text,
        s.total_cost::text,
        CASE WHEN s.runs > 0 THEN (s.total_cost / s.runs)::text ELSE '0' END AS cost_per_run,
        t.first_half_tokens::text, t.second_half_tokens::text
      FROM skill_stats s
      LEFT JOIN trend t ON t.skill_id = s.skill_id
      ORDER BY s.total_cost DESC`,
      [workspaceId, period]
    );

    const byProviderResult = await query<{
      provider: string;
      tokens: string;
      cost: string;
    }>(
      `SELECT provider,
        COALESCE(SUM(total_tokens), 0)::text AS tokens,
        COALESCE(SUM(estimated_cost_usd), 0)::text AS cost
      FROM token_usage
      WHERE workspace_id = $1 AND created_at > NOW() - $2::interval
      GROUP BY provider`,
      [workspaceId, period]
    );

    const byPhaseResult = await query<{
      phase: string;
      tokens: string;
      cost: string;
    }>(
      `SELECT COALESCE(phase, 'unknown') AS phase,
        COALESCE(SUM(total_tokens), 0)::text AS tokens,
        COALESCE(SUM(estimated_cost_usd), 0)::text AS cost
      FROM token_usage
      WHERE workspace_id = $1 AND created_at > NOW() - $2::interval
      GROUP BY phase`,
      [workspaceId, period]
    );

    const totals = totalsResult.rows[0];

    const bySkill = bySkillResult.rows.map(r => {
      const firstHalf = parseInt(r.first_half_tokens) || 0;
      const secondHalf = parseInt(r.second_half_tokens) || 0;
      let trend = 'stable';
      if (firstHalf > 0 && secondHalf > firstHalf * 1.2) trend = 'increasing';
      else if (firstHalf > 0 && secondHalf < firstHalf * 0.8) trend = 'decreasing';

      return {
        skillId: r.skill_id,
        runs: parseInt(r.runs),
        avgInputTokens: parseInt(r.avg_input),
        avgOutputTokens: parseInt(r.avg_output),
        totalCostUsd: parseFloat(parseFloat(r.total_cost).toFixed(4)),
        costPerRun: parseFloat(parseFloat(r.cost_per_run).toFixed(4)),
        trend,
      };
    });

    const byProvider: Record<string, { tokens: number; costUsd: number }> = {};
    for (const r of byProviderResult.rows) {
      byProvider[r.provider] = {
        tokens: parseInt(r.tokens),
        costUsd: parseFloat(parseFloat(r.cost).toFixed(4)),
      };
    }

    const byPhase: Record<string, { tokens: number; costUsd: number }> = {};
    for (const r of byPhaseResult.rows) {
      byPhase[r.phase] = {
        tokens: parseInt(r.tokens),
        costUsd: parseFloat(parseFloat(r.cost).toFixed(4)),
      };
    }

    res.json({
      period: periodLabel,
      totalTokens: parseInt(totals.total_tokens),
      totalCostUsd: parseFloat(parseFloat(totals.total_cost).toFixed(4)),
      bySkill,
      byProvider,
      byPhase,
    });
  } catch (err) {
    console.error('[Token Usage] Summary error:', err);
    res.status(500).json({ error: 'Failed to get token usage summary' });
  }
});

router.get('/:workspaceId/token-usage/skill/:skillId', async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;

    const runsResult = await query<{
      skill_run_id: string;
      created_at: string;
      phase: string;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      estimated_cost_usd: string;
      payload_summary: any;
      latency_ms: number;
      step_name: string;
    }>(
      `SELECT skill_run_id, created_at::text, phase, provider, model,
        input_tokens, output_tokens, total_tokens,
        estimated_cost_usd::text, payload_summary, latency_ms, step_name
      FROM token_usage
      WHERE workspace_id = $1 AND skill_id = $2
      ORDER BY created_at DESC
      LIMIT 100`,
      [workspaceId, skillId]
    );

    const runMap = new Map<string, any>();
    for (const row of runsResult.rows) {
      const runId = row.skill_run_id || 'unknown';
      if (!runMap.has(runId)) {
        runMap.set(runId, {
          runId,
          timestamp: row.created_at,
          phases: [],
          totalTokens: 0,
          totalCostUsd: 0,
          payloadDiagnostics: {
            largestSection: '',
            largestSectionChars: 0,
            hasSourceData: false,
            hasTranscript: false,
            estimatedTokensBeforeSend: 0,
          },
        });
      }

      const run = runMap.get(runId)!;
      run.phases.push({
        phase: row.phase,
        stepName: row.step_name,
        provider: row.provider,
        model: row.model,
        input: row.input_tokens,
        output: row.output_tokens,
        costUsd: parseFloat(parseFloat(row.estimated_cost_usd).toFixed(6)),
        latencyMs: row.latency_ms,
      });

      run.totalTokens += row.total_tokens;
      run.totalCostUsd += parseFloat(row.estimated_cost_usd);

      const summary = row.payload_summary || {};
      if (summary.largestFieldChars > run.payloadDiagnostics.largestSectionChars) {
        run.payloadDiagnostics.largestSection = summary.largestField || '';
        run.payloadDiagnostics.largestSectionChars = summary.largestFieldChars || 0;
      }
      if (summary.sections?.some((s: any) => s.hasSourceData)) {
        run.payloadDiagnostics.hasSourceData = true;
      }
      if (summary.sections?.some((s: any) => s.hasTranscript)) {
        run.payloadDiagnostics.hasTranscript = true;
      }
      run.payloadDiagnostics.estimatedTokensBeforeSend = Math.max(
        run.payloadDiagnostics.estimatedTokensBeforeSend,
        summary.estimatedTokens || 0
      );
    }

    const last10Runs = Array.from(runMap.values())
      .slice(0, 10)
      .map(r => ({
        ...r,
        totalCostUsd: parseFloat(r.totalCostUsd.toFixed(6)),
      }));

    res.json({
      skillId,
      last10Runs,
    });
  } catch (err) {
    console.error('[Token Usage] Skill detail error:', err);
    res.status(500).json({ error: 'Failed to get skill token usage' });
  }
});

router.get('/:workspaceId/token-usage/anomalies', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const anomaliesResult = await query<{
      skill_id: string;
      skill_run_id: string;
      step_name: string;
      total_tokens: number;
      estimated_cost_usd: string;
      payload_summary: any;
      created_at: string;
      avg_tokens: string;
      stddev_tokens: string;
    }>(
      `SELECT t.skill_id, t.skill_run_id, t.step_name,
        t.total_tokens, t.estimated_cost_usd::text,
        t.payload_summary, t.created_at::text,
        stats.avg_tokens::text, stats.stddev_tokens::text
      FROM token_usage t
      INNER JOIN (
        SELECT skill_id,
          AVG(total_tokens) AS avg_tokens,
          STDDEV(total_tokens) AS stddev_tokens
        FROM token_usage
        WHERE workspace_id = $1 AND skill_id IS NOT NULL
        GROUP BY skill_id
        HAVING COUNT(*) >= 2
      ) stats ON stats.skill_id = t.skill_id
      WHERE t.workspace_id = $1
        AND t.total_tokens > stats.avg_tokens + 2 * COALESCE(stats.stddev_tokens, 0)
      ORDER BY t.created_at DESC
      LIMIT 20`,
      [workspaceId]
    );

    const anomalies = anomaliesResult.rows.map(r => {
      const summary = r.payload_summary || {};
      const recommendations = summary.recommendations || [];

      return {
        skillId: r.skill_id,
        skillRunId: r.skill_run_id,
        stepName: r.step_name,
        totalTokens: r.total_tokens,
        estimatedCostUsd: parseFloat(parseFloat(r.estimated_cost_usd).toFixed(6)),
        timestamp: r.created_at,
        avgTokensForSkill: parseFloat(parseFloat(r.avg_tokens).toFixed(0)),
        stddevTokens: parseFloat(parseFloat(r.stddev_tokens).toFixed(0)),
        deviations: r.stddev_tokens && parseFloat(r.stddev_tokens) > 0
          ? parseFloat(((r.total_tokens - parseFloat(r.avg_tokens)) / parseFloat(r.stddev_tokens)).toFixed(1))
          : null,
        payloadDiagnostics: {
          totalChars: summary.totalChars,
          largestField: summary.largestField,
          largestFieldChars: summary.largestFieldChars,
          hasSourceData: summary.sections?.some((s: any) => s.hasSourceData) || false,
          hasTranscript: summary.sections?.some((s: any) => s.hasTranscript) || false,
        },
        recommendations,
      };
    });

    res.json({ anomalies });
  } catch (err) {
    console.error('[Token Usage] Anomalies error:', err);
    res.status(500).json({ error: 'Failed to get token usage anomalies' });
  }
});

export default router;
