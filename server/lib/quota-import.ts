/**
 * Quota CSV Import
 *
 * Parses quota spreadsheets and applies to business dimensions.
 * Supports two formats: rep-level (sum by dimension) and team-level (direct mapping).
 */

import { query } from '../db.js';
import { getDimensions } from './data-dictionary.js';

export interface QuotaImportResult {
  rows_parsed:      number;
  rows_applied:     number;
  rows_skipped:     number;  // dimension not found
  errors:           string[];
  dimensions_updated: string[];
}

interface RepLevelRow {
  rep_email: string;
  quota: number;
  period: string;
  dimension: string;
}

interface TeamLevelRow {
  dimension: string;
  quota: number;
  period: string;
}

function parseCSV(csvText: string): string[][] {
  const lines = csvText.trim().split('\n');
  return lines.map(line => {
    // Simple CSV parse - handle quoted fields
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function detectFormat(headers: string[]): 'rep' | 'team' | null {
  const normalized = headers.map(h => h.toLowerCase().replace(/[^a-z]/g, ''));

  const hasRepEmail = normalized.some(h => h.includes('rep') || h.includes('email'));
  const hasDimension = normalized.some(h => h.includes('dimension') || h.includes('segment'));
  const hasQuota = normalized.some(h => h.includes('quota') || h.includes('target'));

  if (hasRepEmail && hasDimension && hasQuota) {
    return 'rep';
  }
  if (hasDimension && hasQuota && !hasRepEmail) {
    return 'team';
  }
  return null;
}

function parsePeriod(periodStr: string): string {
  // Accept various formats: "Q1 2026", "2026-Q1", "Jan 2026"
  const cleaned = periodStr.trim();

  // Q1 2026 or 2026-Q1
  const qMatch = cleaned.match(/Q(\d).*(\d{4})|(\d{4}).*Q(\d)/i);
  if (qMatch) {
    const quarter = qMatch[1] || qMatch[4];
    const year = qMatch[2] || qMatch[3];
    return `Q${quarter} ${year}`;
  }

  // Month name + year
  const monthMatch = cleaned.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (monthMatch) {
    return `${monthMatch[1]} ${monthMatch[2]}`;
  }

  return cleaned;
}

function matchDimension(dimName: string, dimensions: Array<{ dimension_key: string; label: string }>): string | null {
  const normalized = dimName.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const dim of dimensions) {
    const keyMatch = dim.dimension_key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const labelMatch = dim.label.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (keyMatch === normalized || labelMatch === normalized) {
      return dim.dimension_key;
    }
    if (keyMatch.includes(normalized) || normalized.includes(keyMatch)) {
      return dim.dimension_key;
    }
    if (labelMatch.includes(normalized) || normalized.includes(labelMatch)) {
      return dim.dimension_key;
    }
  }

  return null;
}

export async function importQuotaCSV(
  workspaceId: string,
  csvText: string
): Promise<QuotaImportResult> {
  const result: QuotaImportResult = {
    rows_parsed: 0,
    rows_applied: 0,
    rows_skipped: 0,
    errors: [],
    dimensions_updated: [],
  };

  try {
    const rows = parseCSV(csvText);
    if (rows.length < 2) {
      result.errors.push('CSV must have at least a header row and one data row');
      return result;
    }

    const headers = rows[0];
    const format = detectFormat(headers);

    if (!format) {
      result.errors.push('Could not detect CSV format. Expected columns: rep_email, quota, period, dimension OR dimension, quota, period');
      return result;
    }

    const dimensions = await getDimensions(workspaceId, { confirmedOnly: false });
    const dimMap = dimensions.map(d => ({ dimension_key: d.dimension_key, label: d.label }));

    // Parse data rows
    const dataRows = rows.slice(1);
    result.rows_parsed = dataRows.length;

    if (format === 'rep') {
      // Rep-level: sum quotas by dimension
      const quotaByDimension = new Map<string, { total: number; period: string }>();

      for (const row of dataRows) {
        if (row.length < 4 || !row[1] || !row[3]) continue;

        const repQuota = parseFloat(row[1].replace(/[^0-9.-]/g, ''));
        const period = parsePeriod(row[2] || '');
        const dimName = row[3];

        if (isNaN(repQuota)) continue;

        const matchedKey = matchDimension(dimName, dimMap);
        if (!matchedKey) {
          result.rows_skipped++;
          continue;
        }

        const existing = quotaByDimension.get(matchedKey);
        if (existing) {
          existing.total += repQuota;
        } else {
          quotaByDimension.set(matchedKey, { total: repQuota, period });
        }
      }

      // Apply to dimensions
      for (const [dimensionKey, { total, period }] of quotaByDimension) {
        await query(
          `UPDATE business_dimensions
           SET quota_source = 'manual',
               quota_value = $2,
               quota_period_label = $3,
               updated_at = NOW()
           WHERE workspace_id = $1 AND dimension_key = $4`,
          [workspaceId, total, period, dimensionKey]
        );
        result.rows_applied++;
        result.dimensions_updated.push(dimensionKey);
      }
    } else {
      // Team-level: direct mapping
      for (const row of dataRows) {
        if (row.length < 3 || !row[0] || !row[1]) continue;

        const dimName = row[0];
        const quota = parseFloat(row[1].replace(/[^0-9.-]/g, ''));
        const period = parsePeriod(row[2] || '');

        if (isNaN(quota)) continue;

        const matchedKey = matchDimension(dimName, dimMap);
        if (!matchedKey) {
          result.rows_skipped++;
          continue;
        }

        await query(
          `UPDATE business_dimensions
           SET quota_source = 'manual',
               quota_value = $2,
               quota_period_label = $3,
               updated_at = NOW()
           WHERE workspace_id = $1 AND dimension_key = $4`,
          [workspaceId, quota, period, matchedKey]
        );
        result.rows_applied++;
        result.dimensions_updated.push(matchedKey);
      }
    }

    return result;
  } catch (err: any) {
    result.errors.push(`Import failed: ${err.message}`);
    return result;
  }
}
