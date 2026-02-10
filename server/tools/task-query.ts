import { query } from '../db.js';

export interface Task {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, unknown>;
  title: string;
  description: string;
  status: string;
  assignee: string;
  due_date: string;
  created_date: string;
  completed_date: string;
  priority: string;
  project: string;
  deal_id: string;
  account_id: string;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskFilters {
  status?: string;
  assignee?: string;
  dealId?: string;
  accountId?: string;
  priority?: string;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  overdue?: boolean;
  search?: string;
  sortBy?: 'title' | 'due_date' | 'priority' | 'status' | 'created_at';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function buildWhereClause(workspaceId: string, filters: TaskFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.status !== undefined) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  }

  if (filters.assignee !== undefined) {
    conditions.push(`assignee = $${idx}`);
    params.push(filters.assignee);
    idx++;
  }

  if (filters.dealId !== undefined) {
    conditions.push(`deal_id = $${idx}`);
    params.push(filters.dealId);
    idx++;
  }

  if (filters.accountId !== undefined) {
    conditions.push(`account_id = $${idx}`);
    params.push(filters.accountId);
    idx++;
  }

  if (filters.priority !== undefined) {
    conditions.push(`priority = $${idx}`);
    params.push(filters.priority);
    idx++;
  }

  if (filters.dueDateFrom !== undefined) {
    conditions.push(`due_date >= $${idx}`);
    params.push(filters.dueDateFrom);
    idx++;
  }

  if (filters.dueDateTo !== undefined) {
    conditions.push(`due_date <= $${idx}`);
    params.push(filters.dueDateTo);
    idx++;
  }

  if (filters.overdue === true) {
    conditions.push(`due_date < CURRENT_DATE AND status NOT IN ('completed', 'done', 'closed')`);
  }

  if (filters.search !== undefined) {
    conditions.push(`title ILIKE $${idx}`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

const VALID_SORT_COLUMNS = new Set(['title', 'due_date', 'priority', 'status', 'created_at']);

export async function queryTasks(workspaceId: string, filters: TaskFilters): Promise<{ tasks: Task[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const sortBy = filters.sortBy && VALID_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : 'created_at';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM tasks WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Task>(
    `SELECT * FROM tasks WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { tasks: dataResult.rows, total, limit, offset };
}

export async function getOverdueTasks(workspaceId: string): Promise<Task[]> {
  const result = await query<Task>(
    `SELECT * FROM tasks WHERE workspace_id = $1 AND due_date < CURRENT_DATE AND status NOT IN ('completed', 'done', 'closed') ORDER BY due_date ASC`,
    [workspaceId],
  );
  return result.rows;
}

export async function getTaskSummary(workspaceId: string): Promise<{
  byStatus: { status: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  overdueCount: number;
}> {
  const [statusResult, priorityResult, overdueResult] = await Promise.all([
    query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM tasks WHERE workspace_id = $1 GROUP BY status`,
      [workspaceId],
    ),
    query<{ priority: string; count: string }>(
      `SELECT priority, COUNT(*) AS count FROM tasks WHERE workspace_id = $1 GROUP BY priority`,
      [workspaceId],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM tasks WHERE workspace_id = $1 AND due_date < CURRENT_DATE AND status NOT IN ('completed', 'done', 'closed')`,
      [workspaceId],
    ),
  ]);

  return {
    byStatus: statusResult.rows.map((r) => ({
      status: r.status,
      count: parseInt(r.count, 10),
    })),
    byPriority: priorityResult.rows.map((r) => ({
      priority: r.priority,
      count: parseInt(r.count, 10),
    })),
    overdueCount: parseInt(overdueResult.rows[0].count, 10),
  };
}
