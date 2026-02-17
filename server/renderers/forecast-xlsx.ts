/**
 * Forecast XLSX Renderer
 *
 * 5-tab workbook:
 *   1. Forecast Summary  — scenario totals, coverage, velocity
 *   2. Pipeline by Stage — stage breakdown with probability
 *   3. Close Date Dist.  — monthly close date distribution
 *   4. Slip Risk         — overdue / at-risk deals
 *   5. Deal Detail       — all deals grouped by stage with subtotals
 */

import ExcelJS from 'exceljs';
import * as path from 'path';
import * as os from 'os';
import type { ForecastData } from './data-assembler.js';
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
  subtotalBg: 'FFE2E8F0',
  stageBg: 'FFDBEAFE',
  stageText: 'FF1E40AF',
  greenText: 'FF16A34A',
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

export async function renderForecastXLSX(
  data: ForecastData,
  branding?: BrandingConfig
): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pandora GTM Intelligence';
  wb.created = new Date();

  const companyName = branding?.company_name || data.workspace.name;
  const primaryArgb = 'FF' + (branding?.primary_color || '#1E293B').replace('#', '');

  // ── Tab 1: Forecast Summary ───────────────────────────────────

  const t1 = wb.addWorksheet('Forecast Summary');
  t1.getColumn(1).width = 30;
  t1.getColumn(2).width = 22;
  t1.getColumn(3).width = 30;
  t1.getColumn(4).width = 22;

  const h1 = t1.addRow([`${companyName} — Forecast`]);
  h1.height = 28;
  h1.getCell(1).font = { bold: true, size: 14, color: { argb: primaryArgb } };
  t1.mergeCells(`A${h1.number}:D${h1.number}`);

  const h2 = t1.addRow([data.period_label]);
  h2.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
  t1.mergeCells(`A${h2.number}:D${h2.number}`);
  t1.addRow([]);

  // Scenario block
  const sh = t1.addRow(['FORECAST SCENARIOS']);
  sh.getCell(1).font = { bold: true, size: 11, color: { argb: primaryArgb } };
  t1.mergeCells(`A${sh.number}:D${sh.number}`);
  t1.addRow([]);

  const scenarios: [string, number, string, string][] = [
    ['Best Case', data.totals.best_case, 'Total Pipeline', `$${data.totals.total_pipeline.toLocaleString()}`],
    ['Weighted Forecast', data.totals.weighted_forecast, 'Committed', `$${data.totals.committed.toLocaleString()}`],
    ['Worst Case', data.totals.worst_case, 'Deals in Pipeline', String(data.forecast_by_stage.reduce((s, r) => s + r.deal_count, 0))],
  ];

  for (const [label, value, label2, val2] of scenarios) {
    const r = t1.addRow([label, `$${Math.round(value).toLocaleString()}`, label2, val2]);
    r.getCell(1).font = { size: 10, color: { argb: 'FF64748B' } };
    r.getCell(2).font = { bold: true, size: 12 };
    r.getCell(3).font = { size: 10, color: { argb: 'FF64748B' } };
    r.getCell(4).font = { bold: true, size: 12 };
    r.height = 20;
  }

  t1.addRow([]);

  // Coverage block
  if (data.coverage) {
    const covH = t1.addRow(['QUOTA COVERAGE']);
    covH.getCell(1).font = { bold: true, size: 11, color: { argb: primaryArgb } };
    t1.mergeCells(`A${covH.number}:D${covH.number}`);
    t1.addRow([]);

    const covItems: [string, string][] = [
      ['Quota', data.coverage.quota != null ? `$${data.coverage.quota.toLocaleString()}` : 'Not set'],
      ['Pipeline Coverage', data.coverage.coverage_ratio != null ? `${(data.coverage.coverage_ratio * 100).toFixed(0)}%` : 'N/A'],
      ['Weighted Coverage', data.coverage.weighted_coverage != null ? `${(data.coverage.weighted_coverage * 100).toFixed(0)}%` : 'N/A'],
    ];
    for (const [l, v] of covItems) {
      const r = t1.addRow([l, v]);
      r.getCell(1).font = { size: 10, color: { argb: 'FF64748B' } };
      r.getCell(2).font = { bold: true, size: 11 };
      r.height = 18;
    }
    t1.addRow([]);
  }

  // Recent outcomes
  const outH = t1.addRow(['RECENT OUTCOMES (30 DAYS)']);
  outH.getCell(1).font = { bold: true, size: 11, color: { argb: primaryArgb } };
  t1.mergeCells(`A${outH.number}:D${outH.number}`);
  t1.addRow([]);

  const wonRow = t1.addRow(['Deals Won', String(data.recent_outcomes.won.count), 'Won Value', `$${data.recent_outcomes.won.value.toLocaleString()}`]);
  wonRow.getCell(1).font = { size: 10, color: { argb: 'FF64748B' } };
  wonRow.getCell(2).font = { bold: true, size: 12, color: { argb: C.greenText } };
  wonRow.getCell(3).font = { size: 10, color: { argb: 'FF64748B' } };
  wonRow.getCell(4).font = { bold: true, size: 12, color: { argb: C.greenText } };
  wonRow.height = 20;

  const lostRow = t1.addRow(['Deals Lost', String(data.recent_outcomes.lost.count), 'Lost Value', `$${data.recent_outcomes.lost.value.toLocaleString()}`]);
  lostRow.getCell(1).font = { size: 10, color: { argb: 'FF64748B' } };
  lostRow.getCell(2).font = { bold: true, size: 12, color: { argb: C.criticalText } };
  lostRow.getCell(3).font = { size: 10, color: { argb: 'FF64748B' } };
  lostRow.getCell(4).font = { bold: true, size: 12, color: { argb: C.criticalText } };
  lostRow.height = 20;

  // ── Tab 2: Pipeline by Stage ──────────────────────────────────

  const t2 = wb.addWorksheet('Pipeline by Stage');
  const t2h = t2.addRow(['Stage', 'Deals', 'Total Value', 'Probability', 'Weighted Value', 'Avg Days in Stage']);
  tableHeader(t2h);
  [22, 10, 18, 14, 18, 18].forEach((w, i) => { t2.getColumn(i + 1).width = w; });

  data.forecast_by_stage.forEach((s, i) => {
    const r = t2.addRow([
      s.stage,
      s.deal_count,
      s.total_value,
      s.default_probability,
      s.weighted_value,
      s.avg_days_in_stage,
    ]);
    altRow(r, i);
    r.getCell(3).numFmt = '$#,##0';
    r.getCell(4).numFmt = '0%';
    r.getCell(5).numFmt = '$#,##0';
    r.height = 18;
  });

  const t2tot = t2.addRow([
    'TOTAL',
    data.forecast_by_stage.reduce((s, r) => s + r.deal_count, 0),
    data.totals.total_pipeline,
    '',
    data.totals.weighted_forecast,
    '',
  ]);
  t2tot.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    cell.font = { bold: true, size: 10 };
    cell.border = { top: { style: 'thin', color: { argb: C.border } } };
  });
  t2tot.getCell(3).numFmt = '$#,##0';
  t2tot.getCell(5).numFmt = '$#,##0';

  // ── Tab 3: Close Date Distribution ───────────────────────────

  const t3 = wb.addWorksheet('Close Date Distribution');
  const t3h = t3.addRow(['Month', 'Deal Count', 'Total Value', 'Weighted Value']);
  tableHeader(t3h);
  [18, 14, 18, 18].forEach((w, i) => { t3.getColumn(i + 1).width = w; });

  if (data.close_date_distribution.length === 0) {
    t3.addRow(['No close dates set on open deals']);
  } else {
    data.close_date_distribution.forEach((m, i) => {
      const r = t3.addRow([m.month, m.deal_count, m.total_value, m.weighted_value]);
      altRow(r, i);
      r.getCell(3).numFmt = '$#,##0';
      r.getCell(4).numFmt = '$#,##0';
      r.height = 18;
    });

    const cdTot = t3.addRow([
      'TOTAL',
      data.close_date_distribution.reduce((s, r) => s + r.deal_count, 0),
      data.close_date_distribution.reduce((s, r) => s + r.total_value, 0),
      data.close_date_distribution.reduce((s, r) => s + r.weighted_value, 0),
    ]);
    cdTot.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
      cell.font = { bold: true, size: 10 };
      cell.border = { top: { style: 'thin', color: { argb: C.border } } };
    });
    cdTot.getCell(3).numFmt = '$#,##0';
    cdTot.getCell(4).numFmt = '$#,##0';
  }

  // ── Tab 4: Slip Risk ──────────────────────────────────────────

  const t4 = wb.addWorksheet('Slip Risk');
  const t4h = t4.addRow(['Deal', 'Account', 'Owner', 'Amount', 'Stage', 'Close Date', 'Days Past Close', 'Risk Reason']);
  tableHeader(t4h);
  [28, 22, 16, 14, 16, 14, 16, 40].forEach((w, i) => { t4.getColumn(i + 1).width = w; });

  if (data.slip_risk_deals.length === 0) {
    t4.addRow(['No slip risk deals identified']);
  } else {
    data.slip_risk_deals.forEach((d, i) => {
      const r = t4.addRow([
        d.deal_name,
        d.account,
        d.owner,
        d.amount,
        d.stage,
        fmtDate(d.close_date),
        d.days_past_close > 0 ? d.days_past_close : 0,
        d.risk_reason,
      ]);
      r.getCell(4).numFmt = '$#,##0';
      if (d.days_past_close > 0) {
        r.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.criticalBg } };
        });
        r.getCell(6).font = { color: { argb: C.criticalText }, bold: true };
      } else {
        altRow(r, i);
        r.getCell(6).font = { color: { argb: C.warningText } };
      }
      r.getCell(8).font = { italic: true, size: 9, color: { argb: C.criticalText } };
      r.height = 18;
    });
  }

  // ── Tab 5: Deal Detail ────────────────────────────────────────

  const t5 = wb.addWorksheet('Deal Detail');
  const t5h = t5.addRow(['Deal', 'Account', 'Owner', 'Amount', 'Close Date', 'Days in Stage', 'Risk Flags']);
  tableHeader(t5h);
  [28, 22, 16, 14, 14, 14, 40].forEach((w, i) => { t5.getColumn(i + 1).width = w; });

  let rowIdx = 0;
  for (const stage of data.forecast_by_stage) {
    // Stage header row
    const stageRow = t5.addRow([stage.stage, '', '', stage.total_value, '', '', `${(stage.default_probability * 100).toFixed(0)}% probability — ${stage.deal_count} deals`]);
    stageRow.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.stageBg } };
      cell.font = { bold: true, size: 10, color: { argb: C.stageText } };
    });
    stageRow.getCell(4).numFmt = '$#,##0';
    stageRow.height = 20;

    // Deal rows
    for (const d of stage.deals) {
      const r = t5.addRow([
        d.name,
        d.account,
        d.owner,
        d.amount,
        fmtDate(d.close_date),
        d.days_in_stage,
        d.risk_flags.join('; '),
      ]);
      altRow(r, rowIdx++);
      r.getCell(4).numFmt = '$#,##0';
      if (d.risk_flags.length > 0) {
        r.getCell(7).font = { italic: true, size: 9, color: { argb: C.warningText } };
      }
      r.height = 18;
    }

    // Subtotal row
    const subRow = t5.addRow([
      `Subtotal: ${stage.stage}`, '', '',
      stage.total_value, '', '',
      `Weighted: $${Math.round(stage.weighted_value).toLocaleString()}`,
    ]);
    subRow.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.subtotalBg } };
      cell.font = { bold: true, size: 9 };
      cell.border = { bottom: { style: 'thin', color: { argb: C.border } } };
    });
    subRow.getCell(4).numFmt = '$#,##0';
    subRow.height = 18;
  }

  t5.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  t5.views = [{ state: 'frozen', ySplit: 1 }];

  // Generate buffer
  const date = new Date().toISOString().split('T')[0];
  const cleanName = data.workspace.name.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${cleanName}_Forecast_${date}.xlsx`;
  const filepath = path.join(os.tmpdir(), filename);
  await wb.xlsx.writeFile(filepath);
  const buffer = await wb.xlsx.writeBuffer() as unknown as Buffer;

  return { buffer, filename };
}
