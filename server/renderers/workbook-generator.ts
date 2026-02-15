/**
 * Workbook Generator (XLSX Renderer)
 *
 * Generates multi-tab .xlsx workbooks from two input types:
 * - Mode 1 (Evidence Tables): Dynamic tabs from skill evidence
 * - Mode 2 (Template-Driven): Fixed layout from populated TemplateMatrix
 */

import ExcelJS from 'exceljs';
import { Renderer, RendererInput, RenderOutput, BrandingConfig } from './types.js';
import type { SkillEvidence, EvaluatedRecord, DataSourceContribution, SkillParameter } from '../skills/types.js';
import * as path from 'path';
import * as os from 'os';

const COLORS = {
  headerBg: 'FF1E293B',       // Dark slate
  headerText: 'FFFFFFFF',
  criticalBg: 'FFFEE2E2',     // Light red
  criticalText: 'FFDC2626',
  warningBg: 'FFFFFBEB',      // Light amber
  warningText: 'FFD97706',
  infoBg: 'FFEFF6FF',         // Light blue
  infoText: 'FF2563EB',
  successBg: 'FFF0FDF4',      // Light green
  successText: 'FF16A34A',
  altRowBg: 'FFF8FAFC',       // Subtle gray
  borderColor: 'FFE2E8F0',
  degradedBg: 'FFF1F5F9',     // Muted for degraded cells
  degradedText: 'FF94A3B8',
};

export class WorkbookGenerator implements Renderer {
  format = 'xlsx';

  async render(input: RendererInput): Promise<RenderOutput> {
    const start = Date.now();
    const workbook = new ExcelJS.Workbook();

    // Set workbook metadata
    workbook.creator = 'Pandora GTM Intelligence';
    workbook.created = new Date();
    workbook.modified = new Date();

    if (input.templateMatrix) {
      await this.renderTemplateMode(workbook, input);
    } else if (input.agentOutput) {
      await this.renderEvidenceMode(workbook, input);
    } else if (input.skillEvidence) {
      await this.renderSingleSkill(workbook, input);
    } else {
      throw new Error('WorkbookGenerator requires templateMatrix, agentOutput, or skillEvidence');
    }

    // Write to temp file
    const filename = this.generateFilename(input);
    const filepath = path.join(os.tmpdir(), filename);
    await workbook.xlsx.writeFile(filepath);
    const buffer = await workbook.xlsx.writeBuffer() as Buffer;

    return {
      format: 'xlsx',
      filename,
      filepath,
      buffer,
      metadata: {
        tabs: workbook.worksheets.length,
        file_size_bytes: buffer.length,
        render_duration_ms: Date.now() - start,
      },
    };
  }

  // ── Mode 1: Evidence Tables ──────────────────────────────────

  private async renderEvidenceMode(
    workbook: ExcelJS.Workbook,
    input: RendererInput
  ): Promise<void> {
    const agent = input.agentOutput!;
    const branding = input.workspace.branding;

    // Tab 1: Summary & Claims
    this.buildSummaryTab(workbook, agent, branding, input.options);

    // Tab N: One per skill's evaluated_records
    for (const [skillId, evidence] of Object.entries(agent.skill_evidence)) {
      if (evidence.evaluated_records?.length > 0) {
        this.buildEvidenceTab(workbook, skillId, evidence, branding);
      }
    }

    // Last tab: Methodology
    if (input.options.include_methodology !== false) {
      this.buildMethodologyTab(workbook, agent, branding);
    }
  }

  private buildSummaryTab(
    workbook: ExcelJS.Workbook,
    agent: any,
    branding?: BrandingConfig,
    options?: any
  ): void {
    const ws = workbook.addWorksheet('Summary');

    let row = 1;

    // Branding header
    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    // Title
    const titleRow = ws.getRow(row);
    titleRow.getCell(1).value = 'Pipeline Intelligence Report';
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: COLORS.headerBg } };
    row++;

    // Subtitle with date
    const subtitleRow = ws.getRow(row);
    subtitleRow.getCell(1).value = `Generated ${new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })}`;
    subtitleRow.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
    row += 2;

    // Narrative (if agent produced cross-skill synthesis)
    if (agent.narrative) {
      const narrRow = ws.getRow(row);
      narrRow.getCell(1).value = 'Executive Summary';
      narrRow.getCell(1).font = { size: 12, bold: true };
      row++;
      const textRow = ws.getRow(row);
      textRow.getCell(1).value = agent.narrative;
      textRow.getCell(1).alignment = { wrapText: true };
      ws.getColumn(1).width = 100;
      row += 2;
    }

    // Claims table
    const claims = agent.all_claims || [];
    if (claims.length > 0) {
      const claimsHeaderRow = ws.getRow(row);
      claimsHeaderRow.getCell(1).value = 'Findings';
      claimsHeaderRow.getCell(1).font = { size: 12, bold: true };
      row++;

      // Column headers
      const headers = ['Severity', 'Skill', 'Finding', 'Entity', 'Category'];
      const headerRow = ws.getRow(row);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: COLORS.headerText } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
        };
      });
      row++;

      // Sort: critical → warning → info
      const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      const sorted = [...claims].sort(
        (a: any, b: any) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
      );

      for (const claim of sorted) {
        const dataRow = ws.getRow(row);
        const severityColors: Record<string, { bg: string; text: string }> = {
          critical: { bg: COLORS.criticalBg, text: COLORS.criticalText },
          warning: { bg: COLORS.warningBg, text: COLORS.warningText },
          info: { bg: COLORS.infoBg, text: COLORS.infoText },
        };
        const sc = severityColors[claim.severity] || severityColors.info;

        dataRow.getCell(1).value = claim.severity.toUpperCase();
        dataRow.getCell(1).font = { bold: true, color: { argb: sc.text } };
        dataRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.bg } };
        dataRow.getCell(2).value = claim.skill_id || '';
        dataRow.getCell(3).value = claim.message || claim.claim_text || '';
        dataRow.getCell(3).alignment = { wrapText: true };
        dataRow.getCell(4).value = claim.entity_id || '';
        dataRow.getCell(5).value = claim.category || '';

        // Alternating row shading
        if (row % 2 === 0) {
          for (let c = 1; c <= 5; c++) {
            if (c !== 1) { // Don't override severity cell color
              dataRow.getCell(c).fill = {
                type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg }
              };
            }
          }
        }
        row++;
      }

      // Column widths
      ws.getColumn(1).width = 12;
      ws.getColumn(2).width = 22;
      ws.getColumn(3).width = 60;
      ws.getColumn(4).width = 30;
      ws.getColumn(5).width = 20;
    }
  }

  private buildEvidenceTab(
    workbook: ExcelJS.Workbook,
    skillId: string,
    evidence: SkillEvidence,
    branding?: BrandingConfig
  ): void {
    // Clean skill name for tab label (max 31 chars for Excel)
    const tabName = this.sanitizeTabName(skillId);
    const ws = workbook.addWorksheet(tabName);

    const records = evidence.evaluated_records || [];
    const schema = evidence.column_schema || [];

    if (records.length === 0) return;

    // Determine columns: use column_schema if available, else infer from first record
    const columns: { key: string; label: string; width: number; type?: string }[] =
      schema.length > 0
        ? schema.map(col => ({
            key: col.key,
            label: col.display || col.key,
            width: this.inferColumnWidth(col.key, col.format),
            type: col.format,
          }))
        : Object.keys(records[0]).map(key => ({
            key,
            label: this.humanizeKey(key),
            width: this.inferColumnWidth(key),
          }));

    // Header row
    let row = 1;
    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    const headerRow = ws.getRow(row);
    columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.label;
      cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
      };
      ws.getColumn(i + 1).width = col.width;
    });
    row++;

    // Data rows
    for (const record of records) {
      const dataRow = ws.getRow(row);
      columns.forEach((col, i) => {
        const value = this.resolveNestedValue(record, col.key);
        const cell = dataRow.getCell(i + 1);
        cell.value = this.formatCellValue(value, col.type);
        cell.alignment = { wrapText: true, vertical: 'top' };

        // Alternating rows
        if (row % 2 === 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg } };
        }
      });
      row++;
    }

    // Auto-filter on header row
    if (records.length > 0) {
      ws.autoFilter = {
        from: { row: branding ? 3 : 1, column: 1 },
        to: { row: row - 1, column: columns.length },
      };
    }

    // Freeze header row
    ws.views = [{ state: 'frozen', ySplit: branding ? 3 : 1 }];
  }

  // ── Mode 2: Template-Driven Workbook ─────────────────────────

  private async renderTemplateMode(
    workbook: ExcelJS.Workbook,
    input: RendererInput
  ): Promise<void> {
    const matrix = input.templateMatrix!;
    const branding = input.workspace.branding;

    switch (matrix.template_type) {
      case 'stage_matrix':
        this.buildStageMatrixTab(workbook, matrix, branding);
        break;
      case 'ranked_list':
        this.buildRankedListTab(workbook, matrix, branding);
        break;
      case 'waterfall':
        this.buildWaterfallTab(workbook, matrix, branding);
        break;
      case 'hybrid':
        this.buildHybridTabs(workbook, matrix, branding);
        break;
      default:
        this.buildStageMatrixTab(workbook, matrix, branding);
    }

    // Supporting evidence tabs
    if (input.options.include_evidence_tables && input.agentOutput) {
      for (const [skillId, evidence] of Object.entries(input.agentOutput.skill_evidence)) {
        if (evidence.evaluated_records?.length > 0) {
          this.buildEvidenceTab(workbook, skillId, evidence, branding);
        }
      }
    }

    // Methodology tab
    if (input.options.include_methodology !== false) {
      this.buildTemplateMethodologyTab(workbook, matrix, branding);
    }
  }

  private buildStageMatrixTab(
    workbook: ExcelJS.Workbook,
    matrix: any,
    branding?: BrandingConfig
  ): void {
    const ws = workbook.addWorksheet('Sales Process Map');

    let row = 1;

    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    ws.getRow(row).getCell(1).value = 'Sales Process Map';
    ws.getRow(row).getCell(1).font = { size: 16, bold: true };
    row += 2;

    const stages = matrix.stages || [];
    const rows = matrix.rows || [];

    // Column headers: blank corner + stage names
    const headerRow = ws.getRow(row);
    headerRow.getCell(1).value = '';
    headerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    ws.getColumn(1).width = 28;

    stages.forEach((stage: any, i: number) => {
      const cell = headerRow.getCell(i + 2);
      cell.value = stage.stage_name;
      cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
      cell.alignment = { horizontal: 'center', wrapText: true };
      ws.getColumn(i + 2).width = Math.max(20, Math.ceil(stage.stage_name.length * 1.5));
    });
    row++;

    // Data rows: dimension label + cell content per stage
    for (const matrixRow of rows) {
      const dataRow = ws.getRow(row);

      // Dimension label (row header)
      dataRow.getCell(1).value = matrixRow.dimension_label;
      dataRow.getCell(1).font = { bold: true, size: 10 };
      dataRow.getCell(1).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' }
      };
      dataRow.getCell(1).alignment = { vertical: 'top' };

      // Cell content per stage
      stages.forEach((stage: any, i: number) => {
        const templateCell = matrixRow.cells[stage.stage_normalized];
        const cell = dataRow.getCell(i + 2);

        if (!templateCell || templateCell.status === 'not_applicable') {
          cell.value = '—';
          cell.font = { color: { argb: COLORS.degradedText } };
          cell.alignment = { horizontal: 'center', vertical: 'top' };
        } else if (templateCell.status === 'degraded') {
          cell.value = templateCell.content || 'Limited data';
          cell.font = { italic: true, color: { argb: COLORS.degradedText }, size: 9 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.degradedBg } };
          cell.alignment = { wrapText: true, vertical: 'top' };
        } else {
          cell.value = templateCell.content || '';
          cell.font = { size: 9 };
          cell.alignment = { wrapText: true, vertical: 'top' };
        }

        // Subtle borders
        cell.border = {
          top: { style: 'thin', color: { argb: COLORS.borderColor } },
          left: { style: 'thin', color: { argb: COLORS.borderColor } },
          bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
          right: { style: 'thin', color: { argb: COLORS.borderColor } },
        };
      });

      // Taller rows for content
      dataRow.height = 80;
      row++;
    }

    // Freeze the header row and dimension column
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: branding ? row - rows.length : row - rows.length }];
  }

  private buildRankedListTab(
    workbook: ExcelJS.Workbook,
    matrix: any,
    branding?: BrandingConfig
  ): void {
    const ws = workbook.addWorksheet('Ranked Results');
    let row = 1;

    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    const records = matrix.records || [];
    const schema = matrix.column_schema || [];
    const rankField = matrix.ranking_field || 'score';

    // Sort by ranking field descending
    const sorted = [...records].sort(
      (a: any, b: any) => (b[rankField] || 0) - (a[rankField] || 0)
    );

    // Add rank column + schema columns
    const columns = [
      { key: '_rank', label: 'Rank', width: 8, type: undefined },
      ...schema.map((col: any) => ({
        key: col.key,
        label: col.display || col.label || col.key,
        width: this.inferColumnWidth(col.key, col.format),
        type: col.format,
      })),
    ];

    // Headers
    const headerRow = ws.getRow(row);
    columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.label;
      cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
      ws.getColumn(i + 1).width = col.width;
    });
    row++;

    // Data
    sorted.forEach((record: any, idx: number) => {
      const dataRow = ws.getRow(row);
      dataRow.getCell(1).value = idx + 1;
      dataRow.getCell(1).font = { bold: true };
      dataRow.getCell(1).alignment = { horizontal: 'center' };

      columns.slice(1).forEach((col, i) => {
        const cell = dataRow.getCell(i + 2);
        cell.value = this.formatCellValue(this.resolveNestedValue(record, col.key), col.type);
        cell.alignment = { wrapText: true, vertical: 'top' };
      });

      if (row % 2 === 0) {
        for (let c = 1; c <= columns.length; c++) {
          dataRow.getCell(c).fill = {
            type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg }
          };
        }
      }
      row++;
    });

    ws.autoFilter = { from: { row: branding ? 3 : 1, column: 1 }, to: { row: row - 1, column: columns.length } };
    ws.views = [{ state: 'frozen', ySplit: branding ? 3 : 1 }];
  }

  private buildWaterfallTab(
    workbook: ExcelJS.Workbook,
    matrix: any,
    branding?: BrandingConfig
  ): void {
    const ws = workbook.addWorksheet('Pipeline Waterfall');
    let row = 1;

    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    ws.getRow(row).getCell(1).value = 'Pipeline Waterfall';
    ws.getRow(row).getCell(1).font = { size: 16, bold: true };
    row += 2;

    // Starting value
    const starting = matrix.starting_value;
    if (starting) {
      const startRow = ws.getRow(row);
      startRow.getCell(1).value = starting.label;
      startRow.getCell(1).font = { bold: true };
      startRow.getCell(2).value = starting.amount;
      startRow.getCell(2).numFmt = '$#,##0';
      startRow.getCell(2).font = { bold: true };
      row++;
    }

    // Adjustments
    const adjustments = matrix.adjustments || [];
    for (const adj of adjustments) {
      const adjRow = ws.getRow(row);
      adjRow.getCell(1).value = `  ${adj.label}`;
      adjRow.getCell(2).value = adj.amount;
      adjRow.getCell(2).numFmt = '+$#,##0;-$#,##0;$0';
      adjRow.getCell(2).font = {
        color: { argb: adj.amount >= 0 ? COLORS.successText : COLORS.criticalText }
      };
      row++;
    }

    // Result
    row++;
    const resultRow = ws.getRow(row);
    resultRow.getCell(1).value = 'Ending Pipeline';
    resultRow.getCell(1).font = { bold: true, size: 12 };
    const total = (starting?.amount || 0) + adjustments.reduce((s: number, a: any) => s + a.amount, 0);
    resultRow.getCell(2).value = total;
    resultRow.getCell(2).numFmt = '$#,##0';
    resultRow.getCell(2).font = { bold: true, size: 12 };

    ws.getColumn(1).width = 35;
    ws.getColumn(2).width = 20;
  }

  private buildHybridTabs(
    workbook: ExcelJS.Workbook,
    matrix: any,
    branding?: BrandingConfig
  ): void {
    const sections = matrix.sections || [];
    for (const section of sections) {
      switch (section.type) {
        case 'narrative':
          this.buildNarrativeTab(workbook, section, branding);
          break;
        case 'stage_matrix':
          this.buildStageMatrixTab(workbook, section, branding);
          break;
        case 'ranked_list':
          this.buildRankedListTab(workbook, section, branding);
          break;
        case 'evidence_table':
          if (section.evidence) {
            this.buildEvidenceTab(workbook, section.label || 'Data', section.evidence, branding);
          }
          break;
      }
    }
  }

  private buildNarrativeTab(
    workbook: ExcelJS.Workbook,
    section: any,
    branding?: BrandingConfig
  ): void {
    const ws = workbook.addWorksheet(this.sanitizeTabName(section.label || 'Overview'));
    let row = 1;

    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    ws.getRow(row).getCell(1).value = section.title || section.label;
    ws.getRow(row).getCell(1).font = { size: 14, bold: true };
    row += 2;

    ws.getRow(row).getCell(1).value = section.content || '';
    ws.getRow(row).getCell(1).alignment = { wrapText: true };
    ws.getColumn(1).width = 100;
  }

  // ── Methodology Tab ──────────────────────────────────────────

  private buildMethodologyTab(
    workbook: ExcelJS.Workbook,
    agent: any,
    branding?: BrandingConfig
  ): void {
    const ws = workbook.addWorksheet('Methodology');
    let row = 1;

    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    ws.getRow(row).getCell(1).value = 'Methodology & Data Sources';
    ws.getRow(row).getCell(1).font = { size: 14, bold: true };
    row += 2;

    // Data sources
    ws.getRow(row).getCell(1).value = 'Data Sources';
    ws.getRow(row).getCell(1).font = { size: 12, bold: true };
    row++;

    for (const [skillId, evidence] of Object.entries(agent.skill_evidence || {})) {
      const ev = evidence as any;
      const sources = ev.data_sources || [];
      ws.getRow(row).getCell(1).value = skillId;
      ws.getRow(row).getCell(1).font = { bold: true };
      ws.getRow(row).getCell(2).value = sources.map((s: any) => `${s.source}: ${s.records_used || 0} records`).join(', ') || 'N/A';
      row++;
    }
    row++;

    // Parameters
    ws.getRow(row).getCell(1).value = 'Parameters & Thresholds';
    ws.getRow(row).getCell(1).font = { size: 12, bold: true };
    row++;

    const allParams = new Map<string, any>();
    for (const [skillId, evidence] of Object.entries(agent.skill_evidence || {})) {
      const ev = evidence as any;
      const params = ev.parameters || [];
      for (const p of params) {
        if (!allParams.has(p.name)) {
          allParams.set(p.name, p);
        }
      }
    }

    for (const param of allParams.values()) {
      ws.getRow(row).getCell(1).value = param.display_name || param.name;
      ws.getRow(row).getCell(2).value = String(param.value);
      row++;
    }

    ws.getColumn(1).width = 35;
    ws.getColumn(2).width = 70;
  }

  private buildTemplateMethodologyTab(
    workbook: ExcelJS.Workbook,
    matrix: any,
    branding?: BrandingConfig
  ): void {
    const ws = workbook.addWorksheet('Methodology');
    let row = 1;

    if (branding) {
      row = this.addBrandingHeader(ws, branding, row);
    }

    ws.getRow(row).getCell(1).value = 'Methodology';
    ws.getRow(row).getCell(1).font = { size: 14, bold: true };
    row += 2;

    // Cell count breakdown
    const counts = matrix.cell_count || {};
    ws.getRow(row).getCell(1).value = 'Cell Composition';
    ws.getRow(row).getCell(1).font = { bold: true };
    row++;
    for (const [type, count] of Object.entries(counts)) {
      ws.getRow(row).getCell(1).value = `  ${type}`;
      ws.getRow(row).getCell(2).value = count as number;
      row++;
    }
    row++;

    // Degraded dimensions
    const degraded = (matrix.rows || []).filter(
      (r: any) => Object.values(r.cells).some((c: any) => c.status === 'degraded')
    );
    if (degraded.length > 0) {
      ws.getRow(row).getCell(1).value = 'Data Limitations';
      ws.getRow(row).getCell(1).font = { bold: true };
      row++;
      for (const r of degraded) {
        const degradedCells = Object.entries(r.cells).filter(([_, c]: any) => c.status === 'degraded');
        ws.getRow(row).getCell(1).value = `  ${r.dimension_label}`;
        ws.getRow(row).getCell(2).value = degradedCells.map(([stage, c]: any) =>
          `${stage}: ${c.degradation_reason || 'limited data'}`
        ).join('; ');
        ws.getRow(row).getCell(2).alignment = { wrapText: true };
        row++;
      }
    }

    ws.getColumn(1).width = 35;
    ws.getColumn(2).width = 70;
  }

  // ── Shared Helpers ───────────────────────────────────────────

  private addBrandingHeader(ws: ExcelJS.Worksheet, branding: BrandingConfig, startRow: number): number {
    const row = ws.getRow(startRow);
    row.getCell(1).value = branding.company_name;
    row.getCell(1).font = {
      size: 11,
      bold: true,
      color: { argb: branding.primary_color.replace('#', 'FF') },
    };

    if (branding.prepared_by) {
      row.getCell(3).value = branding.prepared_by;
      row.getCell(3).font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
    }

    if (branding.confidentiality_notice) {
      const noticeRow = ws.getRow(startRow + 1);
      noticeRow.getCell(1).value = branding.confidentiality_notice;
      noticeRow.getCell(1).font = { size: 8, italic: true, color: { argb: 'FF94A3B8' } };
      return startRow + 3;
    }

    return startRow + 2;
  }

  private renderSingleSkill(workbook: ExcelJS.Workbook, input: RendererInput): void {
    const evidence = input.skillEvidence!;
    const skillId = 'skill-export';
    this.buildEvidenceTab(workbook, skillId, evidence, input.workspace.branding);

    if (input.options.include_methodology !== false) {
      const ws = workbook.addWorksheet('Methodology');
      let row = 1;
      ws.getRow(row).getCell(1).value = 'Data Sources';
      ws.getRow(row).getCell(1).font = { bold: true };
      row++;
      for (const source of (evidence.data_sources || [])) {
        ws.getRow(row).getCell(1).value = `${source.source}: ${source.records_used || 0} records`;
        row++;
      }
      ws.getColumn(1).width = 50;
    }
  }

  private generateFilename(input: RendererInput): string {
    const workspace = input.workspace.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'pandora';
    const type = input.templateMatrix?.template_type || 'report';
    const date = new Date().toISOString().split('T')[0];
    return `${workspace}_${type}_${date}.xlsx`;
  }

  private sanitizeTabName(name: string): string {
    // Excel tab names: max 31 chars, no []:*?/\
    return name
      .replace(/[-_]/g, ' ')
      .replace(/[[\]:*?/\\]/g, '')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
      .substring(0, 31);
  }

  private humanizeKey(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private inferColumnWidth(key: string, type?: string): number {
    if (type === 'currency' || type === 'number') return 15;
    if (type === 'date') return 14;
    if (type === 'boolean') return 10;
    if (key.includes('name') || key.includes('label')) return 25;
    if (key.includes('description') || key.includes('notes') || key.includes('message')) return 50;
    if (key.includes('email')) return 30;
    return 20;
  }

  private resolveNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
  }

  private formatCellValue(value: any, type?: string): any {
    if (value === null || value === undefined) return '';
    if (type === 'currency' && typeof value === 'number') return value;
    if (type === 'percentage' && typeof value === 'number') return value;
    if (type === 'date' && typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? value : d;
    }
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  }
}
