/**
 * CSV Import Processor
 *
 * Processes CSV/Excel imports, matches records to CRM accounts,
 * calculates confidence scores, and saves to enriched_accounts table.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { normalizeWebhookRecord } from './webhook-normalizer.js';
import { calculateConfidenceScore } from './confidence-scorer.js';
import { matchEnrichedAccount } from './account-matcher.js';
import type { ColumnMapping } from './csv-mapper.js';
import { applyMapping } from './csv-mapper.js';

const logger = createLogger('CSV Import');

export interface ImportResult {
  import_id: string;
  success: boolean;
  records_imported: number;
  records_matched: number;
  records_unmatched: number;
  average_confidence: number;
  unmatched_records: Array<{
    row_index: number;
    data: Record<string, any>;
    error: string;
  }>;
  errors: string[];
}

/**
 * Process CSV import with column mappings.
 */
export async function processCSVImport(
  workspaceId: string,
  rows: Record<string, any>[],
  mappings: ColumnMapping[],
  fileInfo: { filename: string; size: number }
): Promise<ImportResult> {
  const result: ImportResult = {
    import_id: '',
    success: false,
    records_imported: 0,
    records_matched: 0,
    records_unmatched: 0,
    average_confidence: 0,
    unmatched_records: [],
    errors: [],
  };

  try {
    // Create import record
    const importRecord = await createImportRecord(workspaceId, fileInfo.filename, fileInfo.size, rows.length, mappings);
    result.import_id = importRecord.id;

    // Update status to processing
    await updateImportStatus(importRecord.id, 'processing');

    const confidenceScores: number[] = [];

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        // Apply column mapping
        const mappedData = applyMapping(row, mappings);

        // Normalize data using webhook normalizer (handles flexible formats)
        const { data, errors: normErrors } = normalizeWebhookRecord(mappedData);

        if (normErrors.length > 0) {
          result.records_unmatched++;
          result.unmatched_records.push({
            row_index: i + 1,
            data: mappedData,
            error: normErrors.join('; '),
          });
          continue;
        }

        // Match to CRM account
        const match = await matchEnrichedAccount(workspaceId, data.domain ?? null, data.company_name ?? null);

        if (match.match_type === 'none' || !match.crm_account_id) {
          result.records_unmatched++;
          result.unmatched_records.push({
            row_index: i + 1,
            data: mappedData,
            error: 'No matching CRM account found',
          });
          continue;
        }

        // Calculate confidence score
        const confidenceScore = calculateConfidenceScore(data);

        // Save enriched account
        await saveEnrichedAccount(workspaceId, match.crm_account_id, data, confidenceScore, importRecord.id);

        result.records_matched++;
        result.records_imported++;
        confidenceScores.push(confidenceScore);

        logger.debug('CSV record imported', {
          import_id: importRecord.id,
          row_index: i + 1,
          domain: data.domain,
          company_name: data.company_name,
          crm_account_id: match.crm_account_id,
          match_type: match.match_type,
          confidence: confidenceScore,
        });
      } catch (error) {
        logger.error('Failed to process CSV row', {
          import_id: importRecord.id,
          row_index: i + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        result.records_unmatched++;
        result.unmatched_records.push({
          row_index: i + 1,
          data: row,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Calculate average confidence
    if (confidenceScores.length > 0) {
      result.average_confidence =
        confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length;
    }

    // Update import record
    await finalizeImportRecord(importRecord.id, result);

    result.success = true;

    logger.info('CSV import complete', {
      import_id: importRecord.id,
      workspace_id: workspaceId,
      total_rows: rows.length,
      imported: result.records_imported,
      matched: result.records_matched,
      unmatched: result.records_unmatched,
      average_confidence: result.average_confidence.toFixed(2),
    });

    return result;
  } catch (error) {
    logger.error('CSV import failed', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (result.import_id) {
      await updateImportStatus(result.import_id, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }

    result.success = false;
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}

/**
 * Create import record in database.
 */
async function createImportRecord(
  workspaceId: string,
  filename: string,
  fileSize: number,
  rowCount: number,
  mappings: ColumnMapping[]
): Promise<{ id: string }> {
  const result = await query<{ id: string }>(
    `INSERT INTO csv_imports (workspace_id, filename, file_size, row_count, column_mappings, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id`,
    [workspaceId, filename, fileSize, rowCount, JSON.stringify(mappings)]
  );

  return result.rows[0];
}

/**
 * Update import status.
 */
async function updateImportStatus(
  importId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE csv_imports
     SET status = $1,
         error_message = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [status, errorMessage || null, importId]
  );
}

/**
 * Finalize import record with results.
 */
async function finalizeImportRecord(importId: string, result: ImportResult): Promise<void> {
  await query(
    `UPDATE csv_imports
     SET status = 'completed',
         records_imported = $1,
         records_matched = $2,
         records_unmatched = $3,
         unmatched_records = $4,
         average_confidence = $5,
         imported_at = NOW(),
         updated_at = NOW()
     WHERE id = $6`,
    [
      result.records_imported,
      result.records_matched,
      result.records_unmatched,
      JSON.stringify(result.unmatched_records),
      result.average_confidence,
      importId,
    ]
  );
}

/**
 * Save enriched account to database.
 */
async function saveEnrichedAccount(
  workspaceId: string,
  crmAccountId: string,
  data: any,
  confidenceScore: number,
  importId: string
): Promise<void> {
  try {
    // Check if record already exists from this import
    const existing = await query(
      `SELECT id FROM enriched_accounts
       WHERE workspace_id = $1
         AND crm_account_id = $2
         AND enrichment_source = 'csv'
         AND pandora_batch_id = $3`,
      [workspaceId, crmAccountId, importId]
    );

    if (existing.rows.length > 0) {
      // Update existing record
      await query(
        `UPDATE enriched_accounts
         SET domain = $1,
             company_name = $2,
             industry = $3,
             employee_count = $4,
             employee_range = $5,
             revenue_range = $6,
             funding_stage = $7,
             hq_country = $8,
             hq_state = $9,
             hq_city = $10,
             tech_stack = $11,
             growth_signal = $12,
             founded_year = $13,
             public_or_private = $14,
             confidence_score = $15,
             enriched_at = NOW(),
             updated_at = NOW()
         WHERE id = $16`,
        [
          data.domain,
          data.company_name,
          data.industry,
          data.employee_count,
          data.employee_range,
          data.revenue_range,
          data.funding_stage,
          data.hq_country,
          data.hq_state,
          data.hq_city,
          data.tech_stack,
          data.growth_signal,
          data.founded_year,
          data.public_or_private,
          confidenceScore,
          existing.rows[0].id,
        ]
      );
    } else {
      // Insert new record
      await query(
        `INSERT INTO enriched_accounts (
           workspace_id,
           crm_account_id,
           domain,
           company_name,
           industry,
           employee_count,
           employee_range,
           revenue_range,
           funding_stage,
           hq_country,
           hq_state,
           hq_city,
           tech_stack,
           growth_signal,
           founded_year,
           public_or_private,
           enrichment_source,
           confidence_score,
           pandora_batch_id,
           enriched_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'csv', $17, $18, NOW())`,
        [
          workspaceId,
          crmAccountId,
          data.domain,
          data.company_name,
          data.industry,
          data.employee_count,
          data.employee_range,
          data.revenue_range,
          data.funding_stage,
          data.hq_country,
          data.hq_state,
          data.hq_city,
          data.tech_stack,
          data.growth_signal,
          data.founded_year,
          data.public_or_private,
          confidenceScore,
          importId,
        ]
      );
    }
  } catch (error) {
    logger.error('Failed to save enriched account', {
      crm_account_id: crmAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get import history for a workspace.
 */
export async function getImportHistory(workspaceId: string, limit: number = 50): Promise<any[]> {
  try {
    const result = await query(
      `SELECT id, filename, file_size, row_count, records_imported, records_matched, records_unmatched,
              average_confidence, status, imported_at, created_at
       FROM csv_imports
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit]
    );

    return result.rows;
  } catch (error) {
    logger.error('Failed to get import history', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get unmatched records from an import.
 */
export async function getUnmatchedRecords(workspaceId: string, importId: string): Promise<any[]> {
  try {
    const result = await query(
      `SELECT unmatched_records
       FROM csv_imports
       WHERE id = $1
         AND workspace_id = $2`,
      [importId, workspaceId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    const unmatchedRecords = result.rows[0].unmatched_records;
    return typeof unmatchedRecords === 'string' ? JSON.parse(unmatchedRecords) : unmatchedRecords || [];
  } catch (error) {
    logger.error('Failed to get unmatched records', {
      workspace_id: workspaceId,
      import_id: importId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
