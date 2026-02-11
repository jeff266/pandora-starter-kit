/**
 * Monday.com API Client
 *
 * Pure API client for Monday.com GraphQL API.
 * Stateless - receives API key per call.
 *
 * API Documentation: https://developer.monday.com/api-reference/docs
 *
 * Key Patterns:
 * - GraphQL endpoint: https://api.monday.com/v2
 * - Authorization: API key goes directly in header (NOT "Bearer {key}")
 * - Board = workspace/project container
 * - Group = section within board (like "In Progress", "Done")
 * - Item = task/work item
 */

import { RateLimiter } from '../../utils/retry.js';

export interface MondayCredentials {
  apiKey: string;
}

export interface MondayBoard {
  id: string;
  name: string;
  groups?: MondayGroup[];
}

export interface MondayGroup {
  id: string;
  title: string;
}

export interface MondayItem {
  id: string;
  name: string;
  column_values?: MondayColumnValue[];
}

export interface MondayColumnValue {
  id: string;
  value: string | null;
  text: string | null;
}

export interface CreateItemInput {
  boardId: string;
  groupId: string;
  itemName: string;
  columnValues?: Record<string, any>;
}

export interface UpdateItemInput {
  itemId: string;
  boardId: string;
  columnValues: Record<string, any>;
}

export class MondayClient {
  private readonly apiUrl = 'https://api.monday.com/v2';
  private rateLimiter = new RateLimiter(60, 60_000); // 60 requests per minute

  /**
   * Execute a GraphQL query against Monday.com API
   */
  private async graphql<T = any>(
    credentials: MondayCredentials,
    query: string
  ): Promise<T> {
    return this.rateLimiter.execute(async () => {
      return this.graphqlWithRetry<T>(credentials, query);
    });
  }

  private async graphqlWithRetry<T>(
    credentials: MondayCredentials,
    query: string,
    attempt = 1,
    maxAttempts = 3
  ): Promise<T> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': credentials.apiKey, // API key goes directly, not "Bearer {key}"
      },
      body: JSON.stringify({ query }),
    });

    // Handle 429 rate limit with exponential backoff
    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter) * 1000
        : Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s

      console.warn(`[Monday Client] Rate limited (429), retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return this.graphqlWithRetry<T>(credentials, query, attempt + 1, maxAttempts);
    }

    if (!response.ok) {
      throw new Error(`Monday.com HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors && data.errors.length > 0) {
      throw new Error(`Monday.com API error: ${JSON.stringify(data.errors)}`);
    }

    return data.data as T;
  }

  /**
   * Test connection by fetching current user info
   */
  async testConnection(credentials: MondayCredentials): Promise<{ success: boolean; error?: string }> {
    try {
      const query = `
        query {
          me {
            id
            name
            email
          }
        }
      `;
      await this.graphql(credentials, query);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get board by ID
   */
  async getBoard(credentials: MondayCredentials, boardId: string): Promise<MondayBoard | null> {
    try {
      const query = `
        query {
          boards (ids: ${boardId}) {
            id
            name
            groups {
              id
              title
            }
          }
        }
      `;
      const data = await this.graphql<{ boards: MondayBoard[] }>(credentials, query);
      return data.boards?.[0] || null;
    } catch (error) {
      console.error(`[Monday Client] Error fetching board ${boardId}:`, error);
      return null;
    }
  }

  /**
   * Create a new board
   */
  async createBoard(
    credentials: MondayCredentials,
    boardName: string,
    boardKind: 'public' | 'private' | 'share' = 'public'
  ): Promise<string> {
    const query = `
      mutation {
        create_board (
          board_name: ${JSON.stringify(boardName)},
          board_kind: ${boardKind}
        ) {
          id
        }
      }
    `;

    const data = await this.graphql<{ create_board: { id: string } }>(credentials, query);

    if (!data.create_board?.id) {
      throw new Error('Monday.com: Failed to create board - no ID returned');
    }

    return data.create_board.id;
  }

  /**
   * Get all groups in a board
   */
  async getGroups(credentials: MondayCredentials, boardId: string): Promise<MondayGroup[]> {
    const query = `
      query {
        boards (ids: ${boardId}) {
          groups {
            id
            title
          }
        }
      }
    `;

    const data = await this.graphql<{ boards: MondayBoard[] }>(credentials, query);
    return data.boards?.[0]?.groups || [];
  }

  /**
   * Create a new group within a board
   */
  async createGroup(
    credentials: MondayCredentials,
    boardId: string,
    groupName: string
  ): Promise<string> {
    const query = `
      mutation {
        create_group (
          board_id: ${boardId},
          group_name: ${JSON.stringify(groupName)}
        ) {
          id
        }
      }
    `;

    const data = await this.graphql<{ create_group: { id: string } }>(credentials, query);

    if (!data.create_group?.id) {
      throw new Error('Monday.com: Failed to create group - no ID returned');
    }

    return data.create_group.id;
  }

  /**
   * Get or create a group by name (case-insensitive match)
   */
  async getOrCreateGroup(
    credentials: MondayCredentials,
    boardId: string,
    groupName: string
  ): Promise<string> {
    const groups = await this.getGroups(credentials, boardId);
    const existing = groups.find(
      (g) => g.title.toLowerCase() === groupName.toLowerCase()
    );

    if (existing) {
      return existing.id;
    }

    return await this.createGroup(credentials, boardId, groupName);
  }

  /**
   * Fetch all items from a board
   */
  async fetchItems(credentials: MondayCredentials, boardId: string): Promise<MondayItem[]> {
    const query = `
      query {
        boards (ids: ${boardId}) {
          items_page {
            items {
              id
              name
              column_values {
                id
                value
                text
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{ boards: Array<{ items_page: { items: MondayItem[] } }> }>(
      credentials,
      query
    );

    return data.boards?.[0]?.items_page?.items || [];
  }

  /**
   * Create a new item (task)
   */
  async createItem(credentials: MondayCredentials, input: CreateItemInput): Promise<string> {
    const columnValuesStr = input.columnValues
      ? JSON.stringify(JSON.stringify(input.columnValues))
      : '"{}"';

    const query = `
      mutation {
        create_item (
          board_id: ${input.boardId},
          group_id: "${input.groupId}",
          item_name: ${JSON.stringify(input.itemName)},
          column_values: ${columnValuesStr}
        ) {
          id
        }
      }
    `;

    const data = await this.graphql<{ create_item: { id: string } }>(credentials, query);

    if (!data.create_item?.id) {
      throw new Error('Monday.com: Failed to create item - no ID returned');
    }

    return data.create_item.id;
  }

  /**
   * Update column values for an existing item
   */
  async updateItem(credentials: MondayCredentials, input: UpdateItemInput): Promise<void> {
    const columnValuesStr = JSON.stringify(JSON.stringify(input.columnValues));

    const query = `
      mutation {
        change_multiple_column_values (
          item_id: ${input.itemId},
          board_id: ${input.boardId},
          column_values: ${columnValuesStr}
        ) {
          id
        }
      }
    `;

    await this.graphql(credentials, query);
  }

  /**
   * Delete an item
   */
  async deleteItem(credentials: MondayCredentials, itemId: string): Promise<void> {
    const query = `
      mutation {
        delete_item (item_id: ${itemId}) {
          id
        }
      }
    `;

    await this.graphql(credentials, query);
  }

  /**
   * Get account rate limit information
   */
  async getRateLimitInfo(credentials: MondayCredentials): Promise<{
    complexity: number;
    resetAt: string;
  } | null> {
    try {
      const query = `
        query {
          complexity {
            before
            query
            after
            reset_in_x_seconds
          }
        }
      `;
      const data = await this.graphql<{ complexity: any }>(credentials, query);
      return {
        complexity: data.complexity?.after || 0,
        resetAt: data.complexity?.reset_in_x_seconds
          ? new Date(Date.now() + data.complexity.reset_in_x_seconds * 1000).toISOString()
          : new Date().toISOString(),
      };
    } catch (error) {
      console.error('[Monday Client] Error fetching rate limit info:', error);
      return null;
    }
  }
}
