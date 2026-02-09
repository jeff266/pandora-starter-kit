/**
 * Monday.com Task Adapter
 *
 * Implements TaskAdapter interface to normalize Monday.com items to Pandora tasks.
 * Supports both read and write operations.
 *
 * Status Mapping (Monday → Pandora):
 * - "New" → NOT_STARTED
 * - "Working on it" → IN_PROGRESS
 * - "Stuck" → BLOCKED
 * - "Done" → COMPLETED
 */

import type {
  TaskAdapter,
  NormalizedTask,
  SyncResult,
  TaskCreateInput,
  TaskUpdateInput,
  TaskContext,
} from '../adapters/types.js';
import { MondayClient, type MondayCredentials, type MondayItem } from './client.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';

export class MondayTaskAdapter implements TaskAdapter {
  readonly sourceType = 'monday';
  readonly category = 'tasks' as const;
  readonly supportsWrite = true;

  private client = new MondayClient();

  /**
   * Test connection to Monday.com
   */
  async testConnection(credentials: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    const mondayCredentials = this.validateCredentials(credentials);
    return this.client.testConnection(mondayCredentials);
  }

  /**
   * Get health status (rate limits, API status)
   */
  async health(credentials: Record<string, any>): Promise<{ healthy: boolean; details?: Record<string, any> }> {
    try {
      const mondayCredentials = this.validateCredentials(credentials);
      const rateLimitInfo = await this.client.getRateLimitInfo(mondayCredentials);
      return {
        healthy: true,
        details: rateLimitInfo || undefined,
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
   * Initial sync: fetch all tasks from a Monday board
   */
  async initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ): Promise<{ tasks?: SyncResult<NormalizedTask> }> {
    const mondayCredentials = this.validateCredentials(credentials);
    const boardId = options?.boardId || credentials.boardId;

    if (!boardId) {
      throw new Error('Monday adapter requires boardId in credentials or options');
    }

    const items = await this.client.fetchItems(mondayCredentials, boardId);

    const taskTransformResult = transformWithErrorCapture(
      items,
      (item) => this.transformTask(item, workspaceId),
      'Monday Tasks',
      (item) => item.id
    );

    return { tasks: taskTransformResult };
  }

  /**
   * Incremental sync: fetch all tasks (Monday doesn't have built-in change tracking)
   * For true incremental sync, you would need to track lastModifiedDate in custom columns
   */
  async incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ): Promise<{ tasks?: SyncResult<NormalizedTask> }> {
    // Monday.com doesn't have native change tracking without custom columns
    // Fall back to full sync and let the caller dedupe by source_id
    console.log(`[Monday Adapter] Incremental sync not supported, performing full sync`);
    return this.initialSync(credentials, workspaceId, options);
  }

  /**
   * Transform Monday item to normalized task
   */
  transformTask(item: MondayItem, workspaceId: string, options?: any): NormalizedTask {
    const statusColumn = item.column_values?.find((cv) => cv.id === 'status');
    const priorityColumn = item.column_values?.find((cv) => cv.id === 'priority');
    const assigneeColumn = item.column_values?.find((cv) => cv.id === 'person' || cv.id === 'text');
    const dateColumn = item.column_values?.find((cv) => cv.id === 'date' || cv.id === 'due_date');

    const externalStatus = statusColumn?.text || 'New';
    const status = this.mapStatusFromExternal(externalStatus);

    const priority = this.mapPriorityFromExternal(priorityColumn?.text);

    return {
      workspace_id: workspaceId,
      source: 'monday',
      source_id: item.id,
      source_data: {
        name: item.name,
        column_values: item.column_values,
      },
      title: item.name,
      description: null,
      status,
      priority,
      assignee: assigneeColumn?.text || null,
      due_date: dateColumn?.text ? new Date(dateColumn.text) : null,
      completed_date: status === 'COMPLETED' ? new Date() : null,
      tags: [],
      custom_fields: {},
    };
  }

  /**
   * Create a new task in Monday.com
   */
  async createTask(
    credentials: Record<string, any>,
    workspaceId: string,
    task: TaskCreateInput,
    context?: TaskContext
  ): Promise<{ success: boolean; sourceId?: string; error?: string }> {
    try {
      const mondayCredentials = this.validateCredentials(credentials);
      const boardId = context?.board_id || credentials.boardId;
      const groupId = context?.group_id;

      if (!boardId) {
        throw new Error('Monday adapter requires boardId in credentials or context');
      }

      // Get or create default group if not provided
      const finalGroupId = groupId || await this.getDefaultGroupId(mondayCredentials, boardId);

      const columnValues = this.formatColumnValues(task);

      const itemId = await this.client.createItem(mondayCredentials, {
        boardId,
        groupId: finalGroupId,
        itemName: task.title,
        columnValues,
      });

      return { success: true, sourceId: itemId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update an existing task in Monday.com
   */
  async updateTask(
    credentials: Record<string, any>,
    workspaceId: string,
    sourceId: string,
    updates: TaskUpdateInput
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const mondayCredentials = this.validateCredentials(credentials);
      const boardId = credentials.boardId;

      if (!boardId) {
        throw new Error('Monday adapter requires boardId in credentials');
      }

      const columnValues = this.formatColumnValues(updates);

      await this.client.updateItem(mondayCredentials, {
        itemId: sourceId,
        boardId,
        columnValues,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Mark a task as completed
   */
  async completeTask(
    credentials: Record<string, any>,
    workspaceId: string,
    sourceId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.updateTask(credentials, workspaceId, sourceId, {
      status: 'COMPLETED',
    });
  }

  /**
   * Map Monday status label to Pandora status
   */
  private mapStatusFromExternal(externalStatus: string | null | undefined): NormalizedTask['status'] {
    if (!externalStatus) return 'NOT_STARTED';

    const normalized = externalStatus.toLowerCase().trim();
    const mapping: Record<string, NormalizedTask['status']> = {
      'new': 'NOT_STARTED',
      'not started': 'NOT_STARTED',
      'not_started': 'NOT_STARTED',
      'working on it': 'IN_PROGRESS',
      'working_on_it': 'IN_PROGRESS',
      'in progress': 'IN_PROGRESS',
      'in_progress': 'IN_PROGRESS',
      'stuck': 'BLOCKED',
      'blocked': 'BLOCKED',
      'done': 'COMPLETED',
      'completed': 'COMPLETED',
      'waiting for approval': 'IN_PROGRESS',
      'ordered': 'IN_PROGRESS',
    };

    return mapping[normalized] || 'IN_PROGRESS';
  }

  /**
   * Map Pandora status to Monday status label
   */
  private mapStatusToExternal(status: NormalizedTask['status']): string {
    const mapping: Record<string, string> = {
      'NOT_STARTED': 'New',
      'IN_PROGRESS': 'Working on it',
      'BLOCKED': 'Stuck',
      'COMPLETED': 'Done',
    };
    return mapping[status || 'NOT_STARTED'] || 'New';
  }

  /**
   * Map Monday priority to Pandora priority
   */
  private mapPriorityFromExternal(externalPriority: string | null | undefined): NormalizedTask['priority'] {
    if (!externalPriority) return null;

    const normalized = externalPriority.toLowerCase().trim();
    const mapping: Record<string, NormalizedTask['priority']> = {
      'low': 'LOW',
      'medium': 'MEDIUM',
      'high': 'HIGH',
      'critical': 'CRITICAL',
      'urgent': 'CRITICAL',
    };

    return mapping[normalized] || null;
  }

  /**
   * Map Pandora priority to Monday priority label
   */
  private mapPriorityToExternal(priority: NormalizedTask['priority']): string | undefined {
    if (!priority) return undefined;

    const mapping: Record<string, string> = {
      'LOW': 'Low',
      'MEDIUM': 'Medium',
      'HIGH': 'High',
      'CRITICAL': 'Critical',
    };
    return mapping[priority];
  }

  /**
   * Format task data into Monday column values
   */
  private formatColumnValues(task: Partial<TaskCreateInput | TaskUpdateInput>): Record<string, any> {
    const values: Record<string, any> = {};

    if (task.status) {
      values.status = { label: this.mapStatusToExternal(task.status) };
    }

    if (task.assignee) {
      values.text = task.assignee;
    }

    if (task.due_date) {
      const date = task.due_date instanceof Date ? task.due_date : new Date(task.due_date);
      values.date = { date: date.toISOString().split('T')[0] };
    }

    if (task.priority) {
      const priorityLabel = this.mapPriorityToExternal(task.priority);
      if (priorityLabel) {
        values.priority = { label: priorityLabel };
      }
    }

    return values;
  }

  /**
   * Get default group ID from a board (first group, or create "Tasks")
   */
  private async getDefaultGroupId(credentials: MondayCredentials, boardId: string): Promise<string> {
    const groups = await this.client.getGroups(credentials, boardId);

    if (groups.length > 0) {
      return groups[0].id;
    }

    // No groups exist, create a default one
    return await this.client.createGroup(credentials, boardId, 'Tasks');
  }

  /**
   * Validate and extract Monday credentials
   */
  private validateCredentials(credentials: Record<string, any>): MondayCredentials {
    if (!credentials.apiKey) {
      throw new Error('Monday adapter requires apiKey in credentials');
    }
    return {
      apiKey: credentials.apiKey,
    };
  }
}
