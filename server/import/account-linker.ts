import { normalizeCompanyName } from './value-parsers.js';
import type { PoolClient } from 'pg';
import { query } from '../db.js';

interface LinkResult {
  dealId: string;
  accountId: string | null;
  matchTier: 'explicit_id' | 'domain' | 'exact_name' | 'normalized_name' | 'none';
  confidence: number;
  matchedOn: string;  // what value was used to match
}

export interface AccountLinkSummary {
  linked: number;
  unlinked: number;
  results: LinkResult[];
  byTier: Record<string, number>;
}

/**
 * Link deals to accounts using a tiered matching strategy.
 * Returns results for all unlinked deals — caller decides which to apply.
 */
export async function linkDealsToAccounts(
  workspaceId: string,
  client?: PoolClient
): Promise<AccountLinkSummary> {
  const queryFn = client ? (sql: string, params: any[]) => client.query(sql, params) : query;

  // 1. Load all unlinked deals
  const unlinkedDeals = await queryFn(`
    SELECT id, name,
      source_data->>'external_id' as external_id,
      source_data->'original_row'->>'Account ID' as account_external_id,
      source_data->'original_row'->>'Account Name' as account_name_from_row,
      source_data->>'account_name' as import_company_name
    FROM deals
    WHERE workspace_id = $1
      AND account_id IS NULL
  `, [workspaceId]);

  if (unlinkedDeals.rows.length === 0) {
    return { linked: 0, unlinked: 0, results: [], byTier: {} };
  }

  // 2. Build account lookup indices
  const accounts = await queryFn(`
    SELECT id, name, domain,
      source_data->'original_row'->>'Account ID' as external_id
    FROM accounts
    WHERE workspace_id = $1
  `, [workspaceId]);

  // Index by external ID
  const byExternalId = new Map<string, string>();
  // Index by domain (normalized)
  const byDomain = new Map<string, string>();
  // Index by exact name (lowered)
  const byExactName = new Map<string, string>();
  // Index by normalized name
  const byNormalizedName = new Map<string, { id: string; name: string }[]>();

  for (const acct of accounts.rows) {
    // External ID index
    if (acct.external_id) {
      byExternalId.set(acct.external_id, acct.id);
    }

    // Domain index (strip www, http, trailing slashes)
    if (acct.domain) {
      const cleanDomain = normalizeDomain(acct.domain);
      if (cleanDomain) {
        // Only set if not already claimed — first account wins for domain
        if (!byDomain.has(cleanDomain)) {
          byDomain.set(cleanDomain, acct.id);
        }
      }
    }

    // Exact name index (lowered, trimmed)
    const lowerName = acct.name?.toLowerCase().trim();
    if (lowerName) {
      byExactName.set(lowerName, acct.id);
    }

    // Normalized name index (allows multiple matches for disambiguation)
    const normalized = normalizeCompanyName(acct.name);
    if (normalized) {
      if (!byNormalizedName.has(normalized)) {
        byNormalizedName.set(normalized, []);
      }
      byNormalizedName.get(normalized)!.push({ id: acct.id, name: acct.name });
    }
  }

  // 3. Match each deal through tiers
  const results: LinkResult[] = [];
  let linked = 0;

  for (const deal of unlinkedDeals.rows) {
    const companyName = deal.account_name_from_row || deal.import_company_name || '';
    let result: LinkResult = {
      dealId: deal.id,
      accountId: null,
      matchTier: 'none',
      confidence: 0,
      matchedOn: ''
    };

    // TIER 1: Explicit Account ID from the CSV
    if (deal.account_external_id && byExternalId.has(deal.account_external_id)) {
      result = {
        dealId: deal.id,
        accountId: byExternalId.get(deal.account_external_id)!,
        matchTier: 'explicit_id',
        confidence: 1.0,
        matchedOn: deal.account_external_id
      };
    }

    // TIER 2: Domain match
    // Extract domain from deal's associated account name if it looks like a URL
    else if (companyName) {
      const domainFromDeal = extractDomain(companyName);
      if (domainFromDeal && byDomain.has(domainFromDeal)) {
        result = {
          dealId: deal.id,
          accountId: byDomain.get(domainFromDeal)!,
          matchTier: 'domain',
          confidence: 0.95,
          matchedOn: domainFromDeal
        };
      }

      // TIER 3: Exact name match (case-insensitive)
      else if (byExactName.has(companyName.toLowerCase().trim())) {
        result = {
          dealId: deal.id,
          accountId: byExactName.get(companyName.toLowerCase().trim())!,
          matchTier: 'exact_name',
          confidence: 0.90,
          matchedOn: companyName
        };
      }

      // TIER 4: Normalized name match (strips Inc/LLC/etc)
      else {
        const normalized = normalizeCompanyName(companyName);
        const candidates = byNormalizedName.get(normalized);

        if (candidates && candidates.length === 1) {
          // Single match — safe to link
          result = {
            dealId: deal.id,
            accountId: candidates[0].id,
            matchTier: 'normalized_name',
            confidence: 0.80,
            matchedOn: `"${companyName}" → "${candidates[0].name}"`
          };
        } else if (candidates && candidates.length > 1) {
          // AMBIGUOUS — multiple accounts match the normalized name.
          // DO NOT auto-link. Log the ambiguity.
          console.warn(
            `[Account Linker] Ambiguous match for "${companyName}" — ` +
            `${candidates.length} accounts match: ${candidates.map(c => c.name).join(', ')}. Skipping.`
          );
          result.matchedOn = `AMBIGUOUS: ${candidates.map(c => c.name).join(', ')}`;
        }
      }
    }

    // Apply the link
    if (result.accountId) {
      await queryFn(
        'UPDATE deals SET account_id = $1 WHERE id = $2',
        [result.accountId, deal.id]
      );
      linked++;
    }

    results.push(result);
  }

  // Calculate tier distribution
  const byTier = results.reduce((acc, r) => {
    acc[r.matchTier] = (acc[r.matchTier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    linked,
    unlinked: unlinkedDeals.rows.length - linked,
    results,
    byTier
  };
}

function normalizeDomain(domain: string): string {
  if (!domain) return '';
  return domain.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\s/g, '')
    .trim();
}

/**
 * Try to extract a domain from a company name or URL field.
 */
function extractDomain(value: string): string | null {
  if (!value) return null;

  // If it looks like a URL, extract the domain
  if (value.includes('://') || value.includes('www.')) {
    return normalizeDomain(value);
  }

  // If it looks like a domain (has a dot and common TLD)
  const domainPattern = /([a-z0-9-]+\.(com|io|net|org|co|ai|app|dev|tech))/i;
  const match = value.match(domainPattern);
  if (match) {
    return normalizeDomain(match[0]);
  }

  return null;
}

/**
 * Link contacts to accounts using email domain and account name matching.
 */
export async function linkContactsToAccounts(
  workspaceId: string,
  client?: PoolClient
): Promise<AccountLinkSummary> {
  const queryFn = client ? (sql: string, params: any[]) => client.query(sql, params) : query;

  // 1. Load all unlinked contacts
  const unlinkedContacts = await queryFn(`
    SELECT id, email,
      source_data->'original_row'->>'Account Name' as account_name_from_row,
      source_data->>'account_name' as import_company_name
    FROM contacts
    WHERE workspace_id = $1
      AND account_id IS NULL
  `, [workspaceId]);

  if (unlinkedContacts.rows.length === 0) {
    return { linked: 0, unlinked: 0, results: [], byTier: {} };
  }

  // 2. Build account lookup indices
  const accounts = await queryFn(`
    SELECT id, name, domain
    FROM accounts
    WHERE workspace_id = $1
  `, [workspaceId]);

  const byDomain = new Map<string, string>();
  const byExactName = new Map<string, string>();
  const byNormalizedName = new Map<string, { id: string; name: string }[]>();

  for (const acct of accounts.rows) {
    if (acct.domain) {
      const cleanDomain = normalizeDomain(acct.domain);
      if (cleanDomain && !byDomain.has(cleanDomain)) {
        byDomain.set(cleanDomain, acct.id);
      }
    }

    const lowerName = acct.name?.toLowerCase().trim();
    if (lowerName) {
      byExactName.set(lowerName, acct.id);
    }

    const normalized = normalizeCompanyName(acct.name);
    if (normalized) {
      if (!byNormalizedName.has(normalized)) {
        byNormalizedName.set(normalized, []);
      }
      byNormalizedName.get(normalized)!.push({ id: acct.id, name: acct.name });
    }
  }

  // 3. Match each contact
  const results: LinkResult[] = [];
  let linked = 0;

  for (const contact of unlinkedContacts.rows) {
    const companyName = contact.account_name_from_row || contact.import_company_name || '';
    let result: LinkResult = {
      dealId: contact.id,
      accountId: null,
      matchTier: 'none',
      confidence: 0,
      matchedOn: ''
    };

    // TIER 1: Email domain match
    if (contact.email) {
      const emailDomain = contact.email.split('@')[1]?.toLowerCase().trim();
      if (emailDomain && byDomain.has(emailDomain)) {
        result = {
          dealId: contact.id,
          accountId: byDomain.get(emailDomain)!,
          matchTier: 'domain',
          confidence: 0.95,
          matchedOn: emailDomain
        };
      }
    }

    // TIER 2: Exact company name
    if (!result.accountId && companyName && byExactName.has(companyName.toLowerCase().trim())) {
      result = {
        dealId: contact.id,
        accountId: byExactName.get(companyName.toLowerCase().trim())!,
        matchTier: 'exact_name',
        confidence: 0.90,
        matchedOn: companyName
      };
    }

    // TIER 3: Normalized company name
    if (!result.accountId && companyName) {
      const normalized = normalizeCompanyName(companyName);
      const candidates = byNormalizedName.get(normalized);

      if (candidates && candidates.length === 1) {
        result = {
          dealId: contact.id,
          accountId: candidates[0].id,
          matchTier: 'normalized_name',
          confidence: 0.80,
          matchedOn: `"${companyName}" → "${candidates[0].name}"`
        };
      }
    }

    // Apply the link
    if (result.accountId) {
      await queryFn(
        'UPDATE contacts SET account_id = $1 WHERE id = $2',
        [result.accountId, contact.id]
      );
      linked++;
    }

    results.push(result);
  }

  // Calculate tier distribution
  const byTier = results.reduce((acc, r) => {
    acc[r.matchTier] = (acc[r.matchTier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    linked,
    unlinked: unlinkedContacts.rows.length - linked,
    results,
    byTier
  };
}
