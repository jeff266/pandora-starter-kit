import { query } from '../db.js';
import { getEnrichmentKeys } from '../lib/credential-store.js';

export async function getEnrichmentConfig(workspaceId: string): Promise<{
  apolloApiKey: string | null;
  serperApiKey: string | null;
  linkedinApiKey: string | null;
  autoEnrichOnClose: boolean;
  lookbackMonths: number;
  cacheDays: number;
}> {
  // Get API keys from credential store
  const keys = await getEnrichmentKeys(workspaceId);

  // Get metadata (settings)
  const result = await query<{ metadata: any }>(
    `SELECT metadata FROM connections WHERE workspace_id = $1 AND connector_name = 'enrichment_config' LIMIT 1`,
    [workspaceId]
  );

  const metadata = result.rows.length > 0 ? (result.rows[0].metadata || {}) : {};

  return {
    apolloApiKey: keys.apollo_api_key || null,
    serperApiKey: keys.serper_api_key || null,
    linkedinApiKey: keys.linkedin_rapidapi_key || null,
    autoEnrichOnClose: metadata.auto_enrich_on_close ?? true,
    lookbackMonths: metadata.enrich_lookback_months ?? 6,
    cacheDays: metadata.cache_days ?? 90,
  };
}
