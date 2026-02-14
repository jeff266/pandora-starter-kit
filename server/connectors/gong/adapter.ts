/**
 * Gong Conversation Adapter
 *
 * Implements ConversationAdapter interface wrapping the legacy GongConnector.
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

  /**
   * Test connection to Gong
   */
  async testConnection(credentials: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    const result = await this.connector.testConnection(credentials);
    return {
      success: result.success,
      error: result.error,
    };
  }

  /**
   * Get health status
   */
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

  /**
   * Initial sync: fetch all conversations
   */
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

    return {
      conversations: {
        records: result.calls as NormalizedConversation[],
        errors: [],
      },
    };
  }

  /**
   * Incremental sync: fetch conversations since lastSyncTime
   */
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

    return {
      conversations: {
        records: result.calls as NormalizedConversation[],
        errors: [],
      },
    };
  }
}

export const gongAdapter = new GongConversationAdapter();
