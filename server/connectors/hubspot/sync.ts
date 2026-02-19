import { query, getClient } from '../../db.js';
import { HubSpotClient } from './client.js';
import {
  transformDeal,
  transformContact,
  transformCompany,
  transformEngagement,
  type NormalizedDeal,
  type NormalizedContact,
  type NormalizedAccount,
  type DealTransformOptions,
  type ContactTransformOptions,
} from './transform.js';
import type { SyncResult } from '../_interface.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';
import { detectStageChanges, recordStageChanges, updateDealStageCache } from './stage-tracker.js';
import { getStageMapping } from '../../config/index.js';

async function buildStageMaps(client: HubSpotClient, workspaceId: string): Promise<DealTransformOptions> {
  const stageMap = new Map<string, string>();
  const pipelineMap = new Map<string, string>();

  try {
    const pipelines = await client.getPipelines();
    const stageUpserts: Promise<any>[] = [];
    for (const pipeline of pipelines) {
      pipelineMap.set(pipeline.id, pipeline.label);
      for (const stage of pipeline.stages) {
        stageMap.set(stage.id, stage.label);
        stageUpserts.push(
          query(
            `INSERT INTO stage_configs (workspace_id, pipeline_name, stage_name, display_order)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id, stage_name) DO UPDATE SET
               display_order = EXCLUDED.display_order,
               pipeline_name = EXCLUDED.pipeline_name,
               updated_at = NOW()`,
            [workspaceId, pipeline.label, stage.label, stage.displayOrder]
          ).catch(err => {
            console.warn('[HubSpot Sync] Failed to upsert stage_config:', err instanceof Error ? err.message : err);
          })
        );
      }
    }
    await Promise.all(stageUpserts);
    console.log(`[HubSpot Sync] Built stage map: ${stageMap.size} stages across ${pipelineMap.size} pipelines`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[HubSpot Sync] Failed to fetch pipelines for stage resolution: ${msg}`);
  }

  // Load custom stage mapping from workspace config
  const customStageMapping = await getStageMapping(workspaceId);
  const customMappingCount = Object.keys(customStageMapping).length;
  if (customMappingCount > 0) {
    console.log(`[HubSpot Sync] Loaded ${customMappingCount} custom stage mappings from workspace config`);
  }

  return { stageMap, pipelineMap, customStageMapping };
}

interface ForecastConfig {
  commit_threshold: number;
  best_case_threshold: number;
  forecasted_pipelines: string[] | null;
}

async function getForecastConfig(workspaceId: string): Promise<ForecastConfig> {
  try {
    const result = await query<{ commit_threshold: number; best_case_threshold: number; forecasted_pipelines: string[] | null }>(
      `SELECT commit_threshold, best_case_threshold, forecasted_pipelines
       FROM forecast_thresholds
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        commit_threshold: row.commit_threshold > 1 ? row.commit_threshold / 100 : row.commit_threshold,
        best_case_threshold: row.best_case_threshold > 1 ? row.best_case_threshold / 100 : row.best_case_threshold,
        forecasted_pipelines: row.forecasted_pipelines,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[HubSpot Sync] Failed to fetch forecast config: ${msg}`);
  }

  return { commit_threshold: 0.90, best_case_threshold: 0.60, forecasted_pipelines: null };
}

async function buildOwnerMap(client: HubSpotClient): Promise<Map<string, string>> {
  const ownerMap = new Map<string, string>();
  try {
    const owners = await client.getOwners();
    for (const owner of owners) {
      const name = `${owner.firstName} ${owner.lastName}`.trim();
      if (name) {
        ownerMap.set(owner.id, name);
      }
    }
    console.log(`[HubSpot Sync] Built owner map: ${ownerMap.size} owners`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[HubSpot Sync] Failed to fetch owners: ${msg}`);
  }
  return ownerMap;
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
     WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = ANY($2)`,
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
     WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = ANY($2)`,
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
          WHERE workspace_id = $3 AND source = 'hubspot' AND source_id = $4`,
          [accountUuid, contactUuid, workspaceId, deal.source_id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[HubSpot Sync] Failed to update deal foreign keys:', err);
  } finally {
    client.release();
  }
}

async function populateDealContactsFromAssociations(
  workspaceId: string,
  deals: NormalizedDeal[],
  contactMap: Map<string, string>
): Promise<number> {
  const client = await getClient();
  let populated = 0;
  try {
    await client.query('BEGIN');
    for (const deal of deals) {
      if (deal.contact_source_ids.length === 0) continue;

      const dealResult = await client.query(
        `SELECT id FROM deals WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = $2`,
        [workspaceId, deal.source_id]
      );
      const dealUuid = dealResult.rows[0]?.id;
      if (!dealUuid) continue;

      for (let i = 0; i < deal.contact_source_ids.length; i++) {
        const contactUuid = contactMap.get(deal.contact_source_ids[i]);
        if (!contactUuid) continue;

        await client.query(`
          INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, is_primary, source, role_source)
          VALUES ($1, $2, $3, $4, 'hubspot_association', 'crm_association')
          ON CONFLICT (workspace_id, deal_id, contact_id, source) DO UPDATE SET
            is_primary = EXCLUDED.is_primary,
            updated_at = NOW()
        `, [workspaceId, dealUuid, contactUuid, i === 0]);
        populated++;
      }
    }
    await client.query('COMMIT');
    console.log(`[HubSpot Sync] Populated ${populated} deal_contacts from associations`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[HubSpot Sync] Failed to populate deal_contacts from associations:', err);
  } finally {
    client.release();
  }
  return populated;
}

async function upsertActivities(activities: any[]): Promise<number> {
  return upsertInBatches(activities, async (batch) => {
    if (batch.length === 0) return 0;

    const client = await getClient();
    let stored = 0;
    try {
      await client.query('BEGIN');

      for (const activity of batch) {
        // Resolve contact_id and deal_id from source IDs
        let contactId: string | null = null;
        let dealId: string | null = null;

        if (activity.contact_source_id) {
          const contactResult = await client.query(
            `SELECT id FROM contacts WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = $2`,
            [activity.workspace_id, activity.contact_source_id]
          );
          contactId = contactResult.rows[0]?.id || null;
        }

        if (activity.deal_source_id) {
          const dealResult = await client.query(
            `SELECT id FROM deals WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = $2`,
            [activity.workspace_id, activity.deal_source_id]
          );
          dealId = dealResult.rows[0]?.id || null;
        }

        await client.query(
          `INSERT INTO activities (
            workspace_id, source, source_id, source_data,
            activity_type, subject, body, timestamp,
            duration_seconds, contact_id, deal_id,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, $11,
            NOW(), NOW()
          )
          ON CONFLICT (workspace_id, source, source_id) DO UPDATE SET
            source_data = EXCLUDED.source_data,
            activity_type = EXCLUDED.activity_type,
            subject = EXCLUDED.subject,
            body = EXCLUDED.body,
            timestamp = EXCLUDED.timestamp,
            duration_seconds = EXCLUDED.duration_seconds,
            contact_id = EXCLUDED.contact_id,
            deal_id = EXCLUDED.deal_id,
            updated_at = NOW()`,
          [
            activity.workspace_id, activity.source, activity.source_id, JSON.stringify(activity.source_data),
            activity.activity_type, activity.subject, activity.body, activity.timestamp,
            activity.duration_seconds, contactId, dealId,
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

export async function populateDealContactsFromSourceData(workspaceId: string): Promise<number> {
  const result = await query<{ deal_id: string; contact_source_ids: string[] }>(`
    SELECT d.id as deal_id, 
      ARRAY(
        SELECT elem->>'id' 
        FROM jsonb_array_elements(d.source_data->'associations'->'contacts'->'results') elem
        WHERE elem->>'id' IS NOT NULL
      ) as contact_source_ids
    FROM deals d
    WHERE d.workspace_id = $1 
      AND d.source = 'hubspot'
      AND d.source_data->'associations'->'contacts'->'results' IS NOT NULL
      AND jsonb_array_length(d.source_data->'associations'->'contacts'->'results') > 0
  `, [workspaceId]);

  const client = await getClient();
  let populated = 0;
  try {
    await client.query('BEGIN');
    for (const row of result.rows) {
      for (let i = 0; i < row.contact_source_ids.length; i++) {
        const contactResult = await client.query(
          `SELECT id FROM contacts WHERE workspace_id = $1 AND source = 'hubspot' AND source_id = $2`,
          [workspaceId, row.contact_source_ids[i]]
        );
        const contactUuid = contactResult.rows[0]?.id;
        if (!contactUuid) continue;

        await client.query(`
          INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, is_primary, source, role_source)
          VALUES ($1, $2, $3, $4, 'hubspot_association', 'crm_association')
          ON CONFLICT (workspace_id, deal_id, contact_id, source) DO UPDATE SET
            is_primary = EXCLUDED.is_primary,
            updated_at = NOW()
        `, [workspaceId, row.deal_id, contactUuid, i === 0]);
        populated++;
      }
    }
    await client.query('COMMIT');
    console.log(`[HubSpot Sync] Populated ${populated} deal_contacts from stored association data`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[HubSpot Sync] Failed to populate deal_contacts from source data:', err);
  } finally {
    client.release();
  }
  return populated;
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
           WHERE workspace_id = $2 AND source = 'hubspot' AND source_id = $3`,
          [accountUuid, workspaceId, contact.source_id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[HubSpot Sync] Failed to update contact account_ids:', err);
  } finally {
    client.release();
  }
}

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
            name, amount, stage, stage_normalized, close_date, owner,
            probability, forecast_category, forecast_category_source, pipeline,
            last_activity_date, custom_fields, next_steps, lead_source, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, $18, COALESCE($19::timestamptz, NOW()), NOW()
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
            deal.source_created_at,
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
    const [dealOptions, ownerMap, forecastConfig] = await Promise.all([
      buildStageMaps(client, workspaceId),
      buildOwnerMap(client),
      getForecastConfig(workspaceId),
    ]);
    dealOptions.ownerMap = ownerMap;
    dealOptions.forecastThresholds = forecastConfig;
    dealOptions.forecastedPipelines = forecastConfig.forecasted_pipelines;
    const contactOptions: ContactTransformOptions = { ownerMap };

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

    const dealTransformResult = transformWithErrorCapture(
      rawDeals,
      (d) => transformDeal(d, workspaceId, dealOptions),
      'HubSpot Deals',
      (d) => d.id
    );

    const contactTransformResult = transformWithErrorCapture(
      rawContacts,
      (c) => transformContact(c, workspaceId, contactOptions),
      'HubSpot Contacts',
      (c) => c.id
    );

    const accountTransformResult = transformWithErrorCapture(
      rawCompanies,
      (c) => transformCompany(c, workspaceId),
      'HubSpot Companies',
      (c) => c.id
    );

    if (dealTransformResult.failed.length > 0) {
      errors.push(`Deal transform failures: ${dealTransformResult.failed.length} records`);
    }
    if (contactTransformResult.failed.length > 0) {
      errors.push(`Contact transform failures: ${contactTransformResult.failed.length} records`);
    }
    if (accountTransformResult.failed.length > 0) {
      errors.push(`Account transform failures: ${accountTransformResult.failed.length} records`);
    }

    const normalizedDeals = dealTransformResult.succeeded;
    const normalizedContacts = contactTransformResult.succeeded;
    const normalizedAccounts = accountTransformResult.succeeded;

    // Upsert accounts first so we can resolve account_id FKs
    const accountsStored = await upsertAccounts(normalizedAccounts).catch(err => {
      console.error(`[HubSpot Sync] Failed to store accounts:`, err.message);
      errors.push(`Failed to store accounts: ${err.message}`);
      return 0;
    });

    // Detect stage changes BEFORE upserting deals (must capture previous stage)
    const stageChanges = await detectStageChanges(
      workspaceId,
      normalizedDeals.map(d => ({
        sourceId: d.source_id,
        stage: d.stage,
        stage_normalized: d.stage_normalized,
      }))
    );

    if (stageChanges.length > 0) {
      const recorded = await recordStageChanges(stageChanges, 'sync_detection');
      console.log(`[Stage Tracker] Recorded ${recorded} stage changes for workspace ${workspaceId}`);
    }

    const [dealsStored, contactsStored] = await Promise.all([
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
    ]);

    // Update cached stage columns AFTER upsert
    if (stageChanges.length > 0) {
      await updateDealStageCache(stageChanges);
    }

    // Resolve account_source_id → account_id UUIDs and update FK columns
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

    console.log(`[HubSpot Sync] Resolved FKs: ${accountIdMap.size} accounts, ${contactIdMap.size} contacts`);

    // Fetch and transform activities (must be after contacts and deals for FK resolution)
    let rawEngagements: any[] = [];
    try {
      rawEngagements = await client.getAllEngagements();
      console.log(`[HubSpot Sync] Fetched ${rawEngagements.length} engagements`);
    } catch (err: any) {
      errors.push(`Failed to fetch engagements: ${err.message}`);
    }

    const activityTransformResult = transformWithErrorCapture(
      rawEngagements,
      (e) => transformEngagement(e, workspaceId),
      'HubSpot Engagements',
      (e) => e.id
    );

    if (activityTransformResult.failed.length > 0) {
      errors.push(`Activity transform failures: ${activityTransformResult.failed.length} records`);
    }

    const normalizedActivities = activityTransformResult.succeeded;

    const activitiesStored = await upsertActivities(normalizedActivities).catch(err => {
      console.error(`[HubSpot Sync] Failed to store activities:`, err.message);
      errors.push(`Failed to store activities: ${err.message}`);
      return 0;
    });

    console.log(`[HubSpot Sync] Stored ${activitiesStored} activities`);

    totalStored = dealsStored + contactsStored + accountsStored + activitiesStored;
    console.log(`[HubSpot Sync] Stored ${dealsStored} deals, ${contactsStored} contacts, ${accountsStored} accounts, ${activitiesStored} activities`);

    await updateConnectionSyncStatus(workspaceId, 'hubspot', totalStored, errors.length > 0 ? errors[0] : null);

    // Trigger stage history backfill if this is initial sync and deals have stale stage_changed_at
    if (dealsStored > 0) {
      const staleStageTimestamps = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM deals
         WHERE workspace_id = $1 AND source = 'hubspot'
           AND (stage_changed_at IS NULL OR stage_changed_at = created_at)`,
        [workspaceId]
      );
      const staleCount = parseInt(staleStageTimestamps.rows[0]?.count || '0', 10);

      if (staleCount > 0) {
        console.log(`[HubSpot Sync] ${staleCount} deals have stale stage_changed_at. Triggering stage history backfill...`);
        const { backfillStageHistory } = await import('./stage-history-backfill.js');

        // Run backfill async (don't block sync completion)
        backfillStageHistory(workspaceId, client.getAccessToken())
          .then(result => {
            console.log(`[HubSpot Sync] Stage history backfill complete:`, result);
          })
          .catch(err => {
            console.error(`[HubSpot Sync] Stage history backfill failed:`, err.message);
          });
      }
    }

    // Trigger contact role resolution if deal_contacts is empty or has missing roles
    if (dealsStored > 0 && contactsStored > 0) {
      const dealContactsCheck = await query<{ total: string; with_roles: string }>(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE buying_role IS NOT NULL) as with_roles
         FROM deal_contacts
         WHERE workspace_id = $1`,
        [workspaceId]
      );
      const totalDealContacts = parseInt(dealContactsCheck.rows[0]?.total || '0', 10);
      const dealContactsWithRoles = parseInt(dealContactsCheck.rows[0]?.with_roles || '0', 10);
      const missingRoles = totalDealContacts - dealContactsWithRoles;

      // Trigger if empty OR if >50% are missing roles
      if (totalDealContacts === 0 || (totalDealContacts > 0 && missingRoles / totalDealContacts > 0.5)) {
        console.log(`[HubSpot Sync] ${missingRoles}/${totalDealContacts} deal_contacts missing roles. Triggering contact role resolution...`);
        const { resolveHubSpotContactRoles } = await import('./contact-role-resolution.js');

        // Run async (don't block sync completion)
        resolveHubSpotContactRoles(client, workspaceId)
          .then(result => {
            console.log(`[HubSpot Sync] Contact role resolution complete:`, result);
          })
          .catch(err => {
            console.error(`[HubSpot Sync] Contact role resolution failed:`, err.message);
          });
      }
    }

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

  const [dealOptions, ownerMap, forecastConfig] = await Promise.all([
    buildStageMaps(hubspotClient, workspaceId),
    buildOwnerMap(hubspotClient),
    getForecastConfig(workspaceId),
  ]);
  dealOptions.ownerMap = ownerMap;
  dealOptions.forecastThresholds = forecastConfig;
  dealOptions.forecastedPipelines = forecastConfig.forecasted_pipelines;
  const contactOptions: ContactTransformOptions = { ownerMap };

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

    // Transform with per-record error capture
    const dealTransformResult = transformWithErrorCapture(
      rawDeals,
      (d) => transformDeal({ id: d.id, properties: d.properties as any } as any, workspaceId, dealOptions),
      'HubSpot Deals (Incremental)',
      (d) => d.id
    );

    const contactTransformResult = transformWithErrorCapture(
      rawContacts,
      (c) => transformContact({ id: c.id, properties: c.properties as any } as any, workspaceId, contactOptions),
      'HubSpot Contacts (Incremental)',
      (c) => c.id
    );

    const accountTransformResult = transformWithErrorCapture(
      rawCompanies,
      (c) => transformCompany({ id: c.id, properties: c.properties as any } as any, workspaceId),
      'HubSpot Companies (Incremental)',
      (c) => c.id
    );

    if (dealTransformResult.failed.length > 0) {
      errors.push(`Deal transform failures: ${dealTransformResult.failed.length} records`);
    }
    if (contactTransformResult.failed.length > 0) {
      errors.push(`Contact transform failures: ${contactTransformResult.failed.length} records`);
    }
    if (accountTransformResult.failed.length > 0) {
      errors.push(`Account transform failures: ${accountTransformResult.failed.length} records`);
    }

    const normalizedDeals = dealTransformResult.succeeded;
    const normalizedContacts = contactTransformResult.succeeded;
    const normalizedAccounts = accountTransformResult.succeeded;

    const accountsStored = await upsertAccounts(normalizedAccounts).catch(err => { errors.push(`Failed to store accounts: ${err.message}`); return 0; });

    const [dealsStored, contactsStored] = await Promise.all([
      upsertDeals(normalizedDeals).catch(err => { errors.push(`Failed to store deals: ${err.message}`); return 0; }),
      upsertContacts(normalizedContacts).catch(err => { errors.push(`Failed to store contacts: ${err.message}`); return 0; }),
    ]);

    // Resolve FK associations
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

    await populateDealContactsFromAssociations(workspaceId, normalizedDeals, contactIdMap);

    // Fetch activities updated since last sync
    const lastSyncTimestamp = Math.floor(since.getTime());
    let rawEngagements: any[] = [];
    try {
      rawEngagements = await hubspotClient.getAllEngagements(lastSyncTimestamp);
      console.log(`[HubSpot Incremental Sync] Fetched ${rawEngagements.length} updated engagements`);
    } catch (err: any) {
      errors.push(`Failed to fetch engagements: ${err.message}`);
    }

    const activityTransformResult = transformWithErrorCapture(
      rawEngagements,
      (e) => transformEngagement(e, workspaceId),
      'HubSpot Engagements',
      (e) => e.id
    );

    if (activityTransformResult.failed.length > 0) {
      errors.push(`Activity transform failures: ${activityTransformResult.failed.length} records`);
    }

    const normalizedActivities = activityTransformResult.succeeded;

    const activitiesStored = await upsertActivities(normalizedActivities).catch(err => {
      console.error(`[HubSpot Incremental Sync] Failed to store activities:`, err.message);
      errors.push(`Failed to store activities: ${err.message}`);
      return 0;
    });

    console.log(`[HubSpot Incremental Sync] Stored ${activitiesStored} activities`);

    totalStored = dealsStored + contactsStored + accountsStored + activitiesStored;
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

    await populateDealContactsFromSourceData(workspaceId);
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
