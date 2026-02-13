import { query, getClient } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { parseAmount, parseDate, parsePercentage, normalizeCompanyName } from './value-parsers.js';
import { refreshComputedFields } from '../tools/computed-fields-refresh.js';
import { captureCurrentDealState, diffAndWriteStageHistory, type StageChangeResult } from './snapshot-diff.js';

export interface TransformedDeal {
  name: string;
  amount?: any;
  stage?: string;
  close_date?: any;
  created_date?: any;
  owner?: string;
  pipeline?: string;
  account_name?: string;
  external_id?: string;
  probability?: any;
  unmappedFields: Record<string, any>;
  raw: Record<string, any>;
}

export interface TransformedContact {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  department?: string;
  account_name?: string;
  lifecycle_stage?: string;
  seniority?: string;
  external_id?: string;
  associated_deal_name?: string;
  unmappedFields: Record<string, any>;
  raw: Record<string, any>;
}

export interface TransformedAccount {
  name: string;
  domain?: string;
  industry?: string;
  employee_count?: any;
  annual_revenue?: any;
  owner?: string;
  external_id?: string;
  unmappedFields: Record<string, any>;
  raw: Record<string, any>;
}

export interface ImportResult {
  batchId: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  stageChanges?: StageChangeResult;
  postActions: {
    accountsLinked: number;
    dealsLinkedToAccounts: number;
    contactsLinkedToAccounts: number;
    contactsLinkedToDeals: number;
    contactsInferred: number;
    computedFieldsRefreshed: boolean;
    contextLayerUpdated: boolean;
  };
}

export interface RelinkResult {
  dealsLinkedToAccounts: number;
  contactsLinkedToAccounts: number;
  contactsLinkedToDeals: number;
  contactsInferred: number;
}

export interface StageMapping {
  [rawStage: string]: string;
}

async function lookupStageMapping(client: any, workspaceId: string, rawStage: string): Promise<string | null> {
  const result = await client.query(
    `SELECT normalized_stage FROM stage_mappings
     WHERE workspace_id = $1 AND source = 'csv_import' AND raw_stage = $2
     LIMIT 1`,
    [workspaceId, rawStage]
  );
  return result.rows[0]?.normalized_stage || null;
}

async function linkDealsToAccounts(client: any, workspaceId: string, dealIds: string[]): Promise<number> {
  if (dealIds.length === 0) return 0;

  const deals = await client.query(
    `SELECT d.id, d.source_data->>'account_name' as account_name
     FROM deals d
     WHERE d.workspace_id = $1 AND d.id = ANY($2) AND d.account_id IS NULL
       AND d.source_data->>'account_name' IS NOT NULL`,
    [workspaceId, dealIds]
  );

  let linked = 0;
  for (const deal of deals.rows) {
    const normalized = normalizeCompanyName(deal.account_name);
    if (!normalized) continue;

    const account = await client.query(
      `SELECT id FROM accounts
       WHERE workspace_id = $1 AND LOWER(name) LIKE $2
       LIMIT 1`,
      [workspaceId, `%${normalized}%`]
    );

    if (account.rows.length > 0) {
      await client.query(
        `UPDATE deals SET account_id = $1 WHERE id = $2`,
        [account.rows[0].id, deal.id]
      );
      linked++;
    }
  }
  return linked;
}

async function linkContactsToAccounts(client: any, workspaceId: string, contactIds: string[]): Promise<number> {
  if (contactIds.length === 0) return 0;

  const contacts = await client.query(
    `SELECT c.id, c.source_data->>'account_name' as account_name
     FROM contacts c
     WHERE c.workspace_id = $1 AND c.id = ANY($2) AND c.account_id IS NULL
       AND c.source_data->>'account_name' IS NOT NULL`,
    [workspaceId, contactIds]
  );

  let linked = 0;
  for (const contact of contacts.rows) {
    const normalized = normalizeCompanyName(contact.account_name);
    if (!normalized) continue;

    const account = await client.query(
      `SELECT id FROM accounts
       WHERE workspace_id = $1 AND LOWER(name) LIKE $2
       LIMIT 1`,
      [workspaceId, `%${normalized}%`]
    );

    if (account.rows.length > 0) {
      await client.query(
        `UPDATE contacts SET account_id = $1 WHERE id = $2`,
        [account.rows[0].id, contact.id]
      );
      linked++;
    }
  }
  return linked;
}

async function buildAccountIndex(workspaceId: string, client?: any): Promise<Map<string, string>> {
  const queryFn = client ? (sql: string, params: any[]) => client.query(sql, params) : query;
  const allAccounts = await queryFn(
    `SELECT id, name, domain FROM accounts WHERE workspace_id = $1`,
    [workspaceId]
  );
  const accountIndex = new Map<string, string>();
  for (const a of allAccounts.rows) {
    if (!a.name) continue;
    const normalized = normalizeCompanyName(a.name);
    if (normalized) {
      accountIndex.set(normalized, a.id);
    }
    if (a.domain) {
      accountIndex.set(a.domain.toLowerCase().trim(), a.id);
    }
  }
  return accountIndex;
}

export async function linkAllUnlinkedDeals(workspaceId: string, client?: any): Promise<number> {
  const queryFn = client ? (sql: string, params: any[]) => client.query(sql, params) : query;
  const accountIndex = await buildAccountIndex(workspaceId, client);
  if (accountIndex.size === 0) return 0;

  const unlinkedDeals = await queryFn(
    `SELECT id, source_data->>'account_name' as company
     FROM deals
     WHERE workspace_id = $1 AND account_id IS NULL
       AND source_data->>'account_name' IS NOT NULL`,
    [workspaceId]
  );

  let linked = 0;
  for (const deal of unlinkedDeals.rows) {
    if (!deal.company) continue;
    const normalized = normalizeCompanyName(deal.company);
    if (!normalized) continue;
    const accountId = accountIndex.get(normalized);
    if (accountId) {
      await queryFn(
        `UPDATE deals SET account_id = $1, updated_at = NOW() WHERE id = $2`,
        [accountId, deal.id]
      );
      linked++;
    }
  }
  return linked;
}

export async function linkAllUnlinkedContacts(workspaceId: string, client?: any): Promise<number> {
  const queryFn = client ? (sql: string, params: any[]) => client.query(sql, params) : query;
  const accountIndex = await buildAccountIndex(workspaceId, client);
  if (accountIndex.size === 0) return 0;

  const unlinkedContacts = await queryFn(
    `SELECT id, source_data->>'account_name' as company, email
     FROM contacts
     WHERE workspace_id = $1 AND account_id IS NULL
       AND (source_data->>'account_name' IS NOT NULL OR email IS NOT NULL)`,
    [workspaceId]
  );

  let linked = 0;
  for (const contact of unlinkedContacts.rows) {
    let accountId: string | undefined;

    if (contact.email) {
      const domain = contact.email.split('@')[1]?.toLowerCase().trim();
      if (domain) {
        accountId = accountIndex.get(domain);
      }
    }

    if (!accountId && contact.company) {
      const normalized = normalizeCompanyName(contact.company);
      if (normalized) {
        accountId = accountIndex.get(normalized);
      }
    }

    if (accountId) {
      await queryFn(
        `UPDATE contacts SET account_id = $1, updated_at = NOW() WHERE id = $2`,
        [accountId, contact.id]
      );
      linked++;
    }
  }
  return linked;
}

export async function inferContactDealLinks(workspaceId: string, client?: any): Promise<{ explicit: number; inferred: number }> {
  const queryFn = client ? (sql: string, params: any[]) => client.query(sql, params) : query;

  const contactsWithDeals = await queryFn(
    `SELECT c.id as contact_id, c.account_id,
            c.source_data->>'associated_deal_name' as deal_name
     FROM contacts c
     WHERE c.workspace_id = $1
       AND c.account_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM deal_contacts dc WHERE dc.contact_id = c.id AND dc.workspace_id = $1
       )`,
    [workspaceId]
  );

  if (contactsWithDeals.rows.length === 0) return { explicit: 0, inferred: 0 };

  const allDeals = await queryFn(
    `SELECT id, name, account_id FROM deals WHERE workspace_id = $1`,
    [workspaceId]
  );

  const dealNameIndex = new Map<string, string>();
  for (const d of allDeals.rows) {
    if (d.name) {
      dealNameIndex.set(d.name.toLowerCase().trim(), d.id);
    }
  }

  const dealsByAccount = new Map<string, string[]>();
  for (const d of allDeals.rows) {
    if (d.account_id) {
      const existing = dealsByAccount.get(d.account_id) || [];
      existing.push(d.id);
      dealsByAccount.set(d.account_id, existing);
    }
  }

  let explicit = 0;
  let inferred = 0;

  for (const contact of contactsWithDeals.rows) {
    let dealId: string | undefined;
    let linkMethod = 'inferred_single_deal';

    if (contact.deal_name) {
      dealId = dealNameIndex.get(contact.deal_name.toLowerCase().trim());
      if (dealId) {
        linkMethod = 'explicit_deal_name';
        explicit++;
      }
    }

    if (!dealId && contact.account_id) {
      const accountDeals = dealsByAccount.get(contact.account_id);
      if (accountDeals && accountDeals.length === 1) {
        dealId = accountDeals[0];
        inferred++;
      }
    }

    if (dealId) {
      await queryFn(
        `INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, source, role_source, role_confidence)
         VALUES ($1, $2, $3, 'csv_import', $4, $5)
         ON CONFLICT (workspace_id, deal_id, contact_id, source) DO NOTHING`,
        [workspaceId, dealId, contact.contact_id, linkMethod, linkMethod === 'explicit_deal_name' ? 0.9 : 0.6]
      );
    }
  }

  return { explicit, inferred };
}

export async function relinkAll(workspaceId: string): Promise<RelinkResult> {
  const dealsLinkedToAccounts = await linkAllUnlinkedDeals(workspaceId);
  const contactsLinkedToAccounts = await linkAllUnlinkedContacts(workspaceId);
  const { explicit: contactsLinkedToDeals, inferred: contactsInferred } = await inferContactDealLinks(workspaceId);
  return { dealsLinkedToAccounts, contactsLinkedToAccounts, contactsLinkedToDeals, contactsInferred };
}

async function logToSyncLog(workspaceId: string, entityType: string, recordCount: number, durationMs: number): Promise<void> {
  try {
    await query(
      `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, records_synced, duration_ms, started_at, completed_at)
       VALUES ($1, 'file_import', $2, 'completed', $3, $4, NOW() - make_interval(secs => $5::double precision / 1000), NOW())`,
      [workspaceId, entityType, recordCount, durationMs, durationMs]
    );
  } catch (err) {
    console.error('[Import] Failed to log sync:', err);
  }
}

export async function applyDealImport(
  workspaceId: string,
  batchId: string,
  records: TransformedDeal[],
  strategy: 'replace' | 'merge' | 'append',
  stageMapping: StageMapping | null,
  dateFormat?: string | null
): Promise<ImportResult> {
  const startTime = Date.now();
  let client: any = null;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const dealIds: string[] = [];

  const previousState = await captureCurrentDealState(workspaceId);
  console.log(`[Import] Captured snapshot of ${previousState.size} existing deals before import`);

  try {
    client = await getClient();
    await client.query('BEGIN');

    if (strategy === 'replace') {
      await client.query(
        `DELETE FROM deals WHERE workspace_id = $1 AND source = 'csv_import'`,
        [workspaceId]
      );
    }

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        if (!record.name || record.name.trim() === '') {
          skipped++;
          continue;
        }

        const amount = parseAmount(record.amount);
        const closeDate = parseDate(record.close_date, dateFormat || undefined);
        const createdDate = parseDate(record.created_date, dateFormat || undefined);
        const probability = parsePercentage(record.probability);

        let stageNormalized: string | null = null;
        if (record.stage) {
          if (stageMapping && stageMapping[record.stage]) {
            stageNormalized = stageMapping[record.stage];
          } else {
            stageNormalized = await lookupStageMapping(client, workspaceId, record.stage);
          }
        }

        const sourceId = record.external_id || uuidv4();
        const sourceData = JSON.stringify({
          import_batch_id: batchId,
          original_row: record.raw,
          account_name: record.account_name || null,
        });

        if (strategy === 'merge' && record.external_id) {
          const result = await client.query(
            `INSERT INTO deals (workspace_id, source, source_id, source_data, name, amount, stage, stage_normalized, close_date, owner, pipeline, probability, custom_fields, created_at)
             VALUES ($1, 'csv_import', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, NOW()))
             ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
               name = EXCLUDED.name, amount = EXCLUDED.amount, stage = EXCLUDED.stage,
               stage_normalized = EXCLUDED.stage_normalized, close_date = EXCLUDED.close_date,
               owner = EXCLUDED.owner, pipeline = EXCLUDED.pipeline, probability = EXCLUDED.probability,
               source_data = EXCLUDED.source_data, custom_fields = EXCLUDED.custom_fields, updated_at = NOW()
             RETURNING id, (xmax = 0) AS is_insert`,
            [
              workspaceId, sourceId, sourceData, record.name.trim(), amount,
              record.stage || null, stageNormalized, closeDate,
              record.owner || null, record.pipeline || 'default', probability,
              JSON.stringify(record.unmappedFields || {}), createdDate,
            ]
          );
          if (result.rows[0].is_insert) { inserted++; } else { updated++; }
          dealIds.push(result.rows[0].id);
        } else {
          const result = await client.query(
            `INSERT INTO deals (workspace_id, source, source_id, source_data, name, amount, stage, stage_normalized, close_date, owner, pipeline, probability, custom_fields, created_at)
             VALUES ($1, 'csv_import', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, NOW()))
             RETURNING id`,
            [
              workspaceId, sourceId, sourceData, record.name.trim(), amount,
              record.stage || null, stageNormalized, closeDate,
              record.owner || null, record.pipeline || 'default', probability,
              JSON.stringify(record.unmappedFields || {}), createdDate,
            ]
          );
          inserted++;
          dealIds.push(result.rows[0].id);
        }
      } catch (err) {
        skipped++;
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const accountsLinked = await linkDealsToAccounts(client, workspaceId, dealIds);

    await client.query(
      `UPDATE import_batches SET
         status = 'applied', records_inserted = $2, records_updated = $3,
         records_skipped = $4, replace_strategy = $5, applied_at = NOW()
       WHERE id = $1`,
      [batchId, inserted, updated, skipped, strategy]
    );

    await client.query('COMMIT');

    let stageChanges: StageChangeResult | undefined;
    if (previousState.size > 0) {
      try {
        stageChanges = await diffAndWriteStageHistory(workspaceId, batchId, previousState);
        console.log(`[Import] Stage diff: ${stageChanges.stageChanges} changes, ${stageChanges.newDeals} new, ${stageChanges.removedDeals} removed`);
      } catch (err) {
        console.error('[Import] Failed to compute stage diff:', err);
      }
    }

    const durationMs = Date.now() - startTime;
    let computedFieldsRefreshed = false;
    try {
      await refreshComputedFields(workspaceId);
      computedFieldsRefreshed = true;
    } catch (err) {
      console.error('[Import] Failed to refresh computed fields:', err);
    }

    await logToSyncLog(workspaceId, 'deals', inserted + updated, durationMs);

    await updateImportFreshness(workspaceId).catch(err => {
      console.error('[Import] Failed to update freshness:', err);
    });

    return {
      batchId, inserted, updated, skipped, errors,
      stageChanges,
      postActions: {
        accountsLinked,
        dealsLinkedToAccounts: 0,
        contactsLinkedToAccounts: 0,
        contactsLinkedToDeals: 0,
        contactsInferred: 0,
        computedFieldsRefreshed,
        contextLayerUpdated: false,
      },
    };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (client) client.release();
  }
}

export async function applyContactImport(
  workspaceId: string,
  batchId: string,
  records: TransformedContact[],
  strategy: 'replace' | 'merge' | 'append'
): Promise<ImportResult> {
  const startTime = Date.now();
  let client: any = null;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const contactIds: string[] = [];

  try {
    client = await getClient();
    await client.query('BEGIN');

    if (strategy === 'replace') {
      await client.query(
        `DELETE FROM contacts WHERE workspace_id = $1 AND source = 'csv_import'`,
        [workspaceId]
      );
    }

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        let firstName = record.first_name || '';
        let lastName = record.last_name || '';

        if (record.full_name && !firstName && !lastName) {
          const parts = record.full_name.trim().split(/\s+/);
          firstName = parts[0] || '';
          lastName = parts.slice(1).join(' ') || '';
        }

        if (!record.email && !firstName) {
          skipped++;
          continue;
        }

        const sourceId = record.external_id || uuidv4();
        const sourceData = JSON.stringify({
          import_batch_id: batchId,
          original_row: record.raw,
          account_name: record.account_name || null,
          associated_deal_name: record.associated_deal_name || null,
        });

        if (strategy === 'merge' && record.external_id) {
          const result = await client.query(
            `INSERT INTO contacts (workspace_id, source, source_id, source_data, email, first_name, last_name, title, department, seniority, lifecycle_stage, phone, custom_fields)
             VALUES ($1, 'csv_import', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
               email = COALESCE(EXCLUDED.email, contacts.email),
               first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
               title = EXCLUDED.title, department = EXCLUDED.department,
               seniority = EXCLUDED.seniority, lifecycle_stage = EXCLUDED.lifecycle_stage,
               phone = EXCLUDED.phone, source_data = EXCLUDED.source_data,
               custom_fields = EXCLUDED.custom_fields, updated_at = NOW()
             RETURNING id, (xmax = 0) AS is_insert`,
            [
              workspaceId, sourceId, sourceData,
              record.email || null, firstName, lastName,
              record.title || null, record.department || null,
              record.seniority || null, record.lifecycle_stage || null,
              record.phone || null, JSON.stringify(record.unmappedFields || {}),
            ]
          );
          if (result.rows[0].is_insert) { inserted++; } else { updated++; }
          contactIds.push(result.rows[0].id);
        } else {
          const result = await client.query(
            `INSERT INTO contacts (workspace_id, source, source_id, source_data, email, first_name, last_name, title, department, seniority, lifecycle_stage, phone, custom_fields)
             VALUES ($1, 'csv_import', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [
              workspaceId, sourceId, sourceData,
              record.email || null, firstName, lastName,
              record.title || null, record.department || null,
              record.seniority || null, record.lifecycle_stage || null,
              record.phone || null, JSON.stringify(record.unmappedFields || {}),
            ]
          );
          inserted++;
          contactIds.push(result.rows[0].id);
        }
      } catch (err) {
        skipped++;
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const contactsLinkedToAccounts = await linkContactsToAccounts(client, workspaceId, contactIds);

    await client.query(
      `UPDATE import_batches SET
         status = 'applied', records_inserted = $2, records_updated = $3,
         records_skipped = $4, replace_strategy = $5, applied_at = NOW()
       WHERE id = $1`,
      [batchId, inserted, updated, skipped, strategy]
    );

    await client.query('COMMIT');

    const durationMs = Date.now() - startTime;
    await logToSyncLog(workspaceId, 'contacts', inserted + updated, durationMs);

    let contactsLinkedToDeals = 0;
    let contactsInferred = 0;
    try {
      const dealLinks = await inferContactDealLinks(workspaceId);
      contactsLinkedToDeals = dealLinks.explicit;
      contactsInferred = dealLinks.inferred;
    } catch (err) {
      console.error('[Import] Failed to infer contact-deal links:', err);
    }

    await updateImportFreshness(workspaceId).catch(err => {
      console.error('[Import] Failed to update freshness:', err);
    });

    return {
      batchId, inserted, updated, skipped, errors,
      postActions: {
        accountsLinked: 0,
        dealsLinkedToAccounts: 0,
        contactsLinkedToAccounts,
        contactsLinkedToDeals,
        contactsInferred,
        computedFieldsRefreshed: false,
        contextLayerUpdated: false,
      },
    };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (client) client.release();
  }
}

export async function applyAccountImport(
  workspaceId: string,
  batchId: string,
  records: TransformedAccount[],
  strategy: 'replace' | 'merge' | 'append'
): Promise<ImportResult> {
  const startTime = Date.now();
  let client: any = null;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    client = await getClient();
    await client.query('BEGIN');

    if (strategy === 'replace') {
      await client.query(
        `DELETE FROM accounts WHERE workspace_id = $1 AND source = 'csv_import'`,
        [workspaceId]
      );
    }

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        if (!record.name || record.name.trim() === '') {
          skipped++;
          continue;
        }

        const annualRevenue = parseAmount(record.annual_revenue);
        const employeeCount = record.employee_count
          ? parseInt(String(record.employee_count).replace(/[^0-9]/g, ''), 10) || null
          : null;

        const sourceId = record.external_id || uuidv4();
        const sourceData = JSON.stringify({
          import_batch_id: batchId,
          original_row: record.raw,
        });

        if (strategy === 'merge' && record.external_id) {
          const result = await client.query(
            `INSERT INTO accounts (workspace_id, source, source_id, source_data, name, domain, industry, employee_count, annual_revenue, owner, custom_fields)
             VALUES ($1, 'csv_import', $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
               name = EXCLUDED.name, domain = EXCLUDED.domain, industry = EXCLUDED.industry,
               employee_count = EXCLUDED.employee_count, annual_revenue = EXCLUDED.annual_revenue,
               owner = EXCLUDED.owner, source_data = EXCLUDED.source_data,
               custom_fields = EXCLUDED.custom_fields, updated_at = NOW()
             RETURNING id, (xmax = 0) AS is_insert`,
            [
              workspaceId, sourceId, sourceData, record.name.trim(),
              record.domain || null, record.industry || null,
              employeeCount, annualRevenue, record.owner || null,
              JSON.stringify(record.unmappedFields || {}),
            ]
          );
          if (result.rows[0].is_insert) { inserted++; } else { updated++; }
        } else {
          await client.query(
            `INSERT INTO accounts (workspace_id, source, source_id, source_data, name, domain, industry, employee_count, annual_revenue, owner, custom_fields)
             VALUES ($1, 'csv_import', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              workspaceId, sourceId, sourceData, record.name.trim(),
              record.domain || null, record.industry || null,
              employeeCount, annualRevenue, record.owner || null,
              JSON.stringify(record.unmappedFields || {}),
            ]
          );
          inserted++;
        }
      } catch (err) {
        skipped++;
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await client.query(
      `UPDATE import_batches SET
         status = 'applied', records_inserted = $2, records_updated = $3,
         records_skipped = $4, replace_strategy = $5, applied_at = NOW()
       WHERE id = $1`,
      [batchId, inserted, updated, skipped, strategy]
    );

    await client.query('COMMIT');

    const durationMs = Date.now() - startTime;
    await logToSyncLog(workspaceId, 'accounts', inserted + updated, durationMs);

    let dealsLinkedToAccounts = 0;
    let contactsLinkedToAccounts = 0;
    try {
      dealsLinkedToAccounts = await linkAllUnlinkedDeals(workspaceId);
      contactsLinkedToAccounts = await linkAllUnlinkedContacts(workspaceId);
      console.log(`[Import] Post-account re-link: ${dealsLinkedToAccounts} deals, ${contactsLinkedToAccounts} contacts linked`);
    } catch (err) {
      console.error('[Import] Failed to re-link after account import:', err);
    }

    await updateImportFreshness(workspaceId).catch(err => {
      console.error('[Import] Failed to update freshness:', err);
    });

    return {
      batchId, inserted, updated, skipped, errors,
      postActions: {
        accountsLinked: 0,
        dealsLinkedToAccounts,
        contactsLinkedToAccounts,
        contactsLinkedToDeals: 0,
        contactsInferred: 0,
        computedFieldsRefreshed: false,
        contextLayerUpdated: false,
      },
    };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (client) client.release();
  }
}

export async function updateImportFreshness(workspaceId: string): Promise<void> {
  const connCheck = await query(
    `SELECT id FROM connections WHERE workspace_id = $1 AND connector_name = 'csv_import' LIMIT 1`,
    [workspaceId]
  );

  if (connCheck.rows.length === 0) {
    await query(
      `INSERT INTO connections (workspace_id, connector_name, status, last_sync_at, metadata)
       VALUES ($1, 'csv_import', 'active', NOW(), '{}')`,
      [workspaceId]
    );
  }

  await query(
    `UPDATE connections SET
       last_sync_at = NOW(),
       metadata = jsonb_set(
         COALESCE(metadata, '{}'),
         '{last_imports}',
         (
           SELECT COALESCE(jsonb_object_agg(entity_type, jsonb_build_object(
             'imported_at', applied_at,
             'record_count', records_inserted + records_updated,
             'filename', filename
           )), '{}'::jsonb)
           FROM (
             SELECT DISTINCT ON (entity_type) entity_type, applied_at, records_inserted, records_updated, filename
             FROM import_batches
             WHERE workspace_id = $1 AND status = 'applied'
             ORDER BY entity_type, applied_at DESC
           ) latest
         )
       )
     WHERE workspace_id = $1 AND connector_name = 'csv_import'`,
    [workspaceId]
  );

  console.log(`[Import] Updated freshness for workspace ${workspaceId}`);
}
