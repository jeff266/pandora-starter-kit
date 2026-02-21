/**
 * DOCX Renderer
 *
 * Generates professional Word documents from report sections using docx library.
 * Supports cover pages, metrics, tables, deal cards, action items, and charts.
 */

import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel, ImageRun } from 'docx';
import { ReportGenerationContext } from '../reports/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DOCXRenderResult {
  filepath: string;
  size_bytes: number;
  download_url: string;
}

export async function renderDOCX(context: ReportGenerationContext): Promise<DOCXRenderResult> {
  const { workspace_id, template, sections_content, branding } = context;

  const primaryColor = branding?.primary_color || '2563EB';
  const accentColor = branding?.accent_color || '1E293B';

  // Build document sections
  const docSections: any[] = [];

  // Cover page
  docSections.push({
    properties: {},
    children: [
      new Paragraph({
        text: '',
        spacing: { before: 3000 },
      }),
      new Paragraph({
        text: template.name,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        style: 'Title',
      }),
      new Paragraph({
        text: template.description || '',
        alignment: AlignmentType.CENTER,
        spacing: { after: 800 },
      }),
      new Paragraph({
        text: `Generated on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: branding?.prepared_by || 'Prepared by Pandora',
            italics: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });

  // Content sections
  for (const section of sections_content) {
    const sectionChildren: Paragraph[] = [];

    // Section title
    sectionChildren.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 600, after: 300 },
        pageBreakBefore: true,
      })
    );

    // Narrative
    if (section.narrative) {
      const narrativeParas = section.narrative.split('\n\n').map(para =>
        new Paragraph({
          text: para,
          spacing: { after: 200 },
        })
      );
      sectionChildren.push(...narrativeParas);
    }

    // Metrics
    if (section.metrics && section.metrics.length > 0) {
      sectionChildren.push(
        new Paragraph({
          text: 'Key Metrics',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );

      const metricRows = section.metrics.map(metric => {
        const valueText = metric.delta
          ? `${metric.value} (${metric.delta_direction === 'up' ? '↑' : metric.delta_direction === 'down' ? '↓' : '→'} ${metric.delta})`
          : metric.value;

        return new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(metric.label)],
              width: { size: 40, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: valueText, bold: true })],
                }),
              ],
              width: { size: 60, type: WidthType.PERCENTAGE },
            }),
          ],
        });
      });

      sectionChildren.push(
        new Paragraph({
          children: [
            new Table({
              rows: metricRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1 },
                bottom: { style: BorderStyle.SINGLE, size: 1 },
                left: { style: BorderStyle.SINGLE, size: 1 },
                right: { style: BorderStyle.SINGLE, size: 1 },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
                insideVertical: { style: BorderStyle.SINGLE, size: 1 },
              },
            }) as any,
          ],
          spacing: { after: 400 },
        })
      );
    }

    // Table
    if (section.table) {
      sectionChildren.push(
        new Paragraph({
          text: 'Data',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );

      const headerRow = new TableRow({
        children: section.table.headers.map(
          header =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: header, bold: true })],
                }),
              ],
              shading: { fill: 'E5E7EB' },
            })
        ),
        tableHeader: true,
      });

      const dataRows = section.table.rows.map(
        row =>
          new TableRow({
            children: section.table!.headers.map(
              header =>
                new TableCell({
                  children: [new Paragraph(String(row[header] ?? ''))],
                })
            ),
          })
      );

      sectionChildren.push(
        new Paragraph({
          children: [
            new Table({
              rows: [headerRow, ...dataRows],
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1 },
                bottom: { style: BorderStyle.SINGLE, size: 1 },
                left: { style: BorderStyle.SINGLE, size: 1 },
                right: { style: BorderStyle.SINGLE, size: 1 },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
                insideVertical: { style: BorderStyle.SINGLE, size: 1 },
              },
            }) as any,
          ],
          spacing: { after: 400 },
        })
      );
    }

    // Deal cards
    if (section.deal_cards && section.deal_cards.length > 0) {
      sectionChildren.push(
        new Paragraph({
          text: 'Deals',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );

      for (const card of section.deal_cards) {
        sectionChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${card.name} `, bold: true }),
              new TextRun({ text: `(${card.amount})` }),
            ],
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: `Owner: ${card.owner} | Stage: ${card.stage}`,
            spacing: { after: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Signal: ', italics: true }),
              new TextRun({ text: card.signal }),
            ],
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: card.detail,
            spacing: { after: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Recommended: ', bold: true }),
              new TextRun({ text: card.action }),
            ],
            spacing: { after: 300 },
          })
        );
      }
    }

    // Action items
    if (section.action_items && section.action_items.length > 0) {
      sectionChildren.push(
        new Paragraph({
          text: 'Action Items',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );

      for (const action of section.action_items) {
        const urgencyLabel =
          action.urgency === 'today' ? '🔴 Today' : action.urgency === 'this_week' ? '🟡 This Week' : '🟢 This Month';

        sectionChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${urgencyLabel} `, bold: true }),
              new TextRun({ text: action.action }),
              new TextRun({ text: ` (${action.owner})`, italics: true }),
            ],
            spacing: { after: 200 },
            numbering: {
              reference: 'action-items',
              level: 0,
            },
          })
        );
      }
    }

    docSections.push({
      properties: {},
      children: sectionChildren,
    });
  }

  // Create document
  const doc = new Document({
    creator: 'Pandora',
    title: template.name,
    description: template.description || 'Generated report',
    sections: docSections,
    numbering: {
      config: [
        {
          reference: 'action-items',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
  });

  // Write to file
  const filename = `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.docx`;
  const filepath = path.join(os.tmpdir(), filename);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filepath, buffer);

  return {
    filepath,
    size_bytes: buffer.length,
    download_url: `/api/workspaces/${workspace_id}/reports/${template.id}/download/docx?file=${filename}`,
  };
}
