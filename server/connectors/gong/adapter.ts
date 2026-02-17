/**
 * Gong Conversation Adapter
 *
 * Implements ConversationAdapter interface wrapping the legacy GongConnector.
 * Note: sync.ts handles DB upserts directly; the orchestrator doesn't need
 * to re-process conversation records from the return value.
 */

import type { ConversationAdapter, SyncResult, NormalizedConversation } from '../adapters/types.js';
import { GongConnector } from './index.js';
import { GongClient } from './client.js';
import { initialSync, incrementalSync } from './sync.js';

export class GongConversationAdapter implements ConversationAdapter {
  readonly sourceType = 'gong';
  readonly category = 'conversations' as const;
  readonly supportsWrite = false;

  private connector = new GongConnector();

  async testConnection(credentials: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    const result = await this.connector.testConnection(credentials);
    return {
      success: result.success,
      error: result.error,
    };
  }

  async health(credentials: Record<string, any>): Promise<{ healthy: boolean; details?: Record<string, any> }> {
    try {
      const result = await this.connector.testConnection(credentials);
      return {
        healthy: result.success,
        details: result.accountInfo,
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

  async initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ): Promise<{ conversations?: SyncResult<NormalizedConversation> }> {
    if (!credentials.apiKey) {
      throw new Error('Gong adapter requires apiKey in credentials');
    }

    const client = new GongClient(credentials.apiKey);
    const lookbackDays = options?.lookbackDays || 90;

    const result = await initialSync(client, workspaceId, { lookbackDays });

    console.log(`[Gong Adapter] initialSync complete: ${result.recordsFetched} fetched, ${result.recordsStored} stored, ${result.trackedUsers || 0} tracked users`);

    return {
      conversations: {
        succeeded: [],
        failed: result.errors.map(e => ({ record: null as any, error: e })),
        totalAttempted: result.recordsFetched,
      },
    };
  }

  async incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ): Promise<{ conversations?: SyncResult<NormalizedConversation> }> {
    if (!credentials.apiKey) {
      throw new Error('Gong adapter requires apiKey in credentials');
    }

    const client = new GongClient(credentials.apiKey);
    const result = await incrementalSync(client, workspaceId, lastSyncTime);

    console.log(`[Gong Adapter] incrementalSync complete: ${result.recordsFetched} fetched, ${result.recordsStored} stored, ${result.trackedUsers || 0} tracked users`);

    return {
      conversations: {
        succeeded: [],
        failed: result.errors.map(e => ({ record: null as any, error: e })),
        totalAttempted: result.recordsFetched,
      },
    };
  }
}

export const gongAdapter = new GongConversationAdapter();
