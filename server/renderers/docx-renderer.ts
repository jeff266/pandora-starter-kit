import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType,
  TableLayoutType,
} from 'docx';
import { ReportGenerationContext, SectionContent, MetricCard, DealCard, ActionItem } from '../reports/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const C = {
  navy: '0F172A',
  darkSlate: '1E293B',
  slate: '334155',
  midGray: '64748B',
  lightGray: '94A3B8',
  border: 'CBD5E1',
  softBg: 'F8FAFC',
  white: 'FFFFFF',
  blue: '2563EB',
  blueLight: 'DBEAFE',
  green: '16A34A',
  greenBg: 'D1FAE5',
  greenDark: '15803D',
  amber: 'D97706',
  amberBg: 'FEF3C7',
  amberDark: 'B45309',
  red: 'DC2626',
  redBg: 'FEE2E2',
  redDark: 'B91C1C',
};

export interface DOCXRenderResult {
  filepath: string;
  size_bytes: number;
  download_url: string;
}

function severityShading(severity?: string): { fill: string; color: string } {
  switch (severity) {
    case 'critical': return { fill: C.redBg, color: C.redDark };
    case 'warning': return { fill: C.amberBg, color: C.amberDark };
    case 'good': return { fill: C.greenBg, color: C.greenDark };
    default: return { fill: C.softBg, color: C.slate };
  }
}

function severityTag(severity: string): TextRun {
  const label = severity === 'critical' ? 'CRITICAL' : severity === 'warning' ? 'WARNING' : severity === 'good' ? 'GOOD' : 'INFO';
  const color = severity === 'critical' ? C.red : severity === 'warning' ? C.amber : severity === 'good' ? C.green : C.blue;
  return new TextRun({
    text: ` [${label}] `,
    bold: true,
    color,
    size: 18,
  });
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/🚨|🔴|🟡|🟢|⚠️|📊|📈|📉|💡|🎯/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export async function renderDOCX(context: ReportGenerationContext): Promise<DOCXRenderResult> {
  const { workspace_id, template, sections_content, branding } = context;

  const accentColor = branding?.primary_color?.replace('#', '') || C.blue;
  const docSections: any[] = [];

  // ── COVER PAGE ──
  docSections.push({
    properties: {},
    children: [
      new Paragraph({ spacing: { before: 4000 }, text: '' }),
      new Paragraph({
        children: [new TextRun({ text: template.name, bold: true, size: 72, color: C.navy, font: 'Calibri' })],
        alignment: AlignmentType.LEFT,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: template.description || '', size: 28, color: C.midGray, font: 'Calibri' })],
        spacing: { after: 600 },
      }),
      new Paragraph({
        children: [new TextRun({
          text: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
          size: 22, color: C.lightGray,
        })],
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({
          text: branding?.prepared_by || 'Prepared by Pandora GTM Intelligence',
          italics: true, size: 20, color: C.lightGray,
        })],
      }),
    ],
  });

  // ── CONTENT SECTIONS ──
  for (const section of sections_content) {
    const children: any[] = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: section.title, bold: true, size: 36, color: C.navy, font: 'Calibri' })],
      spacing: { before: 0, after: 300 },
      pageBreakBefore: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accentColor } },
    }));

    // Metrics table
    if (section.metrics && section.metrics.length > 0) {
      children.push(buildMetricsTable(section.metrics, accentColor));
      children.push(new Paragraph({ spacing: { after: 200 }, text: '' }));
    }

    // Narrative paragraphs
    if (section.narrative && !section.narrative.startsWith('⚠')) {
      const cleaned = stripMarkdown(section.narrative);
      const paras = cleaned.split('\n\n').filter(p => p.trim());
      for (const para of paras.slice(0, 12)) {
        const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          children.push(new Paragraph({
            children: [new TextRun({ text: line, size: 20, color: C.darkSlate, font: 'Calibri' })],
            spacing: { after: 120 },
          }));
        }
      }
      children.push(new Paragraph({ spacing: { after: 200 }, text: '' }));
    }

    // Deal cards with colored signal tags
    if (section.deal_cards && section.deal_cards.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Deals Requiring Attention', bold: true, size: 26, color: C.navy })],
        spacing: { before: 300, after: 200 },
      }));

      children.push(buildDealTable(section.deal_cards, accentColor));
      children.push(new Paragraph({ spacing: { after: 200 }, text: '' }));
    }

    // Data table
    if (section.table && section.table.rows.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Data', bold: true, size: 26, color: C.navy })],
        spacing: { before: 300, after: 200 },
      }));
      children.push(buildDataTable(section.table));
      children.push(new Paragraph({ spacing: { after: 200 }, text: '' }));
    }

    // Action items
    if (section.action_items && section.action_items.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Action Items', bold: true, size: 26, color: C.navy })],
        spacing: { before: 300, after: 200 },
      }));

      for (let i = 0; i < Math.min(section.action_items.length, 15); i++) {
        const a = section.action_items[i];
        const urgencyColor = a.urgency === 'today' ? C.red : a.urgency === 'this_week' ? C.amber : C.green;
        const urgencyLabel = a.urgency === 'today' ? 'TODAY' : a.urgency === 'this_week' ? 'THIS WEEK' : 'THIS MONTH';

        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${i + 1}. `, bold: true, size: 20, color: C.darkSlate }),
            new TextRun({ text: `[${urgencyLabel}] `, bold: true, size: 18, color: urgencyColor }),
            new TextRun({ text: a.action, size: 20, color: C.darkSlate }),
            new TextRun({ text: a.owner ? `  — ${a.owner}` : '', italics: true, size: 18, color: C.midGray }),
          ],
          spacing: { after: 100 },
        }));
      }
    }

    // Freshness footer
    children.push(new Paragraph({
      children: [new TextRun({
        text: `Data as of ${new Date(section.data_freshness).toLocaleString('en-US')} · Confidence: ${Math.round(section.confidence * 100)}%`,
        size: 14, color: C.lightGray, italics: true,
      })],
      spacing: { before: 400 },
    }));

    docSections.push({ properties: {}, children });
  }

  const doc = new Document({
    creator: 'Pandora GTM Intelligence',
    title: template.name,
    description: template.description || '',
    sections: docSections,
  });

  const filename = `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.docx`;
  const outDir = path.join(os.tmpdir(), 'pandora-reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filepath, buffer);

  return {
    filepath,
    size_bytes: buffer.length,
    download_url: `/api/workspaces/${workspace_id}/reports/${template.id}/download/docx?file=${filename}`,
  };
}

function buildMetricsTable(metrics: MetricCard[], accent: string): Table {
  const rows: TableRow[] = [];

  rows.push(new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'METRIC', bold: true, size: 16, color: 'FFFFFF', font: 'Calibri' })] })],
        shading: { fill: accent, type: ShadingType.CLEAR, color: 'auto' },
        width: { size: 40, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'VALUE', bold: true, size: 16, color: 'FFFFFF', font: 'Calibri' })] })],
        shading: { fill: accent, type: ShadingType.CLEAR, color: 'auto' },
        width: { size: 35, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'STATUS', bold: true, size: 16, color: 'FFFFFF', font: 'Calibri' })] })],
        shading: { fill: accent, type: ShadingType.CLEAR, color: 'auto' },
        width: { size: 25, type: WidthType.PERCENTAGE },
      }),
    ],
    tableHeader: true,
  }));

  for (const m of metrics) {
    const { fill, color } = severityShading(m.severity);
    const valueText = m.delta
      ? `${m.value} (${m.delta_direction === 'up' ? '▲' : m.delta_direction === 'down' ? '▼' : '—'} ${m.delta})`
      : m.value;

    rows.push(new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: m.label, size: 20, color: C.darkSlate })] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: valueText, bold: true, size: 22, color })] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: [severityTag(m.severity || 'info')] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
      ],
    }));
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      left: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      right: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: C.softBg },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: C.white },
    },
  });
}

function buildDealTable(deals: DealCard[], accent: string): Table {
  const rows: TableRow[] = [];

  rows.push(new TableRow({
    children: ['Deal', 'Amount', 'Stage', 'Signal', 'Action'].map(h =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16, color: 'FFFFFF' })] })],
        shading: { fill: accent, type: ShadingType.CLEAR, color: 'auto' },
      })
    ),
    tableHeader: true,
  }));

  for (const d of deals.slice(0, 15)) {
    const { fill } = severityShading(d.signal_severity);

    rows.push(new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: d.name, bold: true, size: 18, color: C.darkSlate })] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: d.amount || '—', size: 18, color: C.darkSlate })] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: d.stage || '—', size: 18, color: C.midGray })] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: [
            severityTag(d.signal_severity || 'info'),
            new TextRun({ text: d.signal || '', size: 16, color: C.midGray }),
          ] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: d.action || '—', size: 16, color: accent, italics: true })] })],
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
        }),
      ],
    }));
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      left: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      right: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: C.softBg },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: C.softBg },
    },
  });
}

function buildDataTable(table: { headers: string[]; rows: Record<string, any>[] }): Table {
  const rows: TableRow[] = [];

  rows.push(new TableRow({
    children: table.headers.map(h =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16, color: 'FFFFFF' })] })],
        shading: { fill: C.navy, type: ShadingType.CLEAR, color: 'auto' },
      })
    ),
    tableHeader: true,
  }));

  for (let i = 0; i < Math.min(table.rows.length, 25); i++) {
    const row = table.rows[i];
    const bg = i % 2 === 0 ? C.white : C.softBg;
    rows.push(new TableRow({
      children: table.headers.map(h =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: String(row[h] ?? ''), size: 18, color: C.darkSlate })] })],
          shading: { fill: bg, type: ShadingType.CLEAR, color: 'auto' },
        })
      ),
    }));
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      left: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      right: { style: BorderStyle.SINGLE, size: 1, color: C.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: C.softBg },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: C.softBg },
    },
  });
}
