/**
 * Monday.com PM Tool Adapter
 *
 * Implements PandoraTaskAdapter interface for pushing RevOps operator work items
 * to Monday.com boards.
 *
 * Architecture:
 * - Reuses MondayClient from existing task connector
 * - Maps OpsCategory to Monday.com Groups (sections within board)
 * - Priority maps to Monday's priority column
 * - Description goes into long-text column or updates
 */

import type {
  PandoraTaskAdapter,
  OpsWorkItem,
  PMTaskCreationResult,
  OpsCategory,
  OpsPriority,
} from '../types.js';
import { MondayClient, type MondayCredentials } from '../../monday/client.js';

export class MondayPMAdapter implements PandoraTaskAdapter {
  readonly connectorType = 'monday';
  private client = new MondayClient();

  /**
   * Test connection to Monday.com
   */
  async testConnection(credentials: Record<string, any>): Promise<{ success: boolean; error?: string; accountInfo?: any }> {
    const mondayCredentials = this.validateCredentials(credentials);
    return this.client.testConnection(mondayCredentials);
  }

  /**
   * List all boards (projects) accessible with the API key
   */
  async listProjects(credentials: Record<string, any>): Promise<{ id: string; name: string }[]> {
    const mondayCredentials = this.validateCredentials(credentials);
    const boards = await this.client.getBoards(mondayCredentials);
    return boards.map(b => ({ id: b.id, name: b.name }));
  }

  /**
   * List groups (sections) within a board
   */
  async listSections(credentials: Record<string, any>, projectId: string): Promise<{ id: string; name: string }[]> {
    const mondayCredentials = this.validateCredentials(credentials);
    const groups = await this.client.getGroups(mondayCredentials, projectId);
    return groups.map(g => ({ id: g.id, name: g.title }));
  }

  /**
   * List all users in the Monday workspace
   */
  async listUsers(credentials: Record<string, any>): Promise<{ id: string; name: string; email: string }[]> {
    const mondayCredentials = this.validateCredentials(credentials);
    const users = await this.client.getUsers(mondayCredentials);
    return users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
    }));
  }

  /**
   * Create a RevOps work item task in Monday.com
   */
  async createTask(credentials: Record<string, any>, task: OpsWorkItem): Promise<{ externalId: string; url: string }> {
    const mondayCredentials = this.validateCredentials(credentials);
    const boardId = task.projectId || credentials.defaultBoardId;

    if (!boardId) {
      throw new Error('Monday adapter requires projectId in task or defaultBoardId in credentials');
    }

    // Determine group ID from category or use provided sectionId
    const groupId = task.sectionId || await this.resolveGroupId(mondayCredentials, boardId, task.category);

    // Build column values for Monday
    const columnValues = this.buildColumnValues(task);

    // Create the item
    const itemId = await this.client.createItem(mondayCredentials, {
      boardId,
      groupId,
      itemName: task.name,
      columnValues,
    });

    // Add description as update (comment) if provided
    if (task.description) {
      await this.client.addUpdate(mondayCredentials, itemId, this.formatDescription(task));
    }

    // Construct URL to task
    const url = `https://view.monday.com/boards/${boardId}/pulses/${itemId}`;

    return { externalId: itemId, url };
  }

  /**
   * Update an existing task in Monday.com
   */
  async updateTask(credentials: Record<string, any>, externalId: string, updates: Partial<OpsWorkItem>): Promise<void> {
    const mondayCredentials = this.validateCredentials(credentials);
    const boardId = credentials.defaultBoardId;

    if (!boardId) {
      throw new Error('Monday adapter requires defaultBoardId in credentials for updates');
    }

    const columnValues = this.buildColumnValues(updates);

    await this.client.updateItem(mondayCredentials, {
      itemId: externalId,
      boardId,
      columnValues,
    });

    // Add update if description changed
    if (updates.description) {
      await this.client.addUpdate(mondayCredentials, externalId, updates.description);
    }
  }

  /**
   * Mark a task as completed in Monday.com
   */
  async completeTask(credentials: Record<string, any>, externalId: string): Promise<void> {
    const mondayCredentials = this.validateCredentials(credentials);
    const boardId = credentials.defaultBoardId;

    if (!boardId) {
      throw new Error('Monday adapter requires defaultBoardId in credentials');
    }

    await this.client.updateItem(mondayCredentials, {
      itemId: externalId,
      boardId,
      columnValues: {
        status: { label: 'Done' },
      },
    });
  }

  /**
   * Resolve group ID from category
   * Maps OpsCategory to Monday group names like "Process Fixes", "Data Cleanup", etc.
   * Creates group if it doesn't exist.
   */
  private async resolveGroupId(
    credentials: MondayCredentials,
    boardId: string,
    category: OpsCategory
  ): Promise<string> {
    const categoryGroupMap: Record<OpsCategory, string> = {
      process_fix: 'Process Fixes',
      system_config: 'System Configuration',
      data_cleanup: 'Data Cleanup',
      methodology_review: 'Methodology Review',
      enablement_gap: 'Enablement',
      territory_planning: 'Territory Planning',
      reporting_request: 'Reporting',
      gtm_strategy: 'GTM Strategy',
    };

    const targetGroupName = categoryGroupMap[category] || 'RevOps Tasks';

    // Fetch existing groups
    const groups = await this.client.getGroups(credentials, boardId);
    const existing = groups.find(g => g.title === targetGroupName);

    if (existing) {
      return existing.id;
    }

    // Create group if it doesn't exist
    return await this.client.createGroup(credentials, boardId, targetGroupName);
  }

  /**
   * Build Monday column values from OpsWorkItem
   */
  private buildColumnValues(task: Partial<OpsWorkItem>): Record<string, any> {
    const values: Record<string, any> = {};

    // Priority
    if (task.priority) {
      values.priority = { label: this.mapPriority(task.priority) };
    }

    // Due date
    if (task.dueDate) {
      const date = new Date(task.dueDate);
      values.date = { date: date.toISOString().split('T')[0] };
    }

    // Assignee (assumes person column exists)
    if (task.assigneeEmail) {
      // Monday person column expects personsAndTeams array with user IDs
      // For simplicity, we'll use text column or handle this in setup
      values.text = task.assigneeEmail;
    }

    // Labels as tags (Monday supports tags as text)
    if (task.labels && task.labels.length > 0) {
      values.tags = { tag_ids: task.labels };
    }

    // Set initial status to "New"
    values.status = { label: 'New' };

    return values;
  }

  /**
   * Map Pandora priority to Monday priority label
   */
  private mapPriority(priority: OpsPriority): string {
    const mapping: Record<OpsPriority, string> = {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    };
    return mapping[priority];
  }

  /**
   * Format description with Pandora context
   */
  private formatDescription(task: OpsWorkItem): string {
    let description = task.description;

    // Add context footer
    description += '\n\n---\n\n';
    description += `**Finding:** ${task.findingSummary}\n`;

    if (task.impactMetric) {
      description += `**Impact:** ${task.impactMetric}\n`;
    }

    if (task.affectedRecordCount) {
      description += `**Affected Records:** ${task.affectedRecordCount}\n`;
    }

    if (task.recommendedApproach) {
      description += `\n**Recommended Approach:**\n${task.recommendedApproach}\n`;
    }

    description += `\n*Source: Pandora ${task.sourceSkill} skill*`;

    return description;
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
