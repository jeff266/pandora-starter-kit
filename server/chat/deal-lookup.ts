import { query } from '../db.js';

// ─── Product catalog helpers ──────────────────────────────────────────────────

export interface ProductEntry {
  name: string;
  abbreviation?: string;
}

const productCache = new Map<string, { products: ProductEntry[]; ts: number }>();
const PRODUCT_CACHE_TTL = 5 * 60 * 1000;

export async function loadProductCatalog(workspaceId: string): Promise<ProductEntry[]> {
  const cached = productCache.get(workspaceId);
  if (cached && Date.now() - cached.ts < PRODUCT_CACHE_TTL) return cached.products;
  try {
    const result = await query<{ products: any }>(
      `SELECT definitions->'products' AS products
       FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );
    const raw = result.rows[0]?.products;
    const products: ProductEntry[] = Array.isArray(raw) ? raw : [];
    productCache.set(workspaceId, { products, ts: Date.now() });
    return products;
  } catch {
    return [];
  }
}

export function expandDealName(name: string, products: ProductEntry[]): string {
  if (!name || products.length === 0) return name;
  let expanded = name;
  for (const p of products) {
    if (!p.abbreviation) continue;
    // Match abbreviation as whole word (word boundary or surrounded by non-alphanumeric)
    const abbr = p.abbreviation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![A-Za-z0-9])${abbr}(?![A-Za-z0-9])`, 'g');
    expanded = expanded.replace(regex, p.name);
  }
  if (expanded !== name) {
    console.log(`[DealLookup] Expanded deal name: "${name}" → "${expanded}"`);
  }
  return expanded;
}

export interface LiveDealFact {
  id: string;
  name: string;
  amount: number;
  stage: string;
  close_date: string | null;
  owner_name: string | null;
  pipeline: string | null;
  forecast_category: string | null;
  last_synced_at: string;
  contact_count: number;
  days_since_activity: number | null;
}

export async function lookupLiveDeal(
  workspaceId: string,
  nameFragment: string
): Promise<LiveDealFact | null> {
  try {
    const result = await query<any>(
      `SELECT
        d.id,
        d.name,
        COALESCE(d.amount, 0) as amount,
        d.stage,
        d.close_date::text as close_date,
        d.owner as owner_name,
        d.pipeline,
        d.forecast_category,
        d.updated_at::text as last_synced_at,
        COUNT(DISTINCT dc.contact_id)::int as contact_count,
        EXTRACT(EPOCH FROM (NOW() - MAX(a.timestamp))) / 86400 as days_since_activity
      FROM deals d
      LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
      LEFT JOIN activities a ON a.deal_id = d.id AND a.workspace_id = d.workspace_id
      WHERE d.workspace_id = $1
        AND LOWER(d.name) LIKE LOWER($2)
      GROUP BY d.id, d.name, d.amount, d.stage, d.close_date,
               d.owner, d.pipeline, d.forecast_category, d.updated_at
      LIMIT 1`,
      [workspaceId, `%${nameFragment}%`]
    );

    if (!result.rows[0]) return null;
    const row = result.rows[0];
    const products = await loadProductCatalog(workspaceId);
    return {
      id: row.id,
      name: expandDealName(row.name, products),
      amount: parseFloat(row.amount) || 0,
      stage: row.stage || '',
      close_date: row.close_date || null,
      owner_name: row.owner_name || null,
      pipeline: row.pipeline || null,
      forecast_category: row.forecast_category || null,
      last_synced_at: row.last_synced_at || new Date().toISOString(),
      contact_count: parseInt(row.contact_count) || 0,
      days_since_activity: row.days_since_activity != null ? Math.round(parseFloat(row.days_since_activity)) : null,
    };
  } catch (err) {
    console.warn('[DealLookup] lookupLiveDeal error:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function detectDealMentions(
  message: string,
  workspaceId: string
): Promise<string[]> {
  try {
    const result = await query<{ name: string }>(
      `SELECT name FROM deals
       WHERE workspace_id = $1
         AND LOWER($2) LIKE LOWER('%' || name || '%')
         AND length(name) >= 4
       ORDER BY length(name) DESC
       LIMIT 5`,
      [workspaceId, message]
    );
    return result.rows.map(r => r.name);
  } catch (err) {
    console.warn('[DealLookup] detectDealMentions error:', err instanceof Error ? err.message : err);
    return [];
  }
}

export function buildLiveDealFactsBlock(facts: LiveDealFact[]): string {
  if (facts.length === 0) return '';

  const formatAmt = (n: number) => `$${Number(n).toLocaleString()}`;
  const syncedAt = facts[0]?.last_synced_at || new Date().toISOString();

  const dealLines = facts.map(f => {
    const lines = [
      `Deal: ${f.name}`,
      `Amount: ${formatAmt(f.amount)}`,
      `Stage: ${f.stage}`,
      f.pipeline ? `Pipeline: ${f.pipeline}` : null,
      f.close_date ? `Close Date: ${f.close_date}` : null,
      f.owner_name ? `Owner: ${f.owner_name}` : null,
      `Last synced: ${f.last_synced_at}`,
      f.days_since_activity != null ? `Last Activity: ${f.days_since_activity} day(s) ago` : null,
    ].filter(Boolean).join('\n');
    return lines;
  }).join('\n\n');

  return `<live_deal_facts synced_at="${syncedAt}">
${dealLines}

IMPORTANT: Use these exact values when answering about these deals. If the weekly brief shows different values, the brief may be stale — always prefer these live database values.
</live_deal_facts>`;
}

export function detectContradiction(
  message: string,
  history: Array<{ role: string; content: string }>
): boolean {
  const contradictionPatterns = [
    /that'?s?\s+(not|wrong|incorrect)/i,
    /are\s+you\s+sure/i,
    /i\s+thought/i,
    /that\s+doesn'?t?\s+sound\s+right/i,
    /not\s+correct/i,
    /that'?s?\s+wrong/i,
    /incorrect/i,
    /\$[\d,]+k?\s*(is|not|seems)/i,
    /should\s+be\s+\$[\d,]+/i,
    /it'?s?\s+\$[\d,]+/i,
  ];

  return contradictionPatterns.some(p => p.test(message));
}
