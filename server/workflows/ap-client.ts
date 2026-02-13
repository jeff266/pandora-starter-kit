/**
 * ActivePieces REST API Client
 *
 * Implements typed HTTP wrapper around AP's REST API with retry logic,
 * flow version caching, and error handling.
 */

import { APClientInterface } from './workflow-service.js';
import {
  APProject,
  APFlow,
  APFlowRun,
  APConnection,
  APPaginatedResponse,
} from './ap-types.js';
import { APClientError } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('APClient');

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const RETRYABLE_ERRORS = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']);
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 9000]; // Exponential backoff: 1s, 3s, 9s

export class ActivePiecesClient implements APClientInterface {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private flowVersionCache: Map<string, string> = new Map();

  constructor(config: {
    baseUrl: string;      // 'http://activepieces:3000'
    apiKey: string;       // AP platform admin API key
    timeout?: number;     // Request timeout in ms, default 30000
  }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;

    logger.info('[APClient] Initialized', { baseUrl: this.baseUrl });
  }

  // ============================================================================
  // Project Methods
  // ============================================================================

  async createProject(params: {
    displayName: string;
    externalId: string;
    metadata?: Record<string, any>;
  }): Promise<APProject> {
    logger.info('[APClient] Creating project', { externalId: params.externalId });

    return this.request<APProject>('POST', '/api/v1/projects', {
      body: {
        displayName: params.displayName,
        externalId: params.externalId,
        metadata: params.metadata || {},
      },
    });
  }

  async getProjectByExternalId(externalId: string): Promise<APProject | null> {
    logger.debug('[APClient] Getting project by externalId', { externalId });

    const response = await this.request<APPaginatedResponse<APProject>>(
      'GET',
      '/api/v1/projects',
      { params: { externalId } }
    );

    return response.data[0] || null;
  }

  async listProjects(): Promise<APProject[]> {
    logger.debug('[APClient] Listing projects');

    const response = await this.request<APPaginatedResponse<APProject>>(
      'GET',
      '/api/v1/projects'
    );

    return response.data;
  }

  // ============================================================================
  // Flow Methods
  // ============================================================================

  async createFlow(params: {
    projectId: string;
    displayName: string;
  }): Promise<APFlow> {
    logger.info('[APClient] Creating flow', {
      projectId: params.projectId,
      displayName: params.displayName,
    });

    const flow = await this.request<APFlow>('POST', '/api/v1/flows', {
      body: {
        projectId: params.projectId,
        displayName: params.displayName,
      },
    });

    // Cache version ID
    if (flow.version?.id) {
      this.flowVersionCache.set(flow.id, flow.version.id);
    }

    return flow;
  }

  async updateFlow(
    flowId: string,
    params: {
      displayName?: string;
      trigger?: any;
      status?: 'ENABLED' | 'DISABLED';
    }
  ): Promise<APFlow> {
    logger.info('[APClient] Updating flow', { flowId, status: params.status });

    const flow = await this.request<APFlow>('POST', `/api/v1/flows/${flowId}`, {
      body: params,
    });

    // Update version cache (version changes on update)
    if (flow.version?.id) {
      this.flowVersionCache.set(flow.id, flow.version.id);
    } else {
      // Invalidate cache if no version returned
      this.flowVersionCache.delete(flowId);
    }

    return flow;
  }

  async getFlow(flowId: string): Promise<APFlow> {
    logger.debug('[APClient] Getting flow', { flowId });

    const flow = await this.request<APFlow>('GET', `/api/v1/flows/${flowId}`);

    // Update version cache
    if (flow.version?.id) {
      this.flowVersionCache.set(flow.id, flow.version.id);
    }

    return flow;
  }

  async listFlows(projectId: string): Promise<APFlow[]> {
    logger.debug('[APClient] Listing flows', { projectId });

    const response = await this.request<APPaginatedResponse<APFlow>>(
      'GET',
      '/api/v1/flows',
      { params: { projectId } }
    );

    return response.data;
  }

  async deleteFlow(flowId: string): Promise<void> {
    logger.info('[APClient] Deleting flow', { flowId });

    await this.request('DELETE', `/api/v1/flows/${flowId}`);

    // Remove from cache
    this.flowVersionCache.delete(flowId);
  }

  // ============================================================================
  // Flow Run Methods
  // ============================================================================

  async triggerFlow(flowId: string, payload: Record<string, any>): Promise<APFlowRun> {
    logger.info('[APClient] Triggering flow', { flowId });

    // Get flowVersionId (from cache or fetch)
    let flowVersionId = this.flowVersionCache.get(flowId);

    if (!flowVersionId) {
      logger.debug('[APClient] Version cache miss, fetching flow', { flowId });
      const flow = await this.getFlow(flowId);
      flowVersionId = flow.version?.id;

      if (!flowVersionId) {
        throw new Error(`Flow ${flowId} has no version ID`);
      }
    }

    return this.request<APFlowRun>('POST', '/api/v1/flow-runs', {
      body: {
        flowVersionId,
        payload,
      },
    });
  }

  async getFlowRun(runId: string): Promise<APFlowRun> {
    logger.debug('[APClient] Getting flow run', { runId });

    return this.request<APFlowRun>('GET', `/api/v1/flow-runs/${runId}`);
  }

  async listFlowRuns(params: {
    flowId?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: APFlowRun[]; next?: string }> {
    logger.debug('[APClient] Listing flow runs', params);

    return this.request<APPaginatedResponse<APFlowRun>>(
      'GET',
      '/api/v1/flow-runs',
      { params }
    );
  }

  // ============================================================================
  // Connection Methods
  // ============================================================================

  async createConnection(params: {
    projectId: string;
    externalId: string;
    displayName: string;
    pieceName: string;
    type: string;
    value: Record<string, any>;
    scope?: string;
  }): Promise<APConnection> {
    logger.info('[APClient] Creating connection', {
      projectId: params.projectId,
      pieceName: params.pieceName,
      externalId: params.externalId,
    });

    return this.request<APConnection>('POST', '/api/v1/app-connections', {
      body: {
        projectId: params.projectId,
        externalId: params.externalId,
        displayName: params.displayName,
        pieceName: params.pieceName,
        type: params.type,
        value: params.value,
        scope: params.scope || 'PLATFORM',
      },
    });
  }

  async updateConnection(
    connectionId: string,
    params: { value: Record<string, any> }
  ): Promise<APConnection> {
    logger.info('[APClient] Updating connection', { connectionId });

    return this.request<APConnection>(
      'PATCH',
      `/api/v1/app-connections/${connectionId}`,
      { body: params }
    );
  }

  async getConnection(connectionId: string): Promise<APConnection> {
    logger.debug('[APClient] Getting connection', { connectionId });

    return this.request<APConnection>('GET', `/api/v1/app-connections/${connectionId}`);
  }

  async listConnections(projectId: string): Promise<APConnection[]> {
    logger.debug('[APClient] Listing connections', { projectId });

    const response = await this.request<APPaginatedResponse<APConnection>>(
      'GET',
      '/api/v1/app-connections',
      { params: { projectId } }
    );

    return response.data;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    logger.info('[APClient] Deleting connection', { connectionId });

    await this.request('DELETE', `/api/v1/app-connections/${connectionId}`);
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<{ healthy: boolean; version?: string; error?: string }> {
    try {
      // Try to list projects as a health check
      await this.request('GET', '/api/v1/projects', { retries: 0 });
      return { healthy: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[APClient] Health check failed', { error: message });
      return {
        healthy: false,
        error: message,
      };
    }
  }

  // ============================================================================
  // HTTP Layer
  // ============================================================================

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: any;
      params?: Record<string, string | number | undefined>;
      retries?: number;
    }
  ): Promise<T> {
    const retries = options?.retries !== undefined ? options.retries : MAX_RETRIES;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.executeRequest<T>(method, path, options);
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === retries) {
          throw error;
        }

        // Log retry
        const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        logger.warn('[APClient] Request failed, retrying', {
          method,
          path,
          attempt: attempt + 1,
          maxRetries: retries,
          delay,
          error: error instanceof Error ? error.message : String(error),
        });

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async executeRequest<T>(
    method: string,
    path: string,
    options?: {
      body?: any;
      params?: Record<string, string | number | undefined>;
    }
  ): Promise<T> {
    // Build URL with query params
    const url = new URL(path, this.baseUrl);
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    // Build request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (options?.body) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle non-2xx responses
      if (!response.ok) {
        const body = await response.text();
        throw new APClientError(response.status, body);
      }

      // Parse response
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return (await response.json()) as T;
      } else {
        // For DELETE/204, return empty object
        return {} as T;
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof APClientError) {
        throw error;
      }

      // Handle timeout
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }

      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof APClientError) {
      return RETRYABLE_STATUS_CODES.has(error.status);
    }

    if (error instanceof Error) {
      // @ts-ignore - Check for Node.js error codes
      const code = error.code;
      if (code && RETRYABLE_ERRORS.has(code)) {
        return true;
      }
    }

    return false;
  }
}
