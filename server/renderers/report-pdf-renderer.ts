/**
 * Report PDF Renderer
 *
 * Generates professional PDF reports from SectionContent using pdfkit.
 * Section-aware rendering with metrics, tables, deal cards, and action items.
 */

import PDFDocument from 'pdfkit';
import { ReportGenerationContext } from '../reports/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const COLORS = {
  primary: '#2563EB',
  secondary: '#1E293B',
  muted: '#64748B',
  critical: '#DC2626',
  warning: '#D97706',
  success: '#16A34A',
  background: '#F8FAFC',
  border: '#E2E8F0',
};

export interface PDFRenderResult {
  filepath: string;
  size_bytes: number;
  download_url: string;
}

export async function renderReportPDF(context: ReportGenerationContext): Promise<PDFRenderResult> {
  const { workspace_id, template, sections_content, branding } = context;

  const primaryColor = branding?.primary_color || COLORS.primary;

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    info: {
      Title: template.name,
      Author: branding?.prepared_by || 'Pandora',
      Creator: 'Pandora',
    },
  });

  const filename = `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.pdf`;
  const filepath = path.join(os.tmpdir(), filename);
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  // Cover page
  doc.fontSize(36).fillColor(primaryColor).text(template.name, { align: 'center' });
  doc.moveDown(0.5);

  if (template.description) {
    doc.fontSize(14).fillColor(COLORS.muted).text(template.description, { align: 'center' });
    doc.moveDown(1);
  }

  doc.fontSize(12).fillColor(COLORS.secondary);
  doc.text(`Generated on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, {
    align: 'center',
  });

  doc.moveDown(1);

  if (branding?.prepared_by) {
    doc.fontSize(10).fillColor(COLORS.muted).text(branding.prepared_by, { align: 'center' });
  }

  // Render each section
  for (const section of sections_content) {
    doc.addPage();

    // Section title
    doc.fontSize(24).fillColor(primaryColor).text(section.title);
    doc.moveDown(0.5);

    // Narrative
    if (section.narrative) {
      doc.fontSize(11).fillColor(COLORS.secondary).text(section.narrative, {
        align: 'justify',
        lineGap: 4,
      });
      doc.moveDown(1);
    }

    // Metrics
    if (section.metrics && section.metrics.length > 0) {
      doc.fontSize(14).fillColor(primaryColor).text('Key Metrics');
      doc.moveDown(0.5);

      for (const metric of section.metrics) {
        const y = doc.y;
        const boxHeight = 50;

        // Metric card background
        const bgColor =
          metric.severity === 'critical'
            ? '#FEE2E2'
            : metric.severity === 'warning'
            ? '#FEF3C7'
            : metric.severity === 'good'
            ? '#D1FAE5'
            : '#F8FAFC';

        doc.rect(60, y, 500, boxHeight).fillAndStroke(bgColor, COLORS.border);

        // Metric label
        doc.fontSize(10).fillColor(COLORS.muted).text(metric.label, 75, y + 10, { width: 200 });

        // Metric value
        const valueText = metric.delta
          ? `${metric.value} (${metric.delta_direction === 'up' ? '↑' : metric.delta_direction === 'down' ? '↓' : '→'} ${metric.delta})`
          : metric.value;

        doc.fontSize(18).fillColor(COLORS.secondary).text(valueText, 280, y + 12, { width: 260, align: 'right' });

        doc.y = y + boxHeight + 10;
      }

      doc.moveDown(1);
    }

    // Table
    if (section.table && section.table.rows.length > 0) {
      doc.fontSize(14).fillColor(primaryColor).text('Data');
      doc.moveDown(0.5);

      const tableTop = doc.y;
      const columnWidth = 500 / section.table.headers.length;
      const rowHeight = 25;

      // Header row
      let x = 60;
      for (const header of section.table.headers) {
        doc.rect(x, tableTop, columnWidth, rowHeight).fillAndStroke('#E5E7EB', COLORS.border);
        doc.fontSize(10).fillColor(COLORS.secondary).text(header, x + 5, tableTop + 7, {
          width: columnWidth - 10,
          ellipsis: true,
        });
        x += columnWidth;
      }

      // Data rows
      let y = tableTop + rowHeight;
      for (const row of section.table.rows.slice(0, 20)) {
        x = 60;
        for (const header of section.table.headers) {
          doc.rect(x, y, columnWidth, rowHeight).stroke(COLORS.border);
          doc
            .fontSize(9)
            .fillColor(COLORS.secondary)
            .text(String(row[header] ?? ''), x + 5, y + 7, {
              width: columnWidth - 10,
              ellipsis: true,
            });
          x += columnWidth;
        }
        y += rowHeight;
      }

      doc.y = y + 10;
      doc.moveDown(1);
    }

    // Deal cards
    if (section.deal_cards && section.deal_cards.length > 0) {
      doc.fontSize(14).fillColor(primaryColor).text('Deals');
      doc.moveDown(0.5);

      for (const card of section.deal_cards.slice(0, 10)) {
        const y = doc.y;
        const cardHeight = 80;

        // Card background
        const bgColor =
          card.signal_severity === 'critical' ? '#FEE2E2' : card.signal_severity === 'warning' ? '#FEF3C7' : '#DBEAFE';

        doc.rect(60, y, 500, cardHeight).fillAndStroke(bgColor, COLORS.border);

        // Deal name and amount
        doc.fontSize(12).fillColor(COLORS.secondary).text(`${card.name} (${card.amount})`, 75, y + 10, { width: 470 });

        // Owner and stage
        doc
          .fontSize(9)
          .fillColor(COLORS.muted)
          .text(`${card.owner} | ${card.stage} | ${card.signal}`, 75, y + 30, { width: 470 });

        // Detail
        doc.fontSize(9).fillColor(COLORS.secondary).text(card.detail, 75, y + 45, { width: 470 });

        // Action
        doc.fontSize(9).fillColor(primaryColor).text(`→ ${card.action}`, 75, y + 62, { width: 470 });

        doc.y = y + cardHeight + 10;

        // Page break if needed
        if (doc.y > 700) {
          doc.addPage();
        }
      }

      doc.moveDown(1);
    }

    // Action items
    if (section.action_items && section.action_items.length > 0) {
      doc.fontSize(14).fillColor(primaryColor).text('Action Items');
      doc.moveDown(0.5);

      section.action_items.slice(0, 15).forEach((action, idx) => {
        const urgencyColor =
          action.urgency === 'today' ? COLORS.critical : action.urgency === 'this_week' ? COLORS.warning : COLORS.success;

        const urgencyLabel = action.urgency === 'today' ? '🔴' : action.urgency === 'this_week' ? '🟡' : '🟢';

        doc
          .fontSize(11)
          .fillColor(COLORS.secondary)
          .text(`${idx + 1}. ${urgencyLabel} ${action.action} (${action.owner})`, {
            indent: 20,
            lineGap: 3,
          });

        doc.moveDown(0.3);

        // Page break if needed
        if (doc.y > 700) {
          doc.addPage();
        }
      });
    }
  }

  // Footer on last page
  doc.fontSize(8).fillColor(COLORS.muted).text('Generated by Pandora', 60, 750, {
    align: 'center',
    width: 500,
  });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      const stats = fs.statSync(filepath);
      resolve({
        filepath,
        size_bytes: stats.size,
        download_url: `/api/workspaces/${workspace_id}/reports/${template.id}/download/pdf?file=${filename}`,
      });
    });
    stream.on('error', reject);
  });
}
