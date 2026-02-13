import { query } from '../db.js';
import { HubSpotClient } from '../connectors/hubspot/client.js';
import { getConnectorCredentials } from '../lib/credential-store.js';

export interface BackfillResult {
  dealsProcessed: number;
  contactLinksCreated: number;
  accountLinksCreated: number;
  errors: string[];
  duration: number;
}

export async function backfillHubSpotAssociations(
  workspaceId: string
): Promise<BackfillResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let dealsProcessed = 0;
  let contactLinksCreated = 0;
  let accountLinksCreated = 0;

  // Check if HubSpot connection exists and is active
  const connResult = await query<{ status: string }>(
    `SELECT status FROM connections
     WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status IN ('connected', 'synced')`,
    [workspaceId]
  );

  if (connResult.rows.length === 0) {
    return { dealsProcessed: 0, contactLinksCreated: 0, accountLinksCreated: 0, errors: ['No active HubSpot connection'], duration: 0 };
  }

  // Get credentials from credential store
  const creds = await getConnectorCredentials(workspaceId, 'hubspot');
  if (!creds) {
    return { dealsProcessed: 0, contactLinksCreated: 0, accountLinksCreated: 0, errors: ['HubSpot credentials not found'], duration: 0 };
  }

  const client = new HubSpotClient(creds.accessToken);

  const dealsResult = await query<{ id: string; source_id: string; source_data: any }>(
    `SELECT id, source_id, source_data FROM deals
     WHERE workspace_id = $1 AND source = 'hubspot'`,
    [workspaceId]
  );

  const deals = dealsResult.rows;
  console.log(`[Backfill] Processing ${deals.length} HubSpot deals for workspace ${workspaceId}`);

  const BATCH_SIZE = 10;

  for (let i = 0; i < deals.length; i += BATCH_SIZE) {
    const batch = deals.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (deal) => {
      try {
        const [contactIds, companyIds] = await Promise.all([
          client.getAssociations('deals', 'contacts', deal.source_id),
          client.getAssociations('deals', 'companies', deal.source_id),
        ]);

        let accountId: string | null = null;
        let contactLinkCount = 0;

        if (companyIds.length > 0) {
          const accountResult = await query<{ id: string }>(
            `SELECT id FROM accounts
             WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = $2
             LIMIT 1`,
            [workspaceId, companyIds[0]]
          );

          if (accountResult.rows.length > 0) {
            accountId = accountResult.rows[0].id;
          }
        }

        if (contactIds.length > 0) {
          const contactResult = await query<{ id: string }>(
            `SELECT id FROM contacts
             WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = ANY($2)`,
            [workspaceId, contactIds]
          );
          contactLinkCount = contactResult.rows.length;
        }

        const updatedSourceData = {
          ...deal.source_data,
          associations: {
            contacts: { results: contactIds.map((id) => ({ id })) },
            companies: { results: companyIds.map((id) => ({ id })) },
          },
        };

        await query(
          `UPDATE deals
           SET account_id = COALESCE($1, account_id),
               source_data = $2,
               updated_at = NOW()
           WHERE id = $3 AND workspace_id = $4`,
          [accountId, JSON.stringify(updatedSourceData), deal.id, workspaceId]
        );

        dealsProcessed++;
        if (accountId) accountLinksCreated++;
        contactLinksCreated += contactLinkCount;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Deal ${deal.source_id}: ${msg}`);
      }
    });

    await Promise.all(batchPromises);
  }

  const duration = Date.now() - startTime;
  console.log(
    `[Backfill] Updated associations for ${dealsProcessed} deals in workspace ${workspaceId} (${duration}ms)`
  );

  return { dealsProcessed, contactLinksCreated, accountLinksCreated, errors, duration };
}
