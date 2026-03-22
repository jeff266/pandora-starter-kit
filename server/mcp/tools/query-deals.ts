import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  stage: z.string().optional(),
  owner_email: z.string().optional(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  closing_before: z.string().optional(),
  closing_after: z.string().optional(),
  limit: z.number().optional().default(25),
  include_closed: z.boolean().optional().default(false),
});

export const queryDeals: McpTool = {
  name: 'query_deals',
  description: [
    'Query deals from the CRM with optional filters.',
    'Returns deal name, amount, stage, owner, close date,',
    'health score, and risk score. Excludes closed deals by default.',
    'Use closing_before/closing_after (ISO date strings) to find',
    'deals in a close date range.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        description: 'Filter by normalized stage name (e.g. "discovery", "proposal")',
      },
      owner_email: {
        type: 'string',
        description: 'Filter by rep email',
      },
      min_amount: {
        type: 'number',
        description: 'Minimum deal amount',
      },
      max_amount: {
        type: 'number',
        description: 'Maximum deal amount',
      },
      closing_before: {
        type: 'string',
        description: 'ISO date — deals closing on or before this date (e.g. "2026-03-31")',
      },
      closing_after: {
        type: 'string',
        description: 'ISO date — deals closing on or after this date',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 25, max: 100)',
      },
      include_closed: {
        type: 'boolean',
        description: 'Include closed_won and closed_lost deals (default: false)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});
    const limit = Math.min(input.limit ?? 25, 100);

    const conditions: string[] = ['d.workspace_id = $1'];
    const params: any[] = [workspaceId];
    let i = 2;

    if (input.stage) {
      conditions.push(`d.stage_normalized = $${i++}`);
      params.push(input.stage);
    }
    if (input.owner_email) {
      conditions.push(`d.owner_email = $${i++}`);
      params.push(input.owner_email);
    }
    if (input.min_amount != null) {
      conditions.push(`d.amount >= $${i++}`);
      params.push(input.min_amount);
    }
    if (input.max_amount != null) {
      conditions.push(`d.amount <= $${i++}`);
      params.push(input.max_amount);
    }
    if (input.closing_before) {
      conditions.push(`d.close_date <= $${i++}`);
      params.push(input.closing_before);
    }
    if (input.closing_after) {
      conditions.push(`d.close_date >= $${i++}`);
      params.push(input.closing_after);
    }
    if (!input.include_closed) {
      conditions.push(`d.stage_normalized NOT IN ('closed_won', 'closed_lost')`);
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
        d.probability,
        d.forecast_category,
        d.last_activity_date
      FROM deals d
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.amount DESC NULLS LAST
      LIMIT $${i}
    `, params);

    return {
      deals: result.rows,
      count: result.rows.length,
    };
  },
};
