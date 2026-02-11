import { query, getClient } from '../../db.js';
import { FirefliesClient } from './client.js';
import { transformFirefliesTranscript, type NormalizedConversation } from './transform.js';
import type { SyncResult } from '../_interface.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';

const BATCH_SIZE = 500;

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

export async function initialSync(
  client: FirefliesClient,
  workspaceId: string,
  options?: { lookbackDays?: number }
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalFetched = 0;
  let totalStored = 0;

  const days = options?.lookbackDays ?? 90;
  console.log(`[Fireflies Sync] Starting initial sync for workspace ${workspaceId} (lookback: ${days} days)`);

  try {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - days);

    let rawTranscripts: any[] = [];

    try {
      rawTranscripts = await client.getAllTranscripts({ afterDate: lookbackDate });
    } catch (err: any) {
      errors.push(`Failed to fetch transcripts: ${err.message}`);
    }

    totalFetched = rawTranscripts.length;
    console.log(`[Fireflies Sync] Fetched ${rawTranscripts.length} transcripts`);

    const transformResult = transformWithErrorCapture(
      rawTranscripts,
      (transcript) => transformFirefliesTranscript(transcript, workspaceId),
      'Fireflies Transcripts',
      (transcript) => transcript.id
    );

    if (transformResult.failed.length > 0) {
      errors.push(`Transcript transform failures: ${transformResult.failed.length} records`);
    }

    const normalizedConversations = transformResult.succeeded;

    totalStored = await upsertConversations(normalizedConversations).catch(err => {
      console.error(`[Fireflies Sync] Failed to store conversations:`, err.message);
      errors.push(`Failed to store conversations: ${err.message}`);
      return 0;
    });

    await updateConnectionSyncStatus(
      workspaceId,
      'fireflies',
      totalStored,
      errors.length > 0 ? errors.join('; ') : undefined
    );

    console.log(`[Fireflies Sync] Initial sync complete: ${totalStored} stored, ${errors.length} errors`);
  } catch (error: any) {
    console.error(`[Fireflies Sync] Initial sync failed:`, error.message);
    errors.push(`Sync failed: ${error.message}`);

    await updateConnectionSyncStatus(workspaceId, 'fireflies', 0, errors.join('; ')).catch(() => {});
  }

  return {
    recordsFetched: totalFetched,
    recordsStored: totalStored,
    errors,
    duration: Date.now() - startTime,
  };
}

export async function incrementalSync(
  client: FirefliesClient,
  workspaceId: string,
  since: Date
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalFetched = 0;
  let totalStored = 0;

  console.log(`[Fireflies Sync] Starting incremental sync for workspace ${workspaceId} since ${since.toISOString()}`);

  try {
    let rawTranscripts: any[] = [];

    try {
      rawTranscripts = await client.getAllTranscripts({ afterDate: since });
    } catch (err: any) {
      errors.push(`Failed to fetch transcripts: ${err.message}`);
    }

    totalFetched = rawTranscripts.length;
    console.log(`[Fireflies Sync] Fetched ${rawTranscripts.length} transcripts since ${since.toISOString()}`);

    const transformResult = transformWithErrorCapture(
      rawTranscripts,
      (transcript) => transformFirefliesTranscript(transcript, workspaceId),
      'Fireflies Transcripts',
      (transcript) => transcript.id
    );

    if (transformResult.failed.length > 0) {
      errors.push(`Transcript transform failures: ${transformResult.failed.length} records`);
    }

    const normalizedConversations = transformResult.succeeded;

    totalStored = await upsertConversations(normalizedConversations).catch(err => {
      console.error(`[Fireflies Sync] Failed to store conversations:`, err.message);
      errors.push(`Failed to store conversations: ${err.message}`);
      return 0;
    });

    await updateConnectionSyncStatus(
      workspaceId,
      'fireflies',
      totalStored,
      errors.length > 0 ? errors.join('; ') : undefined
    );

    console.log(`[Fireflies Sync] Incremental sync complete: ${totalStored} stored, ${errors.length} errors`);
  } catch (error: any) {
    console.error(`[Fireflies Sync] Incremental sync failed:`, error.message);
    errors.push(`Sync failed: ${error.message}`);

    await updateConnectionSyncStatus(workspaceId, 'fireflies', 0, errors.join('; ')).catch(() => {});
  }

  return {
    recordsFetched: totalFetched,
    recordsStored: totalStored,
    errors,
    duration: Date.now() - startTime,
  };
}
