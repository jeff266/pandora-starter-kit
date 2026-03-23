import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';

export const getFunnelAnalysis: McpTool = {
  name: 'get_funnel_analysis',
  description: [
    'Returns bowtie funnel analysis with stage-by-stage conversion rates.',
    'Identifies the biggest bottleneck in the pipeline funnel.',
    'Cache: 7 days (runs monthly but results stay fresh). Pass save: false to skip.',
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

    const result = await runSkillWithAutoSave(
      workspaceId,
      'bowtie-analysis',
      {},
      save,
      'get_funnel_analysis'
    );

    const output = result.output ?? {};
    const evidence = output.evidence ?? {};
    const records: any[] = evidence.evaluated_records ?? [];
    const claims: any[] = evidence.claims ?? [];

    // evaluated_records represent stage transitions
    const funnelStages = records.map((r: any) => ({
      transition: r.entity_name ?? r.fields?.stage_transition,
      volume: r.fields?.volume ?? 0,
      conversion_rate: r.fields?.conversion_rate ?? 0,
      prior_rate: r.fields?.prior_rate ?? null,
      delta: r.fields?.delta ?? null,
      bottleneck_severity: r.flags?.bottleneck_severity ?? r.severity ?? 'unknown',
      intervention: r.flags?.intervention ?? null,
    }));

    // Lowest conversion_rate with non-zero volume = worst bottleneck
    const bottleneckFromRecords = funnelStages
      .filter((s: any) => s.volume > 0)
      .sort((a: any, b: any) => a.conversion_rate - b.conversion_rate)[0] ?? null;

    // Fall back to claims if records are empty
    const bottleneckClaim = claims.find(
      (c: any) => c.claim_id === 'conversion_bottleneck'
    );

    const bottleneck = bottleneckFromRecords ?? (bottleneckClaim
      ? {
          transition: bottleneckClaim.claim_text,
          conversion_rate: bottleneckClaim.metric_values?.[0] ?? null,
          bottleneck_severity: bottleneckClaim.severity,
          volume: null,
          prior_rate: null,
          delta: null,
          intervention: null,
        }
      : null);

    return {
      skill_id: 'bowtie-analysis',
      run_id: result.run_id,
      funnel_stages: funnelStages,
      bottleneck,
      top_findings: result.top_findings,
      narrative: result.narrative?.slice(0, 2000) ?? '',
      saved: result.saved,
      generated_at: new Date().toISOString(),
    };
  },
};
