import { query } from '../db.js';

export interface Document {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, unknown>;
  title: string;
  doc_type: string;
  content_text: string;
  summary: string;
  mime_type: string;
  url: string;
  deal_id: string;
  account_id: string;
  author: string;
  last_modified_at: string;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DocumentFilters {
  docType?: string;
  dealId?: string;
  accountId?: string;
  mimeType?: string;
  modifiedAfter?: Date;
  search?: string;
  sortBy?: 'title' | 'last_modified_at' | 'doc_type' | 'created_at';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const LIST_COLUMNS = [
  'id', 'workspace_id', 'source', 'source_id', 'source_data',
  'title', 'doc_type', 'summary', 'mime_type', 'url',
  'deal_id', 'account_id', 'author', 'last_modified_at',
  'custom_fields', 'created_at', 'updated_at'
].join(', ');

const VALID_SORT_COLUMNS = new Set(['title', 'last_modified_at', 'doc_type', 'created_at']);

function buildWhereClause(workspaceId: string, filters: DocumentFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.docType !== undefined) {
    conditions.push(`doc_type = $${idx}`);
    params.push(filters.docType);
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

  if (filters.mimeType !== undefined) {
    conditions.push(`mime_type = $${idx}`);
    params.push(filters.mimeType);
    idx++;
  }

  if (filters.modifiedAfter !== undefined) {
    conditions.push(`last_modified_at > $${idx}`);
    params.push(filters.modifiedAfter);
    idx++;
  }

  if (filters.search !== undefined) {
    conditions.push(`(title ILIKE $${idx} OR content_text ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

export async function queryDocuments(workspaceId: string, filters: DocumentFilters): Promise<{ documents: Document[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const sortBy = filters.sortBy && VALID_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : 'last_modified_at';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM documents WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Document>(
    `SELECT ${LIST_COLUMNS} FROM documents WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { documents: dataResult.rows, total, limit, offset };
}

export async function getDocument(workspaceId: string, documentId: string): Promise<Document | null> {
  const result = await query<Document>(
    'SELECT * FROM documents WHERE workspace_id = $1 AND id = $2',
    [workspaceId, documentId],
  );
  return result.rows[0] ?? null;
}

export async function getDocumentsForDeal(workspaceId: string, dealId: string): Promise<Document[]> {
  const result = await query<Document>(
    `SELECT ${LIST_COLUMNS} FROM documents WHERE workspace_id = $1 AND deal_id = $2 ORDER BY last_modified_at DESC`,
    [workspaceId, dealId],
  );
  return result.rows;
}
