/**
 * Investigation Export Utilities
 *
 * Exports investigation results to CSV and XLSX formats
 */

import { query } from '../db.js';
import ExcelJS from 'exceljs';

interface InvestigationRun {
  run_id: string;
  skill_id: string;
  completed_at: string;
  output: any;
}

function buildFindingMessage(rec: any): string {
  const fields = rec.fields || {};
  const parts: string[] = [];

  if (fields.stage) parts.push(fields.stage.trim());
  if (fields.days_since_activity !== undefined && fields.days_since_activity !== null) {
    parts.push(`${fields.days_since_activity}d since activity`);
  }
  if (fields.contact_count !== undefined) {
    parts.push(`${fields.contact_count} contact${fields.contact_count !== 1 ? 's' : ''}`);
  }
  if (fields.risk_score) {
    parts.push(`Risk: ${fields.risk_score}`);
  }

  return parts.join(' · ') || 'No details';
}

/**
 * Export investigation results as CSV
 */
export async function exportInvestigationCSV(
  workspaceId: string,
  runId: string
): Promise<{ buffer: Buffer; filename: string }> {
  // Fetch run data
  const result = await query<InvestigationRun>(
    `SELECT run_id, skill_id, completed_at, output
     FROM skill_runs
     WHERE run_id = $1 AND workspace_id = $2 AND status = 'completed'`,
    [runId, workspaceId]
  );

  if (result.rows.length === 0) {
    throw new Error('Investigation run not found');
  }

  const run = result.rows[0];
  const evaluatedRecords = run.output?.evidence?.evaluated_records || [];

  // Build CSV headers
  const headers = [
    'Deal Name',
    'Severity',
    'Stage',
    'Amount',
    'Owner',
    'Close Date',
    'Risk Score',
    'Finding Message'
  ];

  // Build CSV rows
  const rows = evaluatedRecords.map((rec: any) => [
    rec.entity_name || 'Unknown',
    rec.severity || 'unknown',
    rec.fields?.stage || '',
    rec.fields?.amount ? Number(rec.fields.amount).toFixed(2) : '',
    rec.owner_name || rec.fields?.owner || '',
    rec.fields?.close_date || '',
    rec.fields?.risk_score || '',
    buildFindingMessage(rec)
  ]);

  // Generate CSV content (following csv-enrichment.ts pattern)
  const csvContent = [
    headers.join(','),
    ...rows.map((row: any[]) =>
      row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    )
  ].join('\n');

  // Generate filename
  const date = new Date(run.completed_at).toISOString().split('T')[0];
  const filename = `investigation-${run.skill_id}-${date}.csv`;

  return {
    buffer: Buffer.from(csvContent, 'utf-8'),
    filename
  };
}

/**
 * Export investigation results as XLSX
 */
export async function exportInvestigationXLSX(
  workspaceId: string,
  runId: string
): Promise<{ buffer: Buffer; filename: string }> {
  // Fetch run data
  const result = await query<InvestigationRun>(
    `SELECT run_id, skill_id, completed_at, output
     FROM skill_runs
     WHERE run_id = $1 AND workspace_id = $2 AND status = 'completed'`,
    [runId, workspaceId]
  );

  if (result.rows.length === 0) {
    throw new Error('Investigation run not found');
  }

  const run = result.rows[0];
  const evaluatedRecords = run.output?.evidence?.evaluated_records || [];

  // Create workbook
  const workbook = new ExcelJS.Workbook();

  // Summary Tab
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];

  const totalRecords = evaluatedRecords.length;
  const criticalCount = evaluatedRecords.filter((r: any) => r.severity === 'critical').length;
  const warningCount = evaluatedRecords.filter((r: any) => r.severity === 'warning').length;
  const healthyCount = evaluatedRecords.filter((r: any) => r.severity === 'healthy').length;

  summarySheet.addRows([
    { metric: 'Investigation Run ID', value: run.run_id },
    { metric: 'Skill', value: run.skill_id },
    { metric: 'Completed At', value: new Date(run.completed_at).toLocaleString() },
    { metric: '', value: '' },
    { metric: 'Total Records Evaluated', value: totalRecords },
    { metric: 'Critical Severity', value: criticalCount },
    { metric: 'Warning Severity', value: warningCount },
    { metric: 'Healthy', value: healthyCount }
  ]);

  // Style summary header
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Records Tab
  const recordsSheet = workbook.addWorksheet('Records');
  recordsSheet.columns = [
    { header: 'Deal Name', key: 'dealName', width: 30 },
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Owner', key: 'owner', width: 20 },
    { header: 'Close Date', key: 'closeDate', width: 15 },
    { header: 'Risk Score', key: 'riskScore', width: 12 },
    { header: 'Finding', key: 'finding', width: 40 }
  ];

  // Add data rows
  evaluatedRecords.forEach((rec: any) => {
    recordsSheet.addRow({
      dealName: rec.entity_name || 'Unknown',
      severity: rec.severity || 'unknown',
      stage: rec.fields?.stage || '',
      amount: rec.fields?.amount ? Number(rec.fields.amount) : '',
      owner: rec.owner_name || rec.fields?.owner || '',
      closeDate: rec.fields?.close_date || '',
      riskScore: rec.fields?.risk_score || '',
      finding: buildFindingMessage(rec)
    });
  });

  // Style records header
  recordsSheet.getRow(1).font = { bold: true };
  recordsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4A90E2' }
  };
  recordsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Freeze first row
  recordsSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Add auto-filter
  recordsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 8 }
  };

  // Color-code severity cells
  for (let i = 2; i <= recordsSheet.rowCount; i++) {
    const severityCell = recordsSheet.getCell(`B${i}`);
    const severity = severityCell.value?.toString().toLowerCase();

    if (severity === 'critical') {
      severityCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEF4444' }
      };
      severityCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    } else if (severity === 'warning') {
      severityCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFBBF24' }
      };
    } else if (severity === 'healthy') {
      severityCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF10B981' }
      };
      severityCell.font = { color: { argb: 'FFFFFFFF' } };
    }
  }

  // Generate filename
  const date = new Date(run.completed_at).toISOString().split('T')[0];
  const filename = `investigation-${run.skill_id}-${date}.xlsx`;

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();

  return {
    buffer: Buffer.from(buffer),
    filename
  };
}
