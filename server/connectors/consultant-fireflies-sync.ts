/**
 * Consultant Fireflies Sync
 *
 * Syncs Fireflies transcripts for a consultant's personal account.
 * Unlike workspace-level sync, conversations are inserted with workspace_id = NULL
 * and source_type = 'consultant', then distributed to workspaces by the distribution engine.
 */

import { query, getClient } from '../db.js';
import { FirefliesClient } from './fireflies/client.js';
import { transformFirefliesTranscript } from './fireflies/transform.js';
import {
  getConsultantConnector,
  updateConsultantConnector,
} from './consultant-connector.js';
import { distributeConsultantCalls } from './consultant-distributor.js';

export interface ConsultantSyncResult {
  synced: number;
  skipped: number;
  distributed: {
    processed: number;
    tier1_email: number;
    tier2_calendar: number;
    tier3_transcript: number;
    unmatched: number;
  };
  total_transcripts: number;
  errors: string[];
}

export async function syncConsultantFireflies(connectorId: string): Promise<ConsultantSyncResult> {
  const connector = await getConsultantConnector(connectorId);
  if (!connector) {
    throw new Error(`Consultant connector ${connectorId} not found`);
  }

  if (connector.source !== 'fireflies') {
    throw new Error(`Connector ${connectorId} is ${connector.source}, not fireflies`);
  }

  const apiKey = connector.credentials?.api_key;
  if (!apiKey) {
    throw new Error(`No API key configured for connector ${connectorId}`);
  }

  const client = new FirefliesClient(apiKey);
  const errors: string[] = [];

  // Fetch transcripts since last sync (or 30 days for first sync)
  const since = connector.last_synced_at
    ? new Date(connector.last_synced_at)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  console.log(`[ConsultantSync] Syncing Fireflies for connector ${connectorId} since ${since.toISOString()}`);

  let transcripts;
  try {
    transcripts = await client.getAllTranscripts({ afterDate: since });
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error(`[ConsultantSync] Fireflies API error: ${msg}`);
    await updateConsultantConnector(connectorId, { status: 'error' });
    throw new Error(`Fireflies API error: ${msg}`);
  }

  let synced = 0;
  let skipped = 0;

  for (const transcript of transcripts) {
    try {
      // Check if already synced (idempotent by source + source_id)
      const existing = await query(
        `SELECT id FROM conversations WHERE source = 'fireflies' AND source_id = $1`,
        [transcript.id]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Normalize using existing transform (with a dummy workspace_id that we'll override)
      const conversation = transformFirefliesTranscript(transcript, '');

      // Insert conversation with NULL workspace_id and consultant source_type
      const dbClient = await getClient();
      try {
        await dbClient.query('BEGIN');

        const insertResult = await dbClient.query(
          `INSERT INTO conversations (
            workspace_id, source, source_id, source_data,
            title, call_date, duration_seconds, participants,
            transcript_text, summary,
            action_items, objections,
            sentiment_score, talk_listen_ratio,
            topics, competitor_mentions,
            custom_fields, source_type,
            created_at, updated_at
          ) VALUES (
            NULL, $1, $2, $3,
            $4, $5, $6, $7,
            $8, $9,
            $10, $11,
            $12, $13,
            $14, $15,
            $16, 'consultant',
            NOW(), NOW()
          )
          ON CONFLICT DO NOTHING
          RETURNING id`,
          [
            conversation.source,
            conversation.source_id,
            JSON.stringify(conversation.source_data),
            conversation.title,
            conversation.call_date,
            conversation.duration_seconds,
            JSON.stringify(conversation.participants),
            conversation.transcript_text,
            conversation.summary,
            JSON.stringify(conversation.action_items),
            JSON.stringify(conversation.objections),
            conversation.sentiment_score,
            conversation.talk_listen_ratio ? JSON.stringify(conversation.talk_listen_ratio) : null,
            JSON.stringify(conversation.topics),
            JSON.stringify(conversation.competitor_mentions),
            JSON.stringify(conversation.custom_fields),
          ]
        );

        if (insertResult.rows.length > 0) {
          const conversationId = insertResult.rows[0].id;

          // Create assignment tracking record
          await dbClient.query(
            `INSERT INTO consultant_call_assignments (consultant_connector_id, conversation_id)
             VALUES ($1, $2)
             ON CONFLICT (conversation_id) DO NOTHING`,
            [connectorId, conversationId]
          );

          synced++;
        } else {
          skipped++;
        }

        await dbClient.query('COMMIT');
      } catch (txErr) {
        await dbClient.query('ROLLBACK');
        throw txErr;
      } finally {
        dbClient.release();
      }
    } catch (err: any) {
      errors.push(`Transcript ${transcript.id}: ${err.message}`);
    }
  }

  // Update last_synced_at
  await updateConsultantConnector(connectorId, {
    last_synced_at: new Date().toISOString(),
    status: 'connected',
  });

  console.log(
    `[ConsultantSync] Synced ${synced} new, ${skipped} skipped, ${errors.length} errors out of ${transcripts.length} total`
  );

  // Run distribution engine on unassigned calls
  let distributionResult;
  try {
    distributionResult = await distributeConsultantCalls(connectorId);
  } catch (err: any) {
    console.error(`[ConsultantSync] Distribution failed: ${err.message}`);
    errors.push(`Distribution: ${err.message}`);
    distributionResult = { processed: 0, tier1_email: 0, tier2_calendar: 0, tier3_transcript: 0, unmatched: 0, errors: [] };
  }

  return {
    synced,
    skipped,
    distributed: {
      processed: distributionResult.processed,
      tier1_email: distributionResult.tier1_email,
      tier2_calendar: distributionResult.tier2_calendar,
      tier3_transcript: distributionResult.tier3_transcript,
      unmatched: distributionResult.unmatched,
    },
    total_transcripts: transcripts.length,
    errors,
  };
}
