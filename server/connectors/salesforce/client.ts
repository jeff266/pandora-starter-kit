/**
 * Salesforce REST API Client
 *
 * Pure API client - stateless, credentials passed to constructor
 * No database access - all data operations return plain objects
 */

import { withRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import type {
  SalesforceQueryResult,
  SalesforceOpportunity,
  SalesforceContact,
  SalesforceAccount,
  SalesforceStage,
  SalesforceObjectDescribe,
  SalesforceBulkJobInfo,
  SalesforceApiError,
  SalesforceOrganization,
  SalesforceApiLimits,
  SalesforceTokenResponse,
} from './types.js';
import {
  DEFAULT_OPPORTUNITY_FIELDS,
  DEFAULT_CONTACT_FIELDS,
  DEFAULT_ACCOUNT_FIELDS,
} from './types.js';

// ============================================================================
// Error Classes
// ============================================================================

export class SalesforceApiError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public fields?: string[]
  ) {
    super(message);
    this.name = 'SalesforceApiError';
  }
}

export class SalesforceSessionExpiredError extends SalesforceApiError {
  constructor() {
    super('INVALID_SESSION_ID', 'Session expired or invalid');
    this.name = 'SalesforceSessionExpiredError';
  }
}

export class SalesforceRateLimitError extends SalesforceApiError {
  constructor(message: string) {
    super('REQUEST_LIMIT_EXCEEDED', message);
    this.name = 'SalesforceRateLimitError';
  }
}

// ============================================================================
// Salesforce Client
// ============================================================================

export interface SalesforceClientConfig {
  accessToken: string;
  instanceUrl: string;
  apiVersion?: string;
}

export class SalesforceClient {
  private accessToken: string;
  private instanceUrl: string;
  private apiVersion: string;
  private baseUrl: string;
  private apiLimits: SalesforceApiLimits = { used: 0, total: 0, percentUsed: 0 };

  constructor(config: SalesforceClientConfig) {
    this.accessToken = config.accessToken;
    this.instanceUrl = config.instanceUrl;
    this.apiVersion = config.apiVersion || 'v59.0';
    this.baseUrl = `${this.instanceUrl}/services/data/${this.apiVersion}`;
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Refresh access token using refresh token
   * CRITICAL: Response may contain a DIFFERENT instance_url than before
   */
  static async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ accessToken: string; instanceUrl: string }> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data: SalesforceTokenResponse = await response.json();

    logger.info('[Salesforce] Token refreshed', {
      instanceUrl: data.instance_url,
    });

    return {
      accessToken: data.access_token,
      instanceUrl: data.instance_url,
    };
  }

  // ==========================================================================
  // HTTP Helpers
  // ==========================================================================

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const startTime = Date.now();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const duration = Date.now() - startTime;

    // Track API limits from response headers
    const limitInfo = response.headers.get('Sforce-Limit-Info');
    if (limitInfo) {
      this.parseApiLimits(limitInfo);
    }

    if (!response.ok) {
      await this.handleError(response);
    }

    logger.debug('[Salesforce] API call', {
      path,
      status: response.status,
      duration,
    });

    return response.json();
  }

  private parseApiLimits(limitInfo: string): void {
    // Format: "api-usage=25/15000"
    const match = limitInfo.match(/api-usage=(\d+)\/(\d+)/);
    if (match) {
      const used = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      const percentUsed = Math.round((used / total) * 100);

      this.apiLimits = { used, total, percentUsed };

      if (percentUsed >= 80) {
        logger.warn('[Salesforce] API limit warning', {
          used,
          total,
          percentUsed,
        });
      }
    }
  }

  private async handleError(response: Response): Promise<never> {
    let errors: SalesforceApiError[];
    try {
      errors = await response.json();
    } catch {
      throw new Error(`Salesforce API error: ${response.status} ${response.statusText}`);
    }

    const firstError = errors[0];
    if (!firstError) {
      throw new Error(`Salesforce API error: ${response.status}`);
    }

    // Handle specific error codes
    if (firstError.errorCode === 'INVALID_SESSION_ID') {
      throw new SalesforceSessionExpiredError();
    }

    if (firstError.errorCode === 'REQUEST_LIMIT_EXCEEDED') {
      throw new SalesforceRateLimitError(firstError.message);
    }

    if (firstError.errorCode === 'QUERY_TIMEOUT') {
      logger.error('[Salesforce] Query timeout', { message: firstError.message });
    }

    if (firstError.errorCode === 'INVALID_FIELD') {
      logger.error('[Salesforce] Invalid field', {
        message: firstError.message,
        fields: firstError.fields,
      });
    }

    if (firstError.errorCode === 'MALFORMED_QUERY') {
      logger.error('[Salesforce] Malformed SOQL', { message: firstError.message });
    }

    throw new SalesforceApiError(
      firstError.errorCode,
      firstError.message,
      firstError.fields
    );
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  async query<T = Record<string, unknown>>(soql: string): Promise<SalesforceQueryResult<T>> {
    return withRetry(async () => {
      const encodedQuery = encodeURIComponent(soql);
      return this.request<SalesforceQueryResult<T>>(`/query?q=${encodedQuery}`);
    });
  }

  async queryMore<T = Record<string, unknown>>(
    nextRecordsUrl: string
  ): Promise<SalesforceQueryResult<T>> {
    return withRetry(async () => {
      // nextRecordsUrl is a relative path like /services/data/v59.0/query/...
      return this.request<SalesforceQueryResult<T>>(
        `${this.instanceUrl}${nextRecordsUrl}`
      );
    });
  }

  async queryAll<T = Record<string, unknown>>(soql: string): Promise<T[]> {
    const allRecords: T[] = [];
    let result = await this.query<T>(soql);
    let pageCount = 1;

    allRecords.push(...result.records);

    while (!result.done && result.nextRecordsUrl) {
      result = await this.queryMore<T>(result.nextRecordsUrl);
      allRecords.push(...result.records);
      pageCount++;
    }

    logger.info('[Salesforce] Fetched all records', {
      total: allRecords.length,
      pages: pageCount,
    });

    return allRecords;
  }

  // ==========================================================================
  // Object Queries
  // ==========================================================================

  async getOpportunities(
    fields?: string[],
    where?: string,
    orderBy?: string
  ): Promise<SalesforceOpportunity[]> {
    const fieldList = fields && fields.length > 0 ? fields : DEFAULT_OPPORTUNITY_FIELDS;
    let soql = `SELECT ${fieldList.join(', ')} FROM Opportunity`;

    if (where) {
      soql += ` WHERE ${where}`;
    }

    if (orderBy) {
      soql += ` ORDER BY ${orderBy}`;
    }

    return this.queryAll<SalesforceOpportunity>(soql);
  }

  async getContacts(
    fields?: string[],
    where?: string,
    orderBy?: string
  ): Promise<SalesforceContact[]> {
    const fieldList = fields && fields.length > 0 ? fields : DEFAULT_CONTACT_FIELDS;
    let soql = `SELECT ${fieldList.join(', ')} FROM Contact`;

    if (where) {
      soql += ` WHERE ${where}`;
    }

    if (orderBy) {
      soql += ` ORDER BY ${orderBy}`;
    }

    return this.queryAll<SalesforceContact>(soql);
  }

  async getAccounts(
    fields?: string[],
    where?: string,
    orderBy?: string
  ): Promise<SalesforceAccount[]> {
    const fieldList = fields && fields.length > 0 ? fields : DEFAULT_ACCOUNT_FIELDS;
    let soql = `SELECT ${fieldList.join(', ')} FROM Account`;

    if (where) {
      soql += ` WHERE ${where}`;
    }

    if (orderBy) {
      soql += ` ORDER BY ${orderBy}`;
    }

    return this.queryAll<SalesforceAccount>(soql);
  }

  // ==========================================================================
  // Metadata
  // ==========================================================================

  async describeObject(objectName: string): Promise<SalesforceObjectDescribe> {
    return withRetry(async () => {
      return this.request<SalesforceObjectDescribe>(`/sobjects/${objectName}/describe`);
    });
  }

  async getOpportunityStages(): Promise<SalesforceStage[]> {
    const soql = `SELECT MasterLabel, ApiName, IsActive, IsClosed, IsWon, DefaultProbability, ForecastCategoryName, SortOrder
                  FROM OpportunityStage
                  WHERE IsActive = true
                  ORDER BY SortOrder ASC`;

    return this.queryAll<SalesforceStage>(soql);
  }

  async getRecordTypes(
    objectName: string
  ): Promise<{ Id: string; Name: string; IsActive: boolean }[]> {
    const soql = `SELECT Id, Name, IsActive
                  FROM RecordType
                  WHERE SObjectType = '${objectName}' AND IsActive = true`;

    return this.queryAll(soql);
  }

  // ==========================================================================
  // Bulk API 2.0
  // ==========================================================================

  async createBulkQueryJob(soql: string): Promise<string> {
    const response = await this.request<{ id: string }>('/jobs/query', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'query',
        query: soql,
      }),
    });

    return response.id;
  }

  async getBulkJobStatus(jobId: string): Promise<SalesforceBulkJobInfo> {
    return this.request<SalesforceBulkJobInfo>(`/jobs/query/${jobId}`);
  }

  async getBulkJobResults<T = Record<string, unknown>>(jobId: string): Promise<T[]> {
    const allRecords: T[] = [];
    let locator: string | null = null;

    do {
      const url = locator
        ? `/jobs/query/${jobId}/results?locator=${locator}`
        : `/jobs/query/${jobId}/results`;

      const response = await fetch(`${this.baseUrl}${url}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'text/csv',
        },
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      // Parse CSV to objects
      const csv = await response.text();
      const records = this.parseCsv<T>(csv);
      allRecords.push(...records);

      // Check for more results
      locator = response.headers.get('Sforce-Locator');
      if (locator === 'null') locator = null;
    } while (locator);

    return allRecords;
  }

  async bulkQuery<T = Record<string, unknown>>(
    soql: string,
    pollIntervalMs: number = 5000
  ): Promise<T[]> {
    const jobId = await this.createBulkQueryJob(soql);
    logger.info('[Salesforce Bulk] Job created', { jobId });

    const startTime = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes

    // Poll for job completion
    while (true) {
      const status = await this.getBulkJobStatus(jobId);

      logger.info('[Salesforce Bulk] Job status', {
        jobId,
        state: status.state,
        recordsProcessed: status.numberRecordsProcessed,
      });

      if (status.state === 'JobComplete') {
        return this.getBulkJobResults<T>(jobId);
      }

      if (status.state === 'Failed' || status.state === 'Aborted') {
        throw new Error(`Bulk query job ${status.state.toLowerCase()}: ${jobId}`);
      }

      if (Date.now() - startTime > timeout) {
        logger.error('[Salesforce Bulk] Job timeout', { jobId });
        // Try to get partial results
        try {
          return this.getBulkJobResults<T>(jobId);
        } catch {
          throw new Error(`Bulk query job timed out: ${jobId}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  private parseCsv<T>(csv: string): T[] {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const records: T[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const record: any = {};

      headers.forEach((header, index) => {
        const value = values[index];
        // Parse numbers and booleans
        if (value === 'true') record[header] = true;
        else if (value === 'false') record[header] = false;
        else if (value === '' || value === 'null') record[header] = null;
        else if (!isNaN(Number(value)) && value !== '') record[header] = Number(value);
        else record[header] = value;
      });

      records.push(record as T);
    }

    return records;
  }

  // ==========================================================================
  // Incremental Sync
  // ==========================================================================

  async getModifiedSince<T = Record<string, unknown>>(
    objectName: string,
    fields: string[],
    since: Date
  ): Promise<T[]> {
    const sinceIso = since.toISOString();
    const soql = `SELECT ${fields.join(', ')}
                  FROM ${objectName}
                  WHERE SystemModstamp >= ${sinceIso}`;

    return this.queryAll<T>(soql);
  }

  // ==========================================================================
  // Connection Test
  // ==========================================================================

  async testConnection(): Promise<{
    success: boolean;
    orgId?: string;
    orgName?: string;
    edition?: string;
    apiLimits?: SalesforceApiLimits;
    error?: string;
  }> {
    try {
      const soql = 'SELECT Id, Name, OrganizationType FROM Organization LIMIT 1';
      const result = await this.query<SalesforceOrganization>(soql);

      if (result.records.length === 0) {
        return {
          success: false,
          error: 'No organization found',
        };
      }

      const org = result.records[0];

      return {
        success: true,
        orgId: org.Id,
        orgName: org.Name,
        edition: org.OrganizationType,
        apiLimits: this.apiLimits,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  getApiLimits(): SalesforceApiLimits {
    return { ...this.apiLimits };
  }
}
