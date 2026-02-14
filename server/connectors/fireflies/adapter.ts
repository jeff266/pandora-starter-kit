/**
 * Fireflies Conversation Adapter
 *
 * Implements ConversationAdapter interface wrapping the legacy FirefliesConnector.
 */

import type { ConversationAdapter, SyncResult, NormalizedConversation } from '../adapters/types.js';
import { FirefliesConnector } from './index.js';
import { FirefliesClient } from './client.js';
import { initialSync, incrementalSync } from './sync.js';

export class FirefliesConversationAdapter implements ConversationAdapter {
  readonly sourceType = 'fireflies';
  readonly category = 'conversations' as const;
  readonly supportsWrite = false;

  private connector = new FirefliesConnector();

  /**
   * Test connection to Fireflies
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
   * Initial sync: fetch all transcripts
   */
  async initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ): Promise<{ conversations?: SyncResult<NormalizedConversation> }> {
    if (!credentials.apiKey) {
      throw new Error('Fireflies adapter requires apiKey in credentials');
    }

    const client = new FirefliesClient(credentials.apiKey);
    const lookbackDays = options?.lookbackDays || 90;

    const result = await initialSync(client, workspaceId, { lookbackDays });

    return {
      conversations: {
        records: result.transcripts as NormalizedConversation[],
        errors: [],
      },
    };
  }

  /**
   * Incremental sync: fetch transcripts since lastSyncTime
   */
  async incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ): Promise<{ conversations?: SyncResult<NormalizedConversation> }> {
    if (!credentials.apiKey) {
      throw new Error('Fireflies adapter requires apiKey in credentials');
    }

    const client = new FirefliesClient(credentials.apiKey);
    const result = await incrementalSync(client, workspaceId, lastSyncTime);

    return {
      conversations: {
        records: result.transcripts as NormalizedConversation[],
        errors: [],
      },
    };
  }
}

export const firefliesAdapter = new FirefliesConversationAdapter();
