import {
  Document, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, ShadingType,
  Table, TableRow, TableCell, WidthType,
  PageNumber, Footer, convertInchesToTwip,
  Packer
} from 'docx';
import puppeteer from 'puppeteer';
import type { ReportDocument } from './types.js';

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

  const children: Paragraph[] = [];

  // ── Cover page content ──────────────────────────────

  // Client company name (large, primary color)
  children.push(new Paragraph({
    children: [new TextRun({
      text: for_company || doc.week_label,
      bold: true,
      size: 48,          // 24pt
      color: '1E293B',
    })],
    spacing: { before: 2880 }, // Push down from top
  }));

  // Report title
  children.push(new Paragraph({
    children: [new TextRun({
      text: getReportTitle(doc.document_type),
      size: 32,          // 16pt
      color: '475569',
    })],
    spacing: { before: 240 },
  }));

  // Week label
  children.push(new Paragraph({
    children: [new TextRun({
      text: doc.week_label,
      size: 24,          // 12pt
      color: '94A3B8',
    })],
    spacing: { before: 120 },
  }));

  // Prepared by line
  if (prepared_by) {
    children.push(new Paragraph({
      children: [new TextRun({
        text: `Prepared by ${prepared_by}`,
        size: 20,
        color: '94A3B8',
        italics: true,
      })],
      spacing: { before: 480 },
    }));
  }

  // Horizontal rule after cover content
  children.push(new Paragraph({
    border: {
      bottom: {
        color: 'E2E8F0',
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
    spacing: { before: 480, after: 480 },
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
// PDF Renderer v2 — HTML→PDF via Puppeteer for professional typography
// ══════════════════════════════════════════════════════════════════════════════

export async function renderPdf(
  doc: ReportDocument,
  config: RenderConfig = {}
): Promise<Buffer> {

  const html = buildReportHtml(doc, config);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: {
        top: '1in',
        bottom: '1in',
        left: '1.25in',
        right: '1.25in',
      },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="
          font-size: 9px;
          color: #94A3B8;
          width: 100%;
          text-align: center;
          padding: 0 1.25in;
          font-family: 'Georgia', serif;
        ">
          ${[
            config.prepared_by
              ? `Prepared by ${config.prepared_by}` : '',
            config.for_company
              ? `for ${config.for_company}` : '',
            new Date().toLocaleDateString('en-US', {
              month: 'long', year: 'numeric'
            }),
          ].filter(Boolean).join(' · ')}
          · Page <span class="pageNumber"></span>
          of <span class="totalPages"></span>
        </div>
      `,
    }) as Buffer;

    return pdfBuffer;

  } finally {
    await browser.close();
  }
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
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 13px;
          line-height: 1.6;
          color: #374151;
        }
        p { margin: 0 0 12px 0; }
      </style>
    </head>
    <body>
      <!-- Cover content -->
      <div style="margin-bottom:48px; padding-bottom:32px;
                  border-bottom:1px solid #E2E8F0;">
        <div style="font-size:28px; font-weight:700;
                    color:#1E293B; margin-bottom:8px;">
          ${config.for_company || doc.week_label}
        </div>
        <div style="font-size:16px; color:#475569;
                    margin-bottom:4px;">
          ${getReportTitle(doc.document_type)}
        </div>
        <div style="font-size:13px; color:#94A3B8;">
          ${doc.week_label}
        </div>
      </div>

      <!-- Headline -->
      <div style="
        font-size:17px; font-weight:700; color:#1E293B;
        margin-bottom:32px; line-height:1.4;
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
