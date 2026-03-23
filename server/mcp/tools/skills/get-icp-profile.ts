import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';
import { query } from '../../../db.js';
import { maybeAutoSave } from '../types.js';

export const getICPProfile: McpTool = {
  name: 'get_icp_profile',
  description: [
    'Returns the Ideal Customer Profile analysis for this workspace.',
    'Includes winning personas, industry breakdown, pipeline alignment, and deal size by persona.',
    'Runs monthly. Cache: 30 days. Pass save: false to skip.',
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

    // 30-day cache for monthly skill
    const recent = await query(
      `SELECT run_id, output, output_text
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'icp-discovery'
         AND status = 'completed'
         AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    );

    let runId: string;
    let rawOutput: any;

    if (recent.rows.length > 0) {
      const row = recent.rows[0];
      runId = row.run_id;
      rawOutput = row.output_text ?? row.output;
    } else {
      const result = await runSkillWithAutoSave(
        workspaceId,
        'icp-discovery',
        {},
        false,
        'get_icp_profile'
      );
      runId = result.run_id;
      rawOutput = result.output;
    }

    // Output is a plain string (rich markdown ICP report)
    const narrative: string =
      typeof rawOutput === 'string'
        ? rawOutput
        : rawOutput?.narrative ?? '';

    if (save && narrative) {
      await maybeAutoSave(
        workspaceId,
        'icp-discovery',
        narrative.slice(0, 1000),
        'strategic',
        'info',
        'get_icp_profile'
      );
    }

    return {
      skill_id: 'icp-discovery',
      run_id: runId,
      narrative: narrative.slice(0, 4000),
      saved: save && !!narrative,
      generated_at: new Date().toISOString(),
    };
  },
};
