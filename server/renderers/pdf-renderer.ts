/**
 * PDF Renderer
 *
 * Generates branded PDF reports from populated templates and skill evidence.
 * Includes cover pages, table of contents, and formatted content sections.
 */

import PDFDocument from 'pdfkit';
import { Renderer, RendererInput, RenderOutput, BrandingConfig } from './types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const PDF_COLORS = {
  primary: '#1E293B',
  secondary: '#475569',
  accent: '#2563EB',
  muted: '#94A3B8',
  critical: '#DC2626',
  warning: '#D97706',
  info: '#2563EB',
  success: '#16A34A',
  degraded: '#94A3B8',
  background: '#F8FAFC',
  border: '#E2E8F0',
};

export class PDFRenderer implements Renderer {
  format = 'pdf';

  async render(input: RendererInput): Promise<RenderOutput> {
    const start = Date.now();
    const branding = input.workspace.branding;
    const primaryColor = branding?.primary_color || PDF_COLORS.accent;

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: {
        Title: this.getDocTitle(input),
        Author: branding?.prepared_by || 'Pandora GTM Intelligence',
        Creator: 'Pandora',
      },
    });

    const filename = this.generateFilename(input);
    const filepath = path.join(os.tmpdir(), filename);
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    let pageCount = 0;

    // ── Cover Page ──
    pageCount++;
    this.renderCoverPage(doc, input, primaryColor);

    if (input.templateMatrix) {
      pageCount += this.renderTemplateContent(doc, input, primaryColor);
    } else if (input.agentOutput) {
      pageCount += this.renderAgentContent(doc, input, primaryColor);
    }

    // ── Footer on every page ──
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);

      // Page number
      doc.fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text(
          `Page ${i + 1} of ${pages.count}`,
          60, doc.page.height - 40,
          { align: 'center', width: doc.page.width - 120 }
        );

      // Confidentiality notice
      if (branding?.confidentiality_notice) {
        doc.fontSize(7)
          .fillColor(PDF_COLORS.muted)
          .text(
            branding.confidentiality_notice,
            60, doc.page.height - 28,
            { align: 'center', width: doc.page.width - 120 }
          );
      }
    }

    doc.end();

    // Wait for stream to finish
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    const buffer = fs.readFileSync(filepath);

    return {
      format: 'pdf',
      filename,
      filepath,
      buffer,
      metadata: {
        pages: pages.count,
        file_size_bytes: buffer.length,
        render_duration_ms: Date.now() - start,
      },
    };
  }

  private renderCoverPage(doc: typeof PDFDocument, input: RendererInput, color: string): void {
    const branding = input.workspace.branding;

    // Logo area (for v1, use text)
    doc.moveDown(6);

    // Title
    doc.fontSize(28)
      .fillColor(color)
      .text(this.getDocTitle(input), { align: 'center' });

    doc.moveDown(0.5);

    // Workspace name
    doc.fontSize(14)
      .fillColor(PDF_COLORS.secondary)
      .text(input.workspace.name, { align: 'center' });

    doc.moveDown(2);

    // Date
    doc.fontSize(11)
      .fillColor(PDF_COLORS.muted)
      .text(new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }), { align: 'center' });

    // Prepared by
    if (branding?.prepared_by) {
      doc.moveDown(0.5);
      doc.fontSize(10)
        .fillColor(PDF_COLORS.muted)
        .text(branding.prepared_by, { align: 'center' });
    }

    doc.addPage();
  }

  private renderTemplateContent(doc: typeof PDFDocument, input: RendererInput, color: string): number {
    const matrix = input.templateMatrix!;
    let addedPages = 0;

    switch (matrix.template_type) {
      case 'stage_matrix':
        addedPages += this.renderStageMatrixPDF(doc, matrix, color);
        break;
      case 'ranked_list':
        addedPages += this.renderRankedListPDF(doc, matrix, color);
        break;
      case 'waterfall':
        addedPages += this.renderWaterfallPDF(doc, matrix, color);
        break;
      default:
        addedPages += this.renderStageMatrixPDF(doc, matrix, color);
    }

    return addedPages;
  }

  private renderStageMatrixPDF(doc: typeof PDFDocument, matrix: any, color: string): number {
    let pages = 0;
    const stages = matrix.stages || [];
    const rows = matrix.rows || [];

    // Render stage-by-stage (vertical layout for readability)
    for (const stage of stages) {
      // Stage heading
      doc.fontSize(16)
        .fillColor(color)
        .text(stage.stage_name, { underline: true });
      doc.moveDown(0.3);

      if (stage.probability !== undefined) {
        doc.fontSize(9)
          .fillColor(PDF_COLORS.muted)
          .text(`Win probability: ${(stage.probability * 100).toFixed(0)}%`);
      }
      doc.moveDown(0.5);

      for (const row of rows) {
        const cell = row.cells[stage.stage_normalized];
        if (!cell || cell.status === 'not_applicable') continue;

        // Dimension label
        doc.fontSize(10)
          .fillColor(PDF_COLORS.primary)
          .font('Helvetica-Bold')
          .text(row.dimension_label);

        // Cell content
        const textColor = cell.status === 'degraded' ? PDF_COLORS.degraded : PDF_COLORS.secondary;
        const content = cell.content || (cell.status === 'degraded' ? 'Limited data available' : '—');

        doc.fontSize(9)
          .fillColor(textColor)
          .font('Helvetica')
          .text(content, { indent: 10 });

        if (cell.status === 'degraded' && cell.degradation_reason) {
          doc.fontSize(8)
            .fillColor(PDF_COLORS.muted)
            .font('Helvetica-Oblique')
            .text(`Note: ${cell.degradation_reason}`, { indent: 10 });
        }

        doc.moveDown(0.4);
      }

      // Page break between stages (if not last)
      if (stage !== stages[stages.length - 1]) {
        doc.addPage();
        pages++;
      }
    }

    return pages;
  }

  private renderRankedListPDF(doc: typeof PDFDocument, matrix: any, color: string): number {
    doc.fontSize(14)
      .fillColor(color)
      .text('Ranked Results');
    doc.moveDown(0.5);

    const records = matrix.records || [];
    const schema = matrix.column_schema || [];
    const rankField = matrix.ranking_field || 'score';

    const sorted = [...records].sort((a: any, b: any) => (b[rankField] || 0) - (a[rankField] || 0));

    sorted.forEach((record: any, idx: number) => {
      // Each record as a compact card
      doc.fontSize(11)
        .fillColor(PDF_COLORS.primary)
        .font('Helvetica-Bold')
        .text(`#${idx + 1}  ${record.name || record.deal_name || record.label || 'Record'}`);

      // Key fields
      for (const col of schema.slice(0, 6)) {
        const val = record[col.key];
        if (val !== null && val !== undefined) {
          doc.fontSize(9)
            .fillColor(PDF_COLORS.secondary)
            .font('Helvetica')
            .text(`${col.display || col.label || col.key}: ${val}`, { indent: 15 });
        }
      }

      doc.moveDown(0.4);

      // Subtle divider
      doc.moveTo(60, doc.y)
        .lineTo(doc.page.width - 60, doc.y)
        .strokeColor(PDF_COLORS.border)
        .lineWidth(0.5)
        .stroke();
      doc.moveDown(0.3);

      // Auto page break
      if (doc.y > doc.page.height - 120) {
        doc.addPage();
      }
    });

    return 0;
  }

  private renderWaterfallPDF(doc: typeof PDFDocument, matrix: any, color: string): number {
    doc.fontSize(14)
      .fillColor(color)
      .text('Pipeline Waterfall');
    doc.moveDown(1);

    const starting = matrix.starting_value;
    const adjustments = matrix.adjustments || [];

    if (starting) {
      doc.fontSize(12)
        .fillColor(PDF_COLORS.primary)
        .font('Helvetica-Bold')
        .text(`${starting.label}: $${starting.amount.toLocaleString()}`);
      doc.moveDown(0.5);
    }

    for (const adj of adjustments) {
      const sign = adj.amount >= 0 ? '+' : '';
      const adjColor = adj.amount >= 0 ? PDF_COLORS.success : PDF_COLORS.critical;
      doc.fontSize(10)
        .fillColor(adjColor)
        .font('Helvetica')
        .text(`  ${adj.label}: ${sign}$${adj.amount.toLocaleString()}`, { indent: 20 });
    }

    doc.moveDown(0.5);
    const total = (starting?.amount || 0) + adjustments.reduce((s: number, a: any) => s + a.amount, 0);

    doc.moveTo(60, doc.y).lineTo(300, doc.y).strokeColor(PDF_COLORS.primary).lineWidth(1).stroke();
    doc.moveDown(0.3);

    doc.fontSize(13)
      .fillColor(PDF_COLORS.primary)
      .font('Helvetica-Bold')
      .text(`Ending Pipeline: $${total.toLocaleString()}`);

    return 0;
  }

  private renderAgentContent(doc: typeof PDFDocument, input: RendererInput, color: string): number {
    const agent = input.agentOutput!;
    let pages = 0;

    // Narrative
    if (agent.narrative) {
      doc.fontSize(14)
        .fillColor(color)
        .text('Executive Summary');
      doc.moveDown(0.5);
      doc.fontSize(10)
        .fillColor(PDF_COLORS.secondary)
        .font('Helvetica')
        .text(agent.narrative);
      doc.moveDown(1);
    }

    // Claims by severity
    const claims = agent.all_claims || [];
    if (claims.length > 0) {
      doc.fontSize(14)
        .fillColor(color)
        .text('Key Findings');
      doc.moveDown(0.5);

      const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      const sorted = [...claims].sort(
        (a: any, b: any) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
      );

      const severityIcons: Record<string, string> = { critical: '🔴', warning: '🟡', info: '🔵' };

      for (const claim of sorted) {
        const icon = severityIcons[claim.severity] || '●';

        doc.fontSize(10)
          .fillColor(PDF_COLORS.primary)
          .font('Helvetica-Bold')
          .text(`${icon}  ${claim.message || claim.claim_text || ''}`);

        if (claim.entity_id) {
          doc.fontSize(8)
            .fillColor(PDF_COLORS.muted)
            .font('Helvetica')
            .text(`${claim.entity_type || 'Entity'}: ${claim.entity_id}  |  ${claim.category || ''}`, { indent: 20 });
        }

        doc.moveDown(0.3);

        if (doc.y > doc.page.height - 100) {
          doc.addPage();
          pages++;
        }
      }
    }

    return pages;
  }

  private getDocTitle(input: RendererInput): string {
    if (input.templateMatrix) {
      const typeLabels: Record<string, string> = {
        stage_matrix: 'Sales Process Map',
        ranked_list: 'Lead Scoring Report',
        waterfall: 'Pipeline Waterfall',
        profile_card: 'ICP Profile',
        audit_table: 'Audit Report',
        hybrid: 'GTM Blueprint',
      };
      return typeLabels[input.templateMatrix.template_type] || 'Intelligence Report';
    }
    return 'Pipeline Intelligence Report';
  }

  private generateFilename(input: RendererInput): string {
    const workspace = input.workspace.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'pandora';
    const title = this.getDocTitle(input).replace(/[^a-zA-Z0-9]/g, '_');
    const date = new Date().toISOString().split('T')[0];
    return `${workspace}_${title}_${date}.pdf`;
  }
}
