import { query } from '../../db.js';
import { decryptCredentials } from '../../lib/encryption.js';
import { HubSpotClient } from './client.js';

const portalIdCache = new Map<string, { portalId: number; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getWorkspaceHubSpotPortalId(workspaceId: string): Promise<number | null> {
  const cached = portalIdCache.get(workspaceId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.portalId;

  try {
    const result = await query<{ credentials: string }>(
      `SELECT credentials FROM connections
       WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status = 'active'
       LIMIT 1`,
      [workspaceId]
    );
    if (!result.rows[0]?.credentials) return null;

    const creds = decryptCredentials(result.rows[0].credentials);
    const accessToken = creds.accessToken || creds.access_token;
    if (!accessToken) return null;

    const client = new HubSpotClient(accessToken, workspaceId);
    const portalId = await client.getPortalId();
    if (!portalId) return null;

    portalIdCache.set(workspaceId, { portalId, ts: Date.now() });
    return portalId;
  } catch (err) {
    console.warn('[PortalId] Failed to fetch HubSpot portal ID:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
