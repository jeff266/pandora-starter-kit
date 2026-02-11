import { query } from '../../db.js';

export interface NormalizedUser {
  source_id: string;
  name: string;
  email: string;
  title?: string;
  role?: string;
  active: boolean;
}

export interface TrackedUser {
  source_id: string;
  name: string;
  email: string;
  title?: string;
  selected_at: string;
}

export interface UserDirectory {
  fetched_at: string;
  users: NormalizedUser[];
}

export type ConversationConnector = 'gong' | 'fireflies';

export async function fetchAndStoreDirectory(
  workspaceId: string,
  connectorType: ConversationConnector,
  users: NormalizedUser[]
): Promise<UserDirectory> {
  const directory: UserDirectory = {
    fetched_at: new Date().toISOString(),
    users,
  };

  await query(
    `UPDATE connections
     SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{user_directory}',
       $3::jsonb
     ),
     updated_at = NOW()
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorType, JSON.stringify(directory)]
  );

  return directory;
}

export async function getDirectory(
  workspaceId: string,
  connectorType: ConversationConnector
): Promise<{ users: NormalizedUser[]; fetchedAt: string } | null> {
  const result = await query<{ metadata: any }>(
    `SELECT metadata FROM connections
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorType]
  );

  if (result.rows.length === 0) return null;

  const metadata = result.rows[0].metadata || {};
  const dir = metadata.user_directory;
  if (!dir) return null;

  return {
    users: dir.users || [],
    fetchedAt: dir.fetched_at,
  };
}

export async function setTrackedUsers(
  workspaceId: string,
  connectorType: ConversationConnector,
  userIds: string[]
): Promise<TrackedUser[]> {
  const dir = await getDirectory(workspaceId, connectorType);
  if (!dir) {
    throw new Error(`No user directory found for ${connectorType}. Connect and fetch users first.`);
  }

  const userMap = new Map(dir.users.map(u => [u.source_id, u]));
  const invalidIds = userIds.filter(id => !userMap.has(id));
  if (invalidIds.length > 0) {
    throw new Error(`Unknown user IDs: ${invalidIds.join(', ')}`);
  }

  const now = new Date().toISOString();
  const tracked: TrackedUser[] = userIds.map(id => {
    const user = userMap.get(id)!;
    return {
      source_id: user.source_id,
      name: user.name,
      email: user.email,
      title: user.title,
      selected_at: now,
    };
  });

  await query(
    `UPDATE connections
     SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{tracked_users}',
       $3::jsonb
     ),
     updated_at = NOW()
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorType, JSON.stringify(tracked)]
  );

  return tracked;
}

export async function getTrackedUsers(
  workspaceId: string,
  connectorType: ConversationConnector
): Promise<TrackedUser[]> {
  const result = await query<{ metadata: any }>(
    `SELECT metadata FROM connections
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorType]
  );

  if (result.rows.length === 0) return [];

  const metadata = result.rows[0].metadata || {};
  return metadata.tracked_users || [];
}

export async function clearTrackedUsers(
  workspaceId: string,
  connectorType: ConversationConnector
): Promise<void> {
  await query(
    `UPDATE connections
     SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{tracked_users}',
       '[]'::jsonb
     ),
     updated_at = NOW()
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorType]
  );
}

export async function getSalesRoster(
  workspaceId: string
): Promise<{
  reps: Array<{
    name: string;
    email: string;
    title?: string;
    sources: string[];
    gong_user_id?: string;
    fireflies_user_id?: string;
  }>;
  total: number;
}> {
  const connectorTypes: ConversationConnector[] = ['gong', 'fireflies'];
  const byEmail = new Map<string, {
    name: string;
    email: string;
    title?: string;
    sources: string[];
    gong_user_id?: string;
    fireflies_user_id?: string;
  }>();

  for (const connectorType of connectorTypes) {
    const tracked = await getTrackedUsers(workspaceId, connectorType);
    for (const user of tracked) {
      const email = user.email.toLowerCase();
      const existing = byEmail.get(email);
      if (existing) {
        existing.sources.push(connectorType);
        if (connectorType === 'gong') existing.gong_user_id = user.source_id;
        if (connectorType === 'fireflies') existing.fireflies_user_id = user.source_id;
      } else {
        byEmail.set(email, {
          name: user.name,
          email: user.email,
          title: user.title,
          sources: [connectorType],
          ...(connectorType === 'gong' && { gong_user_id: user.source_id }),
          ...(connectorType === 'fireflies' && { fireflies_user_id: user.source_id }),
        });
      }
    }
  }

  const reps = Array.from(byEmail.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { reps, total: reps.length };
}
