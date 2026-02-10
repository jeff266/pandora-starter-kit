import pool from '../db.js';
import { HubSpotClient } from '../connectors/hubspot/client.js';

type OwnerMap = Record<string, string>;

const ownerCache = new Map<string, { map: OwnerMap; fetchedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function resolveOwnerNames(workspaceId: string): Promise<OwnerMap> {
  const cached = ownerCache.get(workspaceId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.map;
  }

  const dbResult = await pool.query(
    `SELECT settings->'owner_map' AS owner_map FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const storedMap = dbResult.rows[0]?.owner_map;
  if (storedMap && typeof storedMap === 'object' && Object.keys(storedMap).length > 0) {
    ownerCache.set(workspaceId, { map: storedMap, fetchedAt: Date.now() });
    return storedMap;
  }

  const ownerMap = await fetchAndCacheOwners(workspaceId);
  return ownerMap;
}

export async function fetchAndCacheOwners(workspaceId: string): Promise<OwnerMap> {
  const connResult = await pool.query(
    `SELECT credentials FROM connections WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status IN ('active', 'healthy') LIMIT 1`,
    [workspaceId]
  );

  if (connResult.rows.length === 0) {
    return {};
  }

  const credentials = connResult.rows[0].credentials;
  const accessToken = credentials?.access_token || credentials?.accessToken;
  if (!accessToken) {
    return {};
  }

  try {
    const client = new HubSpotClient(accessToken);
    const owners = await client.getOwners();

    const ownerMap: OwnerMap = {};
    for (const owner of owners) {
      const fullName = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim();
      ownerMap[owner.id] = fullName || owner.email || `Owner ${owner.id}`;
    }

    await pool.query(
      `UPDATE workspaces SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{owner_map}', $2::jsonb) WHERE id = $1`,
      [workspaceId, JSON.stringify(ownerMap)]
    );

    console.log(`[OwnerResolver] Cached ${Object.keys(ownerMap).length} owner names for workspace ${workspaceId}`);
    ownerCache.set(workspaceId, { map: ownerMap, fetchedAt: Date.now() });
    return ownerMap;
  } catch (error) {
    console.warn(`[OwnerResolver] Failed to fetch owners from HubSpot:`, error instanceof Error ? error.message : error);
    return {};
  }
}

export function resolveOwnerName(ownerId: string | null | undefined, ownerMap: OwnerMap): string {
  if (!ownerId) return 'Unassigned';
  return ownerMap[ownerId] || ownerId;
}
