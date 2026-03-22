import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  document_type: z.enum(['wbr', 'qbr']).optional(),
  limit: z.number().optional().default(10),
});

export const listReports: McpTool = {
  name: 'list_reports',
  description: [
    'Lists generated WBR and QBR reports for the workspace.',
    'Returns document IDs, types, period labels, and generation timestamps.',
    'Use document_type to filter to only WBR or only QBR.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        enum: ['wbr', 'qbr'],
        description: 'Filter to a specific report type (optional)',
      },
      limit: {
        type: 'number',
        description: 'Max reports to return (default: 10, max: 50)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});
    const limit = Math.min(input.limit ?? 10, 50);

    const conditions: string[] = ['workspace_id = $1'];
    const params: any[] = [workspaceId];
    let i = 2;

    if (input.document_type) {
      conditions.push(`document_type = $${i++}`);
      params.push(input.document_type);
    }

    params.push(limit);

    const result = await query(`
      SELECT id, document_type, week_label, headline, generated_at
      FROM report_documents
      WHERE ${conditions.join(' AND ')}
      ORDER BY generated_at DESC
      LIMIT $${i}
    `, params);

    return {
      reports: result.rows,
      count: result.rows.length,
    };
  },
};
