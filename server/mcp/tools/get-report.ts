import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  document_id: z.string().uuid().optional(),
  document_type: z.enum(['wbr', 'qbr']).optional(),
}).refine(d => d.document_id || d.document_type, {
  message: 'Provide document_id or document_type',
});

export const getReport: McpTool = {
  name: 'get_report',
  description: [
    'Fetches an existing WBR or QBR report.',
    'Pass document_id to retrieve a specific report,',
    'or document_type to get the most recently generated report of that type.',
    'Returns the headline, section narratives, and metrics.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'Document UUID from generate_report',
      },
      document_type: {
        type: 'string',
        enum: ['wbr', 'qbr'],
        description: 'Return the most recent report of this type',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args);

    let sql: string;
    let params: any[];

    if (input.document_id) {
      sql = `SELECT * FROM report_documents WHERE id = $1 AND workspace_id = $2`;
      params = [input.document_id, workspaceId];
    } else {
      sql = `SELECT * FROM report_documents
             WHERE workspace_id = $1 AND document_type = $2
             ORDER BY generated_at DESC LIMIT 1`;
      params = [workspaceId, input.document_type];
    }

    const result = await query(sql, params);

    if (!result.rows.length) {
      return {
        error: 'Report not found. Generate one first with generate_report.',
      };
    }

    const doc = result.rows[0];
    const sections = (doc.sections ?? []).map((s: any) => ({
      id: s.id,
      title: s.title,
      narrative: s.narrative ?? s.content ?? null,
      metrics: s.metrics ?? [],
    }));

    return {
      document_id: doc.id,
      document_type: doc.document_type,
      week_label: doc.week_label,
      headline: doc.headline,
      generated_at: doc.generated_at,
      sections,
      section_count: sections.length,
    };
  },
};
