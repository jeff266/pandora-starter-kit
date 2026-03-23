import { z } from 'zod';
import type { McpTool } from './index.js';
import { runSkillWithAutoSave } from './skills/helpers.js';

const InputSchema = z.object({
  skill_id: z.string().min(1),
  params: z.record(z.string(), z.any()).optional().default({}),
  save: z.boolean().optional().default(true),
  dimension_key: z.string().optional(),
});

export const runSkill: McpTool = {
  name: 'run_skill',
  description: [
    'Runs any Pandora skill on demand. Auto-saves results as Claude insights. Pass save: false to skip persistence.',
    '',
    'Available skill IDs:',
    'Pipeline: bowtie-analysis, gtm-health-diagnostic, pipeline-conversion-rate, pipeline-coverage,',
    'pipeline-gen-forecast, pipeline-goals, pipeline-hygiene, pipeline-movement,',
    'pipeline-progression, pipeline-waterfall, quarterly-pre-mortem',
    '',
    'Forecasting: forecast-accuracy-tracking, forecast-model, forecast-rollup,',
    'monte-carlo-forecast, pipeline-contribution-forecast',
    '',
    'Intelligence: behavioral-winning-path, coaching, icp-discovery, icp-taxonomy-builder, strategy-insights',
    '',
    'Scoring: deal-rfm-scoring, deal-scoring-model, lead-scoring',
    '',
    'Deals: deal-risk-review',
    '',
    'Enrichment: contact-role-resolution, custom-field-discovery, voice-pattern-extraction',
    '',
    'Reporting: competitive-intelligence',
    '',
    'Operations: data-quality-audit, workspace-config-audit',
    '',
    'Calls: conversation-intelligence',
    '',
    'Other: rep-scorecard, single-thread-alert, stage-mismatch-detector,',
    'stage-velocity-benchmarks, weekly-recap, project-recap',
    '',
    'Note: Results are cached for 4 hours. Pass params to override skill-specific options.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    required: ['skill_id'],
    properties: {
      skill_id: {
        type: 'string',
        description: 'Skill ID from the list above (e.g. "pipeline-hygiene", "deal-risk-review")',
      },
      params: {
        type: 'object',
        description: 'Optional params to pass to the skill (skill-specific)',
      },
      save: {
        type: 'boolean',
        description: 'Auto-save insight summary to Pandora (default: true)',
      },
      dimension_key: {
        type: 'string',
        description: 'Optional. Filter to a specific business dimension. Use list_dimensions to see available keys for this workspace. If omitted, uses the workspace default dimension.',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args);
    const params = input.dimension_key
      ? { ...input.params, dimension_key: input.dimension_key }
      : input.params;
    return runSkillWithAutoSave(
      workspaceId,
      input.skill_id,
      params,
      input.save,
      `run_skill: ${input.skill_id}`
    );
  },
};
