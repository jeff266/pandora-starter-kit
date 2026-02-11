import { query, getClient } from '../../db.js';
import { GongClient } from './client.js';
import { transformGongCall, buildUserMap, type NormalizedConversation, type GongUserMap } from './transform.js';
import type { SyncResult } from '../_interface.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';
import { getTrackedUsers, type TrackedUser } from '../shared/tracked-users.js';

const BATCH_SIZE = 500;

interface TrackedSyncResult extends SyncResult {
  trackedUsers?: number;
  byUser?: Array<{ name: string; calls: number }>;
}

async function upsertConversations(conversations: NormalizedConversation[]): Promise<number> {
  if (conversations.length === 0) return 0;

  let totalStored = 0;

  for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
    const batch = conversations.slice(i, i + BATCH_SIZE);
    const client = await getClient();

    try {
      await client.query('BEGIN');

      for (const conv of batch) {
        await client.query(
          `INSERT INTO conversations (
            workspace_id, source, source_id, source_data,
            title, call_date, duration_seconds, participants,
            transcript_text, summary,
            action_items, objections,
            sentiment_score, talk_listen_ratio,
            topics, competitor_mentions,
            custom_fields, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10,
            $11, $12,
            $13, $14,
            $15, $16,
            $17, NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data = EXCLUDED.source_data,
            title = EXCLUDED.title,
            call_date = EXCLUDED.call_date,
            duration_seconds = EXCLUDED.duration_seconds,
            participants = EXCLUDED.participants,
            transcript_text = COALESCE(conversations.transcript_text, EXCLUDED.transcript_text),
            summary = COALESCE(conversations.summary, EXCLUDED.summary),
            action_items = EXCLUDED.action_items,
            objections = EXCLUDED.objections,
            sentiment_score = EXCLUDED.sentiment_score,
            talk_listen_ratio = EXCLUDED.talk_listen_ratio,
            topics = EXCLUDED.topics,
            competitor_mentions = EXCLUDED.competitor_mentions,
            custom_fields = EXCLUDED.custom_fields,
            updated_at = NOW()`,
          [
            conv.workspace_id, conv.source, conv.source_id, JSON.stringify(conv.source_data),
            conv.title, conv.call_date, conv.duration_seconds, JSON.stringify(conv.participants),
            conv.transcript_text, conv.summary,
            JSON.stringify(conv.action_items), JSON.stringify(conv.objections),
            conv.sentiment_score, conv.talk_listen_ratio ? JSON.stringify(conv.talk_listen_ratio) : null,
            JSON.stringify(conv.topics), JSON.stringify(conv.competitor_mentions),
            JSON.stringify(conv.custom_fields),
          ]
        );
        totalStored++;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return totalStored;
}

async function updateConnectionSyncStatus(
  workspaceId: string,
  connectorName: string,
  recordsSynced: number,
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE connections SET
      last_sync_at = NOW(),
      sync_cursor = jsonb_set(
        COALESCE(sync_cursor, '{}'::jsonb),
        '{lastSyncRecords}',
        $3::text::jsonb
      ),
      status = CASE WHEN $4::text IS NULL THEN 'healthy' ELSE 'degraded' END,
      error_message = $4,
      updated_at = NOW()
    WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorName, String(recordsSynced), errorMessage || null]
  );
}

async function syncForTrackedUsers(
  client: GongClient,
  workspaceId: string,
  trackedUsers: TrackedUser[],
  fromDate: string,
  userMap: GongUserMap,
  errors: string[]
): Promise<{ totalFetched: number; totalStored: number; byUser: Array<{ name: string; calls: number }> }> {
  let totalFetched = 0;
  let totalStored = 0;
  const byUser: Array<{ name: string; calls: number }> = [];

  for (let i = 0; i < trackedUsers.length; i++) {
    const user = trackedUsers[i];
    console.log(`[Gong Sync] Syncing user ${i + 1}/${trackedUsers.length}: ${user.name} (${user.source_id})`);

    try {
      const rawCalls = await client.getCallsExtensive(fromDate, undefined, user.source_id);
      totalFetched += rawCalls.length;

      const transformResult = transformWithErrorCapture(
        rawCalls,
        (call) => transformGongCall(call, workspaceId, userMap),
        `Gong Calls (${user.name})`,
        (call) => call.id
      );

      if (transformResult.failed.length > 0) {
        errors.push(`${user.name}: ${transformResult.failed.length} transform failures`);
      }

      const stored = await upsertConversations(transformResult.succeeded);
      totalStored += stored;
      byUser.push({ name: user.name, calls: stored });

      console.log(`[Gong Sync] ${user.name}: ${rawCalls.length} fetched, ${stored} stored`);
    } catch (err: any) {
      console.error(`[Gong Sync] Error syncing user ${user.name}: ${err.message}`);
      errors.push(`${user.name}: ${err.message}`);
      byUser.push({ name: user.name, calls: 0 });
    }
  }

  return { totalFetched, totalStored, byUser };
}

export async function initialSync(
  client: GongClient,
  workspaceId: string,
  options?: { lookbackDays?: number }
): Promise<TrackedSyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const days = options?.lookbackDays ?? 90;
  console.log(`[Gong Sync] Starting initial sync for workspace ${workspaceId} (lookback: ${days} days)`);

  const trackedUsers = await getTrackedUsers(workspaceId, 'gong');
  if (trackedUsers.length === 0) {
    return {
      recordsFetched: 0,
      recordsStored: 0,
      errors: ['No tracked users configured for Gong. Select users before syncing.'],
      duration: Date.now() - startTime,
      trackedUsers: 0,
    };
  }

  console.log(`[Gong Sync] Filtering by ${trackedUsers.length} tracked users`);

  let userMap: GongUserMap = new Map();
  try {
    const users = await client.getAllUsers();
    userMap = buildUserMap(users);
    console.log(`[Gong Sync] Loaded ${userMap.size} users for participant enrichment`);
  } catch (err: any) {
    console.warn(`[Gong Sync] Failed to fetch users (participants will lack names): ${err.message}`);
    errors.push(`User fetch warning: ${err.message}`);
  }

  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - days);
  const fromDate = lookbackDate.toISOString();

  const result = await syncForTrackedUsers(client, workspaceId, trackedUsers, fromDate, userMap, errors);

  await updateConnectionSyncStatus(
    workspaceId,
    'gong',
    result.totalStored,
    errors.length > 0 ? errors.join('; ') : undefined
  );

  console.log(`[Gong Sync] Initial sync complete: ${result.totalStored} stored across ${trackedUsers.length} users, ${errors.length} errors`);

  return {
    recordsFetched: result.totalFetched,
    recordsStored: result.totalStored,
    errors,
    duration: Date.now() - startTime,
    trackedUsers: trackedUsers.length,
    byUser: result.byUser,
  };
}

export async function incrementalSync(
  client: GongClient,
  workspaceId: string,
  since: Date
): Promise<TrackedSyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  console.log(`[Gong Sync] Starting incremental sync for workspace ${workspaceId} since ${since.toISOString()}`);

  const trackedUsers = await getTrackedUsers(workspaceId, 'gong');
  if (trackedUsers.length === 0) {
    return {
      recordsFetched: 0,
      recordsStored: 0,
      errors: ['No tracked users configured for Gong. Select users before syncing.'],
      duration: Date.now() - startTime,
      trackedUsers: 0,
    };
  }

  console.log(`[Gong Sync] Filtering by ${trackedUsers.length} tracked users`);

  let userMap: GongUserMap = new Map();
  try {
    const users = await client.getAllUsers();
    userMap = buildUserMap(users);
  } catch (err: any) {
    console.warn(`[Gong Sync] Failed to fetch users: ${err.message}`);
    errors.push(`User fetch warning: ${err.message}`);
  }

  const fromDate = since.toISOString();
  const result = await syncForTrackedUsers(client, workspaceId, trackedUsers, fromDate, userMap, errors);

  await updateConnectionSyncStatus(
    workspaceId,
    'gong',
    result.totalStored,
    errors.length > 0 ? errors.join('; ') : undefined
  );

  console.log(`[Gong Sync] Incremental sync complete: ${result.totalStored} stored, ${errors.length} errors`);

  return {
    recordsFetched: result.totalFetched,
    recordsStored: result.totalStored,
    errors,
    duration: Date.now() - startTime,
    trackedUsers: trackedUsers.length,
    byUser: result.byUser,
  };
}
