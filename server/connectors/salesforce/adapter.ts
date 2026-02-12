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
} from './transform.js';
import type {
  NormalizedDeal,
  NormalizedContact,
  NormalizedAccount,
  NormalizedActivity,
} from './transform.js';
import type { SalesforceStage, SalesforceCredentials } from './types.js';
import type { CRMAdapter, SyncResult } from '../adapters/types.js';
import { createLogger } from '../../utils/logger.js';
const logger = createLogger('Salesforce');
import { query } from '../../db.js';
import { encryptCredentials, decryptCredentials, isEncrypted } from '../../lib/encryption.js';

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

      return {
        healthy: result.success,
        details: {
          connected: result.success,
          orgName: result.orgName,
          edition: result.edition,
          apiLimitsUsed: limits.used,
          apiLimitsTotal: limits.total,
          apiLimitsPercent: limits.percentUsed,
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
    const accounts = await this.syncAccounts(client, workspaceId, accountCount);

    // Sync contacts second
    const contacts = await this.syncContacts(client, workspaceId, contactCount);

    // Sync opportunities last
    const deals = await this.syncOpportunities(client, workspaceId, oppCount, stageMap);

    logger.info('[Salesforce Adapter] Initial sync completed', {
      accountsSucceeded: accounts.succeeded.length,
      accountsFailed: accounts.failed.length,
      contactsSucceeded: contacts.succeeded.length,
      contactsFailed: contacts.failed.length,
      dealsSucceeded: deals.succeeded.length,
      dealsFailed: deals.failed.length,
    });

    // Sync OpportunityContactRole (deal-contact associations)
    await this.syncContactRoles(client, workspaceId);

    // Sync Activities (Tasks + Events)
    await this.syncActivities(client, workspaceId, null);

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
      const stages = await client.getOpportunityStages();
      const stageMap = new Map(stages.map(s => [s.ApiName, s]));

      logger.info('[Salesforce Adapter] Starting incremental sync', {
        since: lastSyncTime.toISOString(),
      });

      // Use REST API for incremental (volumes are small)
      const [rawAccounts, rawContacts, rawOpportunities] = await Promise.all([
        client.getModifiedSince('Account', [], lastSyncTime),
        client.getModifiedSince('Contact', [], lastSyncTime),
        client.getModifiedSince('Opportunity', [], lastSyncTime),
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

      // Sync OpportunityContactRole (deal-contact associations)
      await this.syncContactRoles(client, workspaceId);

      // Sync Activities (Tasks + Events) - incremental from lastSyncTime
      await this.syncActivities(client, workspaceId, lastSyncTime);

      // TODO: Check for deleted records using IsDeleted = true

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
    // Read current credentials
    const result = await query<{ credentials: any }>(
      `SELECT credentials FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      throw new Error('Salesforce connection not found');
    }

    let credentials = result.rows[0].credentials;

    // Decrypt if encrypted
    if (isEncrypted(credentials)) {
      credentials = decryptCredentials(credentials);
    }

    // Merge updates
    const merged = { ...credentials, ...updates };

    // Encrypt and store
    const encrypted = encryptCredentials(merged);
    await query(
      `UPDATE connections
       SET credentials = $1, updated_at = NOW()
       WHERE workspace_id = $2 AND connector_name = 'salesforce'`,
      [JSON.stringify(encrypted), workspaceId]
    );
  }

  private async syncOpportunities(
    client: SalesforceClient,
    workspaceId: string,
    count: number,
    stageMap: Map<string, SalesforceStage>
  ): Promise<SyncResult<NormalizedDeal>> {
    let rawOpportunities: any[] = [];

    try {
      if (count < 10000) {
        // Use REST API for smaller datasets
        rawOpportunities = await client.getOpportunities();
      } else {
        // Try Bulk API first for large datasets
        try {
          logger.info('[Salesforce Adapter] Using Bulk API for opportunities', { count });
          rawOpportunities = await client.bulkQuery('SELECT Id, Name, Amount, StageName, CloseDate, Probability, ForecastCategoryName, OwnerId, AccountId, Type, LeadSource, IsClosed, IsWon, Description, NextStep, CreatedDate, LastModifiedDate, SystemModstamp FROM Opportunity');
        } catch (bulkError) {
          // Fallback to REST API if Bulk API fails
          logger.warn('[Salesforce Adapter] Bulk API failed, falling back to REST API', {
            error: bulkError instanceof Error ? bulkError.message : String(bulkError),
            count,
          });
          rawOpportunities = await client.getOpportunities();
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
    count: number
  ): Promise<SyncResult<NormalizedContact>> {
    let rawContacts: any[] = [];

    try {
      if (count < 10000) {
        // Use REST API for smaller datasets
        rawContacts = await client.getContacts();
      } else {
        // Try Bulk API first for large datasets
        try {
          logger.info('[Salesforce Adapter] Using Bulk API for contacts', { count });
          rawContacts = await client.bulkQuery('SELECT Id, FirstName, LastName, Email, Phone, Title, Department, AccountId, OwnerId, LeadSource, CreatedDate, LastModifiedDate, SystemModstamp FROM Contact');
        } catch (bulkError) {
          // Fallback to REST API if Bulk API fails
          logger.warn('[Salesforce Adapter] Bulk API failed, falling back to REST API', {
            error: bulkError instanceof Error ? bulkError.message : String(bulkError),
            count,
          });
          rawContacts = await client.getContacts();
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
    count: number
  ): Promise<SyncResult<NormalizedAccount>> {
    let rawAccounts: any[] = [];

    try {
      if (count < 10000) {
        // Use REST API for smaller datasets
        rawAccounts = await client.getAccounts();
      } else {
        // Try Bulk API first for large datasets
        try {
          logger.info('[Salesforce Adapter] Using Bulk API for accounts', { count });
          rawAccounts = await client.bulkQuery('SELECT Id, Name, Website, Industry, NumberOfEmployees, AnnualRevenue, OwnerId, BillingCity, BillingState, BillingCountry, Type, CreatedDate, LastModifiedDate, SystemModstamp FROM Account');
        } catch (bulkError) {
          // Fallback to REST API if Bulk API fails
          logger.warn('[Salesforce Adapter] Bulk API failed, falling back to REST API', {
            error: bulkError instanceof Error ? bulkError.message : String(bulkError),
            count,
          });
          rawAccounts = await client.getAccounts();
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
      const dealIdMap = new Map(dealResult.rows.map(r => [r.source_id, r.id]));

      const contactResult = await query<{ source_id: string; id: string }>(
        `SELECT source_id, id FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
        [workspaceId]
      );
      const contactIdMap = new Map(contactResult.rows.map(r => [r.source_id, r.id]));

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
      const dealIdMap = new Map(dealResult.rows.map(r => [r.source_id, r.id]));

      const contactResult = await query<{ source_id: string; id: string }>(
        `SELECT source_id, id FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
        [workspaceId]
      );
      const contactIdMap = new Map(contactResult.rows.map(r => [r.source_id, r.id]));

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
