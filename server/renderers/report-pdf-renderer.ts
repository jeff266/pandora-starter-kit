import PDFDocument from 'pdfkit';
import { ReportGenerationContext, SectionContent, MetricCard, DealCard, ActionItem, HumanAnnotation } from '../reports/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const C = {
  navy: '#0F172A',
  darkSlate: '#1E293B',
  slate: '#334155',
  midGray: '#64748B',
  lightGray: '#94A3B8',
  border: '#CBD5E1',
  softBorder: '#E2E8F0',
  pageBg: '#FFFFFF',
  sectionBg: '#F8FAFC',
  blue: '#2563EB',
  blueLight: '#DBEAFE',
  blueDark: '#1D4ED8',
  green: '#16A34A',
  greenBg: '#D1FAE5',
  greenDark: '#15803D',
  amber: '#D97706',
  amberBg: '#FEF3C7',
  amberDark: '#B45309',
  red: '#DC2626',
  redBg: '#FEE2E2',
  redDark: '#B91C1C',
};

export interface PDFRenderResult {
  filepath: string;
  size_bytes: number;
  download_url: string;
}

function severityColor(severity?: string): { bg: string; fg: string } {
  switch (severity) {
    case 'critical': return { bg: C.redBg, fg: C.redDark };
    case 'warning': return { bg: C.amberBg, fg: C.amberDark };
    case 'good': return { bg: C.greenBg, fg: C.greenDark };
    default: return { bg: C.sectionBg, fg: C.slate };
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/<actions>[\s\S]*?<\/actions>/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/^---+$/gm, '')
    .replace(/🚨|🔴|🟡|🟢|⚠️|📊|📈|📉|💡|🎯/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureSpace(doc: any, needed: number): void {
  if (doc.y + needed > 700) {
    doc.addPage();
  }
}

const TEAL = '#00BFA5';
const CORAL = '#F87171';

function pdfAnnotationMap(annotations: HumanAnnotation[]): Map<string, HumanAnnotation> {
  const m = new Map<string, HumanAnnotation>();
  for (const a of annotations) m.set(a.block_id, a);
  return m;
}

export async function renderReportPDF(context: ReportGenerationContext): Promise<PDFRenderResult> {
  const { workspace_id, template, sections_content, branding, human_annotations, annotated_at, annotated_by, version } = context;

  const accentColor = branding?.primary_color || C.blue;
  const annMap = pdfAnnotationMap(human_annotations || []);
  const isAnnotated = (human_annotations?.length ?? 0) > 0;

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 50, bottom: 50, left: 55, right: 55 },
    bufferPages: true,
    info: {
      Title: template.name,
      Author: branding?.prepared_by || 'Pandora',
      Creator: 'Pandora GTM Intelligence',
    },
  });

  const pageW = 612;
  const contentW = pageW - 110;
  const lMargin = 55;

  const filename = `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.pdf`;
  const outDir = path.join(os.tmpdir(), 'pandora-reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // ── COVER PAGE ──
  doc.rect(0, 0, pageW, 200).fill(C.navy);
  doc.rect(0, 200, pageW, 6).fill(accentColor);

  doc.fontSize(38).fillColor('#FFFFFF').text(template.name, lMargin, 70, {
    width: contentW,
    align: 'left',
  });

  if (template.description) {
    doc.fontSize(14).fillColor(C.lightGray).text(template.description, lMargin, 130, {
      width: contentW,
    });
  }

  doc.fontSize(12).fillColor(C.midGray).text(
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    lMargin, 250,
  );

  if (branding?.prepared_by) {
    doc.fontSize(11).fillColor(C.midGray).text(`Prepared by ${branding.prepared_by}`, lMargin, 270);
  }

  if (isAnnotated) {
    const revisedY = branding?.prepared_by ? 290 : 270;
    doc.fontSize(11).fillColor(TEAL)
      .text(`Revised by ${annotated_by || 'reviewer'}${annotated_at ? ` · ${new Date(annotated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`, lMargin, revisedY);
    doc.fontSize(9).fillColor(C.lightGray)
      .text(`V${version || 2} — Contains human annotations`, lMargin, revisedY + 16);
  }

  doc.fontSize(10).fillColor(C.lightGray).text('Pandora GTM Intelligence', lMargin, 700, {
    width: contentW,
    align: 'center',
  });

  // ── SECTIONS ──
  for (const section of sections_content) {
    doc.addPage();

    doc.rect(0, 0, pageW, 60).fill(C.navy);
    doc.fontSize(20).fillColor('#FFFFFF').text(section.title, lMargin, 18, { width: contentW });
    doc.rect(0, 60, pageW, 3).fill(accentColor);

    doc.y = 80;

    // Metrics cards (grid layout with annotation support)
    if (section.metrics && section.metrics.length > 0) {
      const metricsWithAnn = section.metrics.map((m, idx) => ({
        metric: m,
        annotation: annMap.get(`${section.section_id}:metric:${idx}`),
      }));
      renderAnnotatedMetricGrid(doc, metricsWithAnn, lMargin, contentW);
    }

    // Narrative
    if (section.narrative && !section.narrative.startsWith('⚠')) {
      ensureSpace(doc, 60);
      const narrativeAnn = annMap.get(`${section.section_id}:narrative`);
      const narrativeText = narrativeAnn?.new_value || section.narrative;
      if (narrativeAnn) {
        doc.rect(lMargin, doc.y, 3, 14).fill(TEAL);
        doc.fontSize(9).fillColor(TEAL).text('  ✎ Narrative edited by reviewer', lMargin + 6, doc.y - 12, { width: contentW });
        doc.moveDown(0.3);
      }
      const cleanText = stripMarkdown(narrativeText);
      const lines = cleanText.split('\n').filter(l => l.trim());
      for (const line of lines.slice(0, 15)) {
        ensureSpace(doc, 16);
        if (narrativeAnn) doc.rect(lMargin, doc.y, 2, 12).fill(TEAL);
        doc.fontSize(10).fillColor(C.darkSlate).text(line.trim(), lMargin + (narrativeAnn ? 8 : 0), doc.y, {
          width: contentW - (narrativeAnn ? 8 : 0),
          lineGap: 3,
        });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.5);
    }

    // Deal cards
    if (section.deal_cards && section.deal_cards.length > 0) {
      renderDealCards(doc, section.deal_cards, lMargin, contentW, accentColor);
    }

    // Table
    if (section.table && section.table.rows.length > 0) {
      renderTable(doc, section.table, lMargin, contentW);
    }

    // Action items (with strike/note annotation support)
    if (section.action_items && section.action_items.length > 0) {
      const actionsWithAnn = section.action_items.map((a, idx) => ({
        action: a,
        annotation: annMap.get(`${section.section_id}:action:${idx}`),
        noteAnnotation: annMap.get(`${section.section_id}:action:${idx}:note`),
      }));
      renderAnnotatedActionItems(doc, actionsWithAnn, lMargin, contentW);
    }

    // Data freshness footer
    doc.fontSize(7).fillColor(C.lightGray).text(
      `Data as of ${new Date(section.data_freshness).toLocaleString('en-US')} | Confidence: ${Math.round(section.confidence * 100)}%`,
      lMargin, 740, { width: contentW, align: 'right' },
    );
  }

  // Page numbers
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor(C.lightGray).text(
      `${i + 1} / ${totalPages}`,
      lMargin, 750, { width: contentW, align: 'center' },
    );
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(filepath, buffer);
      resolve({
        filepath,
        size_bytes: buffer.length,
        download_url: `/api/workspaces/${workspace_id}/reports/${template.id}/download/pdf?file=${filename}`,
      });
    });
    doc.on('error', reject);
  });
}

function renderAnnotatedMetricGrid(
  doc: any,
  entries: { metric: MetricCard; annotation?: HumanAnnotation }[],
  lMargin: number,
  contentW: number,
): void {
  const cols = Math.min(entries.length, 3);
  const cardW = (contentW - (cols - 1) * 10) / cols;
  const cardH = 60;

  for (let i = 0; i < entries.length; i += cols) {
    ensureSpace(doc, cardH + 15);
    const rowY = doc.y;

    for (let j = 0; j < cols && i + j < entries.length; j++) {
      const { metric: m, annotation } = entries[i + j];
      const x = lMargin + j * (cardW + 10);
      const isOverride = annotation?.type === 'override' && annotation.new_value;
      const { bg, fg } = severityColor(m.severity);
      const cardBg = isOverride ? '#E0FDF4' : bg;

      doc.rect(x, rowY, cardW, cardH).fill(cardBg);

      const severityBar = isOverride ? TEAL : (m.severity === 'critical' ? C.red : m.severity === 'warning' ? C.amber : m.severity === 'good' ? C.green : C.border);
      doc.rect(x, rowY, 4, cardH).fill(severityBar);

      doc.fontSize(8).fillColor(C.midGray).text(m.label.toUpperCase(), x + 12, rowY + 8, { width: cardW - 20 });

      if (isOverride) {
        const origText = m.value + (m.delta ? ` ${m.delta}` : '');
        doc.fontSize(10).fillColor(C.lightGray).text(origText, x + 12, rowY + 22, { width: (cardW - 20) / 2 });
        doc.fontSize(14).fillColor(TEAL).text(annotation!.new_value!, x + 12 + (cardW - 20) / 2, rowY + 20, { width: (cardW - 20) / 2 });
        doc.fontSize(7).fillColor(TEAL).text('✎ Edited', x + 12, rowY + 48, { width: cardW - 20 });
      } else {
        const valueText = m.delta
          ? `${m.value}  ${m.delta_direction === 'up' ? '▲' : m.delta_direction === 'down' ? '▼' : '—'} ${m.delta}`
          : m.value;
        doc.fontSize(16).fillColor(fg).text(valueText, x + 12, rowY + 24, { width: cardW - 20 });
      }
    }

    doc.y = rowY + cardH + 10;
  }
  doc.moveDown(0.5);
}

function renderAnnotatedActionItems(
  doc: any,
  entries: { action: ActionItem; annotation?: HumanAnnotation; noteAnnotation?: HumanAnnotation }[],
  lMargin: number,
  contentW: number,
): void {
  ensureSpace(doc, 30);
  doc.fontSize(12).fillColor(C.darkSlate).text('Action Items', lMargin, doc.y);
  doc.moveDown(0.4);

  for (let i = 0; i < Math.min(entries.length, 15); i++) {
    const { action: a, annotation, noteAnnotation } = entries[i];
    const isStruck = annotation?.type === 'strike';
    ensureSpace(doc, 26);
    const y = doc.y;

    const dotColor = isStruck ? C.lightGray : (a.urgency === 'today' ? C.red : a.urgency === 'this_week' ? C.amber : C.green);
    doc.circle(lMargin + 6, y + 6, 4).fill(dotColor);

    if (isStruck) {
      doc.save();
      doc.fontSize(9).fillColor(C.lightGray).text(a.action, lMargin + 18, y, { width: contentW - 100 });
      const textH = 9;
      const textY = y + textH / 2;
      doc.moveTo(lMargin + 18, textY).lineTo(lMargin + 18 + Math.min(a.action.length * 5, contentW - 100), textY).stroke(CORAL);
      doc.restore();
      doc.fontSize(8).fillColor(CORAL).text('[removed by annotation]', lMargin + 18, y + 10, { width: contentW - 100 });
    } else {
      doc.fontSize(9).fillColor(C.darkSlate).text(a.action, lMargin + 18, y, { width: contentW - 100 });
    }

    if (a.owner) {
      doc.fontSize(8).fillColor(C.midGray).text(a.owner, lMargin + contentW - 80, y, { width: 80, align: 'right' });
    }

    doc.y = Math.max(doc.y, y + 18);

    if (noteAnnotation?.new_value) {
      ensureSpace(doc, 20);
      const noteY = doc.y;
      doc.rect(lMargin + 18, noteY, 2, 14).fill(TEAL);
      doc.fontSize(8).fillColor(TEAL).text(`✎ ${noteAnnotation.new_value}`, lMargin + 24, noteY, { width: contentW - 42 });
      doc.y = Math.max(doc.y, noteY + 16);
    }

    doc.moveDown(0.15);
  }
  doc.moveDown(0.5);
}

function renderMetricGrid(doc: any, metrics: MetricCard[], lMargin: number, contentW: number): void {
  const cols = Math.min(metrics.length, 3);
  const cardW = (contentW - (cols - 1) * 10) / cols;
  const cardH = 55;

  for (let i = 0; i < metrics.length; i += cols) {
    ensureSpace(doc, cardH + 15);
    const rowY = doc.y;

    for (let j = 0; j < cols && i + j < metrics.length; j++) {
      const m = metrics[i + j];
      const x = lMargin + j * (cardW + 10);
      const { bg, fg } = severityColor(m.severity);

      doc.rect(x, rowY, cardW, cardH).fill(bg);

      const severityBar = m.severity === 'critical' ? C.red : m.severity === 'warning' ? C.amber : m.severity === 'good' ? C.green : C.border;
      doc.rect(x, rowY, 4, cardH).fill(severityBar);

      doc.fontSize(8).fillColor(C.midGray).text(m.label.toUpperCase(), x + 12, rowY + 8, { width: cardW - 20 });

      const valueText = m.delta
        ? `${m.value}  ${m.delta_direction === 'up' ? '▲' : m.delta_direction === 'down' ? '▼' : '—'} ${m.delta}`
        : m.value;
      doc.fontSize(16).fillColor(fg).text(valueText, x + 12, rowY + 24, { width: cardW - 20 });
    }

    doc.y = rowY + cardH + 10;
  }
  doc.moveDown(0.5);
}

function renderDealCards(doc: any, cards: DealCard[], lMargin: number, contentW: number, accent: string): void {
  ensureSpace(doc, 30);
  doc.fontSize(12).fillColor(C.darkSlate).text('Deals Requiring Attention', lMargin, doc.y);
  doc.moveDown(0.4);

  for (const card of cards.slice(0, 10)) {
    const cardH = 52;
    ensureSpace(doc, cardH + 8);

    const y = doc.y;
    const { bg, fg } = severityColor(card.signal_severity);

    doc.rect(lMargin, y, contentW, cardH).fill(bg);

    const barColor = card.signal_severity === 'critical' ? C.red : card.signal_severity === 'warning' ? C.amber : C.blue;
    doc.rect(lMargin, y, 4, cardH).fill(barColor);

    doc.fontSize(10).fillColor(C.darkSlate).text(card.name, lMargin + 12, y + 6, { width: contentW * 0.6 - 12, continued: false });
    if (card.amount) {
      doc.fontSize(11).fillColor(fg).text(card.amount, lMargin + contentW * 0.65, y + 6, { width: contentW * 0.35 - 12, align: 'right' });
    }

    const meta = [card.owner, card.stage, card.signal].filter(Boolean).join(' · ');
    doc.fontSize(8).fillColor(C.midGray).text(meta, lMargin + 12, y + 22, { width: contentW - 24 });

    if (card.action) {
      doc.fontSize(8).fillColor(accent).text(`→ ${card.action}`, lMargin + 12, y + 36, { width: contentW - 24 });
    }

    doc.y = y + cardH + 6;
  }
  doc.moveDown(0.5);
}

function renderTable(doc: any, table: { headers: string[]; rows: Record<string, any>[] }, lMargin: number, contentW: number): void {
  ensureSpace(doc, 30);
  doc.fontSize(12).fillColor(C.darkSlate).text('Data', lMargin, doc.y);
  doc.moveDown(0.4);

  const colW = contentW / table.headers.length;
  const rowH = 22;

  ensureSpace(doc, rowH * 2);

  let x = lMargin;
  const headerY = doc.y;
  doc.rect(lMargin, headerY, contentW, rowH).fill(C.navy);
  for (const h of table.headers) {
    doc.fontSize(8).fillColor('#FFFFFF').text(h, x + 4, headerY + 6, { width: colW - 8, ellipsis: true });
    x += colW;
  }

  let y = headerY + rowH;
  for (let r = 0; r < Math.min(table.rows.length, 20); r++) {
    ensureSpace(doc, rowH);
    y = doc.y;
    const bgColor = r % 2 === 0 ? C.pageBg : C.sectionBg;
    doc.rect(lMargin, y, contentW, rowH).fill(bgColor);
    x = lMargin;
    for (const h of table.headers) {
      doc.fontSize(8).fillColor(C.darkSlate).text(String(table.rows[r][h] ?? ''), x + 4, y + 6, { width: colW - 8, ellipsis: true });
      x += colW;
    }
    doc.y = y + rowH;
  }
  doc.moveDown(0.5);
}

function renderActionItems(doc: any, actions: ActionItem[], lMargin: number, contentW: number): void {
  ensureSpace(doc, 30);
  doc.fontSize(12).fillColor(C.darkSlate).text('Action Items', lMargin, doc.y);
  doc.moveDown(0.4);

  for (let i = 0; i < Math.min(actions.length, 15); i++) {
    const a = actions[i];
    ensureSpace(doc, 22);
    const y = doc.y;

    const dotColor = a.urgency === 'today' ? C.red : a.urgency === 'this_week' ? C.amber : C.green;
    doc.circle(lMargin + 6, y + 6, 4).fill(dotColor);

    doc.fontSize(9).fillColor(C.darkSlate).text(a.action, lMargin + 18, y, { width: contentW - 100 });

    if (a.owner) {
      doc.fontSize(8).fillColor(C.midGray).text(a.owner, lMargin + contentW - 80, y, { width: 80, align: 'right' });
    }

    doc.y = Math.max(doc.y, y + 18);
    doc.moveDown(0.15);
  }
  doc.moveDown(0.5);
}
