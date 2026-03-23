import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';
import { query } from '../../../db.js';
import { maybeAutoSave } from '../types.js';

export const getCompetitiveLandscape: McpTool = {
  name: 'get_competitive_landscape',
  description: [
    'Returns competitive intelligence from sales call transcripts.',
    'Includes win/loss rates by competitor, objection themes, and pricing patterns.',
    'Requires call transcript data with competitor mentions.',
    'Cache: 30 days. Pass save: false to skip auto-save.',
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
         AND skill_id = 'competitive-intelligence'
         AND status = 'completed'
         AND created_at > NOW() - INTERVAL '30 days'
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
        'competitive-intelligence',
        {},
        false,
        'get_competitive_landscape'
      );
      runId = result.run_id;
      narrative = result.narrative ?? '';
    }

    const noData =
      narrative.toLowerCase().includes('no competitive data') ||
      narrative.toLowerCase().includes('zero competitor');

    const competitorMatch = narrative.match(/(\d+)\s+competitor/i);
    const competitorCount = competitorMatch
      ? parseInt(competitorMatch[1], 10)
      : null;

    if (save && narrative && !noData) {
      await maybeAutoSave(
        workspaceId,
        'competitive-intelligence',
        narrative.slice(0, 1000),
        'competitive',
        'info',
        'get_competitive_landscape'
      );
    }

    return {
      skill_id: 'competitive-intelligence',
      run_id: runId,
      status: noData ? 'no_data' : 'sufficient',
      competitor_count: noData ? 0 : competitorCount,
      narrative: narrative.slice(0, 3000),
      saved: save && !noData,
      generated_at: new Date().toISOString(),
    };
  },
};
