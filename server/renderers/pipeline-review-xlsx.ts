/**
 * Pipeline Review XLSX Renderer
 *
 * 5-tab workbook:
 *   1. Executive Summary  — metrics, findings, actions
 *   2. Pipeline by Stage  — stage breakdown table
 *   3. Risk Deals         — deals with findings, sorted by amount
 *   4. All Deals          — full list with auto-filter + frozen header
 *   5. Data Quality       — issue counts
 */

import ExcelJS from 'exceljs';
import * as path from 'path';
import * as os from 'os';
import type { PipelineReviewData } from './data-assembler.js';
import type { BrandingConfig } from './types.js';

const C = {
  headerBg: 'FF1E293B',
  headerText: 'FFFFFFFF',
  criticalBg: 'FFFEE2E2',
  criticalText: 'FFDC2626',
  warningBg: 'FFFFFBEB',
  warningText: 'FFD97706',
  altRowBg: 'FFF8FAFC',
  border: 'FFE2E8F0',
  totalBg: 'FFF1F5F9',
  missingBg: 'FFFEF3C7',
  noConvoBg: 'FFFED7AA',
};

function tableHeader(row: ExcelJS.Row): void {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    cell.font = { bold: true, color: { argb: C.headerText }, size: 10 };
    cell.border = { bottom: { style: 'thin', color: { argb: C.border } } };
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 22;
}

function altRow(row: ExcelJS.Row, idx: number): void {
  if (idx % 2 === 0) {
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.altRowBg } };
    });
  }
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}

export async function renderPipelineReviewXLSX(
  data: PipelineReviewData,
  branding?: BrandingConfig
): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pandora GTM Intelligence';
  wb.created = new Date();

  const companyName = branding?.company_name || data.workspace.name;
  const primaryArgb = 'FF' + (branding?.primary_color || '#1E293B').replace('#', '');

  // ── Tab 1: Executive Summary ─────────────────────────────────

  const t1 = wb.addWorksheet('Executive Summary');
  t1.getColumn(1).width = 28;
  t1.getColumn(2).width = 20;
  t1.getColumn(3).width = 28;
  t1.getColumn(4).width = 20;

  const h1 = t1.addRow([`${companyName} — Weekly Pipeline Review`]);
  h1.height = 28;
  h1.getCell(1).font = { bold: true, size: 14, color: { argb: primaryArgb } };
  t1.mergeCells(`A${h1.number}:D${h1.number}`);

  const h2 = t1.addRow([data.period_label]);
  h2.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
  t1.mergeCells(`A${h2.number}:D${h2.number}`);
  t1.addRow([]);

  const mh = t1.addRow(['KEY METRICS']);
  mh.getCell(1).font = { bold: true, size: 11, color: { argb: primaryArgb } };
  t1.mergeCells(`A${mh.number}:D${mh.number}`);
  t1.addRow([]);

  const metrics: [string, string, string, string][] = [
    ['Pipeline Value', `$${data.pipeline.total_value.toLocaleString()}`, 'Open Deals', String(data.pipeline.deal_count)],
    ['Weighted Value', `$${Math.round(data.pipeline.weighted_value).toLocaleString()}`, 'Win Rate (period)', data.metrics.win_rate_period != null ? `${(data.metrics.win_rate_period * 100).toFixed(0)}%` : 'N/A'],
    ['Created This Period', `$${Math.round(data.metrics.pipeline_created_period).toLocaleString()}`, 'Avg Cycle', `${data.metrics.avg_cycle_days} days`],
    ['Deals Won', String(data.metrics.deals_won_period), 'Deals Lost', String(data.metrics.deals_lost_period)],
  ];

  for (const [l1, v1, l2, v2] of metrics) {
    const r = t1.addRow([l1, v1, l2, v2]);
    r.getCell(1).font = { size: 10, color: { argb: 'FF64748B' } };
    r.getCell(2).font = { bold: true, size: 12 };
    r.getCell(3).font = { size: 10, color: { argb: 'FF64748B' } };
    r.getCell(4).font = { bold: true, size: 12 };
    r.height = 20;
  }

  t1.addRow([]);

  if (data.findings.critical.length > 0 || data.findings.warning.length > 0) {
    const fh = t1.addRow(['KEY FINDINGS']);
    fh.getCell(1).font = { bold: true, size: 11, color: { argb: primaryArgb } };
    t1.mergeCells(`A${fh.number}:D${fh.number}`);
    t1.addRow([]);

    for (const f of data.findings.critical.slice(0, 5)) {
      const r = t1.addRow([`\u26A0 ${f.message}${f.deal_name ? ` (${f.deal_name})` : ''}`, '', f.impact_amount ? `$${f.impact_amount.toLocaleString()}` : '']);
      r.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.criticalBg } };
        cell.font = { color: { argb: C.criticalText }, size: 10 };
      });
      t1.mergeCells(`A${r.number}:B${r.number}`);
    }
    for (const f of data.findings.warning.slice(0, 5)) {
      const r = t1.addRow([`\u2022 ${f.message}${f.deal_name ? ` (${f.deal_name})` : ''}`, '', f.impact_amount ? `$${f.impact_amount.toLocaleString()}` : '']);
      r.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.warningBg } };
        cell.font = { color: { argb: C.warningText }, size: 10 };
      });
      t1.mergeCells(`A${r.number}:B${r.number}`);
    }
    t1.addRow([]);
  }

  const ah = t1.addRow(['ACTIONS']);
  ah.getCell(1).font = { bold: true, size: 11, color: { argb: primaryArgb } };
  t1.mergeCells(`A${ah.number}:D${ah.number}`);
  t1.addRow(['Open Actions', String(data.actions.open), 'Critical Open', String(data.actions.critical_open)]);
  t1.addRow(['Resolved This Week', String(data.actions.resolved_this_week)]);

  // ── Tab 2: Pipeline by Stage ──────────────────────────────────

  const t2 = wb.addWorksheet('Pipeline by Stage');
  const t2h = t2.addRow(['Stage', 'Deal Count', 'Total Value', 'Weighted Value', 'Avg Age (days)']);
  tableHeader(t2h);
  [22, 14, 18, 18, 16].forEach((w, i) => { t2.getColumn(i + 1).width = w; });

  data.pipeline.by_stage.forEach((s, i) => {
    const r = t2.addRow([s.stage, s.deal_count, s.total_value, s.weighted_value, s.avg_age_days]);
    altRow(r, i);
    r.getCell(3).numFmt = '$#,##0';
    r.getCell(4).numFmt = '$#,##0';
    r.height = 18;
  });

  const totRow = t2.addRow(['TOTAL', data.pipeline.deal_count, data.pipeline.total_value, data.pipeline.weighted_value, '']);
  totRow.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    cell.font = { bold: true, size: 10 };
    cell.border = { top: { style: 'thin', color: { argb: C.border } } };
  });
  totRow.getCell(3).numFmt = '$#,##0';
  totRow.getCell(4).numFmt = '$#,##0';

  // ── Tab 3: Risk Deals ─────────────────────────────────────────

  const t3 = wb.addWorksheet('Risk Deals');
  const t3h = t3.addRow(['Deal', 'Account', 'Owner', 'Amount', 'Stage', 'Age (days)', 'Close Date', 'Risk Reasons']);
  tableHeader(t3h);
  [28, 22, 16, 14, 16, 12, 14, 40].forEach((w, i) => { t3.getColumn(i + 1).width = w; });

  if (data.risk_deals.length === 0) {
    t3.addRow(['No risk deals identified']);
  } else {
    data.risk_deals.forEach((d, i) => {
      const r = t3.addRow([
        d.deal_name, d.account_name, d.owner, d.amount,
        d.stage, d.age_days, fmtDate(d.close_date), d.risk_reasons.join('; '),
      ]);
      altRow(r, i);
      r.getCell(4).numFmt = '$#,##0';
      r.getCell(8).font = { italic: true, color: { argb: C.criticalText }, size: 9 };
      if (d.close_date && new Date(d.close_date) < new Date()) {
        r.getCell(7).font = { color: { argb: C.criticalText }, bold: true };
      }
      r.height = 18;
    });
  }

  // ── Tab 4: All Deals ──────────────────────────────────────────

  const t4 = wb.addWorksheet('All Deals');
  const t4headers = ['Deal', 'Account', 'Owner', 'Amount', 'Stage', 'Age (days)', 'Close Date', 'Last Activity', 'Contacts', 'Conversations', 'Risk Flags'];
  const t4h = t4.addRow(t4headers);
  tableHeader(t4h);
  [28, 22, 16, 14, 16, 12, 14, 16, 10, 14, 35].forEach((w, i) => { t4.getColumn(i + 1).width = w; });

  data.all_deals.forEach((d, i) => {
    const r = t4.addRow([
      d.deal_name, d.account_name, d.owner, d.amount,
      d.stage, d.age_days, fmtDate(d.close_date),
      d.last_activity ? fmtDate(d.last_activity) : 'No activity',
      d.contact_count, d.has_recent_conversation ? 'Yes' : 'No',
      d.risk_flags.join('; '),
    ]);
    altRow(r, i);
    r.getCell(4).numFmt = '$#,##0';
    if (d.contact_count === 0) {
      r.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.missingBg } };
    }
    if (!d.has_recent_conversation) {
      r.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.noConvoBg } };
    }
    r.height = 18;
  });

  t4.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t4headers.length } };
  t4.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Tab 5: Data Quality ───────────────────────────────────────

  const t5 = wb.addWorksheet('Data Quality');
  t5.getColumn(1).width = 35;
  t5.getColumn(2).width = 16;

  const t5title = t5.addRow(['DATA QUALITY SUMMARY']);
  t5title.getCell(1).font = { bold: true, size: 13, color: { argb: primaryArgb } };
  t5.addRow([]);

  const dqItems: [string, number][] = [
    ['Missing close dates', data.data_quality.missing_close_dates],
    ['Missing amounts ($0 or blank)', data.data_quality.missing_amounts],
    ['No contacts linked', data.data_quality.missing_contacts],
    ['Stale deals (no activity 14+ days)', data.data_quality.stale_deals],
    ['Total issues', data.data_quality.total_issues],
  ];

  for (const [label, val] of dqItems) {
    const r = t5.addRow([label, val]);
    const isTotal = label === 'Total issues';
    r.getCell(1).font = { bold: isTotal, size: 10 };
    r.getCell(2).font = {
      bold: isTotal,
      size: 10,
      color: val > 0 && !isTotal ? { argb: C.warningText } : undefined,
    };
    r.height = 18;
  }

  // Generate buffer
  const date = new Date().toISOString().split('T')[0];
  const cleanName = data.workspace.name.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${cleanName}_Pipeline_Review_${date}.xlsx`;
  const filepath = path.join(os.tmpdir(), filename);
  await wb.xlsx.writeFile(filepath);
  const buffer = await wb.xlsx.writeBuffer() as unknown as Buffer;

  return { buffer, filename };
}
