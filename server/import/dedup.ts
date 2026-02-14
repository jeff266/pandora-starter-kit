import type { ColumnMapping } from './heuristic-mapper.js';
import type { PoolClient } from 'pg';

export type DedupStrategy = 'external_id' | 'composite' | 'none';

export interface DedupMatch {
  importRowIndex: number;
  existingRecordId: string;
  matchType: DedupStrategy;
  confidence: number;  // 0-1
}

export interface DedupResult {
  strategy: DedupStrategy;
  keyFields: string[];
  warning?: string;
}

interface TransformedRecord {
  external_id?: string;
  name?: string;
  email?: string;
  domain?: string;
  amount?: number;
  close_date?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  [key: string]: any;
}

/**
 * Determine the best dedup strategy based on available columns.
 * Called during preview generation.
 */
export function detectDedupStrategy(
  entityType: 'deal' | 'contact' | 'account',
  mapping: Record<string, any>
): DedupResult {
  // Best case: external_id mapped
  if (mapping.external_id?.columnIndex !== null && mapping.external_id?.columnIndex !== undefined) {
    return { strategy: 'external_id', keyFields: ['external_id'] };
  }

  // Fallback: composite key based on entity type
  switch (entityType) {
    case 'deal': {
      // Deal name + amount + close_date is a strong composite
      const dealFields: string[] = [];
      if (mapping.name?.columnIndex !== null && mapping.name?.columnIndex !== undefined) dealFields.push('name');
      if (mapping.amount?.columnIndex !== null && mapping.amount?.columnIndex !== undefined) dealFields.push('amount');
      if (mapping.close_date?.columnIndex !== null && mapping.close_date?.columnIndex !== undefined) dealFields.push('close_date');

      if (dealFields.length >= 2) {
        return {
          strategy: 'composite',
          keyFields: dealFields,
          warning: `No record ID column detected. Using ${dealFields.join(' + ')} for duplicate detection. Re-imports may create duplicates if deal names change.`
        };
      }
      break;
    }

    case 'contact': {
      // Email is the gold standard for contacts
      if (mapping.email?.columnIndex !== null && mapping.email?.columnIndex !== undefined) {
        return { strategy: 'composite', keyFields: ['email'] };
      }
      // Fallback: first_name + last_name + company
      const contactFields: string[] = [];
      if (mapping.first_name?.columnIndex !== null || mapping.full_name?.columnIndex !== null)
        contactFields.push('name');
      if (mapping.email?.columnIndex !== null) contactFields.push('email');

      if (contactFields.length >= 1) {
        return {
          strategy: 'composite',
          keyFields: contactFields,
          warning: 'No email or record ID column detected. Duplicate contacts may be created on re-import.'
        };
      }
      break;
    }

    case 'account': {
      // Domain is best for accounts, then name
      if (mapping.domain?.columnIndex !== null && mapping.domain?.columnIndex !== undefined) {
        return { strategy: 'composite', keyFields: ['domain'] };
      }
      if (mapping.name?.columnIndex !== null && mapping.name?.columnIndex !== undefined) {
        return {
          strategy: 'composite',
          keyFields: ['name'],
          warning: 'No domain or record ID column detected. Using company name for duplicate detection — similar names may conflict.'
        };
      }
      break;
    }
  }

  // Worst case: no dedup possible
  return {
    strategy: 'none',
    keyFields: [],
    warning: '⚠️ Cannot detect duplicates — no ID, email, or name column found. Re-importing this file will create duplicate records.'
  };
}

/**
 * Find existing records that match the import data.
 * Called during preview to show dedup count, and during apply to skip/update.
 */
export async function findDuplicates(
  workspaceId: string,
  entityType: 'deal' | 'contact' | 'account',
  strategy: DedupStrategy,
  keyFields: string[],
  importRecords: TransformedRecord[],
  db: PoolClient
): Promise<DedupMatch[]> {
  if (strategy === 'none') return [];

  if (strategy === 'external_id') {
    const externalIds = importRecords
      .map((r, i) => ({ index: i, extId: r.external_id }))
      .filter(r => r.extId);

    if (externalIds.length === 0) return [];

    const table = entityType === 'deal' ? 'deals'
                : entityType === 'contact' ? 'contacts' : 'accounts';

    const existing = await db.query(`
      SELECT id, source_data->'original_row'->>COALESCE(
        CASE
          WHEN '${entityType}' = 'deal' THEN 'Opportunity ID'
          WHEN '${entityType}' = 'contact' THEN 'Contact ID'
          WHEN '${entityType}' = 'account' THEN 'Account ID'
        END, 'external_id'
      ) as source_id
      FROM ${table}
      WHERE workspace_id = $1
        AND source = 'csv_import'
        AND source_data->'original_row'->>COALESCE(
          CASE
            WHEN '${entityType}' = 'deal' THEN 'Opportunity ID'
            WHEN '${entityType}' = 'contact' THEN 'Contact ID'
            WHEN '${entityType}' = 'account' THEN 'Account ID'
          END, 'external_id'
        ) = ANY($2)
    `, [workspaceId, externalIds.map(e => e.extId)]);

    const existingMap = new Map(existing.rows.map(r => [r.source_id, r.id]));

    return externalIds
      .filter(e => e.extId && existingMap.has(e.extId))
      .map(e => ({
        importRowIndex: e.index,
        existingRecordId: existingMap.get(e.extId!)!,
        matchType: 'external_id' as DedupStrategy,
        confidence: 1.0
      }));
  }

  if (strategy === 'composite') {
    return findCompositeMatches(workspaceId, entityType, keyFields, importRecords, db);
  }

  return [];
}

async function findCompositeMatches(
  workspaceId: string,
  entityType: string,
  keyFields: string[],
  importRecords: TransformedRecord[],
  db: PoolClient
): Promise<DedupMatch[]> {
  const table = entityType === 'deal' ? 'deals'
              : entityType === 'contact' ? 'contacts' : 'accounts';

  // Build lookup of existing records by composite key
  // For contacts with email: simple email lookup
  if (entityType === 'contact' && keyFields.includes('email')) {
    const emails = importRecords
      .map((r, i) => ({ index: i, email: r.email?.toLowerCase()?.trim() }))
      .filter(r => r.email);

    if (emails.length === 0) return [];

    const existing = await db.query(`
      SELECT id, LOWER(TRIM(email)) as email
      FROM contacts
      WHERE workspace_id = $1 AND email = ANY($2)
    `, [workspaceId, emails.map(e => e.email)]);

    const emailMap = new Map(existing.rows.map(r => [r.email, r.id]));

    return emails
      .filter(e => e.email && emailMap.has(e.email))
      .map(e => ({
        importRowIndex: e.index,
        existingRecordId: emailMap.get(e.email!)!,
        matchType: 'composite' as DedupStrategy,
        confidence: 0.95
      }));
  }

  // For accounts with domain: domain lookup
  if (entityType === 'account' && keyFields.includes('domain')) {
    const domains = importRecords
      .map((r, i) => ({ index: i, domain: normalizeDomain(r.domain) }))
      .filter(r => r.domain);

    if (domains.length === 0) return [];

    const existing = await db.query(`
      SELECT id, LOWER(domain) as domain
      FROM accounts
      WHERE workspace_id = $1 AND domain = ANY($2)
    `, [workspaceId, domains.map(d => d.domain)]);

    const domainMap = new Map(existing.rows.map(r => [r.domain, r.id]));

    return domains
      .filter(d => d.domain && domainMap.has(d.domain))
      .map(d => ({
        importRowIndex: d.index,
        existingRecordId: domainMap.get(d.domain!)!,
        matchType: 'composite' as DedupStrategy,
        confidence: 0.90
      }));
  }

  // For deals: name + amount + close_date composite
  if (entityType === 'deal' && keyFields.includes('name')) {
    const existing = await db.query(`
      SELECT id, LOWER(name) as name, amount, close_date::TEXT
      FROM deals
      WHERE workspace_id = $1 AND source = 'csv_import'
    `, [workspaceId]);

    // Build composite keys for existing records
    const existingKeys = new Map<string, string>();
    for (const row of existing.rows) {
      const key = buildDealCompositeKey(row.name, row.amount, row.close_date);
      existingKeys.set(key, row.id);
    }

    const matches: DedupMatch[] = [];
    for (let i = 0; i < importRecords.length; i++) {
      const r = importRecords[i];
      const key = buildDealCompositeKey(
        r.name?.toLowerCase(),
        r.amount,
        r.close_date
      );
      if (existingKeys.has(key)) {
        matches.push({
          importRowIndex: i,
          existingRecordId: existingKeys.get(key)!,
          matchType: 'composite',
          confidence: 0.85
        });
      }
    }
    return matches;
  }

  return [];
}

function buildDealCompositeKey(name?: string, amount?: number, closeDate?: string): string {
  return `${(name || '').trim()}|${amount || 0}|${(closeDate || '').substring(0, 10)}`;
}

function normalizeDomain(domain?: string): string {
  if (!domain) return '';
  return domain.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
}
