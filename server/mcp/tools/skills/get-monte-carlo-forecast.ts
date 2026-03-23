import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';
import { query } from '../../../db.js';
import { maybeAutoSave } from '../types.js';

export const getMonteCarlo: McpTool = {
  name: 'get_monte_carlo_forecast',
  description: [
    'Returns Monte Carlo revenue forecast simulation results.',
    'Includes probability distribution (P25/P50/P75), gap to quota target, and key drivers of forecast variance.',
    'Cache: 7 days. Pass save: false to skip auto-save.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      save: {
        type: 'boolean',
        description: 'Auto-save results to Pandora (default: true)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const save = args.save !== false;

    // 7-day cache
    const recent = await query(
      `SELECT run_id, output, output_text
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'monte-carlo-forecast'
         AND status = 'completed'
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    );

    let runId: string;
    let narrative: string;

    if (recent.rows.length > 0) {
      const row = recent.rows[0];
      runId = row.run_id;
      const out = row.output;
      narrative =
        row.output_text ??
        out?.narrative ??
        (typeof out === 'string' ? out : '') ??
        '';
    } else {
      const result = await runSkillWithAutoSave(
        workspaceId,
        'monte-carlo-forecast',
        {},
        false,
        'get_monte_carlo_forecast'
      );
      runId = result.run_id;
      narrative = result.narrative ?? '';
    }

    // Extract P50 from narrative: "most likely outcome is $1,378,731" or "P50: $1,378,731"
    const p50Match =
      narrative.match(/most likely outcome is \$?([\d,]+)/i) ??
      narrative.match(/P50[:\s]+\$?([\d,]+)/i);
    const p50 = p50Match
      ? parseInt(p50Match[1].replace(/,/g, ''), 10)
      : null;

    // Extract hit probability: "26% shot at"
    const probMatch = narrative.match(/(\d+)%\s+shot/i);
    const targetProbability = probMatch
      ? parseInt(probMatch[1], 10)
      : null;

    if (save && narrative) {
      await maybeAutoSave(
        workspaceId,
        'monte-carlo-forecast',
        narrative.slice(0, 1000),
        'forecast',
        'info',
        'get_monte_carlo_forecast'
      );
    }

    return {
      skill_id: 'monte-carlo-forecast',
      run_id: runId,
      p50_forecast: p50,
      target_hit_probability_pct: targetProbability,
      narrative: narrative.slice(0, 3000),
      saved: save && !!narrative,
      generated_at: new Date().toISOString(),
    };
  },
};
