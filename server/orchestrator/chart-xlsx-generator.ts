/**
 * Chart XLSX Generator - Creates companion Excel file with chart data
 *
 * Generates an Excel workbook with raw data from all charts in a report
 */

import ExcelJS from 'exceljs';
import { query } from '../db.js';

export async function generateChartDataXLSX(
  reportDocumentId: string
): Promise<Buffer> {
  // Fetch all charts for this report
  const chartsResult = await query(`
    SELECT section_id, title, data_labels, data_values, chart_type
    FROM report_charts
    WHERE report_document_id = $1
    ORDER BY section_id, position_in_section ASC
  `, [reportDocumentId]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pandora GTM Intelligence';
  workbook.created = new Date();

  // Create a sheet for each chart
  for (let i = 0; i < chartsResult.rows.length; i++) {
    const chart = chartsResult.rows[i];
    const sheetName = `Chart ${i + 1} - ${chart.section_id}`.substring(0, 31); // Excel sheet name limit

    const worksheet = workbook.addWorksheet(sheetName);

    // Add chart title
    worksheet.mergeCells('A1:B1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = chart.title;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };

    // Add chart type
    worksheet.mergeCells('A2:B2');
    const typeCell = worksheet.getCell('A2');
    typeCell.value = `Chart Type: ${chart.chart_type}`;
    typeCell.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
    typeCell.alignment = { horizontal: 'center' };

    // Add headers
    worksheet.getCell('A4').value = 'Label';
    worksheet.getCell('B4').value = 'Value';
    const headerRow = worksheet.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0D9488' },  // Teal brand color
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Add data rows
    const labels = chart.data_labels || [];
    const values = chart.data_values || [];

    for (let j = 0; j < Math.max(labels.length, values.length); j++) {
      const rowNum = j + 5;
      worksheet.getCell(`A${rowNum}`).value = labels[j] || '';
      worksheet.getCell(`B${rowNum}`).value = values[j] || 0;

      // Format value cells as numbers
      worksheet.getCell(`B${rowNum}`).numFmt = '#,##0.00';
    }

    // Auto-fit columns
    worksheet.getColumn('A').width = 30;
    worksheet.getColumn('B').width = 15;

    // Add borders to data range
    const dataRange = `A4:B${4 + Math.max(labels.length, values.length)}`;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber >= 4) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
        });
      }
    });
  }

  // If no charts, create a summary sheet
  if (chartsResult.rows.length === 0) {
    const worksheet = workbook.addWorksheet('No Charts');
    worksheet.getCell('A1').value = 'This report contains no charts.';
    worksheet.getCell('A1').font = { italic: true, color: { argb: 'FF64748B' } };
  }

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
