/**
 * Forecast PDF Renderer
 *
 * Multi-page PDF:
 *   - Cover page
 *   - Forecast Scenarios (best/weighted/committed/worst, coverage, velocity)
 *   - Stage Breakdown table
 *   - Close Date Distribution
 *   - Slip Risk Deals
 */

import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as os from 'os';
import type { ForecastData } from './data-assembler.js';
import type { BrandingConfig } from './types.js';

// ── Layout constants ──────────────────────────────────────────────
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COLOR = {
  primary:   '#1E293B',
  secondary: '#475569',
  warning:   '#D97706',
  critical:  '#DC2626',
  green:     '#16A34A',
  accent:    '#2563EB',
  altRow:    '#F8FAFC',
  border:    '#E2E8F0',
  white:     '#FFFFFF',
  stageBg:   '#DBEAFE',
  stageText: '#1E40AF',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function sectionHeader(doc: typeof PDFDocument, title: string, y: number, color: string): number {
  doc.rect(MARGIN, y, CONTENT_W, 24).fill(color);
  doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(10)
    .text(title, MARGIN + 8, y + 7, { width: CONTENT_W - 16 });
  doc.fillColor(COLOR.primary);
  return y + 30;
}

interface ColDef { label: string; width: number; align?: 'left' | 'right' | 'center' }

function drawTable(
  doc: typeof PDFDocument,
  cols: ColDef[],
  rows: (string | number)[][],
  startY: number,
  primaryColor: string,
  getRowColor?: (idx: number, row: (string | number)[]) => string | null
): number {
  let y = startY;
  const ROW_H = 18;

  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(primaryColor);
  for (const col of cols) {
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(8)
      .text(col.label, x + 4, y + 5, { width: col.width - 8, align: col.align || 'left' });
    x += col.width;
  }
  y += ROW_H;

  rows.forEach((row, idx) => {
    if (y > PAGE_H - MARGIN - ROW_H) {
      doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      y = MARGIN;
    }

    const rowColor = getRowColor ? getRowColor(idx, row) : (idx % 2 === 0 ? COLOR.altRow : null);
    if (rowColor) {
      doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(rowColor);
    }
    doc.rect(MARGIN, y, CONTENT_W, ROW_H).stroke(COLOR.border);

    x = MARGIN;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const val = row[i] != null ? String(row[i]) : '';
      doc.fillColor(COLOR.primary).font('Helvetica').fontSize(8)
        .text(val, x + 4, y + 5, { width: col.width - 8, align: col.align || 'left' });
      x += col.width;
    }
    y += ROW_H;
  });

  return y + 8;
}

function pageHeader(doc: typeof PDFDocument, companyName: string, subtitle: string, periodLabel: string): void {
  doc.fillColor(COLOR.primary).font('Helvetica-Bold').fontSize(11)
    .text(`${companyName} — ${subtitle}`, MARGIN, MARGIN);
  doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(8)
    .text(periodLabel, MARGIN, MARGIN + 14);
  doc.moveTo(MARGIN, MARGIN + 26).lineTo(PAGE_W - MARGIN, MARGIN + 26).stroke(COLOR.border);
}

export async function renderForecastPDF(
  data: ForecastData,
  branding?: BrandingConfig
): Promise<{ buffer: Buffer; filename: string }> {
  const companyName = branding?.company_name || data.workspace.name;
  const primaryColor = branding?.primary_color || '#1E293B';
  const preparedBy = branding?.prepared_by || 'Pandora GTM Intelligence';
  const confidentiality = branding?.confidentiality_notice || '';

  const doc = new PDFDocument({
    layout: 'landscape',
    size: 'letter',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // ── Cover Page ────────────────────────────────────────────────

  doc.rect(0, 0, PAGE_W, PAGE_H).fill(primaryColor);

  doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(30)
    .text('Forecast Report', MARGIN, 175, { width: CONTENT_W, align: 'center' });

  doc.fillColor(COLOR.white).font('Helvetica').fontSize(16)
    .text(companyName, MARGIN, 218, { width: CONTENT_W, align: 'center' });

  doc.fillColor('rgba(255,255,255,0.7)').font('Helvetica').fontSize(12)
    .text(data.period_label, MARGIN, 252, { width: CONTENT_W, align: 'center' });

  // Scenario pills on cover
  const scenarios = [
    { label: 'Best Case', value: fmtMoney(data.totals.best_case) },
    { label: 'Weighted', value: fmtMoney(data.totals.weighted_forecast) },
    { label: 'Committed', value: fmtMoney(data.totals.committed) },
  ];
  const pillW = 160;
  const pillStart = (PAGE_W - scenarios.length * pillW - (scenarios.length - 1) * 20) / 2;
  scenarios.forEach((s, i) => {
    const px = pillStart + i * (pillW + 20);
    doc.rect(px, 295, pillW, 50).fill('rgba(255,255,255,0.12)');
    doc.fillColor('rgba(255,255,255,0.6)').font('Helvetica').fontSize(9)
      .text(s.label, px, 302, { width: pillW, align: 'center' });
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(18)
      .text(s.value, px, 315, { width: pillW, align: 'center' });
  });

  doc.fillColor('rgba(255,255,255,0.5)').font('Helvetica').fontSize(9)
    .text(`Generated ${new Date(data.generated_at).toLocaleString()} · ${preparedBy}`, MARGIN, 375, { width: CONTENT_W, align: 'center' });

  if (confidentiality) {
    doc.fillColor('rgba(255,255,255,0.4)').font('Helvetica').fontSize(8)
      .text(confidentiality, MARGIN, PAGE_H - 50, { width: CONTENT_W, align: 'center' });
  }

  // ── Page 2: Forecast Scenarios ────────────────────────────────

  doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  pageHeader(doc, companyName, 'Forecast Scenarios', data.period_label);

  let y = MARGIN + 38;

  y = sectionHeader(doc, 'FORECAST SCENARIOS', y, primaryColor);
  y += 8;

  // Scenarios 2-up layout
  const scenarioData = [
    ['Best Case', fmtMoney(data.totals.best_case), 'Total Pipeline', fmtMoney(data.totals.total_pipeline)],
    ['Weighted Forecast', fmtMoney(data.totals.weighted_forecast), 'Committed', fmtMoney(data.totals.committed)],
    ['Worst Case', fmtMoney(data.totals.worst_case), 'Open Deals', String(data.forecast_by_stage.reduce((s, r) => s + r.deal_count, 0))],
  ];

  const half = CONTENT_W / 2;
  for (const [l1, v1, l2, v2] of scenarioData) {
    doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(9)
      .text(l1, MARGIN + 8, y, { width: half / 2 });
    doc.fillColor(COLOR.primary).font('Helvetica-Bold').fontSize(14)
      .text(v1, MARGIN + 8 + half / 2, y, { width: half / 2 });
    doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(9)
      .text(l2, MARGIN + half + 8, y, { width: half / 2 });
    doc.fillColor(COLOR.primary).font('Helvetica-Bold').fontSize(14)
      .text(v2, MARGIN + half + 8 + half / 2, y, { width: half / 2 });
    y += 24;
  }

  y += 12;

  // Coverage
  if (data.coverage && data.coverage.quota != null) {
    y = sectionHeader(doc, 'QUOTA COVERAGE', y, primaryColor);
    y += 8;

    const covData = [
      ['Quota', data.coverage.quota != null ? fmtMoney(data.coverage.quota) : 'Not set'],
      ['Pipeline Coverage', data.coverage.coverage_ratio != null ? `${(data.coverage.coverage_ratio * 100).toFixed(0)}%` : 'N/A'],
      ['Weighted Coverage', data.coverage.weighted_coverage != null ? `${(data.coverage.weighted_coverage * 100).toFixed(0)}%` : 'N/A'],
    ];
    for (const [l, v] of covData) {
      doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(9)
        .text(l, MARGIN + 8, y, { width: 180 });
      doc.fillColor(COLOR.primary).font('Helvetica-Bold').fontSize(12)
        .text(v, MARGIN + 200, y);
      y += 20;
    }
    y += 12;
  }

  // Recent outcomes
  y = sectionHeader(doc, 'RECENT OUTCOMES (30 DAYS)', y, primaryColor);
  y += 8;

  doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(9).text('Deals Won', MARGIN + 8, y, { width: 120 });
  doc.fillColor(COLOR.green).font('Helvetica-Bold').fontSize(13)
    .text(`${data.recent_outcomes.won.count}  (${fmtMoney(data.recent_outcomes.won.value)})`, MARGIN + 140, y);
  y += 22;

  doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(9).text('Deals Lost', MARGIN + 8, y, { width: 120 });
  doc.fillColor(COLOR.critical).font('Helvetica-Bold').fontSize(13)
    .text(`${data.recent_outcomes.lost.count}  (${fmtMoney(data.recent_outcomes.lost.value)})`, MARGIN + 140, y);
  y += 22;

  // ── Page 3: Stage Breakdown ───────────────────────────────────

  doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  pageHeader(doc, companyName, 'Stage Breakdown', data.period_label);

  y = MARGIN + 38;
  y = sectionHeader(doc, 'PIPELINE BY STAGE', y, primaryColor);

  const stageCols: ColDef[] = [
    { label: 'Stage', width: 180 },
    { label: 'Deals', width: 60, align: 'right' },
    { label: 'Total Value', width: 120, align: 'right' },
    { label: 'Probability', width: 90, align: 'right' },
    { label: 'Weighted Value', width: 120, align: 'right' },
    { label: 'Avg Days', width: 90, align: 'right' },
    { label: '', width: CONTENT_W - 660 },
  ];

  const stageRows = data.forecast_by_stage.map(s => [
    s.stage,
    s.deal_count,
    fmtMoney(s.total_value),
    `${(s.default_probability * 100).toFixed(0)}%`,
    fmtMoney(s.weighted_value),
    s.avg_days_in_stage,
    '',
  ]);
  stageRows.push([
    'TOTAL',
    data.forecast_by_stage.reduce((s, r) => s + r.deal_count, 0),
    fmtMoney(data.totals.total_pipeline),
    '',
    fmtMoney(data.totals.weighted_forecast),
    '',
    '',
  ]);

  y = drawTable(doc, stageCols, stageRows, y, primaryColor);

  // ── Page 4: Close Date Distribution ──────────────────────────

  if (data.close_date_distribution.length > 0) {
    doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    pageHeader(doc, companyName, 'Close Date Distribution', data.period_label);

    y = MARGIN + 38;
    y = sectionHeader(doc, 'CLOSE DATE DISTRIBUTION', y, primaryColor);

    const cdCols: ColDef[] = [
      { label: 'Month', width: 120 },
      { label: 'Deal Count', width: 100, align: 'right' },
      { label: 'Total Value', width: 140, align: 'right' },
      { label: 'Weighted Value', width: 140, align: 'right' },
      { label: '', width: CONTENT_W - 500 },
    ];

    const cdRows = data.close_date_distribution.map(m => [
      m.month,
      m.deal_count,
      fmtMoney(m.total_value),
      fmtMoney(m.weighted_value),
      '',
    ]);
    cdRows.push([
      'TOTAL',
      data.close_date_distribution.reduce((s, r) => s + r.deal_count, 0),
      fmtMoney(data.close_date_distribution.reduce((s, r) => s + r.total_value, 0)),
      fmtMoney(data.close_date_distribution.reduce((s, r) => s + r.weighted_value, 0)),
      '',
    ]);

    y = drawTable(doc, cdCols, cdRows, y, primaryColor);
  }

  // ── Page 5: Slip Risk ─────────────────────────────────────────

  if (data.slip_risk_deals.length > 0) {
    doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    pageHeader(doc, companyName, 'Slip Risk', data.period_label);

    y = MARGIN + 38;
    y = sectionHeader(doc, `SLIP RISK DEALS (${data.slip_risk_deals.length})`, y, COLOR.critical);

    const slipCols: ColDef[] = [
      { label: 'Deal', width: 190 },
      { label: 'Account', width: 140 },
      { label: 'Owner', width: 100 },
      { label: 'Amount', width: 100, align: 'right' },
      { label: 'Stage', width: 110 },
      { label: 'Close Date', width: 90 },
      { label: 'Days Past', width: 80, align: 'right' },
      { label: 'Risk', width: CONTENT_W - 810 },
    ];

    const slipRows = data.slip_risk_deals.map(d => [
      d.deal_name,
      d.account,
      d.owner,
      fmtMoney(d.amount),
      d.stage,
      fmtDate(d.close_date),
      d.days_past_close > 0 ? d.days_past_close : '—',
      d.risk_reason,
    ]);

    y = drawTable(doc, slipCols, slipRows, y, COLOR.critical, (idx, row) => {
      const daysPast = row[6];
      if (typeof daysPast === 'number' && daysPast > 0) return '#FEF2F2';
      return idx % 2 === 0 ? COLOR.altRow : null;
    });
  }

  // Footer on last page
  doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(7)
    .text(
      `${preparedBy}  ·  Generated ${new Date(data.generated_at).toLocaleString()}${confidentiality ? '  ·  ' + confidentiality : ''}`,
      MARGIN, PAGE_H - MARGIN - 10, { width: CONTENT_W, align: 'center' }
    );

  doc.end();

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const date = new Date().toISOString().split('T')[0];
  const cleanName = data.workspace.name.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${cleanName}_Forecast_${date}.pdf`;

  return { buffer, filename };
}
