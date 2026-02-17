/**
 * Pipeline Review PDF Renderer
 *
 * Multi-page PDF:
 *   - Cover page with title, period, generated timestamp
 *   - Pipeline Summary (stage table + key metrics)
 *   - Findings & Risks (critical / warning)
 *   - Risk Deals table
 *   - Actions & Data Quality
 */

import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { PipelineReviewData } from './data-assembler.js';
import type { BrandingConfig } from './types.js';

// ── Layout constants ──────────────────────────────────────────────
const PAGE_W = 792;  // Letter landscape
const PAGE_H = 612;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Colours
const COLOR = {
  primary:    '#1E293B',
  secondary:  '#475569',
  accent:     '#2563EB',
  critical:   '#DC2626',
  warning:    '#D97706',
  green:      '#16A34A',
  headerBg:   '#1E293B',
  altRow:     '#F8FAFC',
  border:     '#E2E8F0',
  white:      '#FFFFFF',
};

function hex(c: string): string { return c; }

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

// ── Section header ────────────────────────────────────────────────
function sectionHeader(doc: typeof PDFDocument, title: string, y: number, primaryColor: string): number {
  doc.rect(MARGIN, y, CONTENT_W, 24).fill(primaryColor);
  doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(10)
    .text(title, MARGIN + 8, y + 7, { width: CONTENT_W - 16 });
  doc.fillColor(COLOR.primary);
  return y + 30;
}

// ── Simple table ─────────────────────────────────────────────────
interface ColDef { label: string; width: number; align?: 'left' | 'right' | 'center' }

function drawTable(
  doc: typeof PDFDocument,
  cols: ColDef[],
  rows: (string | number)[][],
  startY: number,
  primaryColor: string
): number {
  let y = startY;
  const ROW_H = 18;

  // Header
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(primaryColor);
  for (const col of cols) {
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(8)
      .text(col.label, x + 4, y + 5, { width: col.width - 8, align: col.align || 'left' });
    x += col.width;
  }
  y += ROW_H;

  // Rows
  rows.forEach((row, idx) => {
    if (y > PAGE_H - MARGIN - ROW_H) {
      doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      y = MARGIN;
    }

    if (idx % 2 === 0) {
      doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(COLOR.altRow);
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

// ── Main renderer ─────────────────────────────────────────────────

export async function renderPipelineReviewPDF(
  data: PipelineReviewData,
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

  // Title
  doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(28)
    .text('Weekly Pipeline Review', MARGIN, 180, { width: CONTENT_W, align: 'center' });

  doc.fillColor(COLOR.white).font('Helvetica').fontSize(16)
    .text(companyName, MARGIN, 220, { width: CONTENT_W, align: 'center' });

  doc.fillColor('rgba(255,255,255,0.7)').font('Helvetica').fontSize(12)
    .text(data.period_label, MARGIN, 255, { width: CONTENT_W, align: 'center' });

  doc.fillColor('rgba(255,255,255,0.5)').font('Helvetica').fontSize(9)
    .text(`Generated ${new Date(data.generated_at).toLocaleString()} · ${preparedBy}`, MARGIN, 320, { width: CONTENT_W, align: 'center' });

  if (confidentiality) {
    doc.fillColor('rgba(255,255,255,0.4)').font('Helvetica').fontSize(8)
      .text(confidentiality, MARGIN, PAGE_H - 50, { width: CONTENT_W, align: 'center' });
  }

  // ── Page 2: Pipeline Summary ──────────────────────────────────

  doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });

  // Page header
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(11)
    .text(`${companyName} — Pipeline Review`, MARGIN, MARGIN);
  doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(8)
    .text(data.period_label, MARGIN, MARGIN + 14);
  doc.moveTo(MARGIN, MARGIN + 26).lineTo(PAGE_W - MARGIN, MARGIN + 26).stroke(COLOR.border);

  let y = MARGIN + 38;

  // Key metrics 2-column layout
  y = sectionHeader(doc, 'KEY METRICS', y, primaryColor);

  const metrics = [
    ['Pipeline Value', `$${data.pipeline.total_value.toLocaleString()}`],
    ['Weighted Value', `$${Math.round(data.pipeline.weighted_value).toLocaleString()}`],
    ['Open Deals', String(data.pipeline.deal_count)],
    ['Win Rate (period)', data.metrics.win_rate_period != null ? `${(data.metrics.win_rate_period * 100).toFixed(0)}%` : 'N/A'],
    ['Avg Cycle', `${data.metrics.avg_cycle_days} days`],
    ['Created This Period', `$${Math.round(data.metrics.pipeline_created_period).toLocaleString()}`],
    ['Deals Won', String(data.metrics.deals_won_period)],
    ['Deals Lost', String(data.metrics.deals_lost_period)],
  ];

  const metricColW = CONTENT_W / 4;
  for (let i = 0; i < metrics.length; i += 2) {
    const xLeft = MARGIN;
    const xRight = MARGIN + CONTENT_W / 2;
    doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(8)
      .text(metrics[i][0], xLeft, y, { width: metricColW });
    doc.fillColor(COLOR.primary).font('Helvetica-Bold').fontSize(11)
      .text(metrics[i][1], xLeft + metricColW, y, { width: metricColW });
    if (metrics[i + 1]) {
      doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(8)
        .text(metrics[i + 1][0], xRight, y, { width: metricColW });
      doc.fillColor(COLOR.primary).font('Helvetica-Bold').fontSize(11)
        .text(metrics[i + 1][1], xRight + metricColW, y, { width: metricColW });
    }
    y += 20;
  }

  y += 12;

  // Pipeline by stage table
  y = sectionHeader(doc, 'PIPELINE BY STAGE', y, primaryColor);

  const stageCols: ColDef[] = [
    { label: 'Stage', width: 180 },
    { label: 'Deals', width: 60, align: 'right' },
    { label: 'Total Value', width: 120, align: 'right' },
    { label: 'Weighted Value', width: 120, align: 'right' },
    { label: 'Avg Age (days)', width: 100, align: 'right' },
    { label: '', width: CONTENT_W - 580 },
  ];

  const stageTableRows = data.pipeline.by_stage.map(s => [
    s.stage,
    s.deal_count,
    `$${s.total_value.toLocaleString()}`,
    `$${Math.round(s.weighted_value).toLocaleString()}`,
    s.avg_age_days,
    '',
  ]);

  // Add total row
  stageTableRows.push([
    'TOTAL',
    data.pipeline.deal_count,
    `$${data.pipeline.total_value.toLocaleString()}`,
    `$${Math.round(data.pipeline.weighted_value).toLocaleString()}`,
    '',
    '',
  ]);

  y = drawTable(doc, stageCols, stageTableRows, y, primaryColor);

  // ── Page 3: Findings & Risk Deals ────────────────────────────

  doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });

  // Page header
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(11)
    .text(`${companyName} — Findings & Risk Deals`, MARGIN, MARGIN);
  doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(8)
    .text(data.period_label, MARGIN, MARGIN + 14);
  doc.moveTo(MARGIN, MARGIN + 26).lineTo(PAGE_W - MARGIN, MARGIN + 26).stroke(COLOR.border);

  y = MARGIN + 38;

  // Critical findings
  if (data.findings.critical.length > 0) {
    y = sectionHeader(doc, `CRITICAL FINDINGS (${data.findings.critical.length})`, y, COLOR.critical);

    for (const f of data.findings.critical.slice(0, 8)) {
      if (y > PAGE_H - MARGIN - 20) break;
      doc.rect(MARGIN, y, CONTENT_W, 20).fill('#FEF2F2');
      const dealStr = f.deal_name ? ` — ${f.deal_name}` : '';
      const impactStr = f.impact_amount ? ` ($${f.impact_amount.toLocaleString()})` : '';
      doc.fillColor(COLOR.critical).font('Helvetica').fontSize(8)
        .text(`\u26A0  ${f.message}${dealStr}${impactStr}`, MARGIN + 6, y + 6, { width: CONTENT_W - 12 });
      y += 22;
    }
    y += 8;
  }

  // Warning findings
  if (data.findings.warning.length > 0) {
    y = sectionHeader(doc, `WARNING FINDINGS (${data.findings.warning.length})`, y, '#D97706');

    for (const f of data.findings.warning.slice(0, 8)) {
      if (y > PAGE_H - MARGIN - 20) break;
      doc.rect(MARGIN, y, CONTENT_W, 20).fill('#FFFBEB');
      const dealStr = f.deal_name ? ` — ${f.deal_name}` : '';
      doc.fillColor(COLOR.warning).font('Helvetica').fontSize(8)
        .text(`\u2022  ${f.message}${dealStr}`, MARGIN + 6, y + 6, { width: CONTENT_W - 12 });
      y += 22;
    }
    y += 8;
  }

  // Risk deals table
  if (data.risk_deals.length > 0) {
    if (y > PAGE_H - MARGIN - 100) {
      doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      y = MARGIN + 38;
    }

    y = sectionHeader(doc, `RISK DEALS (${data.risk_deals.length})`, y, primaryColor);

    const riskCols: ColDef[] = [
      { label: 'Deal', width: 190 },
      { label: 'Account', width: 140 },
      { label: 'Owner', width: 100 },
      { label: 'Amount', width: 90, align: 'right' },
      { label: 'Stage', width: 110 },
      { label: 'Close Date', width: 90 },
      { label: 'Risk', width: CONTENT_W - 720 },
    ];

    const riskRows = data.risk_deals.map(d => [
      d.deal_name,
      d.account_name,
      d.owner,
      `$${d.amount.toLocaleString()}`,
      d.stage,
      fmtDate(d.close_date),
      d.risk_reasons[0] || '',
    ]);

    y = drawTable(doc, riskCols, riskRows, y, primaryColor);
  }

  // ── Page 4: Actions & Data Quality ───────────────────────────

  doc.addPage({ layout: 'landscape', size: 'letter', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });

  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(11)
    .text(`${companyName} — Actions & Data Quality`, MARGIN, MARGIN);
  doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(8)
    .text(data.period_label, MARGIN, MARGIN + 14);
  doc.moveTo(MARGIN, MARGIN + 26).lineTo(PAGE_W - MARGIN, MARGIN + 26).stroke(COLOR.border);

  y = MARGIN + 38;

  y = sectionHeader(doc, 'ACTIONS', y, primaryColor);
  y += 8;

  const actionItems = [
    ['Open Actions', String(data.actions.open)],
    ['Critical Open', String(data.actions.critical_open)],
    ['Resolved This Week', String(data.actions.resolved_this_week)],
  ];

  for (const [label, val] of actionItems) {
    doc.fillColor(COLOR.secondary).font('Helvetica').fontSize(9).text(label, MARGIN + 8, y, { width: 180 });
    doc.fillColor(COLOR.primary).font('Helvetica-Bold').fontSize(12).text(val, MARGIN + 200, y);
    y += 22;
  }

  y += 16;
  y = sectionHeader(doc, 'DATA QUALITY', y, primaryColor);
  y += 8;

  const dqItems = [
    ['Missing close dates', String(data.data_quality.missing_close_dates)],
    ['Missing amounts ($0 or blank)', String(data.data_quality.missing_amounts)],
    ['No contacts linked', String(data.data_quality.missing_contacts)],
    ['Stale deals (no activity 14+ days)', String(data.data_quality.stale_deals)],
    ['Total issues', String(data.data_quality.total_issues)],
  ];

  for (const [label, val] of dqItems) {
    const numVal = parseInt(val);
    const isTotal = label === 'Total issues';
    doc.fillColor(COLOR.secondary).font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      .text(label, MARGIN + 8, y, { width: 220 });
    const valColor = numVal > 0 && !isTotal ? COLOR.warning : COLOR.primary;
    doc.fillColor(valColor).font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(isTotal ? 12 : 11)
      .text(val, MARGIN + 240, y);
    y += 22;
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
  const filename = `${cleanName}_Pipeline_Review_${date}.pdf`;

  return { buffer, filename };
}
