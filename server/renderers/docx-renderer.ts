import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType,
  TableLayoutType,
} from 'docx';
import { ReportGenerationContext, SectionContent, MetricCard, DealCard, ActionItem, HumanAnnotation } from '../reports/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEAL = '00BFA5';
const CORAL = 'F87171';

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

function annotationMap(annotations: HumanAnnotation[]): Map<string, HumanAnnotation> {
  const m = new Map<string, HumanAnnotation>();
  for (const a of annotations) m.set(a.block_id, a);
  return m;
}

export async function renderDOCX(context: ReportGenerationContext): Promise<DOCXRenderResult> {
  const { workspace_id, template, sections_content, branding, human_annotations, annotated_at, annotated_by, version, opening_narrative } = context;

  const accentColor = branding?.primary_color?.replace('#', '') || C.blue;
  const annMap = annotationMap(human_annotations || []);
  const isAnnotated = (human_annotations?.length ?? 0) > 0;
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
        spacing: { after: isAnnotated ? 200 : 0 },
      }),
      ...(isAnnotated ? [
        new Paragraph({
          children: [new TextRun({
            text: `Revised by ${annotated_by || 'reviewer'}${annotated_at ? ` · ${new Date(annotated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`,
            bold: true, size: 20, color: TEAL,
          })],
        }),
        new Paragraph({
          children: [new TextRun({
            text: `V${version || 2} — Contains human annotations (overrides, strikethroughs, notes)`,
            italics: true, size: 18, color: C.lightGray,
          })],
        }),
      ] : []),
    ],
  });

  // ── OPENING NARRATIVE / EXECUTIVE SUMMARY ──
  if (opening_narrative) {
    const cleaned = stripMarkdown(opening_narrative);
    const paras = cleaned.split('\n\n').filter(p => p.trim());
    const narrativeChildren: any[] = [
      new Paragraph({
        children: [new TextRun({ text: 'Executive Summary', bold: true, size: 32, color: C.navy, font: 'Calibri' })],
        spacing: { before: 0, after: 240 },
        pageBreakBefore: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accentColor } },
      }),
    ];
    for (const para of paras.slice(0, 20)) {
      const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        narrativeChildren.push(new Paragraph({
          children: [new TextRun({ text: line, size: 20, color: C.darkSlate, font: 'Calibri' })],
          spacing: { after: 120 },
        }));
      }
    }
    docSections.push({ properties: {}, children: narrativeChildren });
  }

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
      const metricsWithAnnotations = section.metrics.map((m, idx) => {
        const blockId = `${section.section_id}:metric:${idx}`;
        const ann = annMap.get(blockId);
        return { metric: m, annotation: ann };
      });
      children.push(buildAnnotatedMetricsTable(metricsWithAnnotations, accentColor));
      children.push(new Paragraph({ spacing: { after: 200 }, text: '' }));
    }

    // Narrative paragraphs
    if (section.narrative && !section.narrative.startsWith('⚠')) {
      const narrativeAnn = annMap.get(`${section.section_id}:narrative`);
      const narrativeText = narrativeAnn?.new_value || section.narrative;
      if (narrativeAnn) {
        children.push(new Paragraph({
          children: [new TextRun({ text: '✎ Narrative edited by reviewer', size: 16, color: TEAL, italics: true })],
          spacing: { after: 100 },
          indent: { left: 200 },
          border: { left: { style: BorderStyle.SINGLE, size: 8, color: TEAL } },
        }));
      }
      const cleaned = stripMarkdown(narrativeText);
      const paras = cleaned.split('\n\n').filter(p => p.trim());
      for (const para of paras.slice(0, 12)) {
        const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          children.push(new Paragraph({
            children: [new TextRun({ text: line, size: 20, color: C.darkSlate, font: 'Calibri' })],
            spacing: { after: 120 },
            ...(narrativeAnn ? { indent: { left: 200 }, border: { left: { style: BorderStyle.SINGLE, size: 4, color: TEAL } } } : {}),
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

    // Action items (with strike annotations)
    if (section.action_items && section.action_items.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Action Items', bold: true, size: 26, color: C.navy })],
        spacing: { before: 300, after: 200 },
      }));

      for (let i = 0; i < Math.min(section.action_items.length, 15); i++) {
        const a = section.action_items[i];
        const blockId = `${section.section_id}:action:${i}`;
        const actionAnn = annMap.get(blockId);
        const noteAnn = annMap.get(`${blockId}:note`);
        const isStruck = actionAnn?.type === 'strike';
        const urgencyColor = a.urgency === 'today' ? C.red : a.urgency === 'this_week' ? C.amber : C.green;
        const urgencyLabel = a.urgency === 'today' ? 'TODAY' : a.urgency === 'this_week' ? 'THIS WEEK' : 'THIS MONTH';

        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${i + 1}. `, bold: true, size: 20, color: isStruck ? C.lightGray : C.darkSlate }),
            new TextRun({ text: `[${urgencyLabel}] `, bold: true, size: 18, color: isStruck ? C.lightGray : urgencyColor }),
            new TextRun({ text: a.action, size: 20, color: isStruck ? C.lightGray : C.darkSlate, strike: isStruck }),
            new TextRun({ text: a.owner ? `  — ${a.owner}` : '', italics: true, size: 18, color: C.midGray, strike: isStruck }),
            ...(isStruck ? [new TextRun({ text: '  [removed by annotation]', italics: true, size: 16, color: CORAL })] : []),
          ],
          spacing: { after: 100 },
        }));

        if (noteAnn?.new_value) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `  ✎ Note: ${noteAnn.new_value}`, italics: true, size: 18, color: TEAL })],
            spacing: { after: 80 },
            indent: { left: 400 },
            border: { left: { style: BorderStyle.SINGLE, size: 4, color: TEAL } },
          }));
        }
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

function buildAnnotatedMetricsTable(entries: { metric: MetricCard; annotation?: HumanAnnotation }[], accent: string): Table {
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

  for (const { metric: m, annotation } of entries) {
    const isOverride = annotation?.type === 'override' && annotation.new_value;
    const { fill, color } = severityShading(m.severity);
    const effectiveFill = isOverride ? 'E0FDF4' : fill;
    const deltaText = m.delta
      ? ` (${m.delta_direction === 'up' ? '▲' : m.delta_direction === 'down' ? '▼' : '—'} ${m.delta})`
      : '';

    const valueChildren = isOverride
      ? [
          new TextRun({ text: m.value + deltaText, size: 18, color: C.lightGray, strike: true }),
          new TextRun({ text: '  →  ' + annotation!.new_value!, bold: true, size: 22, color: TEAL }),
        ]
      : [new TextRun({ text: m.value + deltaText, bold: true, size: 22, color })];

    rows.push(new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: m.label, size: 20, color: C.darkSlate })] })],
          shading: { fill: effectiveFill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: valueChildren })],
          shading: { fill: effectiveFill, type: ShadingType.CLEAR, color: 'auto' },
        }),
        new TableCell({
          children: [new Paragraph({ children: [
            severityTag(m.severity || 'info'),
            ...(isOverride ? [new TextRun({ text: ' ✎', color: TEAL, bold: true, size: 16 })] : []),
          ] })],
          shading: { fill: effectiveFill, type: ShadingType.CLEAR, color: 'auto' },
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

  const dealColWidths = [28, 15, 18, 24, 15];
  rows.push(new TableRow({
    children: ['Deal', 'Amount', 'Stage', 'Signal', 'Action'].map((h, i) =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16, color: 'FFFFFF' })] })],
        shading: { fill: accent, type: ShadingType.CLEAR, color: 'auto' },
        width: { size: dealColWidths[i], type: WidthType.PERCENTAGE },
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

  const colCount = table.headers.length || 1;
  const baseWidth = Math.floor(100 / colCount);
  const remainder = 100 - baseWidth * colCount;
  const colWidths = table.headers.map((_, i) => baseWidth + (i === 0 ? remainder : 0));

  rows.push(new TableRow({
    children: table.headers.map((h, i) =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16, color: 'FFFFFF' })] })],
        shading: { fill: C.navy, type: ShadingType.CLEAR, color: 'auto' },
        width: { size: colWidths[i], type: WidthType.PERCENTAGE },
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
