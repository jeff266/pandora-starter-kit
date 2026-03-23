import { z } from 'zod';
import type { McpTool } from './index.js';
import { runSkillWithAutoSave } from './skills/helpers.js';

const InputSchema = z.object({
  include_rep_breakdown: z.boolean().optional().default(true),
  save: z.boolean().optional().default(true),
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
      save: {
        type: 'boolean',
        description: 'Auto-save findings to claude_insights (default: true)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});

    const result = await runSkillWithAutoSave(
      workspaceId,
      'forecast-rollup',
      {},
      input.save,
      'get_forecast_rollup'
    );

    const output = result.output ?? {};
    const evidence = output.evidence ?? {};
    const claims: any[] = evidence.claims ?? [];
    const narrative = result.narrative ?? '';

    const findClaim = (id: string) =>
      claims.find((c: any) => c.claim_id === id);

    const commitClaim =
      findClaim('commit_total') ??
      findClaim('forecast_commit') ??
      claims.find((c: any) => c.metric_name?.includes('commit'));

    const pipelineClaim =
      findClaim('pipeline_total') ??
      claims.find((c: any) => c.metric_name?.includes('pipeline'));

    const attainmentClaim =
      findClaim('attainment_pct') ??
      findClaim('team_attainment') ??
      claims.find((c: any) => c.metric_name?.includes('attainment'));

    const records: any[] = evidence.evaluated_records ?? [];
    const repBreakdown = input.include_rep_breakdown
      ? records
          .filter((r: any) => r.entity_type === 'rep' || r.fields?.owner_email)
          .slice(0, 20)
          .map((r: any) => ({
            name: r.entity_name ?? r.fields?.owner_name,
            email: r.owner_email ?? r.fields?.owner_email,
            attainment_pct: r.fields?.attainment_pct,
            commit: r.fields?.commit,
            pipeline: r.fields?.pipeline,
            status: r.flags?.status ?? r.severity,
          }))
      : [];

    return {
      skill_id: 'forecast-rollup',
      run_id: result.run_id,
      commit: commitClaim?.metric_values?.[0] ?? null,
      pipeline_total: pipelineClaim?.metric_values?.[0] ?? null,
      attainment_pct: attainmentClaim?.metric_values?.[0] ?? null,
      top_findings: result.top_findings,
      rep_breakdown: repBreakdown,
      narrative,
      saved: result.saved,
      generated_at: new Date().toISOString(),
    };
  },
};
