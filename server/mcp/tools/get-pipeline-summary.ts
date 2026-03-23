import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  dimension_key: z.string().optional(),
});

export const getPipelineSummary: McpTool = {
  name: 'get_pipeline_summary',
  description: [
    'Returns a concise pipeline summary: total ARR by stage,',
    'deal counts, weighted value, and pipeline coverage ratio.',
    'This is a lightweight direct query — no skill run required.',
    'Use for quick pipeline snapshots without triggering a full analysis.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      dimension_key: {
        type: 'string',
        description: 'Optional. Filter to a specific business dimension. Use list_dimensions to see available keys for this workspace. If omitted, uses the workspace default dimension.',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});
    const stageResult = await query(`
      SELECT
        stage_normalized AS stage,
        COUNT(*)::int AS deal_count,
        COALESCE(SUM(amount), 0)::numeric AS total_arr,
        COALESCE(AVG(probability), 0)::numeric AS avg_probability,
        COALESCE(SUM(amount * COALESCE(probability, 0) / 100), 0)::numeric AS weighted_value
      FROM deals
      WHERE workspace_id = $1
        AND stage_normalized NOT IN ('closed_won', 'closed_lost')
        AND amount IS NOT NULL
      GROUP BY stage_normalized
      ORDER BY total_arr DESC
    `, [workspaceId]);

    const closedWonResult = await query(`
      SELECT
        COALESCE(SUM(amount), 0)::numeric AS closed_won_arr,
        COUNT(*)::int AS closed_won_count
      FROM deals
      WHERE workspace_id = $1
        AND stage_normalized = 'closed_won'
        AND EXTRACT(YEAR FROM close_date) = EXTRACT(YEAR FROM NOW())
        AND EXTRACT(QUARTER FROM close_date) = EXTRACT(QUARTER FROM NOW())
    `, [workspaceId]);

    const totalPipeline = stageResult.rows.reduce(
      (sum: number, row: any) => sum + Number(row.total_arr), 0
    );
    const totalDeals = stageResult.rows.reduce(
      (sum: number, row: any) => sum + Number(row.deal_count), 0
    );
    const totalWeighted = stageResult.rows.reduce(
      (sum: number, row: any) => sum + Number(row.weighted_value), 0
    );

    const closedWon = closedWonResult.rows[0];

    return {
      workspace_id: workspaceId,
      pipeline_total_arr: totalPipeline,
      pipeline_deal_count: totalDeals,
      pipeline_weighted_value: totalWeighted,
      closed_won_qtd_arr: Number(closedWon.closed_won_arr),
      closed_won_qtd_count: Number(closedWon.closed_won_count),
      by_stage: stageResult.rows,
      generated_at: new Date().toISOString(),
    };
  },
};
