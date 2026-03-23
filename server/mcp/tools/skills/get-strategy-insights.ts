import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';
import { query } from '../../../db.js';
import { maybeAutoSave } from '../types.js';

export const getStrategyInsights: McpTool = {
  name: 'get_strategy_insights',
  description: [
    'Returns strategic GTM insights synthesized across all skill data.',
    'Includes the big picture, leading indicators, contradictions in the data, and specific strategic recommendations.',
    'The highest-level analysis Pandora produces.',
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
      `SELECT run_id, output, output_text, created_at
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'strategy-insights'
         AND status = 'completed'
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    );

    let runId: string;
    let narrative: string;
    let ranAt: string;

    if (recent.rows.length > 0) {
      const row = recent.rows[0];
      runId = row.run_id;
      const out = row.output;
      narrative =
        row.output_text ??
        out?.narrative ??
        (typeof out === 'string' ? out : '') ??
        '';
      ranAt = row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at);
    } else {
      const result = await runSkillWithAutoSave(
        workspaceId,
        'strategy-insights',
        {},
        false,
        'get_strategy_insights'
      );
      runId = result.run_id;
      narrative = result.narrative ?? '';
      ranAt = new Date().toISOString();
    }

    if (save && narrative) {
      await maybeAutoSave(
        workspaceId,
        'strategy-insights',
        narrative.slice(0, 1000),
        'strategic',
        'info',
        'get_strategy_insights'
      );
    }

    return {
      skill_id: 'strategy-insights',
      run_id: runId,
      narrative: narrative.slice(0, 5000),
      saved: save && !!narrative,
      ran_at: ranAt,
      generated_at: new Date().toISOString(),
    };
  },
};
