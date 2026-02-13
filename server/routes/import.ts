import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db.js';
import { parseImportFile } from '../import/file-parser.js';
import { heuristicMapColumns, type ColumnMapping } from '../import/heuristic-mapper.js';
import { parseAmount, parseDate, parsePercentage, normalizeText } from '../import/value-parsers.js';
import {
  applyDealImport, applyContactImport, applyAccountImport,
  type TransformedDeal, type TransformedContact, type TransformedAccount,
  type StageMapping,
} from '../import/apply.js';
import { refreshComputedFields } from '../tools/computed-fields-refresh.js';

const router = Router();

const TEMP_DIR = '/tmp/imports';
fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.xlsx', '.xls', '.csv'].includes(ext));
  },
});

// POST /api/workspaces/:id/import/upload
router.post('/:id/import/upload', upload.single('file'), async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const entityType = req.query.entityType as string;

    if (!['deal', 'contact', 'account'].includes(entityType)) {
      return res.status(400).json({ error: 'entityType query param required: deal, contact, or account' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const parsed = parseImportFile(req.file.buffer, req.file.originalname);
    const classification = heuristicMapColumns(
      entityType as 'deal' | 'contact' | 'account',
      parsed.headers,
      parsed.sampleRows
    );

    const batchId = uuidv4();

    const ext = path.extname(req.file.originalname).toLowerCase();
    const tempPath = path.join(TEMP_DIR, `${batchId}${ext}`);
    fs.writeFileSync(tempPath, req.file.buffer);

    await query(
      `INSERT INTO import_batches (id, workspace_id, entity_type, filename, row_count, classification, warnings, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [
        batchId, workspaceId, entityType, req.file.originalname,
        parsed.totalRows,
        JSON.stringify({
          mapping: classification.mapping,
          unmappedColumns: classification.unmappedColumns,
          dateFormat: parsed.detectedDateFormat,
          delimiter: parsed.detectedDelimiter,
          fileType: parsed.fileType,
          selectedSheet: parsed.selectedSheet,
          sheetNames: parsed.sheetNames,
          source: 'heuristic',
        }),
        classification.warnings,
      ]
    );

    const previewRows = buildPreviewRows(
      entityType as 'deal' | 'contact' | 'account',
      parsed.sampleRows.slice(0, 5),
      parsed.headers,
      classification,
      parsed.detectedDateFormat
    );

    const uniqueStages = entityType === 'deal'
      ? extractUniqueStages(parsed.sampleRows, parsed.headers, classification)
      : [];

    let existingStageMappings: Record<string, string> = {};
    if (entityType === 'deal' && uniqueStages.length > 0) {
      const mappings = await query<{ raw_stage: string; normalized_stage: string }>(
        `SELECT raw_stage, normalized_stage FROM stage_mappings
         WHERE workspace_id = $1 AND source = 'csv_import'`,
        [workspaceId]
      );
      for (const m of mappings.rows) {
        existingStageMappings[m.raw_stage] = m.normalized_stage;
      }
    }

    return res.json({
      batchId,
      filename: req.file.originalname,
      entityType,
      totalRows: parsed.totalRows,
      headers: parsed.headers,
      mapping: classification.mapping,
      unmappedColumns: classification.unmappedColumns,
      warnings: classification.warnings,
      previewRows,
      uniqueStages,
      existingStageMappings,
      dateFormat: parsed.detectedDateFormat,
      sheetNames: parsed.sheetNames,
      selectedSheet: parsed.selectedSheet,
    });
  } catch (err) {
    console.error('[Import] Upload error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

// POST /api/workspaces/:id/import/confirm
router.post('/:id/import/confirm', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const { batchId, overrides, strategy } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }

    const batch = await query<{
      id: string; entity_type: string; filename: string;
      status: string; classification: any; row_count: number;
    }>(
      `SELECT id, entity_type, filename, status, classification, row_count
       FROM import_batches WHERE id = $1 AND workspace_id = $2`,
      [batchId, workspaceId]
    );

    if (batch.rows.length === 0) {
      return res.status(404).json({ error: 'Import batch not found' });
    }

    const batchRow = batch.rows[0];
    if (batchRow.status !== 'pending') {
      return res.status(400).json({ error: `Batch status is "${batchRow.status}", expected "pending"` });
    }

    const ext = path.extname(batchRow.filename).toLowerCase();
    const tempPath = path.join(TEMP_DIR, `${batchId}${ext}`);

    if (!fs.existsSync(tempPath)) {
      return res.status(400).json({ error: 'Temp file expired. Please re-upload the file.' });
    }

    const buffer = fs.readFileSync(tempPath);
    const parsed = parseImportFile(buffer, batchRow.filename, batchRow.classification?.selectedSheet);

    let mapping = batchRow.classification?.mapping || {};
    if (overrides?.mapping) {
      mapping = { ...mapping, ...overrides.mapping };
    }

    const replaceStrategy = (strategy || 'replace') as 'replace' | 'merge' | 'append';
    const dateFormat = batchRow.classification?.dateFormat;

    let stageMapping: StageMapping | null = null;
    if (overrides?.stageMapping && batchRow.entity_type === 'deal') {
      stageMapping = overrides.stageMapping;
      for (const [rawStage, normalizedStage] of Object.entries(stageMapping!)) {
        await query(
          `INSERT INTO stage_mappings (workspace_id, source, raw_stage, normalized_stage)
           VALUES ($1, 'csv_import', $2, $3)
           ON CONFLICT (workspace_id, source, raw_stage) DO UPDATE SET
             normalized_stage = EXCLUDED.normalized_stage, updated_at = NOW()`,
          [workspaceId, rawStage, normalizedStage]
        );
      }
    }

    const excludeRows = new Set<number>(overrides?.excludeRows || []);
    const defaults = overrides?.defaults || {};

    const allRows = parsed.sampleRows.length < parsed.totalRows
      ? getAllDataRows(buffer, batchRow.filename, batchRow.classification?.selectedSheet)
      : parsed.sampleRows;

    const entityType = batchRow.entity_type as 'deal' | 'contact' | 'account';
    let result;

    if (entityType === 'deal') {
      const records = transformDealRows(allRows, parsed.headers, mapping, excludeRows, defaults);
      result = await applyDealImport(workspaceId, batchId, records, replaceStrategy, stageMapping, dateFormat);
    } else if (entityType === 'contact') {
      const records = transformContactRows(allRows, parsed.headers, mapping, excludeRows, defaults);
      result = await applyContactImport(workspaceId, batchId, records, replaceStrategy);
    } else {
      const records = transformAccountRows(allRows, parsed.headers, mapping, excludeRows, defaults);
      result = await applyAccountImport(workspaceId, batchId, records, replaceStrategy);
    }

    try { fs.unlinkSync(tempPath); } catch {}

    return res.json(result);
  } catch (err) {
    console.error('[Import] Confirm error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Confirm failed' });
  }
});

// DELETE /api/workspaces/:id/import/batch/:batchId
router.delete('/:id/import/batch/:batchId', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const batchId = req.params.batchId;

    const batch = await query<{ entity_type: string; status: string }>(
      `SELECT entity_type, status FROM import_batches WHERE id = $1 AND workspace_id = $2`,
      [batchId, workspaceId]
    );

    if (batch.rows.length === 0) {
      return res.status(404).json({ error: 'Import batch not found' });
    }

    if (batch.rows[0].status !== 'applied') {
      return res.status(400).json({ error: `Cannot rollback batch with status "${batch.rows[0].status}"` });
    }

    const entityType = batch.rows[0].entity_type;
    const table = entityType === 'deal' ? 'deals' : entityType === 'contact' ? 'contacts' : 'accounts';

    const deleteResult = await query(
      `DELETE FROM ${table} WHERE workspace_id = $1 AND source_data->>'import_batch_id' = $2`,
      [workspaceId, batchId]
    );

    await query(
      `UPDATE import_batches SET status = 'rolled_back' WHERE id = $1`,
      [batchId]
    );

    try {
      await refreshComputedFields(workspaceId);
    } catch {}

    return res.json({
      deleted: deleteResult.rowCount || 0,
      entityType,
      batchId,
    });
  } catch (err) {
    console.error('[Import] Rollback error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Rollback failed' });
  }
});

// GET /api/workspaces/:id/import/history
router.get('/:id/import/history', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const result = await query(
      `SELECT id, entity_type, filename, source_crm, row_count,
              records_inserted, records_updated, records_skipped,
              status, replace_strategy, uploaded_by, warnings,
              created_at, confirmed_at, applied_at
       FROM import_batches
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [workspaceId]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch import history' });
  }
});

// GET /api/workspaces/:id/import/freshness
router.get('/:id/import/freshness', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const result = await query<{
      entity_type: string; last_import: string; total_records: string;
    }>(
      `SELECT entity_type,
              MAX(applied_at) as last_import,
              SUM(records_inserted + records_updated) as total_records
       FROM import_batches
       WHERE workspace_id = $1 AND status = 'applied'
       GROUP BY entity_type`,
      [workspaceId]
    );

    const freshness = result.rows.map(row => {
      const lastImport = new Date(row.last_import);
      const daysSince = Math.floor((Date.now() - lastImport.getTime()) / (1000 * 60 * 60 * 24));
      const isStale = daysSince > 14;
      return {
        entityType: row.entity_type,
        lastImportedAt: row.last_import,
        daysSinceImport: daysSince,
        recordCount: parseInt(row.total_records, 10),
        isStale,
        staleCaveat: isStale ? `Last ${row.entity_type} import was ${daysSince} days ago. Consider re-uploading.` : null,
      };
    });

    return res.json(freshness);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch freshness data' });
  }
});

// ============================================================================
// Helpers
// ============================================================================

function getAllDataRows(buffer: Buffer, filename: string, sheetName?: string): any[][] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const selectedSheet = sheetName || wb.SheetNames[0];
  const ws = wb.Sheets[selectedSheet];
  const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const headerRowIndex = findHeaderRowIndex(rawData);
  return rawData.slice(headerRowIndex + 1).filter((row: any[]) =>
    row.some((cell: any) => cell !== '' && cell !== null && cell !== undefined)
  );
}

function findHeaderRowIndex(rawData: any[][]): number {
  for (let i = 0; i < Math.min(rawData.length, 10); i++) {
    const row = rawData[i];
    const nonEmpty = row.filter((c: any) => c !== '' && c !== null && c !== undefined);
    if (nonEmpty.length < 3) continue;
    if (nonEmpty.every((c: any) => typeof c === 'string')) {
      const next = rawData[i + 1];
      if (next) {
        const nextNonEmpty = next.filter((c: any) => c !== '' && c !== null && c !== undefined);
        if (nextNonEmpty.length >= 3) return i;
      } else {
        return i;
      }
    }
  }
  return 0;
}

function getFieldValue(row: any[], mapping: Record<string, any>, field: string): any {
  const m = mapping[field];
  if (!m) return undefined;
  const idx = m.columnIndex ?? m.column_index;
  if (idx === undefined || idx === null) return undefined;
  return row[idx];
}

function buildPreviewRows(
  entityType: 'deal' | 'contact' | 'account',
  sampleRows: any[][],
  headers: string[],
  classification: ColumnMapping,
  dateFormat: string | null
): any[] {
  return sampleRows.map(row => {
    const preview: Record<string, any> = {};
    for (const [field, m] of Object.entries(classification.mapping)) {
      const val = row[m.columnIndex];
      preview[field] = val;
    }
    return preview;
  });
}

function extractUniqueStages(
  sampleRows: any[][],
  headers: string[],
  classification: ColumnMapping
): string[] {
  const stageMapping = classification.mapping['stage'];
  if (!stageMapping) return [];

  const stages = new Set<string>();
  for (const row of sampleRows) {
    const val = row[stageMapping.columnIndex];
    if (val && typeof val === 'string' && val.trim()) {
      stages.add(val.trim());
    }
  }
  return Array.from(stages).sort();
}

function transformDealRows(
  rows: any[][],
  headers: string[],
  mapping: Record<string, any>,
  excludeRows: Set<number>,
  defaults: Record<string, any>
): TransformedDeal[] {
  const records: TransformedDeal[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (excludeRows.has(i)) continue;
    const row = rows[i];

    const rawObj: Record<string, any> = {};
    headers.forEach((h, idx) => { rawObj[h] = row[idx]; });

    const unmappedFields: Record<string, any> = {};
    const mappedIndices = new Set(Object.values(mapping).map((m: any) => m.columnIndex ?? m.column_index));
    headers.forEach((h, idx) => {
      if (!mappedIndices.has(idx) && row[idx] !== '' && row[idx] !== null && row[idx] !== undefined) {
        unmappedFields[h] = row[idx];
      }
    });

    records.push({
      name: normalizeText(getFieldValue(row, mapping, 'name')) || '',
      amount: getFieldValue(row, mapping, 'amount'),
      stage: normalizeText(getFieldValue(row, mapping, 'stage')) || defaults.stage,
      close_date: getFieldValue(row, mapping, 'close_date'),
      created_date: getFieldValue(row, mapping, 'created_date'),
      owner: normalizeText(getFieldValue(row, mapping, 'owner')) || defaults.owner,
      pipeline: normalizeText(getFieldValue(row, mapping, 'pipeline')) || defaults.pipeline,
      account_name: normalizeText(getFieldValue(row, mapping, 'account_name')),
      external_id: normalizeText(getFieldValue(row, mapping, 'external_id')) || undefined,
      probability: getFieldValue(row, mapping, 'probability'),
      unmappedFields,
      raw: rawObj,
    });
  }

  return records;
}

function transformContactRows(
  rows: any[][],
  headers: string[],
  mapping: Record<string, any>,
  excludeRows: Set<number>,
  defaults: Record<string, any>
): TransformedContact[] {
  const records: TransformedContact[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (excludeRows.has(i)) continue;
    const row = rows[i];

    const rawObj: Record<string, any> = {};
    headers.forEach((h, idx) => { rawObj[h] = row[idx]; });

    const unmappedFields: Record<string, any> = {};
    const mappedIndices = new Set(Object.values(mapping).map((m: any) => m.columnIndex ?? m.column_index));
    headers.forEach((h, idx) => {
      if (!mappedIndices.has(idx) && row[idx] !== '' && row[idx] !== null && row[idx] !== undefined) {
        unmappedFields[h] = row[idx];
      }
    });

    records.push({
      first_name: normalizeText(getFieldValue(row, mapping, 'first_name')) || undefined,
      last_name: normalizeText(getFieldValue(row, mapping, 'last_name')) || undefined,
      full_name: normalizeText(getFieldValue(row, mapping, 'full_name')) || undefined,
      email: normalizeText(getFieldValue(row, mapping, 'email')) || undefined,
      phone: normalizeText(getFieldValue(row, mapping, 'phone')) || undefined,
      title: normalizeText(getFieldValue(row, mapping, 'title')) || defaults.title || undefined,
      department: normalizeText(getFieldValue(row, mapping, 'department')) || undefined,
      account_name: normalizeText(getFieldValue(row, mapping, 'account_name')) || undefined,
      lifecycle_stage: normalizeText(getFieldValue(row, mapping, 'lifecycle_stage')) || undefined,
      seniority: normalizeText(getFieldValue(row, mapping, 'seniority')) || undefined,
      external_id: normalizeText(getFieldValue(row, mapping, 'external_id')) || undefined,
      unmappedFields,
      raw: rawObj,
    });
  }

  return records;
}

function transformAccountRows(
  rows: any[][],
  headers: string[],
  mapping: Record<string, any>,
  excludeRows: Set<number>,
  defaults: Record<string, any>
): TransformedAccount[] {
  const records: TransformedAccount[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (excludeRows.has(i)) continue;
    const row = rows[i];

    const rawObj: Record<string, any> = {};
    headers.forEach((h, idx) => { rawObj[h] = row[idx]; });

    const unmappedFields: Record<string, any> = {};
    const mappedIndices = new Set(Object.values(mapping).map((m: any) => m.columnIndex ?? m.column_index));
    headers.forEach((h, idx) => {
      if (!mappedIndices.has(idx) && row[idx] !== '' && row[idx] !== null && row[idx] !== undefined) {
        unmappedFields[h] = row[idx];
      }
    });

    records.push({
      name: normalizeText(getFieldValue(row, mapping, 'name')) || '',
      domain: normalizeText(getFieldValue(row, mapping, 'domain')) || undefined,
      industry: normalizeText(getFieldValue(row, mapping, 'industry')) || defaults.industry || undefined,
      employee_count: getFieldValue(row, mapping, 'employee_count'),
      annual_revenue: getFieldValue(row, mapping, 'annual_revenue'),
      owner: normalizeText(getFieldValue(row, mapping, 'owner')) || undefined,
      external_id: normalizeText(getFieldValue(row, mapping, 'external_id')) || undefined,
      unmappedFields,
      raw: rawObj,
    });
  }

  return records;
}

// ============================================================================
// Temp file cleanup
// ============================================================================

export function cleanupTempFiles(): void {
  try {
    if (!fs.existsSync(TEMP_DIR)) return;
    const files = fs.readdirSync(TEMP_DIR);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Import] Cleaned up ${cleaned} expired temp file(s)`);
    }
  } catch (err) {
    console.error('[Import] Temp cleanup error:', err);
  }
}

export default router;
