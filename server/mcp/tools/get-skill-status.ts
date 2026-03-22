import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  run_id: z.string().uuid(),
});

export const getSkillStatus: McpTool = {
  name: 'get_skill_status',
  description: [
    'Fetches the full output of a skill run by run_id.',
    'Use this after run_skill to retrieve the complete structured output,',
    'evidence, and narrative. The run_id is returned by run_skill.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['run_id'],
    properties: {
      run_id: {
        type: 'string',
        description: 'Skill run UUID returned by run_skill',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args);

    const result = await query(`
      SELECT
        run_id, skill_id, status, trigger_type,
        output, output_text, steps, token_usage,
        duration_ms, error, started_at, completed_at
      FROM skill_runs
      WHERE run_id = $1 AND workspace_id = $2
    `, [input.run_id, workspaceId]);

    if (!result.rows.length) {
      return {
        error: `No skill run found with run_id ${input.run_id}`,
      };
    }

    const row = result.rows[0];

    return {
      run_id: row.run_id,
      skill_id: row.skill_id,
      status: row.status,
      output_text: row.output_text,
      output: row.output,
      duration_ms: row.duration_ms,
      completed_at: row.completed_at,
      error: row.error ?? null,
    };
  },
};
