import { query, getClient } from '../../db.js';
import { SalesforceClient } from './client.js';
import { transformOpportunity, transformContact, transformAccount, transformTask, transformEvent, transformLead } from './transform.js';
import type { NormalizedDeal, NormalizedContact, NormalizedAccount, NormalizedLead } from './transform.js';
import type { SalesforceStage } from './types.js';
import { createLogger } from '../../utils/logger.js';
import { computeFields } from '../../computed-fields/engine.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';
import { updateCredentialFields } from '../../lib/credential-store.js';

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
            probability, forecast_category, forecast_category_source, pipeline,
            last_activity_date, custom_fields, next_steps, lead_source, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, $18, NOW(), NOW()
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
            forecast_category_source = EXCLUDED.forecast_category_source,
            pipeline = EXCLUDED.pipeline,
            last_activity_date = EXCLUDED.last_activity_date,
            custom_fields = EXCLUDED.custom_fields,
            next_steps = EXCLUDED.next_steps,
            lead_source = EXCLUDED.lead_source,
            updated_at = NOW()`,
          [
            deal.workspace_id, deal.source, deal.source_id, JSON.stringify(deal.source_data),
            deal.name, deal.amount, deal.stage, deal.stage_normalized, deal.close_date, deal.owner,
            deal.probability, deal.forecast_category, deal.forecast_category_source, deal.pipeline,
            deal.last_activity_date, JSON.stringify(deal.custom_fields), deal.next_steps, deal.lead_source,
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

async function upsertLeads(leads: NormalizedLead[]): Promise<number> {
  return upsertInBatches(leads, async (batch) => {
    if (batch.length === 0) return 0;

    const client = await getClient();
    let stored = 0;
    try {
      await client.query('BEGIN');

      for (const lead of batch) {
        await client.query(
          `INSERT INTO leads (
            workspace_id, source, source_id, source_data,
            first_name, last_name, email, phone, title, company, website,
            status, lead_source, industry, annual_revenue, employee_count,
            is_converted, converted_at,
            sf_converted_contact_id, sf_converted_account_id, sf_converted_opportunity_id,
            owner_id, owner_name, owner_email,
            custom_fields, created_date, last_modified, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16,
            $17, $18,
            $19, $20, $21,
            $22, $23, $24,
            $25, $26, $27, NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data = EXCLUDED.source_data,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            title = EXCLUDED.title,
            company = EXCLUDED.company,
            website = EXCLUDED.website,
            status = EXCLUDED.status,
            lead_source = EXCLUDED.lead_source,
            industry = EXCLUDED.industry,
            annual_revenue = EXCLUDED.annual_revenue,
            employee_count = EXCLUDED.employee_count,
            is_converted = EXCLUDED.is_converted,
            converted_at = EXCLUDED.converted_at,
            sf_converted_contact_id = EXCLUDED.sf_converted_contact_id,
            sf_converted_account_id = EXCLUDED.sf_converted_account_id,
            sf_converted_opportunity_id = EXCLUDED.sf_converted_opportunity_id,
            owner_id = EXCLUDED.owner_id,
            owner_name = EXCLUDED.owner_name,
            owner_email = EXCLUDED.owner_email,
            custom_fields = EXCLUDED.custom_fields,
            created_date = EXCLUDED.created_date,
            last_modified = EXCLUDED.last_modified,
            updated_at = NOW()`,
          [
            lead.workspace_id, lead.source, lead.source_id, JSON.stringify(lead.source_data),
            lead.first_name, lead.last_name, lead.email, lead.phone, lead.title, lead.company, lead.website,
            lead.status, lead.lead_source, lead.industry, lead.annual_revenue, lead.employee_count,
            lead.is_converted, lead.converted_at,
            lead.sf_converted_contact_id, lead.sf_converted_account_id, lead.sf_converted_opportunity_id,
            lead.owner_id, lead.owner_name, lead.owner_email,
            JSON.stringify(lead.custom_fields), lead.created_date, lead.last_modified,
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

      // Update credentials with refreshed token using credential store
      await updateCredentialFields(workspaceId, 'salesforce', {
        accessToken: refreshed.accessToken,
        instanceUrl: refreshed.instanceUrl,
      });

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
    // Upsert stage_configs for display_order (uses Salesforce SortOrder)
    await Promise.all(stages.map(stage =>
      query(
        `INSERT INTO stage_configs (workspace_id, stage_name, display_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, stage_name) DO UPDATE SET
           display_order = EXCLUDED.display_order,
           updated_at = NOW()`,
        [workspaceId, stage.ApiName, stage.SortOrder ?? 999]
      ).catch(err => {
        logger.warn('Failed to upsert stage_config', { error: err instanceof Error ? err.message : err });
      })
    ));
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

  // Sync OpportunityContactRole → deal_contacts
  await syncContactRoles(client, workspaceId).catch(err => {
    errors.push(`Contact roles sync failed: ${err.message}`);
  });

  // Sync Activities (Tasks + Events)
  const sinceDate = watermark ? new Date(watermark) : null;
  await syncActivities(client, workspaceId, sinceDate).catch(err => {
    errors.push(`Activities sync failed: ${err.message}`);
  });

  // Sync Leads (with custom fields + FK resolution)
  await syncLeads(client, workspaceId, watermark).catch(err => {
    errors.push(`Leads sync failed: ${err.message}`);
  });

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

// ============================================================================
// Contact Roles Sync (OpportunityContactRole → deal_contacts)
// ============================================================================

async function syncContactRoles(
  client: SalesforceClient,
  workspaceId: string
): Promise<void> {
  const dealResult = await query<{ source_id: string; id: string }>(
    `SELECT source_id, id FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
    [workspaceId]
  );
  const dealIdMap = new Map(dealResult.rows.map(r => [r.source_id, r.id]));

  const contactResult = await query<{ source_id: string; id: string }>(
    `SELECT source_id, id FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
    [workspaceId]
  );
  const contactIdMap = new Map(contactResult.rows.map(r => [r.source_id, r.id]));

  const roles = await client.getOpportunityContactRoles();

  if (roles.length === 0) {
    logger.info('No OpportunityContactRoles found (may not be used in this org)');
    return;
  }

  let synced = 0;
  let skipped = 0;

  for (const role of roles) {
    const dealId = dealIdMap.get(role.OpportunityId);
    const contactId = contactIdMap.get(role.ContactId);

    if (!dealId || !contactId) {
      skipped++;
      continue;
    }

    await query(
      `INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, role, is_primary, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'salesforce', NOW(), NOW())
       ON CONFLICT (workspace_id, deal_id, contact_id, source)
       DO UPDATE SET role = $4, is_primary = $5, updated_at = NOW()`,
      [workspaceId, dealId, contactId, role.Role, role.IsPrimary]
    );
    synced++;
  }

  logger.info('Synced contact roles', { total: roles.length, synced, skipped });
}

// ============================================================================
// Activities Sync (Tasks + Events → activities)
// ============================================================================

async function syncActivities(
  client: SalesforceClient,
  workspaceId: string,
  since: Date | null
): Promise<void> {
  const dealResult = await query<{ source_id: string; id: string }>(
    `SELECT source_id, id FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
    [workspaceId]
  );
  const dealIdMap = new Map(dealResult.rows.map(r => [r.source_id, r.id]));

  const contactResult = await query<{ source_id: string; id: string }>(
    `SELECT source_id, id FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
    [workspaceId]
  );
  const contactIdMap = new Map(contactResult.rows.map(r => [r.source_id, r.id]));

  // For initial sync (since = null), limit to last 6 months to prevent pulling millions of activities
  // Salesforce orgs can have huge activity volumes - this is a safety measure
  const activitySince = since || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 6 months

  const [tasks, events] = await Promise.all([
    client.getTasks(undefined, undefined, activitySince),
    client.getEvents(undefined, undefined, activitySince),
  ]);

  let tasksSynced = 0;
  let tasksSkipped = 0;

  for (const task of tasks) {
    const activity = transformTask(task, workspaceId, dealIdMap, contactIdMap);
    if (!activity) {
      tasksSkipped++;
      continue;
    }

    await query(
      `INSERT INTO activities (workspace_id, source, source_id, source_data, activity_type, timestamp, actor, subject, body, deal_id, contact_id, account_id, direction, duration_seconds, custom_fields, created_at, updated_at)
       VALUES ($1, 'salesforce', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
       ON CONFLICT (workspace_id, source, source_id)
       DO UPDATE SET
         activity_type = $4, timestamp = $5, actor = $6, subject = $7, body = $8,
         deal_id = $9, contact_id = $10, account_id = $11, direction = $12,
         duration_seconds = $13, custom_fields = $14, updated_at = NOW()`,
      [
        workspaceId,
        activity.source_id,
        JSON.stringify(activity.source_data),
        activity.activity_type,
        activity.timestamp,
        activity.actor,
        activity.subject,
        activity.body,
        activity.deal_id,
        activity.contact_id,
        activity.account_id,
        activity.direction,
        activity.duration_seconds,
        JSON.stringify(activity.custom_fields),
      ]
    );
    tasksSynced++;
  }

  let eventsSynced = 0;
  let eventsSkipped = 0;

  for (const event of events) {
    const activity = transformEvent(event, workspaceId, dealIdMap, contactIdMap);
    if (!activity) {
      eventsSkipped++;
      continue;
    }

    await query(
      `INSERT INTO activities (workspace_id, source, source_id, source_data, activity_type, timestamp, actor, subject, body, deal_id, contact_id, account_id, direction, duration_seconds, custom_fields, created_at, updated_at)
       VALUES ($1, 'salesforce', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
       ON CONFLICT (workspace_id, source, source_id)
       DO UPDATE SET
         activity_type = $4, timestamp = $5, actor = $6, subject = $7, body = $8,
         deal_id = $9, contact_id = $10, account_id = $11, direction = $12,
         duration_seconds = $13, custom_fields = $14, updated_at = NOW()`,
      [
        workspaceId,
        activity.source_id,
        JSON.stringify(activity.source_data),
        activity.activity_type,
        activity.timestamp,
        activity.actor,
        activity.subject,
        activity.body,
        activity.deal_id,
        activity.contact_id,
        activity.account_id,
        activity.direction,
        activity.duration_seconds,
        JSON.stringify(activity.custom_fields),
      ]
    );
    eventsSynced++;
  }

  logger.info('Synced activities', {
    tasks: { total: tasks.length, synced: tasksSynced, skipped: tasksSkipped },
    events: { total: events.length, synced: eventsSynced, skipped: eventsSkipped },
  });
}

// ============================================================================
// Lead Sync (Lead → leads table with custom fields + FK resolution)
// ============================================================================

export async function syncLeads(
  client: SalesforceClient,
  workspaceId: string,
  watermark: string | null = null
): Promise<{ fetched: number; stored: number; fksResolved: number }> {
  let customFieldNames: string[] = [];
  try {
    const fields = await client.getObjectFields('Lead');
    customFieldNames = fields.map(f => f.name);
    logger.info('Discovered Lead custom fields', { count: customFieldNames.length });
  } catch (err) {
    logger.warn('Failed to discover Lead custom fields, using defaults only', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }

  const { DEFAULT_LEAD_FIELDS } = await import('./types.js');
  const allFields = [...new Set([...DEFAULT_LEAD_FIELDS, ...customFieldNames])];

  let rawLeads: any[] = [];
  try {
    const since = watermark ? new Date(watermark) : undefined;
    rawLeads = await client.getLeads(allFields, since, !watermark);
  } catch (err: any) {
    logger.error('Failed to fetch leads', { error: err.message });
    throw err;
  }

  logger.info('Fetched leads', { count: rawLeads.length });

  const leadResult = transformWithErrorCapture(
    rawLeads,
    (lead) => transformLead(lead, workspaceId),
    'Salesforce Leads',
    (lead) => lead.Id
  );

  if (leadResult.failed.length > 0) {
    logger.warn('Lead transform failures', { count: leadResult.failed.length });
  }

  const normalizedLeads = leadResult.succeeded;

  const stored = await upsertLeads(normalizedLeads);
  logger.info('Stored leads', { fetched: rawLeads.length, stored });

  const fksResolved = await resolveLeadForeignKeys(workspaceId);

  return { fetched: rawLeads.length, stored, fksResolved };
}

async function resolveLeadForeignKeys(workspaceId: string): Promise<number> {
  let resolved = 0;

  const contactResult = await query<{ count: string }>(
    `UPDATE leads l SET
       converted_contact_id = c.id
     FROM contacts c
     WHERE l.workspace_id = $1
       AND l.sf_converted_contact_id IS NOT NULL
       AND l.converted_contact_id IS NULL
       AND c.workspace_id = l.workspace_id
       AND c.source = 'salesforce'
       AND c.source_id = l.sf_converted_contact_id`,
    [workspaceId]
  );
  const contactsLinked = parseInt((contactResult as any).rowCount || '0', 10);

  const accountResult = await query<{ count: string }>(
    `UPDATE leads l SET
       converted_account_id = a.id
     FROM accounts a
     WHERE l.workspace_id = $1
       AND l.sf_converted_account_id IS NOT NULL
       AND l.converted_account_id IS NULL
       AND a.workspace_id = l.workspace_id
       AND a.source = 'salesforce'
       AND a.source_id = l.sf_converted_account_id`,
    [workspaceId]
  );
  const accountsLinked = parseInt((accountResult as any).rowCount || '0', 10);

  const dealResult = await query<{ count: string }>(
    `UPDATE leads l SET
       converted_deal_id = d.id
     FROM deals d
     WHERE l.workspace_id = $1
       AND l.sf_converted_opportunity_id IS NOT NULL
       AND l.converted_deal_id IS NULL
       AND d.workspace_id = l.workspace_id
       AND d.source = 'salesforce'
       AND d.source_id = l.sf_converted_opportunity_id`,
    [workspaceId]
  );
  const dealsLinked = parseInt((dealResult as any).rowCount || '0', 10);

  resolved = contactsLinked + accountsLinked + dealsLinked;
  logger.info('Resolved lead FKs', { contactsLinked, accountsLinked, dealsLinked, total: resolved });

  return resolved;
}
