import { z } from 'zod';
import { query } from '../../db.js';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  document_type: z.enum(['wbr', 'qbr']),
  period_label: z.string().optional(),
});

function defaultPeriodLabel(docType: 'wbr' | 'qbr'): string {
  const now = new Date();
  if (docType === 'wbr') {
    return `Week of ${now.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })}`;
  }
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${q} ${now.getFullYear()}`;
}

export const generateReportTool: McpTool = {
  name: 'generate_report',
  description: [
    'Generates a WBR (Weekly Business Review) or QBR (Quarterly Business Review)',
    'from the latest skill data. Returns the report document ID.',
    'Generation is synchronous and takes 15–45 seconds.',
    'Use get_report to retrieve the content after generation.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['document_type'],
    properties: {
      document_type: {
        type: 'string',
        enum: ['wbr', 'qbr'],
        description: 'Type of report to generate',
      },
      period_label: {
        type: 'string',
        description: 'Human label for the period, e.g. "Week of March 17, 2026" or "Q1 2026"',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args);
    const templateKey = input.document_type === 'wbr' ? 'wbr_standard' : 'qbr_standard';

    const templateResult = await query(`
      SELECT id FROM report_templates
      WHERE workspace_id = $1
        AND created_from_template = $2
        AND is_active = true
      LIMIT 1
    `, [workspaceId, templateKey]);

    if (!templateResult.rows.length) {
      throw new Error(
        `No ${input.document_type.toUpperCase()} template found for this workspace. ` +
        `Open the Reports page in Pandora to initialize templates.`
      );
    }

    const templateId = templateResult.rows[0].id;
    const { generateReport } = await import('../../reports/generator.js');

    const result = await generateReport({
      workspace_id: workspaceId,
      report_template_id: templateId,
      triggered_by: 'api' as const,
      preview_only: false,
      period_label: input.period_label ?? defaultPeriodLabel(input.document_type),
      document_type: input.document_type,
    });

    return {
      document_id: result.document_id ?? null,
      document_type: input.document_type,
      period_label: input.period_label ?? defaultPeriodLabel(input.document_type),
      sections_generated: result.sections_snapshot?.length ?? 0,
      generation_duration_ms: result.generation_duration_ms ?? null,
      generated_at: new Date().toISOString(),
    };
  },
};
