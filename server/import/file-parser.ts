import * as XLSX from 'xlsx';
import chardet from 'chardet';

export interface ParseResult {
  headers: string[];
  sampleRows: any[][];
  sheetNames: string[];
  selectedSheet: string;
  totalRows: number;
  detectedDateFormat: string | null;
  detectedDelimiter: string | null;
  fileType: 'csv' | 'xlsx' | 'xls';
  detectedEncoding: string | null;
  encodingConverted: boolean;
}

/**
 * Strip UTF-8 BOM if present
 */
function stripBOM(buffer: Buffer): Buffer {
  if (buffer.length >= 3 &&
      buffer[0] === 0xEF &&
      buffer[1] === 0xBB &&
      buffer[2] === 0xBF) {
    return buffer.subarray(3);
  }
  return buffer;
}

/**
 * Detect and normalize file encoding to UTF-8.
 * SheetJS handles Excel files (.xlsx/.xls) internally — this is for CSV only.
 */
function normalizeEncoding(buffer: Buffer, fileType: string): { buffer: Buffer; detected: string | null; converted: boolean } {
  // Excel files handle encoding internally via SheetJS
  if (fileType !== 'csv') {
    return { buffer, detected: null, converted: false };
  }

  // Detect encoding
  const detected = chardet.detect(buffer);

  // Common CRM export encodings that need conversion
  const needsConversion = [
    'ISO-8859-1',
    'windows-1252',
    'windows-1250',
    'ISO-8859-15',    // Western European with Euro sign
    'ISO-8859-2',     // Central European
  ];

  if (!detected) {
    // Can't detect — try as UTF-8, fall back to ISO-8859-1
    console.warn('[File Parser] Could not detect encoding, assuming UTF-8');
    return { buffer, detected: null, converted: false };
  }

  console.log(`[File Parser] Detected encoding: ${detected}`);

  if (detected === 'UTF-8' || detected === 'ascii' || detected === 'ASCII') {
    return { buffer, detected, converted: false };  // Already UTF-8 compatible
  }

  if (needsConversion.some(enc => detected.toLowerCase() === enc.toLowerCase())) {
    console.log(`[File Parser] Converting from ${detected} to UTF-8`);

    // Node.js TextDecoder handles these encodings natively
    try {
      // Map chardet names to TextDecoder names
      const encodingMap: Record<string, string> = {
        'ISO-8859-1': 'iso-8859-1',
        'windows-1252': 'windows-1252',
        'windows-1250': 'windows-1250',
        'ISO-8859-15': 'iso-8859-15',
        'ISO-8859-2': 'iso-8859-2',
      };

      const decoderName = encodingMap[detected] || detected.toLowerCase();
      const decoder = new TextDecoder(decoderName);
      const text = decoder.decode(buffer);
      return { buffer: Buffer.from(text, 'utf-8'), detected, converted: true };
    } catch (err) {
      console.error(`[File Parser] Encoding conversion failed for ${detected}:`, err);
      // Return original buffer — SheetJS might handle it, or we'll get a clear error
      return { buffer, detected, converted: false };
    }
  }

  // Unknown encoding — log it but try to proceed
  console.warn(`[File Parser] Unexpected encoding: ${detected}. Trying as-is.`);
  return { buffer, detected, converted: false };
}

export function parseImportFile(
  buffer: Buffer,
  filename: string,
  sheetName?: string
): ParseResult {
  const ext = filename.toLowerCase().match(/\.(xlsx|xls|csv)$/)?.[1] as 'xlsx' | 'xls' | 'csv' | undefined;

  if (!ext) {
    throw new Error('Unsupported file type. Please upload .xlsx, .xls, or .csv files.');
  }

  const fileType = ext === 'csv' ? 'csv' : (ext === '.xlsx' ? 'xlsx' : 'xls');

  // Normalize encoding BEFORE parsing
  const { buffer: normalizedBuffer, detected: detectedEncoding, converted: encodingConverted } = normalizeEncoding(buffer, fileType);

  // Strip BOM if present
  const cleanBuffer = stripBOM(normalizedBuffer);

  let detectedDelimiter: string | null = null;

  if (ext === 'csv') {
    detectedDelimiter = detectCsvDelimiter(cleanBuffer);
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(cleanBuffer, {
      type: 'buffer',
      cellDates: true,
      codepage: 65001,     // Force UTF-8 interpretation for CSV
      ...(ext === 'csv' && detectedDelimiter === ';' ? { FS: ';' } : {}),
      ...(ext === 'csv' && detectedDelimiter === '\t' ? { FS: '\t' } : {}),
    });
  } catch (error) {
    throw new Error('Failed to parse file. File may be corrupted or in an unsupported format.');
  }

  if (workbook.SheetNames.length === 0) {
    throw new Error('File contains no sheets.');
  }

  const selectedSheetName = sheetName && workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0];

  const sheet = workbook.Sheets[selectedSheetName];

  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length === 0) {
    throw new Error('Sheet is empty.');
  }

  const headerRowIndex = findHeaderRow(rawData);
  const headers = rawData[headerRowIndex].map((h: any) => String(h).trim());
  const dataRows = rawData.slice(headerRowIndex + 1).filter(row =>
    row.some((cell: any) => cell !== '' && cell !== null && cell !== undefined)
  );

  const sampleRows = dataRows.slice(0, 10);

  const detectedDateFormat = detectDateFormat(sampleRows, headers);

  return {
    headers,
    sampleRows,
    sheetNames: workbook.SheetNames,
    selectedSheet: selectedSheetName,
    totalRows: dataRows.length,
    detectedDateFormat,
    detectedDelimiter,
    fileType: ext,
    detectedEncoding,
    encodingConverted,
  };
}

function findHeaderRow(rawData: any[][]): number {
  for (let i = 0; i < Math.min(rawData.length, 10); i++) {
    const row = rawData[i];
    const nonEmptyCells = row.filter((cell: any) =>
      cell !== '' && cell !== null && cell !== undefined
    );

    if (nonEmptyCells.length < 3) {
      continue;
    }

    const allStrings = nonEmptyCells.every((cell: any) => typeof cell === 'string');
    if (!allStrings) {
      continue;
    }

    const nextRow = rawData[i + 1];
    if (nextRow) {
      const nextNonEmpty = nextRow.filter((cell: any) =>
        cell !== '' && cell !== null && cell !== undefined
      );
      if (nextNonEmpty.length >= 3) {
        return i;
      }
    } else {
      return i;
    }
  }

  return 0;
}

function detectCsvDelimiter(buffer: Buffer): string {
  let text = buffer.toString('utf-8', 0, Math.min(buffer.length, 2000));
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const firstLine = text.split(/\r?\n/)[0] || '';

  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
  if (semicolonCount > commaCount) return ';';
  return ',';
}

function detectDateFormat(sampleRows: any[][], headers: string[]): string | null {
  const datePatterns: Record<string, RegExp> = {
    'YYYY-MM-DD': /^\d{4}-\d{2}-\d{2}$/,
    'MM/DD/YYYY': /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    'DD/MM/YYYY': /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  };

  const dateHints = ['date', 'created', 'closed', 'close', 'updated', 'modified', 'start', 'end', 'due'];
  const dateColumnIndices: number[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (dateHints.some(hint => h.includes(hint))) {
      dateColumnIndices.push(i);
    }
  }

  if (dateColumnIndices.length === 0) {
    for (let i = 0; i < headers.length; i++) {
      dateColumnIndices.push(i);
    }
  }

  for (const colIdx of dateColumnIndices) {
    for (const row of sampleRows) {
      const val = row[colIdx];
      if (val === '' || val === null || val === undefined) continue;

      if (val instanceof Date) {
        return 'YYYY-MM-DD';
      }

      if (typeof val === 'number' && val > 30000 && val < 60000) {
        return 'excel_serial';
      }

      const strVal = String(val).trim();

      if (datePatterns['YYYY-MM-DD'].test(strVal)) {
        return 'YYYY-MM-DD';
      }

      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(strVal)) {
        const parts = strVal.split('/');
        const first = parseInt(parts[0], 10);
        const second = parseInt(parts[1], 10);

        if (first > 12) return 'DD/MM/YYYY';
        if (second > 12) return 'MM/DD/YYYY';
        return 'MM/DD/YYYY';
      }

      if (/^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/.test(strVal)) {
        return 'named_month';
      }

      if (/^\d{4}-\d{2}-\d{2}T/.test(strVal)) {
        return 'ISO_datetime';
      }
    }
  }

  return null;
}
