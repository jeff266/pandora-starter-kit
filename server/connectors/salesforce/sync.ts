import { query, getClient } from '../../db.js';
import { SalesforceClient } from './client.js';
import { transformOpportunity, transformContact, transformAccount } from './transform.js';
import type { NormalizedDeal, NormalizedContact, NormalizedAccount } from './transform.js';
import type { SalesforceStage } from './types.js';
import { createLogger } from '../../utils/logger.js';
import { computeFields } from '../../computed-fields/engine.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';

const logger = createLogger('SalesforceSync');

const BATCH_SIZE = 500;
const SOURCE = 'salesforce';

export interface SyncResult {
  success: boolean;
  accounts: { fetched: number; stored: number };
  contacts: { fetched: number; stored: number };
  deals: { fetched: number; stored: number };
  computedFields: any;
  duration: number;
  errors: string[];
}

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
            name, amount, stage, stage_normalized, close_date, owner,
            probability, forecast_category, pipeline,
            last_activity_date, custom_fields, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9, $10,
            $11, $12, $13,
            $14, $15, NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data = EXCLUDED.source_data,
            name = EXCLUDED.name,
            amount = EXCLUDED.amount,
            stage = EXCLUDED.stage,
            stage_normalized = EXCLUDED.stage_normalized,
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
            deal.name, deal.amount, deal.stage, deal.stage_normalized, deal.close_date, deal.owner,
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

async function resolveAccountIds(
  workspaceId: string,
  sourceIds: Set<string>
): Promise<Map<string, string>> {
  const sourceIdToUuid = new Map<string, string>();
  if (sourceIds.size === 0) return sourceIdToUuid;

  const idsArray = Array.from(sourceIds);
  const result = await query<{ id: string; source_id: string }>(
    `SELECT id, source_id FROM accounts
     WHERE workspace_id = $1 AND source = 'salesforce' AND source_id = ANY($2)`,
    [workspaceId, idsArray]
  );

  for (const row of result.rows) {
    sourceIdToUuid.set(row.source_id, row.id);
  }
  return sourceIdToUuid;
}

async function resolveContactIds(
  workspaceId: string,
  sourceIds: Set<string>
): Promise<Map<string, string>> {
  const sourceIdToUuid = new Map<string, string>();
  if (sourceIds.size === 0) return sourceIdToUuid;

  const idsArray = Array.from(sourceIds);
  const result = await query<{ id: string; source_id: string }>(
    `SELECT id, source_id FROM contacts
     WHERE workspace_id = $1 AND source = 'salesforce' AND source_id = ANY($2)`,
    [workspaceId, idsArray]
  );

  for (const row of result.rows) {
    sourceIdToUuid.set(row.source_id, row.id);
  }
  return sourceIdToUuid;
}

async function updateDealForeignKeys(
  workspaceId: string,
  deals: NormalizedDeal[],
  accountMap: Map<string, string>,
  contactMap: Map<string, string>
): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const deal of deals) {
      const accountUuid = deal.account_source_id ? accountMap.get(deal.account_source_id) ?? null : null;
      const contactUuid = deal.contact_source_ids.length > 0
        ? contactMap.get(deal.contact_source_ids[0]) ?? null
        : null;

      if (accountUuid || contactUuid) {
        await client.query(
          `UPDATE deals SET
            account_id = COALESCE($1, account_id),
            contact_id = COALESCE($2, contact_id),
            updated_at = NOW()
          WHERE workspace_id = $3 AND source = 'salesforce' AND source_id = $4`,
          [accountUuid, contactUuid, workspaceId, deal.source_id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to update deal foreign keys', err instanceof Error ? err : undefined);
  } finally {
    client.release();
  }
}

async function updateContactAccountIds(
  workspaceId: string,
  contacts: NormalizedContact[],
  accountMap: Map<string, string>
): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const contact of contacts) {
      const accountUuid = contact.account_source_id ? accountMap.get(contact.account_source_id) ?? null : null;
      if (accountUuid) {
        await client.query(
          `UPDATE contacts SET account_id = $1, updated_at = NOW()
           WHERE workspace_id = $2 AND source = 'salesforce' AND source_id = $3`,
          [accountUuid, workspaceId, contact.source_id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to update contact account_ids', err instanceof Error ? err : undefined);
  } finally {
    client.release();
  }
}

export async function syncSalesforce(
  workspaceId: string,
  credentials: {
    accessToken: string;
    refreshToken: string;
    instanceUrl: string;
    clientId: string;
    clientSecret: string;
  },
  mode: 'full' | 'incremental' = 'full'
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  logger.info('Starting Salesforce sync', { workspaceId, mode });

  // Get watermark for incremental sync
  let watermark: string | null = null;
  if (mode === 'incremental') {
    const connResult = await query<{ last_sync_at: Date | null }>(
      `SELECT last_sync_at FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );
    if (connResult.rows[0]?.last_sync_at) {
      watermark = connResult.rows[0].last_sync_at.toISOString();
      logger.info('Incremental sync watermark', { watermark });
    } else {
      logger.info('No watermark found, falling back to full sync');
    }
  }

  const client = new SalesforceClient({
    accessToken: credentials.accessToken,
    instanceUrl: credentials.instanceUrl,
  });

  const connectionTest = await client.testConnection();
  if (!connectionTest.success) {
    if (connectionTest.error?.includes('INVALID_SESSION_ID') || connectionTest.error?.includes('Session expired')) {
      logger.info('Access token expired, attempting refresh');
      const refreshed = await SalesforceClient.refreshAccessToken(
        credentials.refreshToken,
        credentials.clientId,
        credentials.clientSecret
      );

      await query(
        `UPDATE connections
         SET credentials = credentials || $1::jsonb, updated_at = NOW()
         WHERE workspace_id = $2 AND connector_name = 'salesforce'`,
        [JSON.stringify({ accessToken: refreshed.accessToken, instanceUrl: refreshed.instanceUrl }), workspaceId]
      );

      const refreshedClient = new SalesforceClient({
        accessToken: refreshed.accessToken,
        instanceUrl: refreshed.instanceUrl,
      });

      return runSync(refreshedClient, workspaceId, startTime, errors, watermark);
    }

    return {
      success: false,
      accounts: { fetched: 0, stored: 0 },
      contacts: { fetched: 0, stored: 0 },
      deals: { fetched: 0, stored: 0 },
      computedFields: null,
      duration: Date.now() - startTime,
      errors: [`Connection test failed: ${connectionTest.error}`],
    };
  }

  return runSync(client, workspaceId, startTime, errors, watermark);
}

async function runSync(
  client: SalesforceClient,
  workspaceId: string,
  startTime: number,
  errors: string[],
  watermark: string | null = null
): Promise<SyncResult> {
  let stageMap = new Map<string, SalesforceStage>();
  try {
    const stages = await client.getOpportunityStages();
    stageMap = new Map(stages.map(s => [s.ApiName, s]));
    logger.info('Built stage map', { stageCount: stageMap.size });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    errors.push(`Failed to fetch stage metadata: ${msg}`);
    logger.warn('Failed to fetch stage metadata', { error: msg });
  }

  let oppCount = 0;
  let contactCount = 0;
  let accountCount = 0;

  try {
    const [oppCountResult, contactCountResult, accountCountResult] = await Promise.all([
      client.query<{ expr0: number }>('SELECT COUNT() FROM Opportunity'),
      client.query<{ expr0: number }>('SELECT COUNT() FROM Contact'),
      client.query<{ expr0: number }>('SELECT COUNT() FROM Account'),
    ]);

    oppCount = oppCountResult.records[0]?.expr0 || 0;
    contactCount = contactCountResult.records[0]?.expr0 || 0;
    accountCount = accountCountResult.records[0]?.expr0 || 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn('Failed to get record counts', { error: msg });
  }

  logger.info('Record counts', { opportunities: oppCount, contacts: contactCount, accounts: accountCount });

  // Build WHERE clause for incremental sync
  const whereClause = watermark ? `SystemModstamp >= ${watermark}` : undefined;
  if (whereClause) {
    logger.info('Using incremental WHERE clause', { whereClause });
  }

  let rawAccounts: any[] = [];
  let rawContacts: any[] = [];
  let rawOpportunities: any[] = [];

  try {
    if (accountCount < 10000) {
      rawAccounts = await client.getAccounts(undefined, whereClause);
    } else {
      try {
        const bulkWhere = watermark ? ` WHERE SystemModstamp >= ${watermark}` : '';
        rawAccounts = await client.bulkQuery(`SELECT Id, Name, Website, Industry, NumberOfEmployees, AnnualRevenue, OwnerId, BillingCity, BillingState, BillingCountry, Type, CreatedDate, LastModifiedDate, SystemModstamp FROM Account${bulkWhere}`);
      } catch {
        rawAccounts = await client.getAccounts(undefined, whereClause);
      }
    }
  } catch (err: any) {
    errors.push(`Failed to fetch accounts: ${err.message}`);
  }

  try {
    if (contactCount < 10000) {
      rawContacts = await client.getContacts(undefined, whereClause);
    } else {
      try {
        const bulkWhere = watermark ? ` WHERE SystemModstamp >= ${watermark}` : '';
        rawContacts = await client.bulkQuery(`SELECT Id, FirstName, LastName, Email, Phone, Title, Department, AccountId, OwnerId, LeadSource, CreatedDate, LastModifiedDate, SystemModstamp FROM Contact${bulkWhere}`);
      } catch {
        rawContacts = await client.getContacts(undefined, whereClause);
      }
    }
  } catch (err: any) {
    errors.push(`Failed to fetch contacts: ${err.message}`);
  }

  try {
    if (oppCount < 10000) {
      rawOpportunities = await client.getOpportunities(undefined, whereClause);
    } else {
      try {
        const bulkWhere = watermark ? ` WHERE SystemModstamp >= ${watermark}` : '';
        rawOpportunities = await client.bulkQuery(`SELECT Id, Name, Amount, StageName, CloseDate, Probability, ForecastCategoryName, OwnerId, AccountId, Type, LeadSource, IsClosed, IsWon, Description, NextStep, CreatedDate, LastModifiedDate, SystemModstamp FROM Opportunity${bulkWhere}`);
      } catch {
        rawOpportunities = await client.getOpportunities(undefined, whereClause);
      }
    }
  } catch (err: any) {
    errors.push(`Failed to fetch opportunities: ${err.message}`);
  }

  logger.info('Fetched records', {
    accounts: rawAccounts.length,
    contacts: rawContacts.length,
    opportunities: rawOpportunities.length,
  });

  // Transform with per-record error capture
  const accountResult = transformWithErrorCapture(
    rawAccounts,
    (acc) => transformAccount(acc, workspaceId),
    'Salesforce Accounts',
    (acc) => acc.Id
  );

  const contactResult = transformWithErrorCapture(
    rawContacts,
    (con) => transformContact(con, workspaceId),
    'Salesforce Contacts',
    (con) => con.Id
  );

  const dealResult = transformWithErrorCapture(
    rawOpportunities,
    (opp) => transformOpportunity(opp, workspaceId, stageMap),
    'Salesforce Opportunities',
    (opp) => opp.Id
  );

  // Collect transform errors
  accountResult.failed.forEach(f => errors.push(`Account: ${f.error} (${f.recordId})`));
  contactResult.failed.forEach(f => errors.push(`Contact: ${f.error} (${f.recordId})`));
  dealResult.failed.forEach(f => errors.push(`Opportunity: ${f.error} (${f.recordId})`));

  const normalizedAccounts = accountResult.succeeded;
  const normalizedContacts = contactResult.succeeded;
  const normalizedDeals = dealResult.succeeded;

  const accountsStored = await upsertAccounts(normalizedAccounts).catch(err => {
    errors.push(`Failed to store accounts: ${err.message}`);
    return 0;
  });

  const [contactsStored, dealsStored] = await Promise.all([
    upsertContacts(normalizedContacts).catch(err => {
      errors.push(`Failed to store contacts: ${err.message}`);
      return 0;
    }),
    upsertDeals(normalizedDeals).catch(err => {
      errors.push(`Failed to store deals: ${err.message}`);
      return 0;
    }),
  ]);

  const allAccountSourceIds = new Set<string>();
  const allContactSourceIds = new Set<string>();
  for (const d of normalizedDeals) {
    if (d.account_source_id) allAccountSourceIds.add(d.account_source_id);
    for (const cId of d.contact_source_ids) allContactSourceIds.add(cId);
  }
  for (const c of normalizedContacts) {
    if (c.account_source_id) allAccountSourceIds.add(c.account_source_id);
  }

  const [accountIdMap, contactIdMap] = await Promise.all([
    resolveAccountIds(workspaceId, allAccountSourceIds),
    resolveContactIds(workspaceId, allContactSourceIds),
  ]);

  await Promise.all([
    updateDealForeignKeys(workspaceId, normalizedDeals, accountIdMap, contactIdMap),
    updateContactAccountIds(workspaceId, normalizedContacts, accountIdMap),
  ]);

  logger.info('Resolved FKs', { accounts: accountIdMap.size, contacts: contactIdMap.size });

  let computedFields = null;
  try {
    computedFields = await computeFields(workspaceId);
    logger.info('Computed fields updated', { computedFields });
  } catch (err: any) {
    errors.push(`Computed fields error: ${err.message}`);
  }

  const duration = Date.now() - startTime;
  logger.info('Sync completed', {
    duration,
    accountsStored,
    contactsStored,
    dealsStored,
    errors: errors.length,
  });

  // Update watermark for next incremental sync
  await query(
    `UPDATE connections
     SET last_sync_at = NOW()
     WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
    [workspaceId]
  ).catch(err => {
    logger.error('Failed to update last_sync_at watermark', err);
  });

  return {
    success: errors.length === 0,
    accounts: { fetched: rawAccounts.length, stored: accountsStored },
    contacts: { fetched: rawContacts.length, stored: contactsStored },
    deals: { fetched: rawOpportunities.length, stored: dealsStored },
    computedFields,
    duration,
    errors,
  };
}
