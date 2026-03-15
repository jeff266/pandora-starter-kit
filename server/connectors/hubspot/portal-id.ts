import { query } from '../../db.js';
import { decryptCredentials } from '../../lib/encryption.js';
import { HubSpotClient } from './client.js';

const portalIdCache = new Map<string, { portalId: number; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getWorkspaceHubSpotPortalId(workspaceId: string): Promise<number | null> {
  const cached = portalIdCache.get(workspaceId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.portalId;

  try {
    const result = await query<{ credentials: string; metadata: any }>(
      `SELECT credentials, metadata FROM connections
       WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status = 'active'
       LIMIT 1`,
      [workspaceId]
    );
    if (!result.rows[0]) return null;

    // Fast path: portal ID already stored in metadata (matches findings.ts convention: camelCase 'portalId')
    const storedPortalId = result.rows[0].metadata?.portalId;
    if (storedPortalId) {
      const id = Number(storedPortalId);
      portalIdCache.set(workspaceId, { portalId: id, ts: Date.now() });
      console.log(`[PortalId] Loaded from DB metadata: ${id}`);
      return id;
    }

    // Slow path: fetch from HubSpot API and persist back to metadata
    if (!result.rows[0]?.credentials) return null;
    const creds = decryptCredentials(result.rows[0].credentials);
    const accessToken = creds.accessToken || creds.access_token;
    if (!accessToken) return null;

    const client = new HubSpotClient(accessToken, workspaceId);
    const portalId = await client.getPortalId();
    if (!portalId) return null;

    // Persist using same key ('portalId') as findings.ts so both paths share the cache
    await query(
      `UPDATE connections
       SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{portalId}', $1::jsonb)
       WHERE workspace_id = $2 AND connector_name = 'hubspot'`,
      [JSON.stringify(portalId), workspaceId]
    ).catch((e: unknown) => console.warn('[PortalId] Failed to persist to metadata:', e instanceof Error ? e.message : e));

    portalIdCache.set(workspaceId, { portalId, ts: Date.now() });
    console.log(`[PortalId] Fetched from API and persisted: ${portalId}`);
    return portalId;
  } catch (err) {
    console.warn('[PortalId] Failed to fetch HubSpot portal ID:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
