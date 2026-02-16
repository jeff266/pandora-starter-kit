import { query } from '../db.js';

export interface AnnotationInput {
  entityType: string;
  entityId?: string;
  entityName?: string;
  annotationType: string;
  content: string;
  source: string;
  sourceThreadId?: string;
  sourceMessageId?: string;
  createdBy?: string;
  referencesFindingId?: string;
  referencesSkillRunId?: string;
}

export interface Annotation {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  annotation_type: string;
  content: string;
  source: string;
  source_thread_id: string | null;
  source_message_id: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  references_finding_id: string | null;
  references_skill_run_id: string | null;
}

function calculateExpiresAt(entityType: string, annotationType: string): string | null {
  if (annotationType === 'preference') return null;

  let days: number;
  if (annotationType === 'correction' && entityType === 'workspace') {
    days = 180;
  } else if (annotationType === 'confirmation') {
    days = 90;
  } else if (entityType === 'deal' || entityType === 'account') {
    days = 90;
  } else {
    days = 90;
  }

  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function createAnnotation(
  workspaceId: string,
  data: AnnotationInput
): Promise<{ id: string; expiresAt: string | null }> {
  const expiresAt = calculateExpiresAt(data.entityType, data.annotationType);

  const result = await query<{ id: string; expires_at: string | null }>(
    `INSERT INTO workspace_annotations
       (workspace_id, entity_type, entity_id, entity_name, annotation_type, content, source,
        source_thread_id, source_message_id, created_by, expires_at,
        references_finding_id, references_skill_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, expires_at`,
    [
      workspaceId,
      data.entityType,
      data.entityId || null,
      data.entityName || null,
      data.annotationType,
      data.content,
      data.source,
      data.sourceThreadId || null,
      data.sourceMessageId || null,
      data.createdBy || null,
      expiresAt,
      data.referencesFindingId || null,
      data.referencesSkillRunId || null,
    ]
  );

  const row = result.rows[0];
  return { id: row.id, expiresAt: row.expires_at };
}

export async function getActiveAnnotations(
  workspaceId: string,
  entityType: string,
  entityId: string
): Promise<Annotation[]> {
  const result = await query<Annotation>(
    `SELECT * FROM workspace_annotations
     WHERE workspace_id = $1
       AND entity_type = $2
       AND entity_id = $3
       AND resolved_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`,
    [workspaceId, entityType, entityId]
  );
  return result.rows;
}

export interface AnnotationFilters {
  entityType?: string;
  entityId?: string;
  annotationType?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}

export async function getAnnotationsForWorkspace(
  workspaceId: string,
  filters: AnnotationFilters = {}
): Promise<{ rows: Annotation[]; total: number }> {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.entityType) {
    conditions.push(`entity_type = $${idx++}`);
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    conditions.push(`entity_id = $${idx++}`);
    params.push(filters.entityId);
  }
  if (filters.annotationType) {
    conditions.push(`annotation_type = $${idx++}`);
    params.push(filters.annotationType);
  }
  if (filters.active !== false) {
    conditions.push(`resolved_at IS NULL`);
    conditions.push(`(expires_at IS NULL OR expires_at > NOW())`);
  }

  const where = conditions.join(' AND ');

  const countResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM workspace_annotations WHERE ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.cnt || '0', 10);

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await query<Annotation>(
    `SELECT * FROM workspace_annotations
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return { rows: result.rows, total };
}

export async function resolveAnnotation(
  workspaceId: string,
  annotationId: string
): Promise<boolean> {
  const result = await query(
    `UPDATE workspace_annotations
     SET resolved_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND resolved_at IS NULL
     RETURNING id`,
    [annotationId, workspaceId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function resolveEntityAnnotations(
  workspaceId: string,
  entityType: string,
  entityId: string
): Promise<number> {
  const result = await query(
    `UPDATE workspace_annotations
     SET resolved_at = NOW()
     WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3 AND resolved_at IS NULL
     RETURNING id`,
    [workspaceId, entityType, entityId]
  );
  return result.rowCount || 0;
}
