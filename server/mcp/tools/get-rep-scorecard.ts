import { z } from 'zod';
import { query } from '../../db.js';
import { getSkillRegistry } from '../../skills/registry.js';
import { SkillRuntime } from '../../skills/runtime.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  rep_email: z.string().optional(),
});

export const getRepScorecard: McpTool = {
  name: 'get_rep_scorecard',
  description: [
    'Returns rep performance scorecard.',
    'Includes QTD attainment, pipeline coverage, activity metrics,',
    'and deal velocity per rep. Optionally filter to a single rep by email.',
    'Uses the most recent rep-scorecard skill run (< 8 hours) or triggers a fresh one.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      rep_email: {
        type: 'string',
        description: 'Filter to a specific rep by email (optional — returns all reps if omitted)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});

    const recent = await query(`
      SELECT output, created_at
      FROM skill_runs
      WHERE workspace_id = $1
        AND skill_id = 'rep-scorecard'
        AND status = 'completed'
        AND created_at > NOW() - INTERVAL '8 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `, [workspaceId]);

    let output: any;

    if (recent.rows.length) {
      output = recent.rows[0].output;
    } else {
      const registry = getSkillRegistry();
      const skill = registry.get('rep-scorecard');
      if (!skill) throw new Error('rep-scorecard skill not found');
      const runtime = new SkillRuntime();
      const result = await runtime.executeSkill(skill, workspaceId, {});
      const run = await query(
        `SELECT output FROM skill_runs WHERE run_id = $1`,
        [result.runId]
      );
      output = run.rows[0]?.output ?? result.output;
    }

    const reps: any[] = output?.reps ?? output?.scorecard ?? output?.rep_scorecards ?? [];

    const filtered = input.rep_email
      ? reps.filter((r: any) =>
          r.email?.toLowerCase() === input.rep_email!.toLowerCase() ||
          r.owner_email?.toLowerCase() === input.rep_email!.toLowerCase()
        )
      : reps;

    return {
      workspace_id: workspaceId,
      reps: filtered,
      count: filtered.length,
      generated_at: new Date().toISOString(),
    };
  },
};
