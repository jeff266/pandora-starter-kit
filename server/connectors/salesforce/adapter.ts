/**
 * Salesforce CRM Adapter
 *
 * Implements CRMAdapter interface for Salesforce integration
 */

import { SalesforceClient, SalesforceSessionExpiredError } from './client.js';
import {
  transformOpportunity,
  transformContact,
  transformAccount,
  transformTask,
  transformEvent,
  transformStageHistory,
  normalizeSalesforceId,
} from './transform.js';
import type {
  NormalizedDeal,
  NormalizedContact,
  NormalizedAccount,
  NormalizedActivity,
} from './transform.js';
import type {
  SalesforceStage,
  SalesforceCredentials,
  SalesforceField,
} from './types.js';
import type { CRMAdapter, SyncResult } from '../adapters/types.js';
import { createLogger } from '../../utils/logger.js';
const logger = createLogger('Salesforce');
import { query } from '../../db.js';
import { updateCredentialFields } from '../../lib/credential-store.js';
import { inferAnalysisScopes, applyInferredScopes } from '../../config/scope-inference.js';
import { stampAllDealsForWorkspace, stampDealScopes } from '../../config/scope-stamper.js';

// ============================================================================
// Salesforce Adapter Implementation
// ============================================================================

export class SalesforceAdapter implements CRMAdapter {
  readonly sourceType = 'salesforce';
  readonly category = 'crm' as const;

  // ==========================================================================
  // Connection Test
  // ==========================================================================

  async testConnection(credentials: Record<string, any>): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const client = this.createClient(credentials);
      const result = await client.testConnection();

      if (!result.success) {
        return { success: false, error: result.error };
      }

      logger.info('[Salesforce Adapter] Connection test successful', {
        orgId: result.orgId,
        orgName: result.orgName,
        edition: result.edition,
      });

      return { success: true };
    } catch (error) {
      logger.error('[Salesforce Adapter] Connection test failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  async health(credentials: Record<string, any>): Promise<{
    healthy: boolean;
    details?: Record<string, any>;
  }> {
    try {
      const client = this.createClient(credentials);
      const result = await client.testConnection();
      const limits = client.getApiLimits();

      // Calculate token freshness
      const tokenIssuedAt = credentials.issuedAt
        ? new Date(credentials.issuedAt)
        : null;

      let tokenAgeMinutes = null;
      let tokenStatus = 'unknown';
      let nextRefreshAt = null;

      if (tokenIssuedAt) {
        const ageMs = Date.now() - tokenIssuedAt.getTime();
        tokenAgeMinutes = Math.floor(ageMs / (60 * 1000));

        const REFRESH_THRESHOLD_MINUTES = 90;
        const TOKEN_EXPIRY_MINUTES = 120;

        if (tokenAgeMinutes < REFRESH_THRESHOLD_MINUTES) {
          tokenStatus = 'fresh';
          nextRefreshAt = new Date(tokenIssuedAt.getTime() + REFRESH_THRESHOLD_MINUTES * 60 * 1000);
        } else if (tokenAgeMinutes < TOKEN_EXPIRY_MINUTES) {
          tokenStatus = 'stale';
          nextRefreshAt = new Date(); // Refresh on next sync
        } else {
          tokenStatus = 'expired';
          nextRefreshAt = new Date(); // Immediate refresh needed
        }
      }

      return {
        healthy: result.success,
        details: {
          connected: result.success,
          orgName: result.orgName,
          edition: result.edition,
          apiLimitsUsed: limits.used,
          apiLimitsTotal: limits.total,
          apiLimitsPercent: limits.percentUsed,
          tokenAgeMinutes,
          tokenStatus,
          tokenIssuedAt: tokenIssuedAt?.toISOString() || null,
          nextRefreshAt: nextRefreshAt?.toISOString() || null,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // ==========================================================================
  // Schema Discovery
  // ==========================================================================

  async discoverSchema(credentials: Record<string, any>): Promise<{
    customFields: Array<{
      key: string;
      label: string;
      type: 'string' | 'number' | 'date' | 'boolean' | 'array';
      category: 'deal' | 'contact' | 'account';
    }>;
  }> {
    try {
      const client = this.createClient(credentials);

      const [oppDescribe, contactDescribe, accountDescribe, stages] = await Promise.all([
        client.describeObject('Opportunity'),
        client.describeObject('Contact'),
        client.describeObject('Account'),
        client.getOpportunityStages(),
      ]);

      const customFields: Array<any> = [];

      // Extract Opportunity custom fields
      for (const field of oppDescribe.fields) {
        if (field.custom || this.isHighValueField(field.name, field.label)) {
          customFields.push({
            key: field.name,
            label: field.label,
            type: this.mapFieldType(field.type),
            category: 'deal' as const,
          });
        }
      }

      // Extract Contact custom fields
      for (const field of contactDescribe.fields) {
        if (field.custom || this.isHighValueField(field.name, field.label)) {
          customFields.push({
            key: field.name,
            label: field.label,
            type: this.mapFieldType(field.type),
            category: 'contact' as const,
          });
        }
      }

      // Extract Account custom fields
      for (const field of accountDescribe.fields) {
        if (field.custom || this.isHighValueField(field.name, field.label)) {
          customFields.push({
            key: field.name,
            label: field.label,
            type: this.mapFieldType(field.type),
            category: 'account' as const,
          });
        }
      }

      logger.info('[Salesforce Adapter] Schema discovered', {
        opportunityFields: oppDescribe.fields.length,
        customOpportunityFields: customFields.filter(f => f.category === 'deal').length,
        stages: stages.length,
      });

      return { customFields };
    } catch (error) {
      logger.error('[Salesforce Adapter] Schema discovery failed', { error });
      return { customFields: [] };
    }
  }

  // ==========================================================================
  // Custom Field Discovery
  // ==========================================================================

  /**
   * Fetch custom field metadata and build complete field lists for SOQL queries
   */
  private async buildFieldLists(client: SalesforceClient): Promise<{
    opportunityFields: string[];
    contactFields: string[];
    accountFields: string[];
    leadFields: string[];
    fieldMetadata: {
      opportunity: SalesforceField[];
      contact: SalesforceField[];
      account: SalesforceField[];
      lead: SalesforceField[];
    };
  }> {
    // Import default field lists
    const { DEFAULT_OPPORTUNITY_FIELDS, DEFAULT_CONTACT_FIELDS, DEFAULT_ACCOUNT_FIELDS, DEFAULT_LEAD_FIELDS } = await import('./types.js');

    // Fetch field metadata in parallel
    const [oppFieldMeta, contactFieldMeta, accountFieldMeta, leadFieldMeta] = await Promise.all([
      client.getObjectFields('Opportunity'),
      client.getObjectFields('Contact'),
      client.getObjectFields('Account'),
      client.getObjectFields('Lead'),
    ]);

    // Extract field names from metadata
    const oppCustomFieldNames = oppFieldMeta.map(f => f.name);
    const contactCustomFieldNames = contactFieldMeta.map(f => f.name);
    const accountCustomFieldNames = accountFieldMeta.map(f => f.name);
    const leadCustomFieldNames = leadFieldMeta.map(f => f.name);

    // Combine with defaults, deduplicating
    const opportunityFields = Array.from(new Set([
      ...DEFAULT_OPPORTUNITY_FIELDS,
      ...oppCustomFieldNames,
    ]));

    const contactFields = Array.from(new Set([
      ...DEFAULT_CONTACT_FIELDS,
      ...contactCustomFieldNames,
    ]));

    const accountFields = Array.from(new Set([
      ...DEFAULT_ACCOUNT_FIELDS,
      ...accountCustomFieldNames,
    ]));

    const leadFields = Array.from(new Set([
      ...DEFAULT_LEAD_FIELDS,
      ...leadCustomFieldNames,
    ]));

    logger.info('[Salesforce Adapter] Built field lists', {
      opportunity: { default: DEFAULT_OPPORTUNITY_FIELDS.length, custom: oppCustomFieldNames.length, total: opportunityFields.length },
      contact: { default: DEFAULT_CONTACT_FIELDS.length, custom: contactCustomFieldNames.length, total: contactFields.length },
      account: { default: DEFAULT_ACCOUNT_FIELDS.length, custom: accountCustomFieldNames.length, total: accountFields.length },
      lead: { default: DEFAULT_LEAD_FIELDS.length, custom: leadCustomFieldNames.length, total: leadFields.length },
    });

    return {
      opportunityFields,
      contactFields,
      accountFields,
      leadFields,
      fieldMetadata: {
        opportunity: oppFieldMeta,
        contact: contactFieldMeta,
        account: accountFieldMeta,
        lead: leadFieldMeta,
      },
    };
  }

  /**
   * Store field metadata in connections metadata for use by custom field discovery engine
   */
  private async storeFieldMetadata(
    workspaceId: string,
    fieldMetadata: { opportunity: SalesforceField[]; contact: SalesforceField[]; account: SalesforceField[]; lead: SalesforceField[] }
  ): Promise<void> {
    try {
      await query(
        `UPDATE connections
         SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{field_metadata}',
           $1::jsonb
         ),
         updated_at = NOW()
         WHERE workspace_id = $2 AND connector_name = 'salesforce'`,
        [JSON.stringify(fieldMetadata), workspaceId]
      );

      logger.debug('[Salesforce Adapter] Stored field metadata', {
        workspaceId,
        opportunity: fieldMetadata.opportunity.length,
        contact: fieldMetadata.contact.length,
        account: fieldMetadata.account.length,
        lead: fieldMetadata.lead.length,
      });
    } catch (error) {
      logger.warn('[Salesforce Adapter] Failed to store field metadata', { error });
      // Non-fatal - continue with sync
    }
  }

  // ==========================================================================
  // Initial Sync
  // ==========================================================================

  async initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ): Promise<{
    deals?: SyncResult<NormalizedDeal>;
    contacts?: SyncResult<NormalizedContact>;
    accounts?: SyncResult<NormalizedAccount>;
  }> {
    const client = await this.createClientWithRefresh(credentials, workspaceId);

    // Fetch custom field metadata and build field lists
    const { opportunityFields, contactFields, accountFields, leadFields, fieldMetadata } = await this.buildFieldLists(client);

    // Store field metadata for custom field discovery engine
    await this.storeFieldMetadata(workspaceId, fieldMetadata);

    // Get stage metadata (needed for deal transformation)
    let stageMap = new Map<string, SalesforceStage>();
    try {
      const stages = await client.getOpportunityStages();
      stageMap = new Map(stages.map(s => [s.ApiName, s]));
    } catch (error) {
      logger.warn('[Salesforce Adapter] Failed to fetch stage metadata, continuing without stage normalization', { error });
    }

    // Get record counts to decide sync strategy
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
    } catch (error) {
      logger.warn('[Salesforce Adapter] Failed to get record counts, will attempt sync anyway', { error });
    }

    logger.info('[Salesforce Adapter] Starting initial sync', {
      opportunities: oppCount,
      contacts: contactCount,
      accounts: accountCount,
    });

    // Sync accounts first (needed for FK resolution)
    const accounts = await this.syncAccounts(client, workspaceId, accountCount, accountFields);

    // Sync contacts second
    const contacts = await this.syncContacts(client, workspaceId, contactCount, contactFields);

    // Sync opportunities last
    const deals = await this.syncOpportunities(client, workspaceId, oppCount, stageMap, opportunityFields);

    logger.info('[Salesforce Adapter] Initial sync completed', {
      accountsSucceeded: accounts.succeeded.length,
      accountsFailed: accounts.failed.length,
      contactsSucceeded: contacts.succeeded.length,
      contactsFailed: contacts.failed.length,
      dealsSucceeded: deals.succeeded.length,
      dealsFailed: deals.failed.length,
    });

    // Sync Leads (for ICP funnel analysis)
    await this.syncLeads(client, workspaceId, leadFields);

    // Link converted leads to contacts/accounts/deals
    await this.linkConvertedLeads(workspaceId);

    // Sync OpportunityContactRole (deal-contact associations)
    await this.syncContactRoles(client, workspaceId);

    // Sync Activities (Tasks + Events)
    await this.syncActivities(client, workspaceId, null);

    // Sync OpportunityFieldHistory (stage transitions)
    await this.syncStageHistory(client, workspaceId, stageMap, null);

    // File Import → Salesforce Upgrade: Transition file-imported deals to Salesforce source
    // This runs automatically on first Salesforce sync to seamlessly upgrade workspaces
    await this.runUpgradeIfNeeded(workspaceId);

    // Scope inference + stamping — run after all deals are written
    // Non-blocking: don't delay sync completion on inference errors
    if (deals.succeeded.length > 0) {
      inferAnalysisScopes(workspaceId)
        .then(async (inferred) => {
          await applyInferredScopes(workspaceId, inferred);
          await stampAllDealsForWorkspace(workspaceId);
          logger.info('[Salesforce Adapter] Scope inference + stamping complete', { workspaceId });
        })
        .catch(err => {
          logger.warn('[Salesforce Adapter] Scope inference failed', { workspaceId, error: err instanceof Error ? err.message : err });
        });
    }

    return { deals, contacts, accounts };
  }

  // ==========================================================================
  // Incremental Sync
  // ==========================================================================

  async incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ): Promise<{
    deals?: SyncResult<NormalizedDeal>;
    contacts?: SyncResult<NormalizedContact>;
    accounts?: SyncResult<NormalizedAccount>;
  }> {
    const client = await this.createClientWithRefresh(credentials, workspaceId);

    try {
      // Fetch custom field metadata and build field lists
      const { opportunityFields, contactFields, accountFields, leadFields, fieldMetadata } = await this.buildFieldLists(client);

      // Store field metadata for custom field discovery engine
      await this.storeFieldMetadata(workspaceId, fieldMetadata);

      const stages = await client.getOpportunityStages();
      const stageMap = new Map(stages.map(s => [s.ApiName, s]));

      logger.info('[Salesforce Adapter] Starting incremental sync', {
        since: lastSyncTime.toISOString(),
      });

      // Use REST API for incremental (volumes are small)
      const [rawAccounts, rawContacts, rawOpportunities] = await Promise.all([
        client.getModifiedSince('Account', accountFields, lastSyncTime),
        client.getModifiedSince('Contact', contactFields, lastSyncTime),
        client.getModifiedSince('Opportunity', opportunityFields, lastSyncTime),
      ]);

      // Transform and upsert
      const accounts = this.transformAndCollect(
        rawAccounts,
        workspaceId,
        (acc) => transformAccount(acc, workspaceId)
      );

      const contacts = this.transformAndCollect(
        rawContacts,
        workspaceId,
        (contact) => transformContact(contact, workspaceId)
      );

      const deals = this.transformAndCollect(
        rawOpportunities,
        workspaceId,
        (opp) => transformOpportunity(opp, workspaceId, stageMap)
      );

      // Sync Leads (for ICP funnel analysis) - incremental
      await this.syncLeads(client, workspaceId, leadFields, lastSyncTime);

      // Link converted leads to contacts/accounts/deals
      await this.linkConvertedLeads(workspaceId);

      // Sync OpportunityContactRole (deal-contact associations)
      await this.syncContactRoles(client, workspaceId);

      // Sync Activities (Tasks + Events) - incremental from lastSyncTime
      await this.syncActivities(client, workspaceId, lastSyncTime);

      // Sync OpportunityFieldHistory (stage transitions) - incremental from lastSyncTime
      await this.syncStageHistory(client, workspaceId, stageMap, lastSyncTime);

      // TODO: Check for deleted records using IsDeleted = true

      // Scope stamping — re-stamp only the deals touched in this incremental sync
      // Do NOT re-run inference on incremental (scopes are already configured)
      if (deals.succeeded.length > 0) {
        const sourceIds = deals.succeeded.map(d => d.source_id);
        query<{ id: string }>(
          `SELECT id FROM deals WHERE workspace_id = $1 AND source = 'salesforce' AND source_id = ANY($2)`,
          [workspaceId, sourceIds]
        ).then(async (res) => {
          const dealIds = res.rows.map(r => r.id);
          await stampDealScopes(workspaceId, dealIds);
          logger.info('[Salesforce Adapter] Incremental scope stamping complete', { workspaceId, stamped: dealIds.length });
        }).catch(err => {
          logger.warn('[Salesforce Adapter] Incremental scope stamping failed', { workspaceId, error: err instanceof Error ? err.message : err });
        });
      }

      return { deals, contacts, accounts };
    } catch (error) {
      logger.error('[Salesforce Adapter] Incremental sync failed', { error });
      throw error;
    }
  }

  // ==========================================================================
  // Transform Methods (CRMAdapter interface)
  // ==========================================================================

  transformDeal(raw: any, workspaceId: string, options?: any): NormalizedDeal {
    const stageMap = options?.stageMap || new Map();
    return transformOpportunity(raw, workspaceId, stageMap);
  }

  transformContact(raw: any, workspaceId: string, options?: any): NormalizedContact {
    return transformContact(raw, workspaceId);
  }

  transformAccount(raw: any, workspaceId: string, options?: any): NormalizedAccount {
    return transformAccount(raw, workspaceId);
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private createClient(credentials: Record<string, any>): SalesforceClient {
    return new SalesforceClient({
      accessToken: credentials.accessToken,
      instanceUrl: credentials.instanceUrl,
      apiVersion: credentials.apiVersion,
    });
  }

  private async createClientWithRefresh(
    credentials: Record<string, any>,
    workspaceId: string
  ): Promise<SalesforceClient> {
    try {
      return this.createClient(credentials);
    } catch (error) {
      if (error instanceof SalesforceSessionExpiredError) {
        // Refresh token and update credentials
        const refreshed = await SalesforceClient.refreshAccessToken(
          credentials.refreshToken,
          credentials.clientId,
          credentials.clientSecret
        );

        // Update stored credentials
        await this.updateStoredCredentials(workspaceId, {
          accessToken: refreshed.accessToken,
          instanceUrl: refreshed.instanceUrl,
        });

        return new SalesforceClient({
          accessToken: refreshed.accessToken,
          instanceUrl: refreshed.instanceUrl,
        });
      }
      throw error;
    }
  }

  private async updateStoredCredentials(
    workspaceId: string,
    updates: { accessToken: string; instanceUrl: string }
  ): Promise<void> {
    // Update credentials using credential store (handles decryption, merge, encryption)
    await updateCredentialFields(workspaceId, 'salesforce', updates);
  }

  private async syncOpportunities(
    client: SalesforceClient,
    workspaceId: string,
    count: number,
    stageMap: Map<string, SalesforceStage>,
    fields: string[]
  ): Promise<SyncResult<NormalizedDeal>> {
    let rawOpportunities: any[] = [];

    try {
      if (count < 10000) {
        // Use REST API for smaller datasets
        rawOpportunities = await client.getOpportunities(fields);
      } else {
        // Try Bulk API first for large datasets
        try {
          logger.info('[Salesforce Adapter] Using Bulk API for opportunities', { count, fields: fields.length });
          const soql = `SELECT ${fields.join(', ')} FROM Opportunity`;
          rawOpportunities = await client.bulkQuery(soql);
        } catch (bulkError) {
          // Fallback to REST API if Bulk API fails
          logger.warn('[Salesforce Adapter] Bulk API failed, falling back to REST API', {
            error: bulkError instanceof Error ? bulkError.message : String(bulkError),
            count,
          });
          rawOpportunities = await client.getOpportunities(fields);
        }
      }

      return this.transformAndCollect(rawOpportunities, workspaceId, (opp) =>
        transformOpportunity(opp, workspaceId, stageMap)
      );
    } catch (error) {
      logger.error('[Salesforce Adapter] Opportunity sync failed completely', { error });
      return { succeeded: [], failed: [], totalAttempted: 0 };
    }
  }

  private async syncContacts(
    client: SalesforceClient,
    workspaceId: string,
    count: number,
    fields: string[]
  ): Promise<SyncResult<NormalizedContact>> {
    let rawContacts: any[] = [];

    try {
      if (count < 10000) {
        // Use REST API for smaller datasets
        rawContacts = await client.getContacts(fields);
      } else {
        // Try Bulk API first for large datasets
        try {
          logger.info('[Salesforce Adapter] Using Bulk API for contacts', { count, fields: fields.length });
          const soql = `SELECT ${fields.join(', ')} FROM Contact`;
          rawContacts = await client.bulkQuery(soql);
        } catch (bulkError) {
          // Fallback to REST API if Bulk API fails
          logger.warn('[Salesforce Adapter] Bulk API failed, falling back to REST API', {
            error: bulkError instanceof Error ? bulkError.message : String(bulkError),
            count,
          });
          rawContacts = await client.getContacts(fields);
        }
      }

      return this.transformAndCollect(rawContacts, workspaceId, (contact) =>
        transformContact(contact, workspaceId)
      );
    } catch (error) {
      logger.error('[Salesforce Adapter] Contact sync failed completely', { error });
      return { succeeded: [], failed: [], totalAttempted: 0 };
    }
  }

  private async syncAccounts(
    client: SalesforceClient,
    workspaceId: string,
    count: number,
    fields: string[]
  ): Promise<SyncResult<NormalizedAccount>> {
    let rawAccounts: any[] = [];

    try {
      if (count < 10000) {
        // Use REST API for smaller datasets
        rawAccounts = await client.getAccounts(fields);
      } else {
        // Try Bulk API first for large datasets
        try {
          logger.info('[Salesforce Adapter] Using Bulk API for accounts', { count, fields: fields.length });
          const soql = `SELECT ${fields.join(', ')} FROM Account`;
          rawAccounts = await client.bulkQuery(soql);
        } catch (bulkError) {
          // Fallback to REST API if Bulk API fails
          logger.warn('[Salesforce Adapter] Bulk API failed, falling back to REST API', {
            error: bulkError instanceof Error ? bulkError.message : String(bulkError),
            count,
          });
          rawAccounts = await client.getAccounts(fields);
        }
      }

      return this.transformAndCollect(rawAccounts, workspaceId, (account) =>
        transformAccount(account, workspaceId)
      );
    } catch (error) {
      logger.error('[Salesforce Adapter] Account sync failed completely', { error });
      return { succeeded: [], failed: [], totalAttempted: 0 };
    }
  }

  private async syncLeads(
    client: SalesforceClient,
    workspaceId: string,
    fields: string[],
    since?: Date
  ): Promise<void> {
    try {
      const isInitialSync = !since;
      const rawLeads = await client.getLeads(fields, since, isInitialSync);

      logger.info('[Salesforce Adapter] Syncing leads', {
        count: rawLeads.length,
        mode: isInitialSync ? 'initial' : 'incremental',
      });

      // Transform leads
      const { transformLead } = await import('./transform.js');
      let synced = 0;
      let failed = 0;

      for (const lead of rawLeads) {
        try {
          const normalized = transformLead(lead, workspaceId);

          // Upsert to leads table
          await query(
            `INSERT INTO leads (
              workspace_id, source, source_id, source_data,
              first_name, last_name, email, phone, title, company, website,
              status, lead_source, industry, annual_revenue, employee_count,
              is_converted, converted_at,
              sf_converted_contact_id, sf_converted_account_id, sf_converted_opportunity_id,
              owner_id, owner_name, owner_email,
              custom_fields, created_date, last_modified,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, $7, $8, $9, $10, $11,
              $12, $13, $14, $15, $16,
              $17, $18,
              $19, $20, $21,
              $22, $23, $24,
              $25, $26, $27,
              NOW(), NOW()
            )
            ON CONFLICT (workspace_id, source, source_id)
            DO UPDATE SET
              first_name = $5, last_name = $6, email = $7, phone = $8,
              title = $9, company = $10, website = $11,
              status = $12, lead_source = $13, industry = $14,
              annual_revenue = $15, employee_count = $16,
              is_converted = $17, converted_at = $18,
              sf_converted_contact_id = $19, sf_converted_account_id = $20, sf_converted_opportunity_id = $21,
              owner_id = $22, owner_name = $23, owner_email = $24,
              custom_fields = $25, created_date = $26, last_modified = $27,
              source_data = $4, updated_at = NOW()`,
            [
              normalized.workspace_id,
              normalized.source,
              normalized.source_id,
              JSON.stringify(normalized.source_data),
              normalized.first_name,
              normalized.last_name,
              normalized.email,
              normalized.phone,
              normalized.title,
              normalized.company,
              normalized.website,
              normalized.status,
              normalized.lead_source,
              normalized.industry,
              normalized.annual_revenue,
              normalized.employee_count,
              normalized.is_converted,
              normalized.converted_at,
              normalized.sf_converted_contact_id,
              normalized.sf_converted_account_id,
              normalized.sf_converted_opportunity_id,
              normalized.owner_id,
              normalized.owner_name,
              normalized.owner_email,
              JSON.stringify(normalized.custom_fields),
              normalized.created_date,
              normalized.last_modified,
            ]
          );

          synced++;
        } catch (error) {
          failed++;
          logger.warn('[Salesforce Adapter] Failed to sync lead', {
            leadId: lead.Id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('[Salesforce Adapter] Lead sync completed', {
        total: rawLeads.length,
        synced,
        failed,
      });
    } catch (error) {
      logger.warn('[Salesforce Adapter] Lead sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't fail overall sync - leads are enrichment
    }
  }

  /**
   * Link converted leads to their corresponding contacts/accounts/deals
   * Resolves sf_converted_* Salesforce IDs to UUID foreign keys
   */
  private async linkConvertedLeads(workspaceId: string): Promise<void> {
    try {
      // Link to contacts
      const contactResult = await query(
        `UPDATE leads l SET
          converted_contact_id = c.id
        FROM contacts c
        WHERE l.workspace_id = c.workspace_id
          AND l.sf_converted_contact_id = c.source_id
          AND c.source = 'salesforce'
          AND l.workspace_id = $1
          AND l.converted_contact_id IS NULL
          AND l.sf_converted_contact_id IS NOT NULL`,
        [workspaceId]
      );

      // Link to accounts
      const accountResult = await query(
        `UPDATE leads l SET
          converted_account_id = a.id
        FROM accounts a
        WHERE l.workspace_id = a.workspace_id
          AND l.sf_converted_account_id = a.source_id
          AND a.source = 'salesforce'
          AND l.workspace_id = $1
          AND l.converted_account_id IS NULL
          AND l.sf_converted_account_id IS NOT NULL`,
        [workspaceId]
      );

      // Link to deals
      const dealResult = await query(
        `UPDATE leads l SET
          converted_deal_id = d.id
        FROM deals d
        WHERE l.workspace_id = d.workspace_id
          AND l.sf_converted_opportunity_id = d.source_id
          AND d.source = 'salesforce'
          AND l.workspace_id = $1
          AND l.converted_deal_id IS NULL
          AND l.sf_converted_opportunity_id IS NOT NULL`,
        [workspaceId]
      );

      logger.info('[Salesforce Adapter] Linked converted leads', {
        contacts: contactResult.rowCount,
        accounts: accountResult.rowCount,
        deals: dealResult.rowCount,
      });
    } catch (error) {
      logger.warn('[Salesforce Adapter] Failed to link converted leads', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Non-fatal - continue
    }
  }

  private async syncContactRoles(
    client: SalesforceClient,
    workspaceId: string
  ): Promise<void> {
    try {
      // Build lookup maps for deal_id and contact_id resolution
      const dealResult = await query<{ source_id: string; id: string }>(
        `SELECT source_id, id FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
        [workspaceId]
      );
      // Normalize IDs to 15 chars for lookups (handles 15-char CSV IDs vs 18-char API IDs)
      const dealIdMap = new Map(
        dealResult.rows
          .filter(r => r.source_id)
          .map(r => [normalizeSalesforceId(r.source_id)!, r.id])
      );

      const contactResult = await query<{ source_id: string; id: string }>(
        `SELECT source_id, id FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
        [workspaceId]
      );
      // Normalize IDs to 15 chars for lookups
      const contactIdMap = new Map(
        contactResult.rows
          .filter(r => r.source_id)
          .map(r => [normalizeSalesforceId(r.source_id)!, r.id])
      );

      // Fetch contact roles from Salesforce
      const roles = await client.getOpportunityContactRoles();

      if (roles.length === 0) {
        logger.info('[Salesforce Adapter] No OpportunityContactRoles found (may not be used in this org)');
        return;
      }

      // Upsert to deal_contacts table
      let synced = 0;
      let skipped = 0;

      for (const role of roles) {
        // Normalize IDs before lookup (Salesforce API returns 18-char, DB may have 15-char from CSV)
        const dealId = dealIdMap.get(normalizeSalesforceId(role.OpportunityId)!);
        const contactId = contactIdMap.get(normalizeSalesforceId(role.ContactId)!);

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

      logger.info('[Salesforce Adapter] Synced contact roles', {
        total: roles.length,
        synced,
        skipped,
      });
    } catch (error) {
      // Don't fail overall sync if contact roles fail
      logger.warn('[Salesforce Adapter] Contact role sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async syncActivities(
    client: SalesforceClient,
    workspaceId: string,
    since: Date | null
  ): Promise<void> {
    try {
      // Build lookup maps for deal_id and contact_id resolution
      const dealResult = await query<{ source_id: string; id: string }>(
        `SELECT source_id, id FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
        [workspaceId]
      );
      // Normalize IDs to 15 chars for lookups (handles 15-char CSV IDs vs 18-char API IDs)
      const dealIdMap = new Map(
        dealResult.rows
          .filter(r => r.source_id)
          .map(r => [normalizeSalesforceId(r.source_id)!, r.id])
      );

      const contactResult = await query<{ source_id: string; id: string }>(
        `SELECT source_id, id FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
        [workspaceId]
      );
      // Normalize IDs to 15 chars for lookups
      const contactIdMap = new Map(
        contactResult.rows
          .filter(r => r.source_id)
          .map(r => [normalizeSalesforceId(r.source_id)!, r.id])
      );

      // Fetch tasks and events in parallel
      const [tasks, events] = await Promise.all([
        client.getTasks(undefined, undefined, since || undefined),
        client.getEvents(undefined, undefined, since || undefined),
      ]);

      let tasksSynced = 0;
      let tasksSkipped = 0;

      // Transform and upsert tasks
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

      // Transform and upsert events
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

      logger.info('[Salesforce Adapter] Synced activities', {
        tasks: { total: tasks.length, synced: tasksSynced, skipped: tasksSkipped },
        events: { total: events.length, synced: eventsSynced, skipped: eventsSkipped },
      });

      // Log warning if volume is very high on initial sync
      if (!since && (tasks.length > 50000 || events.length > 50000)) {
        logger.warn('[Salesforce Adapter] Very high activity volume detected', {
          tasks: tasks.length,
          events: events.length,
          recommendation: 'Consider using Bulk API for activities in future',
        });
      }
    } catch (error) {
      // Don't fail overall sync if activities fail - they're enrichment, not core
      logger.warn('[Salesforce Adapter] Activity sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sync OpportunityFieldHistory to deal_stage_history table
   * Gracefully handles case where Field History Tracking is not enabled
   */
  private async syncStageHistory(
    client: SalesforceClient,
    workspaceId: string,
    stageMap: Map<string, SalesforceStage>,
    since: Date | null
  ): Promise<void> {
    try {
      // Build lookup map from Salesforce Opportunity ID -> Pandora deal UUID
      const dealResult = await query<{ source_id: string; id: string }>(
        `SELECT source_id, id FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
        [workspaceId]
      );
      const dealIdMap = new Map(dealResult.rows.map(r => [r.source_id, r.id]));

      // Fetch OpportunityFieldHistory records
      const historyRecords = await client.getOpportunityFieldHistory(since || undefined);

      if (historyRecords.length === 0) {
        logger.info('[Salesforce Adapter] No stage history records to sync');
        return;
      }

      // Transform to StageChange objects
      const transitions = transformStageHistory(historyRecords, workspaceId, dealIdMap, stageMap);

      if (transitions.length === 0) {
        logger.info('[Salesforce Adapter] No stage transitions after transformation (no matching deals)');
        return;
      }

      // Record stage changes using shared utility
      const { recordStageChanges } = await import('../hubspot/stage-tracker.js');
      const recorded = await recordStageChanges(transitions, 'salesforce_history');

      logger.info('[Salesforce Adapter] Synced stage history', {
        historyRecords: historyRecords.length,
        transitions: transitions.length,
        recorded,
      });
    } catch (error) {
      // Don't fail overall sync if stage history fails
      // This is expected if Field History Tracking is not enabled for StageName
      logger.warn('[Salesforce Adapter] Stage history sync failed (this is normal if Field History Tracking is not enabled)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Run file import → Salesforce upgrade if needed
   * Automatically transitions CSV-imported deals to Salesforce source on first sync
   */
  private async runUpgradeIfNeeded(workspaceId: string): Promise<void> {
    try {
      const { transitionToApiSync, hasTransitioned } = await import('../import/upgrade.js');

      // Check if upgrade already completed
      if (await hasTransitioned(workspaceId)) {
        logger.debug('[Salesforce Adapter] Upgrade already completed, skipping', { workspaceId });
        return;
      }

      // Run upgrade
      const result = await transitionToApiSync(workspaceId);

      if (result.matchedByExternalId > 0) {
        logger.info('[Salesforce Adapter] File import upgrade completed', {
          matchedDeals: result.matchedByExternalId,
          unmatchedDeals: result.unmatchedDeals,
          stageHistoryTransferred: result.stageHistoryTransferred,
        });
      }
    } catch (error) {
      // Don't fail overall sync if upgrade fails
      logger.warn('[Salesforce Adapter] File import upgrade failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private transformAndCollect<T, R>(
    records: T[],
    workspaceId: string,
    transformFn: (record: T) => R
  ): SyncResult<R> {
    const succeeded: R[] = [];
    const failed: Array<{ record: any; error: string; recordId?: string }> = [];

    for (const record of records) {
      try {
        const normalized = transformFn(record);
        succeeded.push(normalized);
      } catch (error) {
        failed.push({
          record,
          error: error instanceof Error ? error.message : String(error),
          recordId: (record as any).Id,
        });
      }
    }

    return {
      succeeded,
      failed,
      totalAttempted: records.length,
    };
  }

  private isHighValueField(name: string, label: string): boolean {
    const nameLower = name.toLowerCase();
    const labelLower = label.toLowerCase();

    const highValueTerms = [
      'meddic',
      'meddpicc',
      'champion',
      'competitor',
      'next_step',
      'nextstep',
      'arr',
      'mrr',
      'partner',
      'channel',
    ];

    return highValueTerms.some(
      (term) => nameLower.includes(term) || labelLower.includes(term)
    );
  }

  private mapFieldType(
    sfType: string
  ): 'string' | 'number' | 'date' | 'boolean' | 'array' {
    switch (sfType.toLowerCase()) {
      case 'double':
      case 'currency':
      case 'percent':
      case 'int':
        return 'number';
      case 'date':
      case 'datetime':
        return 'date';
      case 'boolean':
      case 'checkbox':
        return 'boolean';
      case 'multipicklist':
        return 'array';
      default:
        return 'string';
    }
  }
}

// Export singleton instance
export const salesforceAdapter = new SalesforceAdapter();
