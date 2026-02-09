import { query, getClient } from '../../db.js';
import { HubSpotClient } from './client.js';
import {
  transformDeal,
  transformContact,
  transformCompany,
  type NormalizedDeal,
  type NormalizedContact,
  type NormalizedAccount,
} from './transform.js';
import type { SyncResult } from '../_interface.js';

const BATCH_SIZE = 500;

async function upsertInBatches<T>(
  items: T[],
  upsertFn: (batch: T[]) => Promise<number>
): Promise<number> {
  let stored = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    stored += await upsertFn(batch);
  }
  return stored;
}

async function upsertDeals(deals: NormalizedDeal[]): Promise<number> {
  return upsertInBatches(deals, async (batch) => {
    if (batch.length === 0) return 0;

    const client = await getClient();
    let stored = 0;
    try {
      await client.query('BEGIN');

      for (const deal of batch) {
        await client.query(
          `INSERT INTO deals (
            workspace_id, source, source_id, source_data,
            name, amount, stage, close_date, owner,
            probability, forecast_category, pipeline,
            last_activity_date, custom_fields, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9,
            $10, $11, $12,
            $13, $14, NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data = EXCLUDED.source_data,
            name = EXCLUDED.name,
            amount = EXCLUDED.amount,
            stage = EXCLUDED.stage,
            close_date = EXCLUDED.close_date,
            owner = EXCLUDED.owner,
            probability = EXCLUDED.probability,
            forecast_category = EXCLUDED.forecast_category,
            pipeline = EXCLUDED.pipeline,
            last_activity_date = EXCLUDED.last_activity_date,
            custom_fields = EXCLUDED.custom_fields,
            updated_at = NOW()`,
          [
            deal.workspace_id, deal.source, deal.source_id, JSON.stringify(deal.source_data),
            deal.name, deal.amount, deal.stage, deal.close_date, deal.owner,
            deal.probability, deal.forecast_category, deal.pipeline,
            deal.last_activity_date, JSON.stringify(deal.custom_fields),
          ]
        );
        stored++;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return stored;
  });
}

async function upsertContacts(contacts: NormalizedContact[]): Promise<number> {
  return upsertInBatches(contacts, async (batch) => {
    if (batch.length === 0) return 0;

    const client = await getClient();
    let stored = 0;
    try {
      await client.query('BEGIN');

      for (const contact of batch) {
        await client.query(
          `INSERT INTO contacts (
            workspace_id, source, source_id, source_data,
            email, first_name, last_name, title, seniority,
            department, lifecycle_stage, engagement_score,
            phone, last_activity_date, custom_fields, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9,
            $10, $11, $12,
            $13, $14, $15, NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data = EXCLUDED.source_data,
            email = EXCLUDED.email,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            title = EXCLUDED.title,
            seniority = EXCLUDED.seniority,
            department = EXCLUDED.department,
            lifecycle_stage = EXCLUDED.lifecycle_stage,
            engagement_score = EXCLUDED.engagement_score,
            phone = EXCLUDED.phone,
            last_activity_date = EXCLUDED.last_activity_date,
            custom_fields = EXCLUDED.custom_fields,
            updated_at = NOW()`,
          [
            contact.workspace_id, contact.source, contact.source_id, JSON.stringify(contact.source_data),
            contact.email, contact.first_name, contact.last_name, contact.title, contact.seniority,
            contact.department, contact.lifecycle_stage, contact.engagement_score,
            contact.phone, contact.last_activity_date, JSON.stringify(contact.custom_fields),
          ]
        );
        stored++;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return stored;
  });
}

async function upsertAccounts(accounts: NormalizedAccount[]): Promise<number> {
  return upsertInBatches(accounts, async (batch) => {
    if (batch.length === 0) return 0;

    const client = await getClient();
    let stored = 0;
    try {
      await client.query('BEGIN');

      for (const account of batch) {
        await client.query(
          `INSERT INTO accounts (
            workspace_id, source, source_id, source_data,
            name, domain, industry, employee_count,
            annual_revenue, owner, custom_fields, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, $11, NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data = EXCLUDED.source_data,
            name = EXCLUDED.name,
            domain = EXCLUDED.domain,
            industry = EXCLUDED.industry,
            employee_count = EXCLUDED.employee_count,
            annual_revenue = EXCLUDED.annual_revenue,
            owner = EXCLUDED.owner,
            custom_fields = EXCLUDED.custom_fields,
            updated_at = NOW()`,
          [
            account.workspace_id, account.source, account.source_id, JSON.stringify(account.source_data),
            account.name, account.domain, account.industry, account.employee_count,
            account.annual_revenue, account.owner, JSON.stringify(account.custom_fields),
          ]
        );
        stored++;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return stored;
  });
}

export async function initialSync(
  client: HubSpotClient,
  workspaceId: string
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalFetched = 0;
  let totalStored = 0;

  console.log(`[HubSpot Sync] Starting initial sync for workspace ${workspaceId}`);

  try {
    let rawDeals: any[] = [];
    let rawContacts: any[] = [];
    let rawCompanies: any[] = [];

    try { rawDeals = await client.getAllDeals(false); }
    catch (err: any) { errors.push(`Failed to fetch deals: ${err.message}`); }

    try { rawContacts = await client.getAllContacts(false); }
    catch (err: any) { errors.push(`Failed to fetch contacts: ${err.message}`); }

    try { rawCompanies = await client.getAllCompanies(false); }
    catch (err: any) { errors.push(`Failed to fetch companies: ${err.message}`); }

    totalFetched = rawDeals.length + rawContacts.length + rawCompanies.length;
    console.log(`[HubSpot Sync] Fetched ${rawDeals.length} deals, ${rawContacts.length} contacts, ${rawCompanies.length} companies`);

    const normalizedDeals = rawDeals.map(d => transformDeal(d, workspaceId));
    const normalizedContacts = rawContacts.map(c => transformContact(c, workspaceId));
    const normalizedAccounts = rawCompanies.map(c => transformCompany(c, workspaceId));

    const [dealsStored, contactsStored, accountsStored] = await Promise.all([
      upsertDeals(normalizedDeals).catch(err => {
        console.error(`[HubSpot Sync] Failed to store deals:`, err.message);
        errors.push(`Failed to store deals: ${err.message}`);
        return 0;
      }),
      upsertContacts(normalizedContacts).catch(err => {
        console.error(`[HubSpot Sync] Failed to store contacts:`, err.message);
        errors.push(`Failed to store contacts: ${err.message}`);
        return 0;
      }),
      upsertAccounts(normalizedAccounts).catch(err => {
        console.error(`[HubSpot Sync] Failed to store accounts:`, err.message);
        errors.push(`Failed to store accounts: ${err.message}`);
        return 0;
      }),
    ]);

    totalStored = dealsStored + contactsStored + accountsStored;
    console.log(`[HubSpot Sync] Stored ${dealsStored} deals, ${contactsStored} contacts, ${accountsStored} accounts`);

    await updateConnectionSyncStatus(workspaceId, 'hubspot', totalStored, errors.length > 0 ? errors[0] : null);

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown sync error';
    errors.push(msg);
    console.error(`[HubSpot Sync] Fatal error during initial sync:`, msg);
  }

  return {
    recordsFetched: totalFetched,
    recordsStored: totalStored,
    errors,
    duration: Date.now() - startTime,
  };
}

export async function incrementalSync(
  hubspotClient: HubSpotClient,
  workspaceId: string,
  since: Date
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalFetched = 0;
  let totalStored = 0;

  console.log(`[HubSpot Sync] Starting incremental sync for workspace ${workspaceId} since ${since.toISOString()}`);

  const dealProps = [
    "dealname", "amount", "dealstage", "closedate", "createdate",
    "hs_lastmodifieddate", "pipeline", "hubspot_owner_id",
    "hs_deal_stage_probability", "notes_last_updated",
    "closed_lost_reason", "closed_won_reason", "hs_closed_lost_competitor",
  ];

  const contactProps = [
    "firstname", "lastname", "email", "phone", "company",
    "jobtitle", "lifecyclestage", "hs_lead_status",
    "createdate", "lastmodifieddate", "hubspot_owner_id",
    "hs_analytics_source", "hubspotscore", "hs_buying_role",
  ];

  const companyProps = [
    "name", "domain", "industry", "numberofemployees",
    "annualrevenue", "city", "state", "country",
    "createdate", "hs_lastmodifieddate",
  ];

  try {
    const fetchAllPages = async (
      objectType: "deals" | "contacts" | "companies",
      properties: string[]
    ) => {
      const allResults: Array<{ id: string; properties: Record<string, string | null> }> = [];
      let after: string | undefined;

      do {
        const response = await hubspotClient.searchRecentlyModified(
          objectType, since, properties, 100, after
        );
        allResults.push(...response.results);
        after = response.paging?.next?.after;
      } while (after);

      return allResults;
    };

    const [rawDeals, rawContacts, rawCompanies] = await Promise.all([
      fetchAllPages("deals", dealProps).catch(err => {
        errors.push(`Failed to fetch modified deals: ${err.message}`);
        return [];
      }),
      fetchAllPages("contacts", contactProps).catch(err => {
        errors.push(`Failed to fetch modified contacts: ${err.message}`);
        return [];
      }),
      fetchAllPages("companies", companyProps).catch(err => {
        errors.push(`Failed to fetch modified companies: ${err.message}`);
        return [];
      }),
    ]);

    totalFetched = rawDeals.length + rawContacts.length + rawCompanies.length;
    console.log(`[HubSpot Sync] Incremental: ${rawDeals.length} deals, ${rawContacts.length} contacts, ${rawCompanies.length} companies modified since ${since.toISOString()}`);

    const normalizedDeals = rawDeals.map(d => transformDeal(
      { id: d.id, properties: d.properties as any } as any,
      workspaceId
    ));
    const normalizedContacts = rawContacts.map(c => transformContact(
      { id: c.id, properties: c.properties as any } as any,
      workspaceId
    ));
    const normalizedAccounts = rawCompanies.map(c => transformCompany(
      { id: c.id, properties: c.properties as any } as any,
      workspaceId
    ));

    const [dealsStored, contactsStored, accountsStored] = await Promise.all([
      upsertDeals(normalizedDeals).catch(err => { errors.push(`Failed to store deals: ${err.message}`); return 0; }),
      upsertContacts(normalizedContacts).catch(err => { errors.push(`Failed to store contacts: ${err.message}`); return 0; }),
      upsertAccounts(normalizedAccounts).catch(err => { errors.push(`Failed to store accounts: ${err.message}`); return 0; }),
    ]);

    totalStored = dealsStored + contactsStored + accountsStored;
    await updateConnectionSyncStatus(workspaceId, 'hubspot', totalStored, errors.length > 0 ? errors[0] : null);

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown sync error';
    errors.push(msg);
  }

  return {
    recordsFetched: totalFetched,
    recordsStored: totalStored,
    errors,
    duration: Date.now() - startTime,
  };
}

export async function backfillAssociations(
  hubspotClient: HubSpotClient,
  workspaceId: string
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalFetched = 0;
  let totalStored = 0;

  console.log(`[HubSpot Sync] Starting association backfill for workspace ${workspaceId}`);

  try {
    const dealsResult = await query<{ source_id: string; source_data: any }>(
      `SELECT source_id, source_data FROM deals WHERE workspace_id = $1 AND source = 'hubspot'`,
      [workspaceId]
    );

    for (const deal of dealsResult.rows) {
      const existingAssociations = deal.source_data?.associations;
      if (existingAssociations?.contacts && existingAssociations?.companies) {
        continue;
      }

      try {
        const [contactIds, companyIds] = await Promise.all([
          hubspotClient.getAssociations("deals", "contacts", deal.source_id),
          hubspotClient.getAssociations("deals", "companies", deal.source_id),
        ]);

        totalFetched += 2;

        const updatedSourceData = {
          ...deal.source_data,
          associations: {
            contacts: { results: contactIds.map(id => ({ id })) },
            companies: { results: companyIds.map(id => ({ id })) },
          },
        };

        await query(
          `UPDATE deals SET source_data = $1, updated_at = NOW()
           WHERE workspace_id = $2 AND source = 'hubspot' AND source_id = $3`,
          [JSON.stringify(updatedSourceData), workspaceId, deal.source_id]
        );

        totalStored++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Failed to backfill associations for deal ${deal.source_id}: ${msg}`);
      }
    }

    console.log(`[HubSpot Sync] Backfilled associations for ${totalStored} deals`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    errors.push(msg);
  }

  return {
    recordsFetched: totalFetched,
    recordsStored: totalStored,
    errors,
    duration: Date.now() - startTime,
  };
}

async function updateConnectionSyncStatus(
  workspaceId: string,
  connectorName: string,
  recordsSynced: number,
  errorMessage: string | null
): Promise<void> {
  try {
    await query(
      `UPDATE connections SET
        last_sync_at = NOW(),
        status = $1,
        error_message = $2,
        sync_cursor = COALESCE(sync_cursor, '{}'::jsonb) || $3::jsonb,
        updated_at = NOW()
      WHERE workspace_id = $4 AND connector_name = $5`,
      [
        errorMessage ? 'degraded' : 'healthy',
        errorMessage,
        JSON.stringify({ lastSyncRecords: recordsSynced, lastSyncAt: new Date().toISOString() }),
        workspaceId,
        connectorName,
      ]
    );
  } catch (err) {
    console.error('[HubSpot Sync] Failed to update connection sync status:', err);
  }
}
