import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';
import { query } from '../../../db.js';
import { maybeAutoSave } from '../types.js';

export const getCallThemes: McpTool = {
  name: 'get_call_themes',
  description: [
    'Returns conversation intelligence themes from recent sales calls.',
    'Includes objection patterns, win/loss language, and call quality signals.',
    'Requires 5+ summarized call transcripts to generate output.',
    'Cache: 12 hours. Pass save: false to skip auto-save.',
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

    // 12-hour cache (weekly skill with slower cadence)
    const recent = await query(
      `SELECT run_id, output, output_text, created_at
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'conversation-intelligence'
         AND status = 'completed'
         AND created_at > NOW() - INTERVAL '12 hours'
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
        'conversation-intelligence',
        {},
        false,
        'get_call_themes'
      );
      runId = result.run_id;
      narrative = result.narrative ?? '';
    }

    const insufficient =
      narrative.toLowerCase().includes('insufficient data') ||
      narrative.toLowerCase().includes('insufficient_data') ||
      /0\s+of\s+\d+\s+calls/.test(narrative);

    if (save && narrative && !insufficient) {
      await maybeAutoSave(
        workspaceId,
        'conversation-intelligence',
        narrative.slice(0, 1000),
        'coaching',
        'info',
        'get_call_themes'
      );
    }

    return {
      skill_id: 'conversation-intelligence',
      run_id: runId,
      status: insufficient ? 'insufficient_data' : 'sufficient',
      status_message: insufficient
        ? 'Not enough summarized calls yet. Requires 5+ calls with transcripts.'
        : null,
      narrative: narrative.slice(0, 3000),
      saved: save && !insufficient,
      generated_at: new Date().toISOString(),
    };
  },
};
