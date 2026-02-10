import { query } from '../db.js';

export interface Contact {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, unknown>;
  email: string;
  first_name: string;
  last_name: string;
  title: string;
  seniority: string;
  department: string;
  account_id: string;
  lifecycle_stage: string;
  engagement_score: number;
  phone: string;
  last_activity_date: string;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContactFilters {
  email?: string;
  accountId?: string;
  owner?: string;
  seniority?: string;
  department?: string;
  lastActivityAfter?: Date;
  search?: string;
  sortBy?: 'name' | 'email' | 'engagement_score' | 'last_activity_date' | 'created_at';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function buildWhereClause(workspaceId: string, filters: ContactFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.email !== undefined) {
    conditions.push(`email = $${idx}`);
    params.push(filters.email);
    idx++;
  }

  if (filters.accountId !== undefined) {
    conditions.push(`account_id = $${idx}`);
    params.push(filters.accountId);
    idx++;
  }

  if (filters.seniority !== undefined) {
    conditions.push(`seniority = $${idx}`);
    params.push(filters.seniority);
    idx++;
  }

  if (filters.department !== undefined) {
    conditions.push(`department = $${idx}`);
    params.push(filters.department);
    idx++;
  }

  if (filters.lastActivityAfter !== undefined) {
    conditions.push(`last_activity_date > $${idx}`);
    params.push(filters.lastActivityAfter);
    idx++;
  }

  if (filters.search !== undefined) {
    conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

const VALID_SORT_COLUMNS: Record<string, string> = {
  name: 'last_name, first_name',
  email: 'email',
  engagement_score: 'engagement_score',
  last_activity_date: 'last_activity_date',
  created_at: 'created_at',
};

export async function queryContacts(workspaceId: string, filters: ContactFilters): Promise<{ contacts: Contact[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const sortBy = filters.sortBy && VALID_SORT_COLUMNS[filters.sortBy] ? VALID_SORT_COLUMNS[filters.sortBy] : 'created_at';
  const sortDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM contacts WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Contact>(
    `SELECT * FROM contacts WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { contacts: dataResult.rows, total, limit, offset };
}

export async function getContact(workspaceId: string, contactId: string): Promise<Contact | null> {
  const result = await query<Contact>(
    'SELECT * FROM contacts WHERE workspace_id = $1 AND id = $2',
    [workspaceId, contactId],
  );
  return result.rows[0] ?? null;
}

export async function getContactsForDeal(workspaceId: string, dealId: string): Promise<Contact[]> {
  const result = await query<Contact>(
    `SELECT DISTINCT ON (c.id) c.* FROM (
      SELECT co.* FROM contacts co
      INNER JOIN deals d ON d.contact_id = co.id AND d.workspace_id = $1
      WHERE co.workspace_id = $1 AND d.id = $2
      UNION
      SELECT co.* FROM contacts co
      INNER JOIN activities a ON a.contact_id = co.id AND a.workspace_id = $1
      WHERE co.workspace_id = $1 AND a.deal_id = $2 AND a.contact_id IS NOT NULL
      UNION
      SELECT co.* FROM contacts co
      INNER JOIN deals d ON d.account_id = co.account_id AND d.workspace_id = $1
      WHERE co.workspace_id = $1 AND d.id = $2
    ) c ORDER BY c.id, c.seniority`,
    [workspaceId, dealId],
  );
  return result.rows;
}

export async function getStakeholderMap(workspaceId: string, accountId: string): Promise<{
  account: { id: string; name: string };
  stakeholders: { seniority: string; contacts: Contact[] }[];
}> {
  const accountResult = await query<{ id: string; name: string }>(
    'SELECT id, name FROM accounts WHERE workspace_id = $1 AND id = $2',
    [workspaceId, accountId],
  );
  const account = accountResult.rows[0] ?? { id: accountId, name: '' };

  const contactsResult = await query<Contact>(
    'SELECT * FROM contacts WHERE workspace_id = $1 AND account_id = $2 ORDER BY seniority, last_name',
    [workspaceId, accountId],
  );

  const grouped = new Map<string, Contact[]>();
  for (const contact of contactsResult.rows) {
    const key = contact.seniority ?? '';
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(contact);
  }

  const stakeholders = Array.from(grouped.entries()).map(([seniority, contacts]) => ({
    seniority,
    contacts,
  }));

  return { account, stakeholders };
}
