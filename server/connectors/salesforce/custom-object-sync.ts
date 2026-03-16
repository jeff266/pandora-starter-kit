/**
 * Custom Object Sync — Conversations
 *
 * Reads workspace_config.custom_objects and for each entry with
 * mode='map_to_entity' + target='conversations', queries the custom
 * Salesforce object via SOQL and upserts records into the conversations table.
 *
 * Field map keys are Pandora conversation fields; values are SF API field names.
 * Required: title, call_date. Optional: duration_seconds, transcript_text,
 *           summary, sentiment_score, participants, deal_id, account_id.
 */

import { query as dbQuery, getClient } from '../../db.js';
import { createLogger } from '../../utils/logger.js';
import type { SalesforceClient } from './client.js';

const logger = createLogger('SalesforceCustomObjectSync');

export interface CustomObjectConfig {
  id: string;
  connector: 'salesforce';
  object_name: string;
  label: string;
  mode: 'map_to_entity';
  target: 'conversations';
  field_map: Record<string, string>;
}

// Pandora conversation fields that users can map
export const PANDORA_CONVERSATION_FIELDS = [
  { key: 'title',            label: 'Call Title / Name',           type: 'string',   required: true  },
  { key: 'call_date',        label: 'Call Date',                   type: 'datetime', required: true  },
  { key: 'duration_seconds', label: 'Duration (seconds)',          type: 'number',   required: false },
  { key: 'transcript_text',  label: 'Transcript / Body',           type: 'text',     required: false },
  { key: 'summary',          label: 'Summary / Description',       type: 'text',     required: false },
  { key: 'sentiment_score',  label: 'Sentiment Score (0–1)',       type: 'number',   required: false },
  { key: 'participants',     label: 'Participants (emails/names)',  type: 'string',   required: false },
  { key: 'deal_id',          label: 'Related Opportunity / Deal',  type: 'reference',required: false },
  { key: 'account_id',       label: 'Related Account',             type: 'reference',required: false },
] as const;

async function getCustomObjectConfigs(workspaceId: string): Promise<CustomObjectConfig[]> {
  try {
    const result = await dbQuery<{ definitions: any }>(
      `SELECT definitions FROM workspace_definitions
       WHERE workspace_id = $1 AND category = 'settings' AND key = 'workspace_config'
       LIMIT 1`,
      [workspaceId]
    );
    const defs = result.rows[0]?.definitions ?? {};
    const all: CustomObjectConfig[] = defs.custom_objects ?? [];
    return all.filter(o => o.mode === 'map_to_entity' && o.target === 'conversations');
  } catch {
    return [];
  }
}

function buildSOQL(objectName: string, fieldMap: Record<string, string>, since?: Date): string {
  const sfFields = new Set<string>(['Id', 'CreatedDate', 'LastModifiedDate']);
  for (const sfField of Object.values(fieldMap)) {
    if (sfField) sfFields.add(sfField);
  }

  const fieldList = [...sfFields].join(', ');
  let soql = `SELECT ${fieldList} FROM ${objectName}`;
  if (since) {
    soql += ` WHERE LastModifiedDate > ${since.toISOString()}`;
  }
  soql += ' ORDER BY CreatedDate ASC LIMIT 2000';
  return soql;
}

function transformRecord(
  raw: Record<string, any>,
  workspaceId: string,
  objectName: string,
  fieldMap: Record<string, string>
): Record<string, any> {
  const get = (pandoraKey: string) => {
    const sfKey = fieldMap[pandoraKey];
    return sfKey ? raw[sfKey] : null;
  };

  // title — required
  const title = get('title') ?? raw.Name ?? raw.Subject ?? `${objectName} ${raw.Id}`;

  // call_date — required
  const rawDate = get('call_date') ?? raw.CreatedDate;
  const callDate = rawDate ? new Date(rawDate) : null;

  // duration_seconds
  const rawDuration = get('duration_seconds');
  const durationSeconds = rawDuration !== null && rawDuration !== undefined
    ? Math.round(Number(rawDuration))
    : null;

  // transcript_text
  const transcriptText = get('transcript_text') ?? null;

  // summary
  const summary = get('summary') ?? null;

  // sentiment_score
  const rawSentiment = get('sentiment_score');
  const sentimentScore = rawSentiment !== null && rawSentiment !== undefined
    ? Math.min(1, Math.max(0, Number(rawSentiment)))
    : null;

  // participants — convert comma-separated string to array of simple objects
  const rawParticipants = get('participants');
  let participants: any[] = [];
  if (rawParticipants) {
    const parts = String(rawParticipants).split(/[,;]/).map(s => s.trim()).filter(Boolean);
    participants = parts.map(p => ({ name: p, email: p.includes('@') ? p : undefined }));
  }

  // deal linkage — store SF opp id in custom_fields for later resolution
  const dealRef = get('deal_id') ?? null;
  const accountRef = get('account_id') ?? null;

  const customFields: Record<string, any> = {
    sf_object: objectName,
    sf_id: raw.Id,
  };
  if (dealRef) customFields.sf_opportunity_id = dealRef;
  if (accountRef) customFields.sf_account_id = accountRef;

  // unmapped SF fields → custom_fields
  for (const [sfKey, value] of Object.entries(raw)) {
    if (sfKey === 'attributes') continue;
    const isMapped = Object.values(fieldMap).includes(sfKey) || sfKey === 'Id' || sfKey === 'CreatedDate' || sfKey === 'LastModifiedDate';
    if (!isMapped) customFields[sfKey] = value;
  }

  return {
    workspace_id: workspaceId,
    source: `salesforce:${objectName}`,
    source_id: raw.Id,
    source_data: raw,
    title,
    call_date: callDate,
    duration_seconds: durationSeconds,
    participants: JSON.stringify(participants),
    transcript_text: transcriptText,
    summary,
    action_items: JSON.stringify([]),
    objections: JSON.stringify([]),
    sentiment_score: sentimentScore,
    talk_listen_ratio: null,
    topics: JSON.stringify([]),
    competitor_mentions: JSON.stringify([]),
    custom_fields: JSON.stringify(customFields),
    is_internal: false,
    call_disposition: null,
    decision_makers_mentioned: JSON.stringify([]),
  };
}

async function upsertConversations(records: Record<string, any>[]): Promise<{ inserted: number; failed: number }> {
  if (records.length === 0) return { inserted: 0, failed: 0 };

  const client = await getClient();
  let inserted = 0;
  let failed = 0;

  try {
    await client.query('BEGIN');

    for (const r of records) {
      try {
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
            $5, $6, $7, $8::jsonb,
            $9, $10,
            $11::jsonb, $12::jsonb,
            $13, $14,
            $15::jsonb, $16::jsonb,
            $17::jsonb,
            $18, $19, $20::jsonb,
            NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data  = EXCLUDED.source_data,
            title        = EXCLUDED.title,
            call_date    = EXCLUDED.call_date,
            duration_seconds = EXCLUDED.duration_seconds,
            participants = EXCLUDED.participants,
            transcript_text  = COALESCE(conversations.transcript_text, EXCLUDED.transcript_text),
            summary      = COALESCE(conversations.summary, EXCLUDED.summary),
            sentiment_score  = EXCLUDED.sentiment_score,
            custom_fields    = EXCLUDED.custom_fields,
            updated_at   = NOW()`,
          [
            r.workspace_id, r.source, r.source_id, JSON.stringify(r.source_data),
            r.title, r.call_date, r.duration_seconds, r.participants,
            r.transcript_text, r.summary,
            r.action_items, r.objections,
            r.sentiment_score, r.talk_listen_ratio,
            r.topics, r.competitor_mentions,
            r.custom_fields,
            r.is_internal, r.call_disposition, r.decision_makers_mentioned,
          ]
        );
        inserted++;
      } catch (err) {
        failed++;
        logger.warn('[CustomObjectSync] Row upsert failed', { sourceId: r.source_id, error: err instanceof Error ? err.message : err });
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { inserted, failed };
}

/**
 * Main entry point — called from Salesforce adapter during sync.
 */
export async function syncCustomObjects(
  sfClient: SalesforceClient,
  workspaceId: string,
  since?: Date
): Promise<void> {
  const configs = await getCustomObjectConfigs(workspaceId);
  if (configs.length === 0) return;

  for (const config of configs) {
    try {
      logger.info('[CustomObjectSync] Syncing custom object', {
        workspaceId,
        objectName: config.object_name,
        since: since?.toISOString(),
      });

      const soql = buildSOQL(config.object_name, config.field_map, since);
      const result = await sfClient.query<Record<string, any>>(soql);
      const records = result.records ?? [];

      if (records.length === 0) {
        logger.info('[CustomObjectSync] No records found', { objectName: config.object_name });
        continue;
      }

      const transformed = records.map(raw =>
        transformRecord(raw, workspaceId, config.object_name, config.field_map)
      );

      const { inserted, failed } = await upsertConversations(transformed);

      logger.info('[CustomObjectSync] Upsert complete', {
        workspaceId,
        objectName: config.object_name,
        total: records.length,
        inserted,
        failed,
      });
    } catch (err) {
      logger.error('[CustomObjectSync] Failed to sync custom object', err as Error, {
        workspaceId,
        objectName: config.object_name,
      });
    }
  }
}
