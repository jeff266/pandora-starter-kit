import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  min_amount: z.number().optional(),
  limit: z.number().optional().default(20),
});

export const getAtRiskDeals: McpTool = {
  name: 'get_at_risk_deals',
  description: [
    'Returns deals currently at risk of slipping or being lost.',
    'Includes risk score, days since activity, single-thread status,',
    'and close date for each deal. Sorted by deal_risk descending.',
    'Excludes closed deals.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      min_amount: {
        type: 'number',
        description: 'Only return deals above this amount',
      },
      limit: {
        type: 'number',
        description: 'Max deals to return (default: 20, max: 50)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});
    const limit = Math.min(input.limit ?? 20, 50);

    const conditions: string[] = [
      `d.workspace_id = $1`,
      `d.deal_risk IS NOT NULL`,
      `d.stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    ];
    const params: any[] = [workspaceId];
    let i = 2;

    if (input.min_amount != null) {
      conditions.push(`d.amount >= $${i++}`);
      params.push(input.min_amount);
    }

    params.push(limit);

    const result = await query(`
      SELECT
        d.id,
        d.name,
        d.amount,
        d.stage_normalized AS stage,
        d.owner,
        d.owner_email,
        d.close_date,
        d.deal_risk,
        d.health_score,
        d.last_activity_date,
        d.days_in_stage,
        EXTRACT(DAY FROM NOW() - d.last_activity_date)::int AS days_since_activity
      FROM deals d
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.deal_risk DESC NULLS LAST
      LIMIT $${i}
    `, params);

    return {
      at_risk_deals: result.rows,
      count: result.rows.length,
      generated_at: new Date().toISOString(),
    };
  },
};
