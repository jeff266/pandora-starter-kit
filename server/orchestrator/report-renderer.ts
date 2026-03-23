import {
  Document, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, ShadingType,
  Table, TableRow, TableCell, WidthType,
  PageNumber, Footer, convertInchesToTwip,
  Packer, ImageRun
} from 'docx';
import PDFDocument from 'pdfkit';
import type { ReportDocument } from './types.js';
import { query } from '../db.js';

export interface RenderConfig {
  prepared_by?: string;
  for_company?: string;
  audience?: string;
  include_actions?: boolean;
  anonymize?: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// DOCX Renderer v2 — Professional output with proper typography
// ══════════════════════════════════════════════════════════════════════════════

export async function renderDocx(
  doc: ReportDocument,
  config: RenderConfig = {}
): Promise<Buffer> {

  const {
    prepared_by = 'RevOps Impact',
    for_company = '',
    include_actions = true,
  } = config;

  const children: (Paragraph | Table)[] = [];

  // ── Cover page — teal band ──────────────────────────

  // Teal band as a full-width table with shaded cell
  const coverBandRow = new TableRow({
    children: [new TableCell({
      children: [
        // "PREPARED BY" label — small, tinted white
        new Paragraph({
          children: [new TextRun({
            text: `PREPARED BY ${(prepared_by || 'RevOps Impact').toUpperCase()}`,
            size: 16,   // 8pt
            color: 'A7F3D0',
            font: 'Calibri',
            characterSpacing: 50,
          })],
          spacing: { before: 200, after: 120 },
        }),
        // Company name — large, white
        new Paragraph({
          children: [new TextRun({
            text: for_company || doc.week_label || '',
            bold: true,
            size: 56,   // 28pt
            color: 'FFFFFF',
            font: 'Calibri',
          })],
          spacing: { before: 0, after: 120 },
        }),
        // Document type — medium, light teal
        new Paragraph({
          children: [new TextRun({
            text: getReportTitle(doc.document_type),
            size: 28,   // 14pt
            color: 'A7F3D0',
            font: 'Calibri',
          })],
          spacing: { after: 200 },
        }),
      ],
      shading: { fill: '0D9488', type: ShadingType.CLEAR, color: 'auto' },
      margins: {
        top: convertInchesToTwip(0.4),
        bottom: convertInchesToTwip(0.4),
        left: convertInchesToTwip(0.5),
        right: convertInchesToTwip(0.5),
      },
    })],
  });

  children.push(new Table({
    rows: [coverBandRow],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom:           { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left:             { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right:            { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
  }));

  // Week label below the band — appears ONCE
  children.push(new Paragraph({
    children: [new TextRun({
      text: doc.week_label || '',
      size: 22,   // 11pt
      color: '64748B',
      font: 'Calibri',
    })],
    spacing: { before: 240, after: 80 },
  }));

  // Confidential
  children.push(new Paragraph({
    children: [new TextRun({
      text: 'Confidential',
      size: 18,
      color: '94A3B8',
      font: 'Calibri',
      italics: true,
    })],
    spacing: { after: 480 },
  }));

  // Teal divider rule
  children.push(new Paragraph({
    border: {
      bottom: {
        color: '0D9488',
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
    spacing: { before: 0, after: 400 },
  }));

  // ── Headline ─────────────────────────────────────────

  children.push(new Paragraph({
    children: [new TextRun({
      text: doc.headline,
      bold: true,
      size: 28,         // 14pt
      color: '1E293B',
    })],
    spacing: { before: 480, after: 240 },
  }));

  // ── Sections ─────────────────────────────────────────

  // Fetch all charts for this report
  const chartsResult = doc.id ? await query(`
    SELECT section_id, chart_png, title
    FROM report_charts
    WHERE report_document_id = $1
    ORDER BY section_id, position_in_section ASC
  `, [doc.id]) : { rows: [] };

  const chartsBySection = new Map<string, any[]>();
  for (const chart of chartsResult.rows) {
    if (!chartsBySection.has(chart.section_id)) {
      chartsBySection.set(chart.section_id, []);
    }
    chartsBySection.get(chart.section_id)!.push(chart);
  }

  for (const section of doc.sections) {
    // Section title as H2
    children.push(new Paragraph({
      text: section.title,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 480, after: 160 },
      border: {
        left: {
          color: '0D9488',   // Teal — Pandora brand
          space: 8,
          style: BorderStyle.SINGLE,
          size: 18,          // 2.25pt
        },
      },
    }));

    // Split content into paragraphs
    const paragraphs = section.content
      .split(/\n\n+/)
      .filter(p => p.trim().length > 0);

    for (const para of paragraphs) {
      const paraProps: any = {
        children: [new TextRun({
          text: para.trim(),
          size: 22,    // 11pt
          color: '374151',
        })],
        spacing: { before: 120, after: 120 },
        indent: { left: convertInchesToTwip(0) },
      };

      // Flagged section: add shading + left border
      if (section.flagged_for_client) {
        paraProps.shading = {
          type: ShadingType.SOLID,
          color: 'EFF6FF',
        };
        paraProps.border = {
          left: {
            color: 'BFDBFE',
            space: 8,
            style: BorderStyle.SINGLE,
            size: 18,
          },
        };
      }

      children.push(new Paragraph(paraProps));
    }

    // Render reasoning tree (McKinsey-style reasoning layers)
    if (section.reasoning_tree?.length) {
      // Small spacer before tree
      children.push(new Paragraph({
        spacing: { before: 160 },
      }));

      const layerLabels: Record<string, string> = {
        cause:        'Why',
        second_order: 'What this means',
        third_order:  'Strategic question',
        action:       'Action required',
      };

      const layerColors: Record<string, string> = {
        cause:        '475569',  // slate
        second_order: '0F6E56',  // dark teal
        third_order:  '533AB7',  // purple
        action:       'DC2626',  // red
      };

      for (const node of section.reasoning_tree) {
        // Layer label
        children.push(new Paragraph({
          children: [new TextRun({
            text: layerLabels[node.layer] || node.layer,
            size: 16,  // 8pt
            bold: true,
            color: layerColors[node.layer] || '475569',
            allCaps: true,
          })],
          spacing: { before: 160, after: 40 },
        }));

        // Question in italic
        children.push(new Paragraph({
          children: [new TextRun({
            text: node.question,
            size: 18,  // 9pt
            italics: true,
            color: '374151',
          })],
          spacing: { before: 0, after: 60 },
          indent: { left: convertInchesToTwip(0.15) },
        }));

        // Answer
        children.push(new Paragraph({
          children: [new TextRun({
            text: node.answer,
            size: 20,  // 10pt
            color: node.data_gap ? '94A3B8' : '1E293B',
            italics: node.data_gap || false,
          })],
          spacing: { before: 0, after: 120 },
          indent: { left: convertInchesToTwip(0.15) },
        }));

        // Chart Intelligence: render chart after answer
        if (node.chart_png && node.chart_spec) {
          children.push(new Paragraph({
            children: [
              new ImageRun({
                data: node.chart_png,
                transformation: {
                  width: 450,
                  height: 300,
                },
              } as any),
            ],
            spacing: { before: 120, after: 120 },
            alignment: AlignmentType.CENTER,
            indent: { left: convertInchesToTwip(0.15) },
          }));

          // Chart title as caption
          children.push(new Paragraph({
            children: [new TextRun({
              text: node.chart_spec.title,
              size: 16,
              color: '64748B',
              italics: true,
            })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            indent: { left: convertInchesToTwip(0.15) },
          }));
        }

        // Data gap note
        if (node.data_gap) {
          children.push(new Paragraph({
            children: [new TextRun({
              text: '⚠ Insufficient data to answer fully',
              size: 16,
              color: 'F59E0B',
              italics: true,
            })],
            indent: { left: convertInchesToTwip(0.15) },
            spacing: { after: 80 },
          }));
        }
      }
    }

    // Embed charts for this section
    const sectionCharts = chartsBySection.get(section.id) || [];
    for (const chart of sectionCharts) {
      if (chart.chart_png) {
        children.push(new Paragraph({
          children: [
            new ImageRun({
              data: chart.chart_png,
              transformation: {
                width: 500,
                height: 333,
              },
            } as any),
          ],
          spacing: { before: 240, after: 240 },
          alignment: AlignmentType.CENTER,
        }));

        // Chart caption
        children.push(new Paragraph({
          children: [new TextRun({
            text: chart.title,
            size: 18,
            color: '64748B',
            italics: true,
          })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
        }));
      }
    }
  }

  // ── Actions ──────────────────────────────────────────

  if (include_actions && doc.actions?.length > 0) {
    children.push(new Paragraph({
      text: 'Actions',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 480, after: 160 },
      border: {
        left: {
          color: '0D9488',
          space: 8,
          style: BorderStyle.SINGLE,
          size: 18,
        },
      },
    }));

    // Actions as table
    const urgencyLabels: Record<string, string> = {
      today: 'TODAY',
      this_week: 'THIS WEEK',
      this_month: 'THIS MONTH',
    };

    const rows = doc.actions.map(action =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({
                text: urgencyLabels[action.urgency]
                  || action.urgency.toUpperCase(),
                bold: true,
                size: 18,
                color: action.urgency === 'today'
                  ? 'DC2626' : 'D97706',
              })],
            })],
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({
                text: action.text
                  .replace(/\s*—?\s*Owned by:.*$/i, '')
                  .trim(),
                size: 20,
                color: '374151',
              })],
            })],
            width: { size: 70, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({
                text: action.rep_name || '',
                size: 18,
                color: '6B7280',
                italics: true,
              })],
            })],
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
        ],
      })
    );

    children.push(new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }

  // ── Recommended Next Steps ────────────────────────────

  if (doc.recommended_next_steps) {
    children.push(new Paragraph({
      text: 'Recommended Next Steps',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 480, after: 160 },
      border: {
        left: {
          color: '0D9488',
          space: 8,
          style: BorderStyle.SINGLE,
          size: 18,
        },
      },
    }));

    children.push(new Paragraph({
      children: [new TextRun({
        text: doc.recommended_next_steps,
        size: 22,
        color: '374151',
        italics: true,
      })],
      spacing: { before: 120, after: 120 },
    }));
  }

  // ── Build Document ────────────────────────────────────

  const footerText = [
    prepared_by ? `Prepared by ${prepared_by}` : '',
    for_company ? `for ${for_company}` : '',
    new Date().toLocaleDateString('en-US', {
      month: 'long', year: 'numeric'
    }),
  ].filter(Boolean).join(' · ');

  const document = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.25),
            right: convertInchesToTwip(1.25),
          },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: footerText + ' · Page ',
                  size: 16,
                  color: '94A3B8',
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: 16,
                  color: '94A3B8',
                }),
                new TextRun({
                  text: ' of ',
                  size: 16,
                  color: '94A3B8',
                }),
                new TextRun({
                  children: [PageNumber.TOTAL_PAGES],
                  size: 16,
                  color: '94A3B8',
                }),
              ],
            }),
          ],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(document);
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF Renderer — pdfkit (no system dependencies)
// ══════════════════════════════════════════════════════════════════════════════

const TEAL   = '#0D9488';
const DARK   = '#1E293B';
const MID    = '#374151';
const MUTED  = '#94A3B8';
const BORDER = '#E2E8F0';

const URGENCY_LABELS: Record<string, string> = {
  today:      'TODAY',
  this_week:  'THIS WEEK',
  this_month: 'THIS MONTH',
};
const URGENCY_COLORS: Record<string, string> = {
  today:      '#DC2626',
  this_week:  '#D97706',
  this_month: '#6B7280',
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export async function renderPdf(
  doc: ReportDocument,
  config: RenderConfig = {}
): Promise<Buffer> {

  const pdf = new PDFDocument({
    size: 'LETTER',
    margins: { top: 72, bottom: 72, left: 90, right: 90 },
    bufferPages: true,   // required for post-render footer pass
    info: {
      Title: doc.week_label || 'Pipeline Report',
      Author: config.prepared_by || 'Pandora',
    },
  });

  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));

  const done = new Promise<void>((resolve, reject) => {
    pdf.on('end', resolve);
    pdf.on('error', reject);
  });

  const W = pdf.page.width - 90 - 90;

  // ── Cover ──────────────────────────────────────────────────────────────────
  const COVER_H = 200;
  // Full-width teal band at top
  pdf.rect(0, 0, pdf.page.width, COVER_H).fill(hexToRgb(TEAL));

  const preparedByStr = config.prepared_by || 'RevOps Impact';
  const companyName   = config.for_company || '';
  const docTypeLabel  = getReportTitle(doc.document_type);

  // "PREPARED BY …" — small, white/65, uppercase
  pdf.save();
  pdf.opacity(0.65);
  pdf.fillColor(hexToRgb('#FFFFFF')).font('Helvetica').fontSize(9)
     .text((`PREPARED BY ${preparedByStr}`).toUpperCase(), 90, 28, {
       width: W, characterSpacing: 0.8,
     });
  pdf.restore();

  // Company name inside band — large, white
  if (companyName) {
    pdf.fillColor(hexToRgb('#FFFFFF')).font('Helvetica-Bold').fontSize(28)
       .text(companyName, 90, 54, { width: W });
  }

  // Document type — medium, white/75
  const docTypeY = companyName ? 104 : 54;
  pdf.save();
  pdf.opacity(0.75);
  pdf.fillColor(hexToRgb('#FFFFFF')).font('Helvetica').fontSize(15)
     .text(docTypeLabel, 90, docTypeY, { width: W });
  pdf.restore();

  // Week label below band — appears ONCE
  pdf.fillColor(hexToRgb('#64748B')).font('Helvetica').fontSize(12)
     .text(doc.week_label || '', 90, COVER_H + 22, { width: W });

  // Confidential tag
  pdf.fillColor(hexToRgb(MUTED)).font('Helvetica').fontSize(10)
     .text('Confidential', 90, COVER_H + 40, { width: W });

  // Move cursor below cover content
  pdf.y = COVER_H + 68;

  // Thin teal divider
  pdf.strokeColor(hexToRgb(TEAL)).lineWidth(1.5)
     .moveTo(90, pdf.y).lineTo(90 + W, pdf.y).stroke();
  pdf.y += 26;

  // Headline — callout box with teal left border and light background
  if (doc.headline) {
    const hlY   = pdf.y;
    const hlBoxH = 62;
    pdf.rect(90, hlY, W, hlBoxH).fill(hexToRgb('#F8FAFC'));
    pdf.rect(90, hlY, 4, hlBoxH).fill(hexToRgb(TEAL));
    pdf.fillColor(hexToRgb(DARK)).font('Helvetica-Bold').fontSize(13.5)
       .text(doc.headline, 108, hlY + 14, { width: W - 22, lineGap: 3 });
    pdf.y = Math.max(pdf.y, hlY + hlBoxH + 6);
  }
  pdf.moveDown(1.5);

  // ── Sections ───────────────────────────────────────────────────────────────

  // Fetch all charts for this report
  const pdfChartsResult = doc.id ? await query(`
    SELECT section_id, chart_png, title
    FROM report_charts
    WHERE report_document_id = $1
    ORDER BY section_id, position_in_section ASC
  `, [doc.id]) : { rows: [] };

  const pdfChartsBySection = new Map<string, any[]>();
  for (const chart of pdfChartsResult.rows) {
    if (!pdfChartsBySection.has(chart.section_id)) {
      pdfChartsBySection.set(chart.section_id, []);
    }
    pdfChartsBySection.get(chart.section_id)!.push(chart);
  }

  // Re-attach chart PNGs from report_charts to reasoning_tree nodes.
  // chart_png Buffers are stripped before JSON serialization (persistence.ts),
  // so they must be restored here for inline rendering to work.
  for (const section of doc.sections) {
    if (!section.reasoning_tree?.length) continue;
    const sectionCharts = pdfChartsBySection.get(section.id) || [];
    for (let i = 0; i < section.reasoning_tree.length; i++) {
      const node = section.reasoning_tree[i];
      if (node.chart_spec && sectionCharts[i]) {
        node.chart_png = sectionCharts[i].chart_png;
      }
    }
  }

  for (const section of doc.sections) {
    if (pdf.y > pdf.page.height - 180) pdf.addPage();

    // Section accent bar
    const barY = pdf.y;
    pdf.fillColor(hexToRgb(TEAL))
       .rect(90, barY, 3, 16).fill();

    pdf.fillColor(hexToRgb(DARK)).font('Helvetica-Bold').fontSize(12)
       .text(section.title, 99, barY, { width: W - 9 });
    pdf.moveDown(0.5);

    pdf.fillColor(hexToRgb(MID)).font('Helvetica').fontSize(10.5)
       .text(section.content || '', { width: W, lineGap: 4 });
    pdf.moveDown(1.8);

    // Render reasoning tree (McKinsey-style reasoning layers)
    if (section.reasoning_tree?.length) {
      const layerLabels: Record<string, string> = {
        cause:        'WHY',
        second_order: 'WHAT THIS MEANS',
        third_order:  'STRATEGIC QUESTION',
        action:       'ACTION REQUIRED',
      };

      const layerColors: Record<string, string> = {
        cause:        '#475569',  // slate
        second_order: '#0F6E56',  // dark teal
        third_order:  '#533AB7',  // purple
        action:       '#DC2626',  // red
      };

      for (const node of section.reasoning_tree) {
        if (pdf.y > pdf.page.height - 120) pdf.addPage();

        // Layer label — bigger, spaced capitals
        const labelColor = layerColors[node.layer] || '#475569';
        pdf.fillColor(hexToRgb(labelColor))
           .font('Helvetica-Bold')
           .fontSize(10)
           .text(layerLabels[node.layer] || node.layer.toUpperCase(), 108, pdf.y, {
             width: W - 18, characterSpacing: 0.5,
           });
        pdf.moveDown(0.25);

        // Question in italic
        pdf.fillColor(hexToRgb('#475569'))
           .font('Helvetica-Oblique')
           .fontSize(10.5)
           .text(node.question, 108, pdf.y, { width: W - 18, lineGap: 2 });
        pdf.moveDown(0.35);

        // Answer
        pdf.fillColor(hexToRgb(node.data_gap ? '#94A3B8' : '#1E293B'))
           .font(node.data_gap ? 'Helvetica-Oblique' : 'Helvetica')
           .fontSize(11)
           .text(node.answer, 108, pdf.y, { width: W - 18, lineGap: 3 });
        pdf.moveDown(0.6);

        // Chart Intelligence: render chart after answer
        if (node.chart_png && node.chart_spec) {
          if (pdf.y > pdf.page.height - 280) pdf.addPage();

          // Chart title ABOVE the image (Chart.js title is disabled in renderer)
          pdf.fillColor(hexToRgb('#1E293B'))
             .font('Helvetica-Bold')
             .fontSize(10)
             .text(node.chart_spec.title, 102, pdf.y, { width: W - 12, align: 'center' });
          pdf.moveDown(0.4);

          // Embed chart image — capture startY before so we can force cursor
          // to image bottom regardless of how PDFKit handles explicit-coordinate images
          const chartH = 160;
          const chartStartY = pdf.y;
          pdf.image(node.chart_png, 102, chartStartY, {
            fit: [W - 12, chartH],
            align: 'center',
          });
          pdf.y = chartStartY + chartH + 64;  // force cursor past chart + bottom margin (64pt gap)
        }

        // Data gap note
        if (node.data_gap) {
          pdf.fillColor(hexToRgb('#F59E0B'))
             .font('Helvetica-Oblique')
             .fontSize(8)
             .text('⚠ Insufficient data to answer fully', 102, pdf.y, { width: W - 12 });
          pdf.moveDown(0.4);
        }
      }

      pdf.moveDown(0.6);
    }

    // Embed section-level charts — skip if inline charts already rendered via reasoning_tree
    const hasInlineCharts = section.reasoning_tree?.some((n: any) => n.chart_png);
    const pdfSectionCharts = hasInlineCharts ? [] : (pdfChartsBySection.get(section.id) || []);
    for (const chart of pdfSectionCharts) {
      if (chart.chart_png) {
        if (pdf.y > pdf.page.height - 300) pdf.addPage();

        // Chart title ABOVE the image
        pdf.fillColor(hexToRgb(DARK))
           .font('Helvetica-Bold')
           .fontSize(10)
           .text(chart.title, 90, pdf.y, { width: W, align: 'center' });
        pdf.moveDown(0.4);

        // Embed PNG chart image — capture startY to force cursor to image bottom
        const sectionChartH = 180;
        const sectionChartStartY = pdf.y;
        pdf.image(chart.chart_png, 90, sectionChartStartY, {
          fit: [W, sectionChartH],
          align: 'center',
        });
        pdf.y = sectionChartStartY + sectionChartH + 64;  // force cursor past chart + bottom margin (64pt gap)
      }
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  if (config.include_actions !== false && doc.actions?.length) {
    if (pdf.y > pdf.page.height - 180) pdf.addPage();

    // Teal section divider line
    pdf.moveDown(0.8);
    pdf.save();
    pdf.opacity(0.25);
    pdf.strokeColor(hexToRgb(TEAL)).lineWidth(1.5)
       .moveTo(90, pdf.y).lineTo(90 + W, pdf.y).stroke();
    pdf.restore();
    pdf.y += 18;

    const barY = pdf.y;
    pdf.fillColor(hexToRgb(TEAL)).rect(90, barY, 3, 16).fill();
    pdf.fillColor(hexToRgb(DARK)).font('Helvetica-Bold').fontSize(12)
       .text('Actions', 99, barY, { width: W - 9 });
    pdf.moveDown(0.7);

    for (const action of doc.actions) {
      if (pdf.y > pdf.page.height - 100) pdf.addPage();

      const label = URGENCY_LABELS[action.urgency] ?? action.urgency.toUpperCase();
      const color = URGENCY_COLORS[action.urgency] ?? '#6B7280';
      const cleanText = (action.text || '').replace(/\s*—?\s*Owned by:.*$/i, '').trim();

      const rowY = pdf.y;
      pdf.fillColor(hexToRgb(color)).font('Helvetica-Bold').fontSize(8.5)
         .text(label, 90, rowY, { width: 72 });
      pdf.fillColor(hexToRgb(MID)).font('Helvetica').fontSize(10)
         .text(cleanText, 168, rowY, { width: W - 78 });
      pdf.moveDown(0.2);
      pdf.strokeColor(hexToRgb(BORDER)).lineWidth(0.5)
         .moveTo(90, pdf.y).lineTo(90 + W, pdf.y).stroke();
      pdf.moveDown(0.4);
    }
    pdf.moveDown(0.6);
  }

  // ── Recommended Next Steps ─────────────────────────────────────────────────
  if (doc.recommended_next_steps) {
    if (pdf.y > pdf.page.height - 140) pdf.addPage();

    const barY = pdf.y;
    pdf.fillColor(hexToRgb(TEAL)).rect(90, barY, 3, 16).fill();
    pdf.fillColor(hexToRgb(DARK)).font('Helvetica-Bold').fontSize(12)
       .text('Recommended Next Steps', 99, barY, { width: W - 9 });
    pdf.moveDown(0.5);

    pdf.fillColor(hexToRgb(MID)).font('Helvetica-Oblique').fontSize(10.5)
       .text(doc.recommended_next_steps, { width: W, lineGap: 2 });
  }

  // ── Footer on every page — post-render pass using bufferPages ─────────────
  // IMPORTANT: fy must stay within maxY (= page.height - margins.bottom = 720pt
  // for LETTER with bottom:72). Drawing text at y > maxY causes PDFKit to add a
  // new blank page, which was the source of the "6 pages instead of 4" bug.
  const footerLeft  = config.prepared_by
    ? `Prepared by ${config.prepared_by}`
    : 'Prepared by RevOps Impact';
  const footerRight = [doc.week_label || '', 'Confidential']
    .filter(Boolean).join(' · ');

  // fy = maxY - 18 keeps the 8pt text (lineHeight ~10pt) safely inside the text area
  const fy = pdf.page.height - pdf.page.margins.bottom - 18;

  const { start, count } = pdf.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    pdf.switchToPage(start + i);

    // Hairline divider above footer text
    pdf.strokeColor(hexToRgb(BORDER)).lineWidth(0.5)
       .moveTo(90, fy - 6).lineTo(90 + W, fy - 6).stroke();

    // Left: "Prepared by …"
    pdf.fillColor(hexToRgb(MUTED)).font('Helvetica').fontSize(8)
       .text(footerLeft, 90, fy, {
         width: W / 2, align: 'left', lineBreak: false,
       });

    // Right: "Week of … · Confidential"
    pdf.fillColor(hexToRgb(MUTED)).font('Helvetica').fontSize(8)
       .text(footerRight, 90 + W / 2, fy, {
         width: W / 2, align: 'right', lineBreak: false,
       });
  }

  pdf.flushPages();
  pdf.end();
  await done;
  return Buffer.concat(chunks);
}

function buildReportHtml(
  doc: ReportDocument,
  config: RenderConfig
): string {
  const urgencyLabels: Record<string, string> = {
    today: 'TODAY',
    this_week: 'THIS WEEK',
    this_month: 'THIS MONTH',
  };

  const urgencyColors: Record<string, string> = {
    today: '#DC2626',
    this_week: '#D97706',
    this_month: '#6B7280',
  };

  const sectionsHtml = doc.sections.map(section => {
    const paragraphs = section.content
      .split(/\n\n+/)
      .filter(p => p.trim())
      .map(p => {
        const style = section.flagged_for_client
          ? `background:#EFF6FF; border-left:3px solid #BFDBFE;
             padding:12px 16px; border-radius:0 4px 4px 0;`
          : '';
        return `<p style="margin:0 0 12px 0;${style}">${p.trim()}</p>`;
      }).join('');

    return `
      <div style="margin-bottom:32px;">
        <h2 style="
          font-size:16px; font-weight:600; color:#1E293B;
          margin:0 0 12px 0; padding:0 0 8px 12px;
          border-left:3px solid #0D9488;
        ">${section.title}</h2>
        ${paragraphs}
      </div>
    `;
  }).join('');

  const actionsHtml = (config.include_actions !== false
    && doc.actions?.length)
    ? `
      <div style="margin-bottom:32px;">
        <h2 style="
          font-size:16px; font-weight:600; color:#1E293B;
          margin:0 0 12px 0; padding:0 0 8px 12px;
          border-left:3px solid #0D9488;
        ">Actions</h2>
        <table style="width:100%; border-collapse:collapse;">
          ${doc.actions.map(a => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="
                padding:10px 12px 10px 0;
                width:15%;
                font-weight:700;
                font-size:11px;
                color:${urgencyColors[a.urgency] || '#6B7280'};
                vertical-align:top;
                white-space:nowrap;
              ">${urgencyLabels[a.urgency] || a.urgency.toUpperCase()}</td>
              <td style="
                padding:10px 12px;
                font-size:13px;
                color:#374151;
                vertical-align:top;
              ">${a.text.replace(/\s*—?\s*Owned by:.*$/i, '').trim()}</td>
              <td style="
                padding:10px 0 10px 12px;
                width:15%;
                font-size:12px;
                color:#6B7280;
                font-style:italic;
                vertical-align:top;
              ">${a.rep_name || ''}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : '';

  const nextStepsHtml = doc.recommended_next_steps
    ? `
      <div style="margin-bottom:32px;">
        <h2 style="
          font-size:16px; font-weight:600; color:#1E293B;
          margin:0 0 12px 0; padding:0 0 8px 12px;
          border-left:3px solid #0D9488;
        ">Recommended Next Steps</h2>
        <p style="
          margin:0; font-style:italic;
          color:#374151; font-size:13px; line-height:1.6;
        ">${doc.recommended_next_steps}</p>
      </div>
    ` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          font-size: 13px;
          line-height: 1.7;
          color: #374151;
        }
        p { margin: 0 0 12px 0; }
      </style>
    </head>
    <body>
      <!-- Cover — teal band -->
      <div style="background:#0D9488; padding:36px 40px 32px; margin-bottom:0;">
        <div style="font-size:9px; color:#A7F3D0; letter-spacing:1px;
                    text-transform:uppercase; margin-bottom:10px;">
          PREPARED BY ${config.prepared_by || 'RevOps Impact'}
        </div>
        ${config.for_company ? `
        <div style="font-size:28px; font-weight:700; color:#FFFFFF; margin-bottom:8px; line-height:1.2;">
          ${config.for_company}
        </div>` : ''}
        <div style="font-size:15px; color:#A7F3D0;">
          ${getReportTitle(doc.document_type)}
        </div>
      </div>
      <!-- Week label + confidential — below teal band -->
      <div style="padding:14px 40px 0; margin-bottom:24px;">
        <span style="font-size:12px; color:#64748B; margin-right:16px;">${doc.week_label}</span>
        <span style="font-size:11px; color:#94A3B8; font-style:italic;">Confidential</span>
      </div>
      <!-- Teal divider -->
      <div style="height:2px; background:#0D9488; opacity:0.25; margin:0 40px 24px;"></div>

      <!-- Headline — callout box -->
      <div style="
        background:#F8FAFC; border-left:4px solid #0D9488;
        padding:14px 20px; margin:0 40px 32px;
        font-size:15px; font-weight:700; color:#1E293B; line-height:1.45;
      ">${doc.headline}</div>

      <!-- Sections -->
      ${sectionsHtml}

      <!-- Actions -->
      ${actionsHtml}

      <!-- Recommended Next Steps -->
      ${nextStepsHtml}
    </body>
    </html>
  `;
}

function getReportTitle(docType: string): string {
  const titles: Record<string, string> = {
    monday_briefing:        'Monday Pipeline Briefing',
    weekly_business_review: 'Weekly Business Review',
    qbr:                    'Quarterly Business Review',
    board_deck:             'Board Revenue Update',
  };
  return titles[docType] || 'Pipeline Intelligence Report';
}

// ══════════════════════════════════════════════════════════════════════════════
// PPTX Renderer — Keep existing implementation
// ══════════════════════════════════════════════════════════════════════════════

export async function renderPptx(doc: ReportDocument): Promise<Buffer> {
  const pptxgen = (await import('pptxgenjs')).default;
  const prs = new (pptxgen as any)();

  prs.layout = 'LAYOUT_WIDE';
  prs.defineLayout({ name: 'LAYOUT_WIDE', width: 13.33, height: 7.5 });

  const BRAND = '4f46e5';
  const MUTED = '6b7280';
  const WHITE = 'FFFFFF';

  const titleSlide = prs.addSlide();
  titleSlide.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BRAND },
  });
  titleSlide.addText(doc.week_label || 'Weekly Briefing', {
    x: 0.8, y: 2.4, w: 11.73, h: 1.0,
    fontSize: 36, bold: true, color: WHITE, fontFace: 'Helvetica',
  });
  titleSlide.addText(doc.headline, {
    x: 0.8, y: 3.6, w: 11.73, h: 1.4,
    fontSize: 18, color: 'c7d2fe', fontFace: 'Helvetica', wrap: true,
  });

  for (const section of doc.sections) {
    const slide = prs.addSlide();

    slide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.5, fill: { color: BRAND },
    });

    slide.addText(section.title, {
      x: 0.5, y: 0.7, w: 12.33, h: 0.7,
      fontSize: 24, bold: true, color: '111827', fontFace: 'Helvetica',
    });

    slide.addText(section.content, {
      x: 0.5, y: 1.55, w: 12.33, h: 5.6,
      fontSize: 14, color: '374151', fontFace: 'Helvetica',
      valign: 'top', wrap: true,
    });
  }

  if (doc.actions && doc.actions.length > 0) {
    const actSlide = prs.addSlide();
    actSlide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.5, fill: { color: BRAND },
    });
    actSlide.addText('Actions', {
      x: 0.5, y: 0.7, w: 12.33, h: 0.7,
      fontSize: 24, bold: true, color: '111827',
    });
    const bulletLines = doc.actions.map(a => ({
      text: `[${a.urgency}]  ${a.text}`,
      options: { fontSize: 14, color: '374151', bullet: true },
    }));
    actSlide.addText(bulletLines, { x: 0.5, y: 1.55, w: 12.33, h: 5.6, valign: 'top', wrap: true });
  }

  const buf = await prs.write({ outputType: 'nodebuffer' }) as Buffer;
  return buf;
}
