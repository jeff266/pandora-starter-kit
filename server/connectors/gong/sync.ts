import { query, getClient } from '../../db.js';
import { GongClient } from './client.js';
import type { GongCall } from './types.js';
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
            custom_fields,
            is_internal, call_disposition, decision_makers_mentioned,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10,
            $11, $12,
            $13, $14,
            $15, $16,
            $17,
            $18, $19, $20,
            NOW(), NOW()
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
            is_internal = EXCLUDED.is_internal,
            call_disposition = EXCLUDED.call_disposition,
            decision_makers_mentioned = EXCLUDED.decision_makers_mentioned,
            updated_at = NOW()`,
          [
            conv.workspace_id, conv.source, conv.source_id, JSON.stringify(conv.source_data),
            conv.title, conv.call_date, conv.duration_seconds, JSON.stringify(conv.participants),
            conv.transcript_text, conv.summary,
            JSON.stringify(conv.action_items), JSON.stringify(conv.objections),
            conv.sentiment_score, conv.talk_listen_ratio ? JSON.stringify(conv.talk_listen_ratio) : null,
            JSON.stringify(conv.topics), JSON.stringify(conv.competitor_mentions),
            JSON.stringify(conv.custom_fields),
            conv.is_internal, conv.call_disposition, JSON.stringify(conv.decision_makers_mentioned),
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

function getTrackedUserIdsInCall(call: GongCall, trackedUserIds: Set<string>): string[] {
  const matched = new Set<string>();
  if (trackedUserIds.has(call.primaryUserId)) matched.add(call.primaryUserId);
  for (const party of call.parties) {
    if (party.userId && trackedUserIds.has(party.userId)) matched.add(party.userId);
  }
  return Array.from(matched);
}

async function syncForTrackedUsers(
  client: GongClient,
  workspaceId: string,
  trackedUsers: TrackedUser[],
  fromDate: string,
  userMap: GongUserMap,
  errors: string[]
): Promise<{ totalFetched: number; totalStored: number; byUser: Array<{ name: string; calls: number }> }> {
  const trackedUserIds = new Set(trackedUsers.map(u => u.source_id));
  const userCallCounts = new Map<string, number>(trackedUsers.map(u => [u.source_id, 0]));

  console.log(`[Gong Sync] Fetching all calls from ${fromDate} then filtering by ${trackedUsers.length} tracked users (hosted + attended + invited)`);

  let allCalls: GongCall[];
  try {
    allCalls = await client.getCallsExtensive(fromDate);
  } catch (err: any) {
    console.error(`[Gong Sync] Failed to fetch calls: ${err.message}`);
    errors.push(`Fetch error: ${err.message}`);
    return {
      totalFetched: 0,
      totalStored: 0,
      byUser: trackedUsers.map(u => ({ name: u.name, calls: 0 })),
    };
  }

  const uniqueCallMap = new Map<string, GongCall>();
  for (const call of allCalls) {
    uniqueCallMap.set(call.id, call);
  }
  const dedupedCalls = Array.from(uniqueCallMap.values());
  if (dedupedCalls.length !== allCalls.length) {
    console.warn(`[Gong Sync] Deduplicated: ${allCalls.length} → ${dedupedCalls.length} unique calls`);
  }

  console.log(`[Gong Sync] Fetched ${dedupedCalls.length} unique calls from Gong, filtering by tracked users...`);

  const matchedCalls: GongCall[] = [];
  for (const call of dedupedCalls) {
    const matchedUserIdsInCall = getTrackedUserIdsInCall(call, trackedUserIds);
    if (matchedUserIdsInCall.length > 0) {
      matchedCalls.push(call);
      for (const uid of matchedUserIdsInCall) {
        userCallCounts.set(uid, (userCallCounts.get(uid) || 0) + 1);
      }
    }
  }

  console.log(`[Gong Sync] ${matchedCalls.length} calls match tracked users (out of ${dedupedCalls.length} total)`);

  const transformResult = transformWithErrorCapture(
    matchedCalls,
    (call) => transformGongCall(call, workspaceId, userMap),
    `Gong Calls`,
    (call) => call.id
  );

  const uniqueSourceIds = new Set(transformResult.succeeded.map(c => c.source_id));
  console.log(`[Gong Sync] Transform: ${transformResult.succeeded.length} succeeded (${uniqueSourceIds.size} unique source_ids), ${transformResult.failed.length} failed`);

  if (transformResult.failed.length > 0) {
    errors.push(`${transformResult.failed.length} transform failures`);
    if (transformResult.failed.length <= 5) {
      for (const f of transformResult.failed) {
        console.error(`[Gong Sync] Transform failure: ${f.id} — ${f.error}`);
      }
    }
  }

  const totalStored = await upsertConversations(transformResult.succeeded);

  const byUser = trackedUsers.map(u => ({
    name: u.name,
    calls: userCallCounts.get(u.source_id) || 0,
  }));

  for (const entry of byUser) {
    console.log(`[Gong Sync] ${entry.name}: ${entry.calls} calls matched`);
  }

  return { totalFetched: dedupedCalls.length, totalStored, byUser };
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
