/**
 * CSV and Excel File Parser
 *
 * Parses CSV and Excel files into structured data for enrichment import.
 * Supports .csv, .xlsx, and .xls formats.
 */

import { createLogger } from '../utils/logger.js';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';

const logger = createLogger('CSV Parser');

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_ROWS = 10000;

export interface ParsedData {
  headers: string[];
  rows: Record<string, any>[];
  row_count: number;
  file_info: {
    filename: string;
    size: number;
    format: 'csv' | 'xlsx' | 'xls';
  };
}

export interface ParseError {
  error: string;
  details?: string;
}

/**
 * Parse CSV or Excel file to structured data.
 */
export async function parseFile(
  buffer: Buffer,
  filename: string
): Promise<ParsedData | ParseError> {
  try {
    // Check file size
    if (buffer.length > MAX_FILE_SIZE) {
      return {
        error: 'File too large',
        details: `Maximum file size is 25MB. Your file is ${(buffer.length / 1024 / 1024).toFixed(2)}MB.`,
      };
    }

    // Determine file format
    const ext = filename.toLowerCase().split('.').pop();
    const format = ext === 'csv' ? 'csv' : ext === 'xlsx' || ext === 'xls' ? ext : null;

    if (!format) {
      return {
        error: 'Unsupported file format',
        details: 'Only .csv, .xlsx, and .xls files are supported.',
      };
    }

    // Parse file based on format
    let headers: string[] = [];
    let rows: Record<string, any>[] = [];

    if (format === 'csv') {
      const parsed = parseCSV(buffer);
      if ('error' in parsed) return parsed;
      headers = parsed.headers;
      rows = parsed.rows;
    } else {
      const parsed = parseExcel(buffer);
      if ('error' in parsed) return parsed;
      headers = parsed.headers;
      rows = parsed.rows;
    }

    // Validate row count
    if (rows.length === 0) {
      return {
        error: 'Empty file',
        details: 'The file contains no data rows.',
      };
    }

    if (rows.length > MAX_ROWS) {
      return {
        error: 'Too many rows',
        details: `Maximum ${MAX_ROWS} rows per upload. Your file has ${rows.length} rows. Split your file into smaller batches.`,
      };
    }

    // Validate headers
    if (headers.length === 0) {
      return {
        error: 'No headers found',
        details: 'The file must have a header row with column names.',
      };
    }

    logger.info('File parsed successfully', {
      filename,
      format,
      headers: headers.length,
      rows: rows.length,
      size: buffer.length,
    });

    return {
      headers,
      rows,
      row_count: rows.length,
      file_info: {
        filename,
        size: buffer.length,
        format: format as 'csv' | 'xlsx' | 'xls',
      },
    };
  } catch (error) {
    logger.error('File parsing error', {
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: 'Failed to parse file',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Parse CSV file.
 */
function parseCSV(buffer: Buffer): { headers: string[]; rows: Record<string, any>[] } | ParseError {
  try {
    // Try UTF-8 first
    let content = buffer.toString('utf-8');

    // Check for BOM and remove it
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.substring(1);
    }

    // Try parsing as UTF-8
    let records: any[];
    try {
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      });
    } catch {
      // If UTF-8 fails, try Latin-1
      content = buffer.toString('latin1');
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      });
    }

    if (records.length === 0) {
      return { error: 'Empty CSV file', details: 'No data rows found.' };
    }

    const headers = Object.keys(records[0]);
    return { headers, rows: records };
  } catch (error) {
    logger.error('CSV parsing error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: 'Failed to parse CSV',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Parse Excel file (.xlsx or .xls).
 */
function parseExcel(buffer: Buffer): { headers: string[]; rows: Record<string, any>[] } | ParseError {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Get first sheet
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { error: 'Empty Excel file', details: 'No worksheets found.' };
    }

    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with header row
    const records: any[] = XLSX.utils.sheet_to_json(worksheet, {
      raw: false, // Convert all values to strings
      defval: '', // Default value for empty cells
    });

    if (records.length === 0) {
      return { error: 'Empty Excel file', details: 'No data rows found in first worksheet.' };
    }

    const headers = Object.keys(records[0]);
    return { headers, rows: records };
  } catch (error) {
    logger.error('Excel parsing error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: 'Failed to parse Excel',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate that at least one identifier column is present.
 */
export function validateIdentifierColumns(headers: string[]): boolean {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  // Check for domain variations
  const domainVariations = ['domain', 'website', 'company url', 'web address', 'url'];
  const hasDomain = domainVariations.some(variant =>
    normalizedHeaders.some(h => h.includes(variant))
  );

  // Check for company name variations
  const nameVariations = ['company', 'company name', 'account name', 'organization', 'name'];
  const hasCompanyName = nameVariations.some(variant =>
    normalizedHeaders.some(h => h.includes(variant))
  );

  return hasDomain || hasCompanyName;
}
