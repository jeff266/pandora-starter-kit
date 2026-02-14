import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db.js';
import { parseImportFile } from '../import/file-parser.js';
import { heuristicMapColumns, type ColumnMapping } from '../import/heuristic-mapper.js';
import { classifyColumns as aiClassifyColumns, type ClassificationResult } from '../import/ai-classifier.js';
import { classifyStages, heuristicMapStages, type StageMappingResult } from '../import/stage-classifier.js';
import { detectDedupStrategy } from '../import/dedup.js';
import { linkDealsToAccounts, linkContactsToAccounts } from '../import/account-linker.js';
import { parseAmount, parseDate, parsePercentage, normalizeText } from '../import/value-parsers.js';
import {
  applyDealImport, applyContactImport, applyAccountImport, relinkAll,
  type TransformedDeal, type TransformedContact, type TransformedAccount,
  type StageMapping,
} from '../import/apply.js';
import { computeDeduplication } from '../import/snapshot-diff.js';
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

    // Try AI classification first, fall back to heuristic
    let aiClassification: ClassificationResult | null = null;
    let classificationSource = 'heuristic';
    let warnings: string[] = [];

    try {
      aiClassification = await aiClassifyColumns(
        entityType as 'deal' | 'contact' | 'account',
        parsed.headers,
        parsed.sampleRows,
        workspaceId
      );
      classificationSource = 'ai';
      console.log(`[Import] AI classification succeeded for ${entityType}`);
    } catch (err: any) {
      console.warn(`[Import] AI classification failed, using heuristic: ${err.message}`);
    }

    // Use AI classification if available, otherwise heuristic
    const classification = aiClassification
      ? convertAIClassificationToMapping(aiClassification, entityType)
      : heuristicMapColumns(
          entityType as 'deal' | 'contact' | 'account',
          parsed.headers,
          parsed.sampleRows
        );

    // Add confidence warnings for low-confidence AI mappings
    if (aiClassification && classificationSource === 'ai') {
      const confWarnings = buildConfidenceWarnings(aiClassification, entityType);
      warnings.push(...confWarnings);
    }

    warnings.push(...(classification.warnings || []));

    // Add encoding warning if conversion happened
    if (parsed.encodingConverted) {
      warnings.push(
        `File was encoded as ${parsed.detectedEncoding} and automatically converted to UTF-8. ` +
        `Verify accented characters (é, ñ, ü) display correctly.`
      );
    }

    if (entityType === 'contact' || entityType === 'deal') {
      try {
        const accountCount = await query<{ count: string }>(
          `SELECT COUNT(*) as count FROM accounts WHERE workspace_id = $1`,
          [workspaceId]
        );
        if (parseInt(accountCount.rows[0].count) === 0) {
          warnings.push(
            `No accounts imported yet — ${entityType}s won't be linked to accounts. ` +
            `Import accounts first for best results, or import them after and use the re-link endpoint.`
          );
        }
      } catch (err) {
        console.warn('[Import] Failed to check account count for warning:', err);
      }
    }

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
          unmappedColumns: classification.unmappedColumns || [],
          dateFormat: aiClassification?.['date_format'] || parsed.detectedDateFormat,
          delimiter: parsed.detectedDelimiter,
          fileType: parsed.fileType,
          selectedSheet: parsed.selectedSheet,
          sheetNames: parsed.sheetNames,
          source: classificationSource,
          aiMetadata: aiClassification ? {
            source_crm: aiClassification['source_crm'],
            currency: aiClassification['currency'],
            has_header_row: aiClassification['has_header_row'],
            stage_values: (aiClassification as any).stage_values,
            notes: aiClassification['notes'],
          } : null,
        }),
        warnings,
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
    let newStageMappings: Record<string, any> = {};
    let stageMappingSource = 'existing';

    if (entityType === 'deal' && uniqueStages.length > 0) {
      // Load existing mappings from stage_mappings table
      const mappings = await query<{ raw_stage: string; normalized_stage: string; is_open: boolean; display_order: number }>(
        `SELECT raw_stage, normalized_stage, is_open, display_order FROM stage_mappings
         WHERE workspace_id = $1 AND source = 'csv_import'`,
        [workspaceId]
      );
      for (const m of mappings.rows) {
        existingStageMappings[m.raw_stage] = m.normalized_stage;
      }

      // Find unmapped stages
      const unmappedStages = uniqueStages.filter(s => !existingStageMappings[s]);

      // If there are unmapped stages, classify them with AI
      if (unmappedStages.length > 0) {
        console.log(`[Import] Classifying ${unmappedStages.length} unmapped stages with AI`);

        try {
          // Build sample deals by stage for AI context
          const sampleDealsByStage: Record<string, any[]> = {};
          for (const stage of unmappedStages) {
            const stageDeals = parsed.sampleRows
              .filter(row => {
                const stageIdx = classification.mapping['stage']?.columnIndex;
                return stageIdx !== undefined && row[stageIdx] === stage;
              })
              .slice(0, 3)
              .map(row => ({
                name: row[classification.mapping['name']?.columnIndex || 0],
                amount: row[classification.mapping['amount']?.columnIndex || -1],
                close_date: row[classification.mapping['close_date']?.columnIndex || -1],
              }));
            sampleDealsByStage[stage] = stageDeals;
          }

          const aiStageMapping = await classifyStages(
            unmappedStages,
            sampleDealsByStage,
            workspaceId
          );

          newStageMappings = aiStageMapping.stageMapping;
          stageMappingSource = 'ai';
          console.log(`[Import] AI stage classification succeeded with confidence ${aiStageMapping.confidence}`);

          if (aiStageMapping.confidence < 0.7) {
            warnings.push(`Stage mapping confidence is low (${Math.round(aiStageMapping.confidence * 100)}%) — please verify`);
          }

          if (aiStageMapping.notes) {
            warnings.push(`Stage Mapping Note: ${aiStageMapping.notes}`);
          }
        } catch (err: any) {
          console.warn(`[Import] AI stage classification failed, using heuristic: ${err.message}`);
          const heuristicMapping = heuristicMapStages(unmappedStages);
          newStageMappings = heuristicMapping.stageMapping;
          stageMappingSource = 'heuristic';
          warnings.push('Stage mapping used heuristic fallback — please verify mappings');
        }
      }
    }

    // Detect deduplication strategy based on available columns
    const dedupStrategyResult = detectDedupStrategy(
      entityType as 'deal' | 'contact' | 'account',
      classification.mapping
    );

    // Add warning if no dedup possible
    if (dedupStrategyResult.strategy === 'none') {
      warnings.unshift(
        '⚠️ DUPLICATE RISK: No unique identifier detected in this file. ' +
        'Re-importing will create duplicate records. Consider adding a ' +
        'Record ID, Deal ID, or Email column to enable duplicate detection.'
      );
    } else if (dedupStrategyResult.warning) {
      warnings.push(dedupStrategyResult.warning);
    }

    let deduplication = null;
    try {
      deduplication = await computeDeduplication(
        workspaceId,
        entityType as 'deal' | 'contact' | 'account',
        parsed.sampleRows,
        parsed.headers,
        classification.mapping
      );

      // Enhance deduplication with strategy info
      (deduplication as any).dedupStrategy = dedupStrategyResult.strategy;
      (deduplication as any).dedupKeyFields = dedupStrategyResult.keyFields;

      if (deduplication.existingRecords > 0) {
        warnings.push(
          `Found ${deduplication.existingRecords} existing imported ${entityType}s. ` +
          `${deduplication.matchingRecords} rows match existing records. ` +
          `Recommended strategy: ${deduplication.recommendation}`
        );
      }
    } catch (err) {
      console.warn('[Import] Failed to compute deduplication:', err);
    }

    return res.json({
      batchId,
      filename: req.file.originalname,
      entityType,
      totalRows: parsed.totalRows,
      headers: parsed.headers,
      mapping: classification.mapping,
      unmappedColumns: classification.unmappedColumns,
      warnings,
      previewRows,
      deduplication,
      stageMapping: {
        uniqueStages,
        existingMappings: existingStageMappings,
        newMappings: newStageMappings,
        source: stageMappingSource,
      },
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
      // Persist stage mappings with is_open and display_order
      for (const [rawStage, mappingData] of Object.entries(stageMapping!)) {
        const normalized = typeof mappingData === 'string' ? mappingData : mappingData.normalized;
        const isOpen = typeof mappingData === 'object' ? mappingData.is_open : true;
        const displayOrder = typeof mappingData === 'object' ? mappingData.display_order : 0;

        await query(
          `INSERT INTO stage_mappings (workspace_id, source, raw_stage, normalized_stage, is_open, display_order)
           VALUES ($1, 'csv_import', $2, $3, $4, $5)
           ON CONFLICT (workspace_id, source, raw_stage) DO UPDATE SET
             normalized_stage = EXCLUDED.normalized_stage,
             is_open = EXCLUDED.is_open,
             display_order = EXCLUDED.display_order,
             updated_at = NOW()`,
          [workspaceId, rawStage, normalized, isOpen, displayOrder]
        );
      }
      console.log(`[Import] Persisted ${Object.keys(stageMapping).length} stage mappings`);
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

    const batch = await query<{ entity_type: string; status: string; filename: string }>(
      `SELECT entity_type, status, filename FROM import_batches WHERE id = $1 AND workspace_id = $2`,
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

    if (entityType === 'deal') {
      await query(
        `DELETE FROM deal_stage_history
         WHERE workspace_id = $1
           AND source IN ('file_import_diff', 'file_import_new', 'file_import_removed')`,
        [workspaceId]
      );
    }

    await query(
      `UPDATE import_batches SET status = 'rolled_back' WHERE id = $1`,
      [batchId]
    );

    try {
      await refreshComputedFields(workspaceId);
    } catch {}

    const ext = path.extname(batch.rows[0].filename).toLowerCase();
    const tempPath = path.join(TEMP_DIR, `${batchId}${ext}`);
    try { fs.unlinkSync(tempPath); } catch {}

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

// POST /api/workspaces/:id/import/cancel/:batchId
router.post('/:id/import/cancel/:batchId', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const batchId = req.params.batchId;

    const batch = await query<{ status: string; filename: string }>(
      `SELECT status, filename FROM import_batches WHERE id = $1 AND workspace_id = $2`,
      [batchId, workspaceId]
    );

    if (batch.rows.length === 0) {
      return res.status(404).json({ error: 'Import batch not found' });
    }

    if (batch.rows[0].status !== 'pending') {
      return res.status(400).json({ error: `Cannot cancel batch with status "${batch.rows[0].status}"` });
    }

    await query(
      `UPDATE import_batches SET status = 'cancelled' WHERE id = $1`,
      [batchId]
    );

    const ext = path.extname(batch.rows[0].filename).toLowerCase();
    const tempPath = path.join(TEMP_DIR, `${batchId}${ext}`);
    try { fs.unlinkSync(tempPath); } catch {}

    return res.json({ cancelled: true, batchId });
  } catch (err) {
    console.error('[Import] Cancel error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Cancel failed' });
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

// OLD relink endpoint - replaced by improved domain-first linking below
// router.post('/:id/import/relink', async (req, res) => {
//   try {
//     const workspaceId = req.params.id;
//     console.log(`[Import] Running full re-link for workspace ${workspaceId}`);
//     const result = await relinkAll(workspaceId);
//     console.log(`[Import] Re-link complete:`, result);
//     return res.json(result);
//   } catch (err) {
//     console.error('[Import] Relink error:', err);
//     return res.status(500).json({ error: err instanceof Error ? err.message : 'Relink failed' });
//   }
// });

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
      associated_deal_name: normalizeText(getFieldValue(row, mapping, 'associated_deals')) || undefined,
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
// AI Classification Helpers
// ============================================================================

/**
 * Convert AI classification result to the same format as heuristic mapper
 */
function convertAIClassificationToMapping(
  aiClassification: ClassificationResult,
  entityType: 'deal' | 'contact' | 'account'
): ColumnMapping {
  const mapping: Record<string, any> = {};
  const unmappedColumns: string[] = aiClassification.unmapped_columns || [];

  for (const [field, value] of Object.entries(aiClassification.mapping)) {
    if (value.column_index !== null) {
      mapping[field] = {
        columnIndex: value.column_index,
        columnHeader: value.column_header,
        confidence: value.confidence,
        source: 'ai',
      };
    }
  }

  return {
    mapping,
    unmappedColumns,
    warnings: [],
  };
}

/**
 * Build warnings for low-confidence AI mappings
 */
function buildConfidenceWarnings(
  aiClassification: ClassificationResult,
  entityType: 'deal' | 'contact' | 'account'
): string[] {
  const warnings: string[] = [];

  // Required fields by entity type
  const requiredFields: Record<string, string[]> = {
    deal: ['name', 'amount', 'stage', 'close_date'],
    contact: ['email'],
    account: ['name'],
  };

  const required = requiredFields[entityType] || [];

  for (const [field, mapping] of Object.entries(aiClassification.mapping)) {
    // Warn on low confidence for mapped fields
    if (mapping.column_index !== null && mapping.confidence > 0 && mapping.confidence < 0.7) {
      warnings.push(
        `"${mapping.column_header}" mapped to ${field} with low confidence ` +
        `(${Math.round(mapping.confidence * 100)}%) — please verify`
      );
    }

    // Warn on missing required fields
    if (required.includes(field) && mapping.confidence === 0) {
      warnings.push(`Required field "${field}" was not detected — please map manually`);
    }
  }

  // Add notes from AI if present
  if (aiClassification.notes && aiClassification.notes.length > 0) {
    warnings.push(`AI Note: ${aiClassification.notes}`);
  }

  return warnings;
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

// ============================================================================
// Stage Mapping CRUD API
// ============================================================================

// GET /api/workspaces/:id/import/stage-mapping
router.get('/:id/import/stage-mapping', async (req, res) => {
  try {
    const workspaceId = req.params.id;

    const mappings = await query<{
      id: string;
      source: string;
      raw_stage: string;
      normalized_stage: string;
      is_open: boolean;
      display_order: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, source, raw_stage, normalized_stage, is_open, display_order, created_at, updated_at
       FROM stage_mappings
       WHERE workspace_id = $1
       ORDER BY source, display_order, raw_stage`,
      [workspaceId]
    );

    // Group by source
    const grouped: Record<string, any[]> = {};
    for (const m of mappings.rows) {
      if (!grouped[m.source]) {
        grouped[m.source] = [];
      }
      grouped[m.source].push({
        id: m.id,
        rawStage: m.raw_stage,
        normalizedStage: m.normalized_stage,
        isOpen: m.is_open,
        displayOrder: m.display_order,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
      });
    }

    return res.json(grouped);
  } catch (err) {
    console.error('[Import] Get stage mappings error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get stage mappings' });
  }
});

// PUT /api/workspaces/:id/import/stage-mapping
router.put('/:id/import/stage-mapping', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const { mappings, source } = req.body;

    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings array is required' });
    }

    const sourceValue = source || 'csv_import';

    // Bulk upsert
    let upserted = 0;
    for (const mapping of mappings) {
      const { rawStage, normalized, isOpen, displayOrder } = mapping;

      if (!rawStage || !normalized) {
        continue;
      }

      await query(
        `INSERT INTO stage_mappings (workspace_id, source, raw_stage, normalized_stage, is_open, display_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, source, raw_stage) DO UPDATE SET
           normalized_stage = EXCLUDED.normalized_stage,
           is_open = EXCLUDED.is_open,
           display_order = EXCLUDED.display_order,
           updated_at = NOW()`,
        [
          workspaceId,
          sourceValue,
          rawStage,
          normalized,
          isOpen !== undefined ? isOpen : true,
          displayOrder !== undefined ? displayOrder : 0,
        ]
      );
      upserted++;
    }

    return res.json({ upserted, source: sourceValue });
  } catch (err) {
    console.error('[Import] Put stage mappings error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update stage mappings' });
  }
});

// DELETE /api/workspaces/:id/import/stage-mapping/:rawStage
router.delete('/:id/import/stage-mapping/:rawStage', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const rawStage = decodeURIComponent(req.params.rawStage);
    const source = req.query.source as string || 'csv_import';

    const result = await query(
      `DELETE FROM stage_mappings
       WHERE workspace_id = $1 AND source = $2 AND raw_stage = $3`,
      [workspaceId, source, rawStage]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Stage mapping not found' });
    }

    return res.json({ deleted: true });
  } catch (err) {
    console.error('[Import] Delete stage mapping error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete stage mapping' });
  }
});

/**
 * Get file import → Salesforce upgrade status
 * GET /import/:workspaceId/upgrade-status
 */
router.get('/:workspaceId/upgrade-status', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const { getTransitionStatus, getOrphanedDeals } = await import('../import/upgrade.js');

    const status = await getTransitionStatus(workspaceId);

    if (!status) {
      return res.json({
        hasTransitioned: false,
        orphanedDeals: [],
      });
    }

    const orphanedDeals = await getOrphanedDeals(workspaceId);

    return res.json({
      hasTransitioned: true,
      transition: status,
      orphanedDeals: orphanedDeals.map(d => ({
        id: d.id,
        externalId: d.source_id,
        name: d.name,
        stage: d.stage,
        amount: d.amount,
        owner: d.owner,
      })),
    });
  } catch (err) {
    console.error('[Import] Get upgrade status error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get upgrade status' });
  }
});

// POST /api/workspaces/:id/import/relink
// Re-link unlinked deals and contacts to accounts using improved domain-first matching
router.post('/:id/import/relink', async (req, res) => {
  try {
    const workspaceId = req.params.id;

    console.log(`[Import] Re-linking deals and contacts for workspace ${workspaceId}`);

    // Link deals to accounts
    const dealLinkResult = await linkDealsToAccounts(workspaceId);

    console.log(
      `[Import] Deal linking complete: ${dealLinkResult.linked} linked, ` +
      `${dealLinkResult.unlinked} unlinked`
    );
    console.log(`[Import] Deal link tiers:`, dealLinkResult.byTier);

    // Link contacts to accounts
    const contactLinkResult = await linkContactsToAccounts(workspaceId);

    console.log(
      `[Import] Contact linking complete: ${contactLinkResult.linked} linked, ` +
      `${contactLinkResult.unlinked} unlinked`
    );
    console.log(`[Import] Contact link tiers:`, contactLinkResult.byTier);

    return res.json({
      deals: {
        linked: dealLinkResult.linked,
        unlinked: dealLinkResult.unlinked,
        byTier: dealLinkResult.byTier
      },
      contacts: {
        linked: contactLinkResult.linked,
        unlinked: contactLinkResult.unlinked,
        byTier: contactLinkResult.byTier
      }
    });
  } catch (err) {
    console.error('[Import] Re-link error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Re-link failed' });
  }
});

export default router;
