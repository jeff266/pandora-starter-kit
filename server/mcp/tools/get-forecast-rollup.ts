import { z } from 'zod';
import { query } from '../../db.js';
import { getSkillRegistry } from '../../skills/registry.js';
import { SkillRuntime } from '../../skills/runtime.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  include_rep_breakdown: z.boolean().optional().default(true),
});

export const getForecastRollup: McpTool = {
  name: 'get_forecast_rollup',
  description: [
    'Returns the current forecast rollup by rep and category.',
    'Includes commit, best case, pipeline totals, and attainment vs quota.',
    'Uses the most recent forecast-rollup skill run (< 4 hours) or triggers a fresh one.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      include_rep_breakdown: {
        type: 'boolean',
        description: 'Include per-rep breakdown (default: true)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});

    const recent = await query(`
      SELECT output, created_at
      FROM skill_runs
      WHERE workspace_id = $1
        AND skill_id = 'forecast-rollup'
        AND status = 'completed'
        AND created_at > NOW() - INTERVAL '4 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `, [workspaceId]);

    let output: any;

    if (recent.rows.length) {
      output = recent.rows[0].output;
    } else {
      const registry = getSkillRegistry();
      const skill = registry.get('forecast-rollup');
      if (!skill) throw new Error('forecast-rollup skill not found');
      const runtime = new SkillRuntime();
      const result = await runtime.executeSkill(skill, workspaceId, {});
      const run = await query(
        `SELECT output FROM skill_runs WHERE run_id = $1`,
        [result.runId]
      );
      output = run.rows[0]?.output ?? result.output;
    }

    const summary = output?.summary ?? output?.narrative ?? output;

    const totals = {
      commit: output?.commit ?? output?.totals?.commit ?? null,
      best_case: output?.best_case ?? output?.totals?.best_case ?? null,
      pipeline: output?.pipeline ?? output?.totals?.pipeline ?? null,
      quota: output?.quota ?? output?.totals?.quota ?? null,
      attainment_pct: output?.attainment_pct ?? output?.totals?.attainment_pct ?? null,
    };

    const repBreakdown = input.include_rep_breakdown
      ? (output?.reps ?? output?.rep_breakdown ?? [])
      : [];

    return {
      workspace_id: workspaceId,
      totals,
      rep_breakdown: repBreakdown,
      narrative: typeof summary === 'string' ? summary : null,
      generated_at: new Date().toISOString(),
    };
  },
};
