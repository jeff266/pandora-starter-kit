/**
 * New Field Detection
 *
 * After every incremental sync, diffs the current CRM schema against
 * the stored snapshot. New fields with >= 10% fill rate generate a
 * `new_crm_fields` finding. Deduplicates by updating the existing
 * open finding rather than inserting a new one.
 */

import { query } from '../db.js';

export interface SchemaSnapshot {
  deals: string[];
  contacts: string[];
  accounts: string[];
  captured_at: string;
}

export interface NewFieldEntry {
  object: 'deals' | 'contacts' | 'accounts';
  field_name: string;
  fill_rate: number;
}

export interface NewFieldsResult {
  hasNewFields: boolean;
  newFields: NewFieldEntry[];
}

async function getFieldFillRate(
  workspaceId: string,
  object: 'deals' | 'contacts' | 'accounts',
  fieldName: string
): Promise<number> {
  const result = await query<{ fill_rate: string | null }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE custom_fields ? $2
           AND custom_fields->>$2 IS NOT NULL
           AND custom_fields->>$2 != ''
       )::float / NULLIF(COUNT(*), 0) * 100 AS fill_rate
     FROM ${object}
     WHERE workspace_id = $1`,
    [workspaceId, fieldName]
  );
  return Math.round(parseFloat(result.rows[0]?.fill_rate ?? '0') || 0);
}

export async function captureCurrentSchema(
  workspaceId: string,
  _connectorType: string
): Promise<SchemaSnapshot> {
  const getFields = async (table: string): Promise<string[]> => {
    const result = await query<{ field_name: string }>(
      `SELECT DISTINCT jsonb_object_keys(custom_fields) AS field_name
       FROM ${table}
       WHERE workspace_id = $1
         AND custom_fields IS NOT NULL
         AND custom_fields != '{}'::jsonb
       LIMIT 500`,
      [workspaceId]
    );
    return result.rows.map(r => r.field_name);
  };

  const [deals, contacts, accounts] = await Promise.all([
    getFields('deals'),
    getFields('contacts'),
    getFields('accounts'),
  ]);

  return { deals, contacts, accounts, captured_at: new Date().toISOString() };
}

export async function detectNewFields(
  workspaceId: string,
  connectorType: string,
  currentFields: SchemaSnapshot
): Promise<NewFieldsResult> {
  // Load stored snapshot
  const snapResult = await query<{ schema_snapshot: SchemaSnapshot | null }>(
    `SELECT schema_snapshot FROM connections
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorType]
  );

  const stored: SchemaSnapshot | null = snapResult.rows[0]?.schema_snapshot ?? null;

  // First sync — store baseline, no finding
  if (!stored) {
    await query(
      `UPDATE connections SET schema_snapshot = $3::jsonb, updated_at = NOW()
       WHERE workspace_id = $1 AND connector_name = $2`,
      [workspaceId, connectorType, JSON.stringify(currentFields)]
    );
    return { hasNewFields: false, newFields: [] };
  }

  // Diff each object type
  const objects: Array<'deals' | 'contacts' | 'accounts'> = ['deals', 'contacts', 'accounts'];
  const candidates: NewFieldEntry[] = [];

  for (const obj of objects) {
    const storedFields = new Set(stored[obj] ?? []);
    const added = (currentFields[obj] ?? []).filter(f => !storedFields.has(f));
    for (const field of added) {
      const fillRate = await getFieldFillRate(workspaceId, obj, field);
      if (fillRate >= 10) {
        candidates.push({ object: obj, field_name: field, fill_rate: fillRate });
      }
    }
  }

  // Always update the snapshot to current
  await query(
    `UPDATE connections SET schema_snapshot = $3::jsonb, updated_at = NOW()
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorType, JSON.stringify(currentFields)]
  );

  return { hasNewFields: candidates.length > 0, newFields: candidates };
}

export async function insertNewFieldsFinding(
  workspaceId: string,
  connectorType: string,
  newFields: NewFieldEntry[]
): Promise<void> {
  if (newFields.length === 0) return;

  // Build message
  const byObject = newFields.reduce<Record<string, string[]>>((acc, f) => {
    if (!acc[f.object]) acc[f.object] = [];
    acc[f.object].push(`${f.field_name} (${f.fill_rate}% filled)`);
    return acc;
  }, {});

  const objectSummaries = Object.entries(byObject)
    .map(([obj, fields]) => `${fields.length} on ${obj}: ${fields.join(', ')}`)
    .join('; ');

  const message = `${newFields.length} new ${connectorType} field${newFields.length > 1 ? 's' : ''} detected — ${objectSummaries}. Review and add to required field tracking if needed.`;

  const metadata = {
    connector_type: connectorType,
    new_fields: newFields,
    detected_at: new Date().toISOString(),
  };

  // Deduplication: check for an open finding within the last 7 days
  const existingResult = await query<{ id: string }>(
    `SELECT id FROM findings
     WHERE workspace_id = $1
       AND category = 'new_crm_fields'
       AND resolved_at IS NULL
       AND metadata->>'connector_type' = $2
       AND found_at > NOW() - INTERVAL '7 days'
     LIMIT 1`,
    [workspaceId, connectorType]
  );

  if (existingResult.rows.length > 0) {
    // Update existing finding with latest field list
    await query(
      `UPDATE findings
       SET message = $3,
           metadata = $4::jsonb,
           found_at = NOW()
       WHERE id = $5`,
      [workspaceId, connectorType, message, JSON.stringify(metadata), existingResult.rows[0].id]
    );
    console.log(`[FieldDetector] Updated existing new_crm_fields finding for workspace ${workspaceId}`);
    return;
  }

  await query(
    `INSERT INTO findings
       (workspace_id, skill_id, severity, category, message, metadata, found_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
    [
      workspaceId,
      'system/field-detector',
      'info',
      'new_crm_fields',
      message,
      JSON.stringify(metadata),
    ]
  );

  console.log(`[FieldDetector] Inserted new_crm_fields finding for workspace ${workspaceId}: ${newFields.length} field(s)`);
}
