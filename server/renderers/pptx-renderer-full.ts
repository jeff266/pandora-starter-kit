/**
 * PPTX Renderer
 *
 * Generates PowerPoint presentations from report sections using pptxgenjs.
 * Supports title slides, metrics, tables, deal cards, and action items.
 */

import PptxGenJS from 'pptxgenjs';
import { ReportGenerationContext } from '../reports/types.js';
import * as path from 'path';
import * as os from 'os';

export interface PPTXRenderResult {
  filepath: string;
  size_bytes: number;
  download_url: string;
}

export async function renderPPTX(context: ReportGenerationContext): Promise<PPTXRenderResult> {
  const { workspace_id, template, sections_content, branding } = context;

  const pptx = new (PptxGenJS as any)();

  // Set presentation properties
  pptx.author = branding?.prepared_by || 'Pandora';
  pptx.company = branding?.company_name || 'Pandora';
  pptx.title = template.name;
  pptx.subject = template.description || 'Auto-generated report';

  const primaryColor = branding?.primary_color || '2563EB';
  const accentColor = branding?.accent_color || '1E293B';

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: 'F8FAFC' };

  titleSlide.addText(template.name, {
    x: 0.5,
    y: 2.5,
    w: 9,
    h: 1.5,
    fontSize: 44,
    bold: true,
    color: accentColor,
    align: 'center',
  });

  titleSlide.addText(template.description || '', {
    x: 0.5,
    y: 4.0,
    w: 9,
    h: 0.5,
    fontSize: 18,
    color: '64748B',
    align: 'center',
  });

  titleSlide.addText(
    `Generated on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    {
      x: 0.5,
      y: 5.0,
      w: 9,
      h: 0.4,
      fontSize: 14,
      color: '94A3B8',
      align: 'center',
    }
  );

  if (branding?.prepared_by) {
    titleSlide.addText(branding.prepared_by, {
      x: 0.5,
      y: 7.0,
      w: 9,
      h: 0.3,
      fontSize: 12,
      italic: true,
      color: '94A3B8',
      align: 'center',
    });
  }

  // Content slides
  for (const section of sections_content) {
    // Section title slide
    const sectionSlide = pptx.addSlide();
    sectionSlide.background = { color: 'FFFFFF' };

    sectionSlide.addText(section.title, {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.7,
      fontSize: 36,
      bold: true,
      color: primaryColor,
    });

    // Narrative
    if (section.narrative) {
      const narrativeText = section.narrative.slice(0, 600); // Limit for readability
      sectionSlide.addText(narrativeText, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 4.0,
        fontSize: 14,
        color: '1E293B',
        valign: 'top',
      });
    }

    // Metrics slide
    if (section.metrics && section.metrics.length > 0) {
      const metricsSlide = pptx.addSlide();
      metricsSlide.background = { color: 'FFFFFF' };

      metricsSlide.addText(`${section.title} - Metrics`, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 0.5,
        fontSize: 28,
        bold: true,
        color: primaryColor,
      });

      const rows: any[] = [];
      rows.push([
        { text: 'Metric', options: { bold: true, fill: 'E5E7EB' } },
        { text: 'Value', options: { bold: true, fill: 'E5E7EB' } },
      ]);

      for (const metric of section.metrics) {
        const valueText = metric.delta
          ? `${metric.value} (${metric.delta_direction === 'up' ? '↑' : metric.delta_direction === 'down' ? '↓' : '→'} ${metric.delta})`
          : metric.value;

        const fillColor =
          metric.severity === 'critical' ? 'FEE2E2' : metric.severity === 'warning' ? 'FEF3C7' : metric.severity === 'good' ? 'D1FAE5' : 'FFFFFF';

        rows.push([
          { text: metric.label },
          { text: valueText, options: { bold: true, fill: fillColor } },
        ]);
      }

      metricsSlide.addTable(rows, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 4.5,
        fontSize: 16,
        border: { pt: 1, color: 'E2E8F0' },
        align: 'left',
      });
    }

    // Table slide
    if (section.table && section.table.rows.length > 0) {
      const tableSlide = pptx.addSlide();
      tableSlide.background = { color: 'FFFFFF' };

      tableSlide.addText(`${section.title} - Data`, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 0.5,
        fontSize: 28,
        bold: true,
        color: primaryColor,
      });

      const rows: any[] = [];
      rows.push(section.table.headers.map(h => ({ text: h, options: { bold: true, fill: 'E5E7EB' } })));

      for (const row of section.table.rows.slice(0, 15)) {
        rows.push(section.table.headers.map(h => ({ text: String(row[h] ?? '') })));
      }

      tableSlide.addTable(rows, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 5.0,
        fontSize: 12,
        border: { pt: 1, color: 'E2E8F0' },
        align: 'left',
      });
    }

    // Deal cards slides (max 3 per slide)
    if (section.deal_cards && section.deal_cards.length > 0) {
      const cardsPerSlide = 3;
      for (let i = 0; i < section.deal_cards.length; i += cardsPerSlide) {
        const dealSlide = pptx.addSlide();
        dealSlide.background = { color: 'FFFFFF' };

        dealSlide.addText(`${section.title} - Deals`, {
          x: 0.5,
          y: 0.5,
          w: 9,
          h: 0.5,
          fontSize: 28,
          bold: true,
          color: primaryColor,
        });

        const cards = section.deal_cards.slice(i, i + cardsPerSlide);
        const cardHeight = 1.5;
        const cardSpacing = 0.2;

        cards.forEach((card, idx) => {
          const yPos = 1.5 + idx * (cardHeight + cardSpacing);

          const fillColor =
            card.signal_severity === 'critical' ? 'FEE2E2' : card.signal_severity === 'warning' ? 'FEF3C7' : 'DBEAFE';

          // Deal card box
          dealSlide.addShape(pptx.ShapeType.rect, {
            x: 0.5,
            y: yPos,
            w: 9,
            h: cardHeight,
            fill: { color: fillColor },
            line: { color: 'E2E8F0', width: 1 },
          });

          dealSlide.addText(`${card.name} (${card.amount})`, {
            x: 0.7,
            y: yPos + 0.1,
            w: 8.6,
            h: 0.3,
            fontSize: 14,
            bold: true,
            color: '1E293B',
          });

          dealSlide.addText(`${card.owner} | ${card.stage} | ${card.signal}`, {
            x: 0.7,
            y: yPos + 0.45,
            w: 8.6,
            h: 0.25,
            fontSize: 11,
            color: '475569',
          });

          dealSlide.addText(`→ ${card.action}`, {
            x: 0.7,
            y: yPos + 0.75,
            w: 8.6,
            h: 0.6,
            fontSize: 11,
            color: '1E293B',
            italic: true,
          });
        });
      }
    }

    // Action items slide
    if (section.action_items && section.action_items.length > 0) {
      const actionSlide = pptx.addSlide();
      actionSlide.background = { color: 'FFFFFF' };

      actionSlide.addText(`${section.title} - Action Items`, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 0.5,
        fontSize: 28,
        bold: true,
        color: primaryColor,
      });

      const yStart = 1.5;
      const itemHeight = 0.4;
      const itemSpacing = 0.1;

      section.action_items.slice(0, 10).forEach((action, idx) => {
        const yPos = yStart + idx * (itemHeight + itemSpacing);

        const urgencyColor =
          action.urgency === 'today' ? 'DC2626' : action.urgency === 'this_week' ? 'D97706' : '16A34A';

        const urgencyLabel = action.urgency === 'today' ? '🔴' : action.urgency === 'this_week' ? '🟡' : '🟢';

        actionSlide.addText(`${urgencyLabel} ${action.action} (${action.owner})`, {
          x: 0.7,
          y: yPos,
          w: 8.6,
          h: itemHeight,
          fontSize: 12,
          color: '1E293B',
          bullet: { code: String(idx + 1) },
        });
      });
    }
  }

  // Write to file
  const filename = `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.pptx`;
  const filepath = path.join(os.tmpdir(), filename);

  await pptx.writeFile({ fileName: filepath });

  const stats = await import('fs/promises').then(fs => fs.stat(filepath));

  return {
    filepath,
    size_bytes: stats.size,
    download_url: `/api/workspaces/${workspace_id}/reports/${template.id}/download/pptx?file=${filename}`,
  };
}
