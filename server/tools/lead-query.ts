import { query } from '../db.js';

export interface Lead {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: string | null;
  website: string | null;
  status: string | null;
  lead_source: string | null;
  industry: string | null;
  employee_count: number | null;
  is_converted: boolean | null;
  converted_contact_id: string | null;
  converted_account_id: string | null;
  converted_deal_id: string | null;
  sf_converted_contact_id: string | null;
  sf_converted_account_id: string | null;
  sf_converted_opportunity_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  custom_fields: Record<string, unknown> | null;
  source_data: Record<string, unknown> | null;
}

export interface LeadFilters {
  status?: string;
  isConverted?: boolean;
  leadSource?: string;
  ownerId?: string;
  ownerEmail?: string;
  company?: string;
  search?: string;
  createdAfter?: Date;
  lastModifiedAfter?: Date;
  sortBy?: 'created_date' | 'last_modified' | 'company' | 'status';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const VALID_SORT_COLUMNS: Record<string, string> = {
  created_date: 'source_data->>\'CreatedDate\'',
  last_modified: 'source_data->>\'LastModifiedDate\'',
  company: 'company',
  status: 'status',
};

function buildWhereClause(workspaceId: string, filters: LeadFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.status !== undefined) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  }

  if (filters.isConverted !== undefined) {
    conditions.push(`is_converted = $${idx}`);
    params.push(filters.isConverted);
    idx++;
  }

  if (filters.leadSource !== undefined) {
    conditions.push(`lead_source ILIKE $${idx}`);
    params.push(`%${filters.leadSource}%`);
    idx++;
  }

  if (filters.ownerId !== undefined) {
    conditions.push(`owner_id = $${idx}`);
    params.push(filters.ownerId);
    idx++;
  }

  if (filters.ownerEmail !== undefined) {
    conditions.push(`owner_email ILIKE $${idx}`);
    params.push(`%${filters.ownerEmail}%`);
    idx++;
  }

  if (filters.company !== undefined) {
    conditions.push(`company ILIKE $${idx}`);
    params.push(`%${filters.company}%`);
    idx++;
  }

  if (filters.search !== undefined) {
    conditions.push(
      `(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx} OR company ILIKE $${idx})`
    );
    params.push(`%${filters.search}%`);
    idx++;
  }

  if (filters.createdAfter !== undefined) {
    conditions.push(`(source_data->>'CreatedDate')::timestamptz > $${idx}`);
    params.push(filters.createdAfter);
    idx++;
  }

  if (filters.lastModifiedAfter !== undefined) {
    conditions.push(`(source_data->>'LastModifiedDate')::timestamptz > $${idx}`);
    params.push(filters.lastModifiedAfter);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

export async function queryLeads(
  workspaceId: string,
  filters: LeadFilters
): Promise<{ leads: Lead[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const sortCol = filters.sortBy && VALID_SORT_COLUMNS[filters.sortBy]
    ? VALID_SORT_COLUMNS[filters.sortBy]
    : 'source_data->>\'CreatedDate\'';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM leads WHERE ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Lead>(
    `SELECT * FROM leads WHERE ${where} ORDER BY ${sortCol} ${sortDir} NULLS LAST LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams
  );

  return { leads: dataResult.rows, total, limit, offset };
}

export async function getLead(workspaceId: string, leadId: string): Promise<Lead | null> {
  const result = await query<Lead>(
    'SELECT * FROM leads WHERE workspace_id = $1 AND id = $2',
    [workspaceId, leadId]
  );
  return result.rows[0] ?? null;
}

export async function getLeadsForAccount(workspaceId: string, accountId: string): Promise<Lead[]> {
  const result = await query<Lead>(
    `SELECT l.* FROM leads l
     WHERE l.workspace_id = $1 AND l.converted_account_id = $2
     ORDER BY (l.source_data->>'CreatedDate') DESC NULLS LAST`,
    [workspaceId, accountId]
  );
  return result.rows;
}

export async function getLeadFromConvertedContact(
  workspaceId: string,
  contactId: string
): Promise<Lead | null> {
  const result = await query<Lead>(
    `SELECT l.* FROM leads l
     WHERE l.workspace_id = $1 AND l.converted_contact_id = $2
     LIMIT 1`,
    [workspaceId, contactId]
  );
  return result.rows[0] ?? null;
}
