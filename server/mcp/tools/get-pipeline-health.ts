import { z } from 'zod';
import { query } from '../../db.js';
import { getSkillRegistry } from '../../skills/registry.js';
import { SkillRuntime } from '../../skills/runtime.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  include_stale_deals: z.boolean().optional().default(true),
  include_single_thread: z.boolean().optional().default(true),
  dimension_key: z.string().optional(),
});

export const getPipelineHealth: McpTool = {
  name: 'get_pipeline_health',
  description: [
    'Returns pipeline health findings for the workspace.',
    'Includes stale deals, single-threaded deals, coverage ratio,',
    'and data quality issues. Runs the pipeline-hygiene skill on demand',
    'and returns structured findings with deal-level detail.',
    'Reuses a cached run if one completed within the last 4 hours.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      include_stale_deals: {
        type: 'boolean',
        description: 'Include stale deal findings (default: true)',
      },
      include_single_thread: {
        type: 'boolean',
        description: 'Include single-threaded deal findings (default: true)',
      },
      dimension_key: {
        type: 'string',
        description: 'Optional. Filter to a specific business dimension. Use list_dimensions to see available keys for this workspace. If omitted, uses the workspace default dimension.',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});

    const recent = await query(`
      SELECT output, created_at
      FROM skill_runs
      WHERE workspace_id = $1
        AND skill_id = 'pipeline-hygiene'
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
      const skill = registry.get('pipeline-hygiene');
      if (!skill) throw new Error('pipeline-hygiene skill not found');
      const runtime = new SkillRuntime();
      const result = await runtime.executeSkill(skill, workspaceId, input.dimension_key ? { dimension_key: input.dimension_key } : {});
      const run = await query(
        `SELECT output FROM skill_runs WHERE run_id = $1`,
        [result.runId]
      );
      output = run.rows[0]?.output ?? result.output;
    }

    const evidence = output?.evidence ?? {};
    const claims: any[] = evidence.claims ?? [];
    const records: any[] = evidence.evaluated_records ?? [];

    const findings = claims.map((c: any) => ({
      finding: c.claim_text,
      severity: c.severity,
      metric: c.metric_name,
      value: c.metric_values?.[0],
      deal_count: c.entity_ids?.length ?? 0,
    }));

    const staleRecords = records.filter((r: any) => r.flags?.stale_flag === 'stale');
    const singleThread = records.filter((r: any) => r.flags?.single_thread === true);

    const staleDeals = input.include_stale_deals
      ? staleRecords.slice(0, 20).map((r: any) => ({
          name: r.entity_name,
          amount: r.fields?.amount,
          owner: r.owner_name,
          stage: r.fields?.stage,
          days_dark: r.fields?.days_since_activity,
        }))
      : [];

    const singleThreadDeals = input.include_single_thread
      ? singleThread.slice(0, 20).map((r: any) => ({
          name: r.entity_name,
          amount: r.fields?.amount,
          owner: r.owner_name,
          stage: r.fields?.stage,
          contact_count: r.fields?.contact_count,
        }))
      : [];

    return {
      workspace_id: workspaceId,
      findings,
      stale_deals: staleDeals,
      total_stale: staleRecords.length,
      single_thread_deals: singleThreadDeals,
      total_single_thread: singleThread.length,
      generated_at: new Date().toISOString(),
    };
  },
};
