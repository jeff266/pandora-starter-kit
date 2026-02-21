import PDFDocument from 'pdfkit';
import { ReportGenerationContext, SectionContent, MetricCard, DealCard, ActionItem } from '../reports/types.js';
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
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/🚨|🔴|🟡|🟢|⚠️|📊|📈|📉|💡|🎯/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function ensureSpace(doc: any, needed: number): void {
  if (doc.y + needed > 700) {
    doc.addPage();
  }
}

export async function renderReportPDF(context: ReportGenerationContext): Promise<PDFRenderResult> {
  const { workspace_id, template, sections_content, branding } = context;

  const accentColor = branding?.primary_color || C.blue;

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

    // Metrics cards (grid layout)
    if (section.metrics && section.metrics.length > 0) {
      renderMetricGrid(doc, section.metrics, lMargin, contentW);
    }

    // Narrative
    if (section.narrative && !section.narrative.startsWith('⚠')) {
      ensureSpace(doc, 60);
      const cleanText = stripMarkdown(section.narrative);
      const lines = cleanText.split('\n').filter(l => l.trim());
      for (const line of lines.slice(0, 15)) {
        ensureSpace(doc, 16);
        doc.fontSize(10).fillColor(C.darkSlate).text(line.trim(), lMargin, doc.y, {
          width: contentW,
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

    // Action items
    if (section.action_items && section.action_items.length > 0) {
      renderActionItems(doc, section.action_items, lMargin, contentW);
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
