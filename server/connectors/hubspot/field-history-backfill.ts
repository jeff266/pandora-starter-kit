import { query } from '../../db.js';
import { HubSpotClient } from './client.js';
import type { PropertyHistoryEntry } from './client.js';

const TRACKED_PROPERTIES = ['forecastcategory', 'amount', 'closedate'] as const;
type TrackedProperty = typeof TRACKED_PROPERTIES[number];

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;

export interface FieldHistoryBackfillResult {
  total: number;
  processed: number;
  entriesCreated: number;
  errors: number;
}

export async function backfillFieldHistory(
  workspaceId: string,
  accessToken: string,
  options: { fullBackfill?: boolean } = {}
): Promise<FieldHistoryBackfillResult> {
  const hubspotClient = new HubSpotClient(accessToken, workspaceId);
  console.log(`[FieldHistoryBackfill] Starting for workspace ${workspaceId} — tracking: ${TRACKED_PROPERTIES.join(', ')}`);

  const dealsResult = await query<{ id: string; source_id: string }>(
    `SELECT d.id, d.source_id
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.source = 'hubspot'
       AND d.source_id IS NOT NULL
     ${!options.fullBackfill ? `AND NOT EXISTS (
       SELECT 1 FROM deal_field_history fh
       WHERE fh.deal_id = d.id AND fh.field_name = 'forecastcategory'
     )` : ''}
     ORDER BY d.created_at DESC`,
    [workspaceId]
  );

  const deals = dealsResult.rows;
  console.log(`[FieldHistoryBackfill] ${deals.length} deals to process`);

  let processed = 0;
  let entriesCreated = 0;
  let errors = 0;

  for (let i = 0; i < deals.length; i += BATCH_SIZE) {
    const batch = deals.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(deal => fetchAllFieldHistory(hubspotClient, deal.source_id))
    );

    for (let j = 0; j < results.length; j++) {
      const deal = batch[j];
      const result = results[j];

      if (result.status === 'rejected') {
        console.error(`[FieldHistoryBackfill] Failed for deal ${deal.source_id}:`, result.reason);
        errors++;
        continue;
      }

      try {
        const created = await storeFieldHistory(workspaceId, deal.id, deal.source_id, result.value);
        entriesCreated += created;
        processed++;
      } catch (err) {
        console.error(`[FieldHistoryBackfill] Failed to store history for deal ${deal.id}:`, err);
        errors++;
      }
    }

    if (i + BATCH_SIZE < deals.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= deals.length) {
      console.log(`[FieldHistoryBackfill] Progress: ${Math.min(i + BATCH_SIZE, deals.length)}/${deals.length} deals`);
    }
  }

  const result: FieldHistoryBackfillResult = { total: deals.length, processed, entriesCreated, errors };
  console.log(`[FieldHistoryBackfill] Complete:`, result);
  return result;
}

async function fetchAllFieldHistory(
  client: HubSpotClient,
  sourceId: string
): Promise<Record<TrackedProperty, PropertyHistoryEntry[]>> {
  const propertiesParam = TRACKED_PROPERTIES.join(',');
  const endpoint = `/crm/v3/objects/deals/${sourceId}?propertiesWithHistory=${propertiesParam}`;

  try {
    const response = (await (client as any).request(endpoint)) as {
      propertiesWithHistory?: Record<string, PropertyHistoryEntry[]>;
    };

    const result: Record<TrackedProperty, PropertyHistoryEntry[]> = {
      forecastcategory: [],
      amount: [],
      closedate: [],
    };

    for (const prop of TRACKED_PROPERTIES) {
      result[prop] = response.propertiesWithHistory?.[prop] ?? [];
    }

    return result;
  } catch {
    return { forecastcategory: [], amount: [], closedate: [] };
  }
}

async function storeFieldHistory(
  workspaceId: string,
  dealId: string,
  dealSourceId: string,
  historyByField: Record<TrackedProperty, PropertyHistoryEntry[]>
): Promise<number> {
  let count = 0;

  for (const fieldName of TRACKED_PROPERTIES) {
    const history = historyByField[fieldName];
    if (history.length === 0) continue;

    const reversed = [...history].reverse();

    for (let i = 0; i < reversed.length; i++) {
      const entry = reversed[i];
      const fromEntry = i > 0 ? reversed[i - 1] : null;

      try {
        await query(
          `INSERT INTO deal_field_history
             (workspace_id, deal_id, deal_source_id, field_name, from_value, to_value, changed_at, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (deal_id, field_name, changed_at, to_value) DO NOTHING`,
          [
            workspaceId,
            dealId,
            dealSourceId,
            fieldName,
            fromEntry?.value ?? null,
            entry.value,
            new Date(entry.timestamp).toISOString(),
            'hubspot_history',
          ]
        );
        count++;
      } catch {
      }
    }
  }

  return count;
}
