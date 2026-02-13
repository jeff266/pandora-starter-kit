import { query } from '../db.js';
import { encryptCredentials, decryptCredentials, isEncrypted } from '../lib/encryption.js';

export async function getEnrichmentConfig(workspaceId: string): Promise<{
  apolloApiKey: string | null;
  serperApiKey: string | null;
  linkedinApiKey: string | null;
  autoEnrichOnClose: boolean;
  lookbackMonths: number;
  cacheDays: number;
}> {
  const result = await query<{ credentials: any; metadata: any }>(
    `SELECT credentials, metadata FROM connections WHERE workspace_id = $1 AND connector_name = 'enrichment_config' LIMIT 1`,
    [workspaceId]
  );

  const defaults = {
    apolloApiKey: null as string | null,
    serperApiKey: null as string | null,
    linkedinApiKey: null as string | null,
    autoEnrichOnClose: true,
    lookbackMonths: 6,
    cacheDays: 90,
  };

  if (result.rows.length === 0) return defaults;

  const row = result.rows[0];
  const metadata = row.metadata || {};

  if (row.credentials && isEncrypted(row.credentials)) {
    const decrypted = decryptCredentials(row.credentials as any);
    defaults.apolloApiKey = decrypted.apollo_api_key || null;
    defaults.serperApiKey = decrypted.serper_api_key || null;
    defaults.linkedinApiKey = decrypted.linkedin_rapidapi_key || null;
  }

  defaults.autoEnrichOnClose = metadata.auto_enrich_on_close ?? true;
  defaults.lookbackMonths = metadata.enrich_lookback_months ?? 6;
  defaults.cacheDays = metadata.cache_days ?? 90;

  return defaults;
}
