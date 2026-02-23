/**
 * CSV Enrichment Routes
 *
 * API endpoints for CSV/Excel enrichment imports.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { createLogger } from '../utils/logger.js';
import { parseFile, validateIdentifierColumns } from '../enrichment/csv-parser.js';
import { suggestMappings, validateMapping, type ColumnMapping } from '../enrichment/csv-mapper.js';
import { processCSVImport, getImportHistory, getUnmatchedRecords } from '../enrichment/csv-import.js';
import { query } from '../db.js';

const router = Router();
const logger = createLogger('CSV Routes');

// Configure multer for file upload (in-memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
  },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
      cb(null, true);
    } else {
      cb(new Error('Only .csv, .xlsx, and .xls files are allowed'));
    }
  },
});

interface WorkspaceParams {
  workspaceId: string;
}

interface ImportParams {
  workspaceId: string;
  importId: string;
}

// ============================================================================
// CSV Upload & Preview
// ============================================================================

/**
 * Upload CSV/Excel file and get column mapping suggestions.
 * Does not process import - just parses and suggests mappings.
 */
router.post(
  '/:workspaceId/enrichment/csv/upload',
  upload.single('file'),
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // Check workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Parse file
      const parsed = await parseFile(req.file.buffer, req.file.originalname);

      if ('error' in parsed) {
        res.status(400).json({
          error: parsed.error,
          details: parsed.details,
        });
        return;
      }

      // Validate identifier columns
      const hasIdentifiers = validateIdentifierColumns(parsed.headers);
      if (!hasIdentifiers) {
        res.status(400).json({
          error: 'Missing required identifier columns',
          details: 'File must have at least one column for domain or company_name',
        });
        return;
      }

      // Suggest column mappings
      const suggestions = suggestMappings(parsed.headers);

      logger.info('CSV file uploaded and parsed', {
        workspace_id: workspaceId,
        filename: req.file.originalname,
        rows: parsed.row_count,
        headers: parsed.headers.length,
        suggested_mappings: suggestions.mappings.length,
      });

      // Return preview data (first 5 rows) and suggested mappings
      res.json({
        file_info: parsed.file_info,
        headers: parsed.headers,
        row_count: parsed.row_count,
        preview_rows: parsed.rows.slice(0, 5),
        suggested_mappings: suggestions.mappings,
        unmapped_columns: suggestions.unmapped_columns,
        has_required_fields: suggestions.has_required_fields,
      });
    } catch (err: any) {
      logger.error('CSV upload error', {
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// CSV Import Processing
// ============================================================================

/**
 * Process CSV import with user-confirmed column mappings.
 */
router.post(
  '/:workspaceId/enrichment/csv/import',
  upload.single('file'),
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // Parse column mappings from request body
      let mappings: ColumnMapping[];
      try {
        mappings = JSON.parse(req.body.mappings);
      } catch {
        res.status(400).json({ error: 'Invalid mappings JSON' });
        return;
      }

      // Check workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Parse file
      const parsed = await parseFile(req.file.buffer, req.file.originalname);

      if ('error' in parsed) {
        res.status(400).json({
          error: parsed.error,
          details: parsed.details,
        });
        return;
      }

      // Validate mappings
      const validation = validateMapping(mappings, parsed.headers);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid column mappings',
          details: validation.errors,
        });
        return;
      }

      logger.info('Starting CSV import', {
        workspace_id: workspaceId,
        filename: req.file.originalname,
        rows: parsed.row_count,
        mappings: mappings.length,
      });

      // Process import
      const result = await processCSVImport(workspaceId, parsed.rows, mappings, {
        filename: req.file.originalname,
        size: req.file.size,
      });

      if (result.success) {
        res.json({
          success: true,
          import_id: result.import_id,
          records_imported: result.records_imported,
          records_matched: result.records_matched,
          records_unmatched: result.records_unmatched,
          average_confidence: result.average_confidence,
          unmatched_count: result.unmatched_records.length,
          message: `Successfully imported ${result.records_matched} records. ${result.records_unmatched} records could not be matched.`,
        });
      } else {
        res.status(400).json({
          success: false,
          import_id: result.import_id,
          error: 'Import failed',
          details: result.errors,
        });
      }
    } catch (err: any) {
      logger.error('CSV import error', {
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// Import History & Unmatched Records
// ============================================================================

/**
 * Get CSV import history for a workspace.
 */
router.get('/:workspaceId/enrichment/csv/imports', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const history = await getImportHistory(workspaceId, limit);

    res.json({ imports: history });
  } catch (err: any) {
    logger.error('Failed to get import history', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get unmatched records from a specific import.
 */
router.get(
  '/:workspaceId/enrichment/csv/imports/:importId/unmatched',
  async (req: Request<ImportParams>, res: Response) => {
    try {
      const { workspaceId, importId } = req.params;

      const unmatchedRecords = await getUnmatchedRecords(workspaceId, importId);

      res.json({
        import_id: importId,
        unmatched_count: unmatchedRecords.length,
        unmatched_records: unmatchedRecords,
      });
    } catch (err: any) {
      logger.error('Failed to get unmatched records', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Download unmatched records as CSV.
 */
router.get(
  '/:workspaceId/enrichment/csv/imports/:importId/unmatched/download',
  async (req: Request<ImportParams>, res: Response) => {
    try {
      const { workspaceId, importId } = req.params;

      const unmatchedRecords = await getUnmatchedRecords(workspaceId, importId);

      if (unmatchedRecords.length === 0) {
        res.status(404).json({ error: 'No unmatched records found' });
        return;
      }

      // Build CSV content
      const headers = ['Row Index', 'Error', ...Object.keys(unmatchedRecords[0].data || {})];
      const rows = unmatchedRecords.map(record => {
        const row = [record.row_index, record.error];
        for (const key of Object.keys(unmatchedRecords[0].data || {})) {
          row.push(record.data[key] || '');
        }
        return row;
      });

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="unmatched-records-${importId}.csv"`);
      res.send(csvContent);
    } catch (err: any) {
      logger.error('Failed to download unmatched records', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
