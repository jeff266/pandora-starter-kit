/**
 * Quota Upload Parser
 *
 * Handles Excel/CSV file parsing and AI-powered column classification for quota uploads.
 */

import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { callLLM } from '../utils/llm-router.js';
import { query } from '../db.js';

export interface ParsedQuotaFile {
  headers: string[];
  sampleRows: any[][];
  sheetNames: string[];
  totalRows: number;
  hasHeaderRow: boolean;
}

export interface ColumnMapping {
  column_index: number | null;
  column_header: string | null;
  confidence: number;
}

export interface QuotaClassification {
  mapping: {
    rep_name: ColumnMapping;
    rep_email: ColumnMapping;
    quota_amount: ColumnMapping;
    period: ColumnMapping;
  };
  inferred_period: string | null;
  period_type: 'monthly' | 'quarterly' | 'annual';
  period_start: string;
  period_end: string;
  currency: string;
  has_header_row: boolean;
  annual_needs_split: boolean;
  total_reps_found: number;
  total_quota_amount: number;
  notes: string;
}

export interface QuotaPreview {
  reps: Array<{
    name: string;
    email: string | null;
    quota: number;
  }>;
  period: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  teamTotal: number;
  repCount: number;
  currency: string;
}

export interface QuotaUploadPreview {
  preview: QuotaPreview;
  classification: QuotaClassification;
  warnings: string[];
  uploadId: string;
}

export interface ApplyQuotasResult {
  inserted: number;
  updated: number;
  skipped: number;
  batchId: string;
  periodId: string;
}

/**
 * Parse Excel/CSV file and extract headers + sample rows
 */
export function parseQuotaFile(buffer: Buffer, filename: string): ParsedQuotaFile {
  const ext = filename.toLowerCase().match(/\.(xlsx|xls|csv)$/)?.[1];

  if (!ext) {
    throw new Error('Unsupported file type. Please upload .xlsx, .xls, or .csv files.');
  }

  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    throw new Error('Failed to parse file. File may be corrupted or in an unsupported format.');
  }

  if (workbook.SheetNames.length === 0) {
    throw new Error('File contains no sheets.');
  }

  // Use first sheet by default
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON with raw row arrays
  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length === 0) {
    throw new Error('Sheet is empty.');
  }

  // Detect if first row is a header
  const firstRow = rawData[0];
  const secondRow = rawData[1];

  // Simple heuristic: if first row has mostly strings and second row has numbers, assume header
  const hasHeaderRow = firstRow.every((cell: any) => typeof cell === 'string') &&
                       secondRow && secondRow.some((cell: any) => typeof cell === 'number');

  const headers = hasHeaderRow ? firstRow.map((h: any) => String(h).trim()) :
                                 firstRow.map((_, i) => `Column ${i + 1}`);

  const dataRows = hasHeaderRow ? rawData.slice(1) : rawData;
  const sampleRows = dataRows.slice(0, 8);

  return {
    headers,
    sampleRows,
    sheetNames: workbook.SheetNames,
    totalRows: dataRows.length,
    hasHeaderRow,
  };
}

/**
 * Use DeepSeek to classify columns and infer period/format
 */
export async function classifyColumns(
  headers: string[],
  sampleRows: any[][],
  workspaceId: string
): Promise<QuotaClassification> {
  // Format sample data as table for LLM
  const tableRows = sampleRows.map(row =>
    headers.map((h, i) => `${h}: ${row[i] ?? ''}`).join(' | ')
  ).join('\n');

  const prompt = `You are analyzing a spreadsheet to extract sales quota data.

Column headers: ${JSON.stringify(headers)}

Sample data (first ${sampleRows.length} rows):
${tableRows}

Identify which columns contain:
1. rep_name: The sales rep's full name
2. rep_email: The sales rep's email address (may not exist)
3. quota_amount: The quota/target dollar amount
4. period: The time period (Q1 2026, January, FY2026, etc.) — may not exist if all rows are same period
5. period_type: Infer whether quotas are 'monthly', 'quarterly', or 'annual'

Also determine:
- currency_format: Are amounts in dollars, euros, etc? Are they formatted with $, commas, etc?
- has_header_row: Is row 1 a header or data?
- single_period: If all rows share the same period, what is it?
- annual_needs_split: If quotas are annual but the system needs quarterly, note this

Respond with ONLY a JSON object:
{
  "mapping": {
    "rep_name": { "column_index": 0, "column_header": "Rep Name", "confidence": 0.95 },
    "rep_email": { "column_index": 1, "column_header": "Email", "confidence": 0.90 },
    "quota_amount": { "column_index": 3, "column_header": "Q1 Target", "confidence": 0.85 },
    "period": { "column_index": null, "column_header": null, "confidence": 0 }
  },
  "inferred_period": "Q1 2026",
  "period_type": "quarterly",
  "period_start": "2026-01-01",
  "period_end": "2026-03-31",
  "currency": "USD",
  "has_header_row": true,
  "annual_needs_split": false,
  "total_reps_found": 4,
  "total_quota_amount": 4200000,
  "notes": "All rows appear to be Q1 2026 quarterly quotas. No email column found."
}`;

  const response = await callLLM(workspaceId, 'classify', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4096,
    temperature: 0.1,
  });

  try {
    const classification = JSON.parse(response.content);
    return classification as QuotaClassification;
  } catch (error) {
    throw new Error('Failed to parse AI classification response. Please try again or specify columns manually.');
  }
}

/**
 * Build human-readable preview from parsed file + AI classification
 */
export function buildPreview(
  parsed: ParsedQuotaFile,
  classification: QuotaClassification
): QuotaUploadPreview {
  const warnings: string[] = [];
  const uploadId = uuidv4();

  const { mapping } = classification;
  const dataRows = parsed.sampleRows; // In production, use all rows, not just samples

  // Extract data using column mapping
  const reps: Array<{ name: string; email: string | null; quota: number }> = [];
  let teamTotal = 0;
  let skippedRows = 0;

  for (const row of dataRows) {
    const name = mapping.rep_name.column_index !== null
      ? String(row[mapping.rep_name.column_index] ?? '').trim()
      : '';

    const email = mapping.rep_email.column_index !== null
      ? String(row[mapping.rep_email.column_index] ?? '').trim() || null
      : null;

    const quotaRaw = mapping.quota_amount.column_index !== null
      ? row[mapping.quota_amount.column_index]
      : null;

    // Parse quota amount (handle $, commas, etc.)
    let quota = 0;
    if (quotaRaw !== null && quotaRaw !== undefined && quotaRaw !== '') {
      const quotaStr = String(quotaRaw).replace(/[$,]/g, '').trim();
      quota = parseFloat(quotaStr);

      if (isNaN(quota)) {
        skippedRows++;
        continue;
      }
    } else {
      skippedRows++;
      continue;
    }

    if (!name) {
      skippedRows++;
      continue;
    }

    reps.push({ name, email, quota });
    teamTotal += quota;
  }

  if (skippedRows > 0) {
    warnings.push(`${skippedRows} rows skipped due to missing or invalid data`);
  }

  if (!mapping.rep_email.column_index) {
    warnings.push('No email column found — quotas will be matched by name only (less reliable)');
  }

  if (classification.annual_needs_split) {
    warnings.push('Annual quotas detected — will be split into 4 equal quarterly quotas');
  }

  if (classification.currency !== 'USD') {
    warnings.push(`Currency detected as ${classification.currency} — ensure amounts are in correct currency`);
  }

  return {
    preview: {
      reps,
      period: classification.inferred_period || `${classification.period_type} period`,
      periodType: classification.period_type,
      periodStart: classification.period_start,
      periodEnd: classification.period_end,
      teamTotal,
      repCount: reps.length,
      currency: classification.currency,
    },
    classification,
    warnings,
    uploadId,
  };
}

/**
 * Apply confirmed quotas to database
 */
export async function applyQuotas(
  workspaceId: string,
  preview: QuotaUploadPreview,
  options?: {
    overrides?: Partial<QuotaPreview>;
    periodId?: string;
  }
): Promise<ApplyQuotasResult> {
  const batchId = uuidv4();
  const { preview: previewData, classification } = preview;

  // Apply any overrides
  const finalPreview = options?.overrides
    ? { ...previewData, ...options.overrides }
    : previewData;

  // Get or create period
  let periodId = options?.periodId;

  if (!periodId) {
    // Check if period already exists
    const existingPeriod = await query<{ id: string }>(
      `SELECT id FROM quota_periods
       WHERE workspace_id = $1
         AND start_date = $2
         AND end_date = $3
         AND period_type = $4
       LIMIT 1`,
      [workspaceId, finalPreview.periodStart, finalPreview.periodEnd, finalPreview.periodType]
    );

    if (existingPeriod.rows.length > 0) {
      periodId = existingPeriod.rows[0].id;
    } else {
      // Create new period
      const newPeriod = await query<{ id: string }>(
        `INSERT INTO quota_periods (workspace_id, name, period_type, start_date, end_date, team_quota)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          workspaceId,
          finalPreview.period,
          finalPreview.periodType,
          finalPreview.periodStart,
          finalPreview.periodEnd,
          finalPreview.teamTotal,
        ]
      );
      periodId = newPeriod.rows[0].id;
    }
  }

  // Match reps to existing deal owners and insert quotas
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const rep of finalPreview.reps) {
    // Try to match rep to existing deals
    const matchResult = await query<{ matched_email: string | null; matched_name: string }>(
      `SELECT matched_email, matched_name FROM match_rep_to_deals($1, $2, $3)`,
      [workspaceId, rep.email, rep.name]
    );

    const matchedEmail = matchResult.rows[0]?.matched_email || rep.email;
    const matchedName = matchResult.rows[0]?.matched_name || rep.name;

    try {
      // Upsert quota
      const result = await query(
        `INSERT INTO rep_quotas (period_id, rep_name, rep_email, quota_amount, source, upload_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (period_id, rep_email) WHERE rep_email IS NOT NULL
         DO UPDATE SET
           quota_amount = EXCLUDED.quota_amount,
           rep_name = EXCLUDED.rep_name,
           source = EXCLUDED.source,
           upload_batch_id = EXCLUDED.upload_batch_id,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [
          periodId,
          matchedName,
          matchedEmail,
          rep.quota,
          classification.has_header_row ? 'excel_upload' : 'csv_upload',
          batchId,
        ]
      );

      if (result.rows[0].inserted) {
        inserted++;
      } else {
        updated++;
      }
    } catch (error) {
      console.error(`[QuotaUpload] Failed to upsert quota for ${rep.name}:`, error);
      skipped++;
    }
  }

  return {
    inserted,
    updated,
    skipped,
    batchId,
    periodId,
  };
}
