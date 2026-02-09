import { TaskSyncAdapter, UniversalTask, HierarchyContext } from '../types';
import { db } from '../../../db';
import { eq, and } from 'drizzle-orm';
import { clientIntegrations } from '../../../../shared/schema';

export class MondayAdapter implements TaskSyncAdapter {
  name = 'Monday';
  
  async isAvailable(clientId: string): Promise<boolean> {
    const integration = await this.getMondayIntegration(clientId);
    return !!(integration?.apiKey && integration?.instanceUrl && integration?.status === 'connected');
  }
  
  private async getMondayIntegration(clientId: string) {
    return db.query.clientIntegrations.findFirst({
      where: and(
        eq(clientIntegrations.clientId, clientId),
        eq(clientIntegrations.type, 'monday')
      )
    });
  }
  
  async getOrCreateHierarchy(
    clientId: string,
    hierarchy: HierarchyContext
  ): Promise<{ containerId: string; mapping: any; fullPath: string[] }> {
    const integration = await this.getMondayIntegration(clientId);
    if (!integration?.apiKey) {
      throw new Error('Monday.com not configured');
    }
    
    const boardId = await this.getOrCreateBoard(clientId, hierarchy.engagement);
    
    const groupName = hierarchy.milestone?.name || hierarchy.phase?.name || 'General';
    const groupId = await this.getOrCreateGroup(boardId, groupName, integration.apiKey);
    
    const fullPath = [
      hierarchy.engagement.name,
      groupName
    ];
    
    return {
      containerId: groupId,
      mapping: {
        boardId,
        groupId
      },
      fullPath
    };
  }
  
  async createTask(
    clientId: string,
    task: UniversalTask,
    containerId: string
  ): Promise<{ externalId: string }> {
    const integration = await this.getMondayIntegration(clientId);
    
    if (!integration?.apiKey) {
      throw new Error('Monday.com not configured properly');
    }
    
    const boardId = task.externalMapping?.monday?.boardId || integration.instanceUrl;
    const groupId = containerId;
    
    const columnValues = this.formatColumnValues(task);
    
    const query = `
      mutation {
        create_item (
          board_id: ${boardId},
          group_id: "${groupId}",
          item_name: ${JSON.stringify(task.title)},
          column_values: ${JSON.stringify(columnValues)}
        ) {
          id
        }
      }
    `;
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': integration.apiKey
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      throw new Error(`Monday.com HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(data.errors)}`);
    }
    
    if (!data.data?.create_item?.id) {
      throw new Error('Monday.com: Failed to create item - no ID returned');
    }
    
    return {
      externalId: data.data.create_item.id
    };
  }
  
  async updateTask(
    clientId: string,
    taskId: string,
    externalId: string,
    updates: Partial<UniversalTask>
  ): Promise<void> {
    const integration = await this.getMondayIntegration(clientId);
    
    if (!integration?.apiKey) {
      throw new Error('Monday.com not configured');
    }
    
    const boardId = integration.instanceUrl;
    const columnValues = this.formatColumnValues(updates as UniversalTask);
    
    const query = `
      mutation {
        change_multiple_column_values (
          item_id: ${externalId},
          board_id: ${boardId},
          column_values: ${JSON.stringify(columnValues)}
        ) {
          id
        }
      }
    `;
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': integration.apiKey
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      throw new Error(`Monday.com HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(data.errors)}`);
    }
  }
  
  async completeTask(clientId: string, externalId: string): Promise<void> {
    await this.updateTask(clientId, '', externalId, {
      status: 'COMPLETED'
    } as UniversalTask);
  }
  
  async fetchTasks(clientId: string): Promise<Array<{ externalId: string; status: string; completedAt?: Date; title?: string }>> {
    const integration = await this.getMondayIntegration(clientId);
    
    if (!integration?.apiKey || !integration?.instanceUrl) {
      return [];
    }
    
    const boardId = integration.instanceUrl;
    
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
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': integration.apiKey
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      console.error(`[Monday Sync] HTTP error fetching tasks: ${response.status}`);
      return [];
    }
    
    let data;
    try {
      data = await response.json();
    } catch (e) {
      console.error(`[Monday Sync] JSON parse error fetching tasks:`, e);
      return [];
    }
    
    if (data.errors) {
      console.error(`[Monday Sync] API error fetching tasks:`, data.errors);
      return [];
    }
    
    if (!data.data?.boards?.[0]?.items_page?.items) {
      return [];
    }
    
    return data.data.boards[0].items_page.items.map((item: any) => {
      const statusColumn = item.column_values.find((cv: any) => cv.id === 'status');
      const externalStatus = statusColumn?.text || 'New';
      return {
        externalId: item.id,
        title: item.name,
        status: this.mapStatusFromExternal(externalStatus),
        completedAt: undefined
      };
    });
  }
  
  mapStatusToExternal(status: UniversalTask['status']): string {
    // Monday.com uses these exact labels - must match board configuration
    const mapping: Record<string, string> = {
      'NOT_STARTED': 'New',
      'IN_PROGRESS': 'Working on it',
      'BLOCKED': 'Stuck',
      'COMPLETED': 'Done',
      'CANCELLED': 'Done'
    };
    return mapping[status] || 'New';
  }
  
  mapStatusFromExternal(externalStatus: string | null | undefined): UniversalTask['status'] {
    if (!externalStatus) return 'NOT_STARTED';
    const normalized = externalStatus.toLowerCase().trim();
    const mapping: Record<string, UniversalTask['status']> = {
      'new': 'NOT_STARTED',
      'not_started': 'NOT_STARTED',
      'not started': 'NOT_STARTED',
      'working on it': 'IN_PROGRESS',
      'working_on_it': 'IN_PROGRESS',
      'stuck': 'BLOCKED',
      'done': 'COMPLETED',
      'waiting for approval': 'IN_PROGRESS',
      'ordered': 'IN_PROGRESS'
    };
    return mapping[normalized] || 'IN_PROGRESS';
  }
  
  private async getOrCreateBoard(clientId: string, engagement: { id: string; name: string }): Promise<string> {
    const integration = await this.getMondayIntegration(clientId);
    
    if (!integration?.apiKey) {
      throw new Error('Monday.com not configured');
    }
    
    if (integration.instanceUrl) {
      return integration.instanceUrl;
    }
    
    const query = `
      mutation {
        create_board (
          board_name: ${JSON.stringify(engagement.name)},
          board_kind: public
        ) {
          id
        }
      }
    `;
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': integration.apiKey
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      throw new Error(`Monday.com HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`Failed to create Monday board: ${JSON.stringify(data.errors)}`);
    }
    
    if (!data.data?.create_board?.id) {
      throw new Error('Monday.com: Failed to create board - no ID returned');
    }
    
    return data.data.create_board.id;
  }
  
  private async getOrCreateGroup(boardId: string, groupName: string, apiKey: string): Promise<string> {
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
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      throw new Error(`Monday.com HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(data.errors)}`);
    }
    
    const groups = data.data?.boards?.[0]?.groups || [];
    
    const existingGroup = groups.find((g: any) => 
      g.title.toLowerCase() === groupName.toLowerCase()
    );
    
    if (existingGroup) {
      return existingGroup.id;
    }
    
    return await this.createGroup(boardId, groupName, apiKey);
  }
  
  private async createGroup(boardId: string, groupName: string, apiKey: string): Promise<string> {
    const query = `
      mutation {
        create_group (board_id: ${boardId}, group_name: ${JSON.stringify(groupName)}) {
          id
        }
      }
    `;
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      throw new Error(`Monday.com HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(data.errors)}`);
    }
    
    if (!data.data?.create_group?.id) {
      throw new Error('Monday.com: Failed to create group - no ID returned');
    }
    
    return data.data.create_group.id;
  }
  
  async getDefaultGroupId(clientId: string): Promise<string> {
    const integration = await this.getMondayIntegration(clientId);
    
    if (!integration?.apiKey || !integration?.instanceUrl) {
      throw new Error('Monday.com not configured');
    }
    
    const boardId = integration.instanceUrl;
    
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
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': integration.apiKey
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      throw new Error(`Monday.com HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(data.errors)}`);
    }
    
    const groups = data.data?.boards?.[0]?.groups || [];
    
    if (groups.length > 0) {
      return groups[0].id;
    }
    
    return await this.createGroup(boardId, 'Tasks', integration.apiKey);
  }
  
  private formatColumnValues(task: Partial<UniversalTask>): string {
    const values: Record<string, any> = {};
    
    if (task.status) {
      values.status = { label: this.mapStatusToExternal(task.status) };
    }
    
    if (task.assignee) {
      values.text = task.assignee;
    }
    
    if (task.dueDate) {
      values.date = { date: task.dueDate.toISOString().split('T')[0] };
    }
    
    if (task.priority) {
      values.priority = { label: task.priority };
    }
    
    return JSON.stringify(values);
  }
}
