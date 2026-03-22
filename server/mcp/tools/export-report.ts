import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  document_id: z.string().uuid(),
});

export const exportReportToGoogleDocs: McpTool = {
  name: 'export_report_to_google_docs',
  description: [
    'Returns Google Docs status for an existing WBR or QBR report.',
    'If the report was already exported to Google Docs during generation,',
    'returns the Google Docs URL. If not yet exported, indicates that',
    'Google Drive delivery must be configured in the workspace settings.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['document_id'],
    properties: {
      document_id: {
        type: 'string',
        description: 'Report document UUID to check or export',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args);

    const result = await query(`
      SELECT
        id,
        document_type,
        week_label,
        google_doc_url,
        google_doc_id,
        google_doc_last_exported_at
      FROM report_documents
      WHERE id = $1 AND workspace_id = $2
    `, [input.document_id, workspaceId]);

    if (!result.rows.length) {
      throw new Error(`Report ${input.document_id} not found`);
    }

    const doc = result.rows[0];

    if (doc.google_doc_url) {
      return {
        document_id: doc.id,
        document_type: doc.document_type,
        week_label: doc.week_label,
        google_doc_url: doc.google_doc_url,
        google_doc_id: doc.google_doc_id,
        last_exported_at: doc.google_doc_last_exported_at,
        status: 'exported',
      };
    }

    return {
      document_id: doc.id,
      document_type: doc.document_type,
      week_label: doc.week_label,
      google_doc_url: null,
      status: 'not_exported',
      message: 'This report has not been exported to Google Docs. ' +
        'Configure Google Drive delivery in workspace report settings to enable automatic export.',
    };
  },
};
