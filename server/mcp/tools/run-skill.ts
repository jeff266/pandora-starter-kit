import { z } from 'zod';
import { query } from '../../db.js';
import { getSkillRegistry } from '../../skills/registry.js';
import { SkillRuntime } from '../../skills/runtime.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  skill_id: z.string().min(1),
  params: z.record(z.any()).optional().default({}),
});

export const runSkill: McpTool = {
  name: 'run_skill',
  description: [
    'Runs any registered Pandora skill on demand.',
    'Skills produce structured findings, narratives, and evidence.',
    'Common skill IDs: pipeline-hygiene, deal-risk-review, forecast-rollup,',
    'rep-scorecard, weekly-recap, pipeline-coverage, monte-carlo-forecast,',
    'competitive-intelligence, gtm-health-diagnostic.',
    'Use get_skill_status to retrieve the full output by run_id after execution.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['skill_id'],
    properties: {
      skill_id: {
        type: 'string',
        description: 'Skill ID to run (e.g. "pipeline-hygiene", "deal-risk-review")',
      },
      params: {
        type: 'object',
        description: 'Optional params to pass to the skill (skill-specific)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args);

    const registry = getSkillRegistry();
    const skill = registry.get(input.skill_id);
    if (!skill) {
      const allSkills = registry.getAll ? registry.getAll() : [];
      const available = Array.isArray(allSkills)
        ? allSkills.map((s: any) => s.id).join(', ')
        : 'use list_skills to see available skills';
      throw new Error(
        `Skill not found: "${input.skill_id}". Available: ${available}`
      );
    }

    const runtime = new SkillRuntime();
    const result = await runtime.executeSkill(skill, workspaceId, input.params);

    const run = await query(
      `SELECT output, output_text FROM skill_runs WHERE run_id = $1`,
      [result.runId]
    );

    const fullOutput = run.rows[0]?.output ?? result.output;
    const text = run.rows[0]?.output_text ?? null;

    return {
      run_id: result.runId,
      skill_id: input.skill_id,
      status: result.status,
      duration_ms: result.totalDuration_ms,
      output_text: text,
      output: fullOutput,
    };
  },
};
