import * as XLSX from 'xlsx';
import { parseImportFile } from '../server/import/file-parser.js';
import {
  parseAmount,
  parseDate,
  parsePercentage,
  normalizeText,
  normalizeCompanyName,
} from '../server/import/value-parsers.js';

let passed = 0;
let failed = 0;

function assert(label: string, actual: any, expected: any) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

console.log('\n=== FILE PARSER TESTS ===\n');

console.log('--- CSV parsing ---');
{
  const csv = 'Deal Name,Amount,Stage,Close Date,Owner\nAcme Corp,$50000,Discovery,2026-03-15,Jane Smith\nBeta Inc,$75000,Proposal,2026-04-01,John Doe';
  const buf = Buffer.from(csv, 'utf-8');
  const result = parseImportFile(buf, 'deals.csv');

  assert('CSV headers count', result.headers.length, 5);
  assert('CSV header[0]', result.headers[0], 'Deal Name');
  assert('CSV header[1]', result.headers[1], 'Amount');
  assert('CSV totalRows', result.totalRows, 2);
  assert('CSV sampleRows count', result.sampleRows.length, 2);
  assert('CSV sampleRows[0][0]', result.sampleRows[0][0], 'Acme Corp');
  assert('CSV fileType', result.fileType, 'csv');
  assert('CSV delimiter', result.detectedDelimiter, ',');
  assert('CSV dateFormat', result.detectedDateFormat, 'YYYY-MM-DD');
}

console.log('\n--- CSV with semicolons ---');
{
  const csv = 'Name;Amount;Date\nTest;1234;2026-01-01';
  const buf = Buffer.from(csv, 'utf-8');
  const result = parseImportFile(buf, 'data.csv');
  assert('Semicolon delimiter', result.detectedDelimiter, ';');
  assert('Semicolon headers', result.headers.length, 3);
}

console.log('\n--- CSV with title row ---');
{
  const csv = 'HubSpot Deal Export - Feb 2026\nDeal Name,Amount,Stage,Close Date,Owner\nAcme,$50000,Discovery,2026-03-15,Jane';
  const buf = Buffer.from(csv, 'utf-8');
  const result = parseImportFile(buf, 'export.csv');
  assert('Title row skipped, header[0]', result.headers[0], 'Deal Name');
  assert('Title row skipped, totalRows', result.totalRows, 1);
}

console.log('\n--- CSV with leading empty rows ---');
{
  const csv = '\n\n\nDeal Name,Amount,Stage\nAcme,$50000,Discovery';
  const buf = Buffer.from(csv, 'utf-8');
  const result = parseImportFile(buf, 'export.csv');
  assert('Empty rows skipped, header[0]', result.headers[0], 'Deal Name');
  assert('Empty rows skipped, totalRows', result.totalRows, 1);
}

console.log('\n--- CSV with named month dates ---');
{
  const csv = 'Deal Name,Amount,Close Date\nAcme,$50000,"Jan 15, 2026"\nBeta,$75000,"March 1, 2026"';
  const buf = Buffer.from(csv, 'utf-8');
  const result = parseImportFile(buf, 'deals.csv');
  assert('Named month dateFormat (SheetJS auto-converts to Date obj)', result.detectedDateFormat, 'YYYY-MM-DD');
}

console.log('\n--- XLSX generation and parsing ---');
{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Revenue', 'Created'],
    ['Alpha Corp', 100000, '2026-02-01'],
    ['Beta LLC', 250000, '2026-03-15'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Deals');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Other']]), 'Sheet2');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const result = parseImportFile(Buffer.from(xlsxBuf), 'deals.xlsx');
  assert('XLSX headers count', result.headers.length, 3);
  assert('XLSX header[0]', result.headers[0], 'Name');
  assert('XLSX totalRows', result.totalRows, 2);
  assert('XLSX fileType', result.fileType, 'xlsx');
  assert('XLSX sheetNames count', result.sheetNames.length, 2);
  assert('XLSX selectedSheet', result.selectedSheet, 'Deals');
}

console.log('\n=== VALUE PARSER TESTS ===\n');

console.log('--- parseAmount ---');
assert('parseAmount("$1,234.56")', parseAmount('$1,234.56'), 1234.56);
assert('parseAmount("1234.56")', parseAmount('1234.56'), 1234.56);
assert('parseAmount("1,234")', parseAmount('1,234'), 1234);
assert('parseAmount("$1.2M")', parseAmount('$1.2M'), 1200000);
assert('parseAmount("$500K")', parseAmount('$500K'), 500000);
assert('parseAmount("1234")', parseAmount('1234'), 1234);
assert('parseAmount(1234)', parseAmount(1234), 1234);
assert('parseAmount("2.5B")', parseAmount('2.5B'), 2500000000);
assert('parseAmount("abc")', parseAmount('abc'), null);
assert('parseAmount("")', parseAmount(''), null);
assert('parseAmount(null)', parseAmount(null), null);
assert('parseAmount(0)', parseAmount(0), 0);

console.log('\n--- parseDate ---');
assert('parseDate("2026-01-15")', parseDate('2026-01-15'), '2026-01-15');
assert('parseDate("01/15/2026", "MM/DD/YYYY")', parseDate('01/15/2026', 'MM/DD/YYYY'), '2026-01-15');
assert('parseDate("15/01/2026", "DD/MM/YYYY")', parseDate('15/01/2026', 'DD/MM/YYYY'), '2026-01-15');
assert('parseDate("Jan 15, 2026")', parseDate('Jan 15, 2026'), '2026-01-15');
assert('parseDate("March 1, 2026")', parseDate('March 1, 2026'), '2026-03-01');
assert('parseDate("")', parseDate(''), null);
assert('parseDate(null)', parseDate(null), null);
{
  const serial = 46037;
  const result = parseDate(serial);
  assert('parseDate(excel serial 46037)', result, '2026-01-15');
}

console.log('\n--- parsePercentage ---');
assert('parsePercentage("75%")', parsePercentage('75%'), 0.75);
assert('parsePercentage("0.75")', parsePercentage('0.75'), 0.75);
assert('parsePercentage(0.75)', parsePercentage(0.75), 0.75);
assert('parsePercentage("100%")', parsePercentage('100%'), 1);
assert('parsePercentage("")', parsePercentage(''), null);

console.log('\n--- normalizeText ---');
assert('normalizeText("  hello  world  ")', normalizeText('  hello  world  '), 'hello world');
assert('normalizeText("N/A")', normalizeText('N/A'), null);
assert('normalizeText("n/a")', normalizeText('n/a'), null);
assert('normalizeText("-")', normalizeText('-'), null);
assert('normalizeText("--")', normalizeText('--'), null);
assert('normalizeText("")', normalizeText(''), null);
assert('normalizeText(null)', normalizeText(null), null);
assert('normalizeText("Valid Text")', normalizeText('Valid Text'), 'Valid Text');

console.log('\n--- normalizeCompanyName ---');
assert('normalizeCompanyName("Acme Corp, Inc.")', normalizeCompanyName('Acme Corp, Inc.'), 'acme');
assert('normalizeCompanyName("Global Tech Solutions LLC")', normalizeCompanyName('Global Tech Solutions LLC'), 'global');
assert('normalizeCompanyName("Hopebridge")', normalizeCompanyName('Hopebridge'), 'hopebridge');
assert('normalizeCompanyName("Microsoft Corporation")', normalizeCompanyName('Microsoft Corporation'), 'microsoft');
assert('normalizeCompanyName("  Stripe, Inc.  ")', normalizeCompanyName('  Stripe, Inc.  '), 'stripe');

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
