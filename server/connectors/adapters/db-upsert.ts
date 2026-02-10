import { query } from '../../db.js';
import type { NormalizedTask, NormalizedDocument } from './types.js';

export async function upsertTask(task: NormalizedTask): Promise<void> {
  await query(
    `INSERT INTO tasks (
       id, workspace_id, source, source_id, source_data,
       title, description, status, priority, assignee,
       due_date, completed_date, custom_fields,
       created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, $4,
       $5, $6, $7, $8, $9,
       $10, $11, $12,
       NOW(), NOW()
     )
     ON CONFLICT (workspace_id, source, source_id)
     DO UPDATE SET
       source_data = $4,
       title = $5,
       description = $6,
       status = $7,
       priority = $8,
       assignee = $9,
       due_date = $10,
       completed_date = $11,
       custom_fields = $12,
       updated_at = NOW()`,
    [
      task.workspace_id,
      task.source,
      task.source_id,
      JSON.stringify(task.source_data),
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assignee,
      task.due_date,
      task.completed_date,
      JSON.stringify(task.custom_fields),
    ]
  );
}

export async function upsertTasks(tasks: NormalizedTask[]): Promise<{ inserted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      await upsertTask(task);
      inserted++;
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[DB Upsert] Failed to upsert task ${task.source_id}: ${msg}`);
    }
  }

  return { inserted, failed };
}

export async function upsertDocument(doc: NormalizedDocument): Promise<void> {
  const mimeType = doc.custom_fields?.mimeType || null;

  await query(
    `INSERT INTO documents (
       id, workspace_id, source, source_id, source_data,
       title, doc_type, mime_type, url, author,
       content_text, last_modified_at, custom_fields,
       created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, $4,
       $5, $6, $7, $8, $9,
       $10, $11, $12,
       NOW(), NOW()
     )
     ON CONFLICT (workspace_id, source, source_id)
     DO UPDATE SET
       source_data = $4,
       title = $5,
       doc_type = $6,
       mime_type = $7,
       url = $8,
       author = $9,
       content_text = COALESCE($10, documents.content_text),
       last_modified_at = $11,
       custom_fields = $12,
       updated_at = NOW()`,
    [
      doc.workspace_id,
      doc.source,
      doc.source_id,
      JSON.stringify(doc.source_data),
      doc.title,
      doc.file_type,
      mimeType,
      doc.url,
      doc.owner,
      doc.content_text,
      doc.modified_date,
      JSON.stringify(doc.custom_fields),
    ]
  );
}

export async function upsertDocuments(docs: NormalizedDocument[]): Promise<{ inserted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;

  for (const doc of docs) {
    try {
      await upsertDocument(doc);
      inserted++;
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[DB Upsert] Failed to upsert document ${doc.source_id}: ${msg}`);
    }
  }

  return { inserted, failed };
}
