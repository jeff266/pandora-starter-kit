/**
 * Knowledge History API
 *
 * Read and revert versioned change log for internal knowledge tables:
 *   data_dictionary, workspace_knowledge, metric_definitions, business_dimensions
 *
 * GET  /api/workspaces/:workspaceId/knowledge-history
 *      ?table_name=<table>&record_key=<key>
 *      Returns full ordered history (newest-first) for that table + key.
 *
 * POST /api/workspaces/:workspaceId/knowledge-history/:changeId/revert
 *      Replays before_snapshot back into the target table and writes a new
 *      log row (change_type = 'revert').  If before_snapshot is null (first-ever
 *      write), the row is deleted from the target table instead of updated.
 */

import { Router, type Request, type Response } from 'express';
import { query as dbQuery } from '../db.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

// ─── GET history ─────────────────────────────────────────────────────────────

router.get(
  '/:workspaceId/knowledge-history',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { table_name, record_key } = req.query as Record<string, string>;

      if (!table_name || !record_key) {
        return res.status(400).json({ error: 'table_name and record_key are required' });
      }

      const ALLOWED_TABLES = new Set([
        'data_dictionary',
        'workspace_knowledge',
        'metric_definitions',
        'business_dimensions',
      ]);
      if (!ALLOWED_TABLES.has(table_name)) {
        return res.status(400).json({ error: `Unknown table_name: ${table_name}` });
      }

      const result = await dbQuery(
        `SELECT
           id, workspace_id, table_name, record_key,
           action_id, changed_by, change_type,
           before_snapshot, after_snapshot, created_at
         FROM knowledge_change_log
         WHERE workspace_id = $1
           AND table_name   = $2
           AND record_key   = $3
         ORDER BY created_at DESC`,
        [workspaceId, table_name, record_key]
      );

      res.json({ history: result.rows, total: result.rows.length });
    } catch (err) {
      console.error('[Knowledge History GET]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

// ─── POST revert ─────────────────────────────────────────────────────────────

router.post(
  '/:workspaceId/knowledge-history/:changeId/revert',
  async (req: Request<WorkspaceParams & { changeId: string }>, res: Response) => {
    try {
      const { workspaceId, changeId } = req.params;
      const { reverted_by = 'system' } = req.body as { reverted_by?: string };

      // Load the log row to revert
      const logResult = await dbQuery(
        `SELECT * FROM knowledge_change_log WHERE id = $1 AND workspace_id = $2`,
        [changeId, workspaceId]
      );

      if (logResult.rows.length === 0) {
        return res.status(404).json({ error: 'Change log entry not found' });
      }

      const logRow = logResult.rows[0];
      const { table_name, record_key, before_snapshot, after_snapshot } = logRow;

      // Read current state (this becomes the new "before" in the revert log row)
      const currentSnap = await readCurrentSnapshot(workspaceId, table_name, record_key);

      if (before_snapshot === null) {
        // First-ever write: no prior value — delete the row from the target table
        await deleteFromTable(workspaceId, table_name, record_key);

        await dbQuery(
          `INSERT INTO knowledge_change_log
             (workspace_id, table_name, record_key, action_id, changed_by, change_type,
              before_snapshot, after_snapshot)
           VALUES ($1, $2, $3, NULL, $4, 'revert', $5, NULL)`,
          [
            workspaceId,
            table_name,
            record_key,
            reverted_by,
            currentSnap ? JSON.stringify(currentSnap) : null,
          ]
        );

        return res.json({
          success: true,
          message: `Reverted to pre-creation state (row deleted from ${table_name})`,
          change_id: changeId,
        });
      }

      // Replay the before_snapshot back into the target table
      const snap = typeof before_snapshot === 'string'
        ? JSON.parse(before_snapshot)
        : before_snapshot;

      await replaySnapshot(workspaceId, table_name, record_key, snap);

      // Read what we just wrote as the new "after"
      const newSnap = await readCurrentSnapshot(workspaceId, table_name, record_key);

      await dbQuery(
        `INSERT INTO knowledge_change_log
           (workspace_id, table_name, record_key, action_id, changed_by, change_type,
            before_snapshot, after_snapshot)
         VALUES ($1, $2, $3, NULL, $4, 'revert', $5, $6)`,
        [
          workspaceId,
          table_name,
          record_key,
          reverted_by,
          currentSnap ? JSON.stringify(currentSnap) : null,
          newSnap ? JSON.stringify(newSnap) : JSON.stringify(snap),
        ]
      );

      res.json({
        success: true,
        message: `Reverted ${table_name} / ${record_key} to snapshot from ${logRow.created_at}`,
        change_id: changeId,
        reverted_to: snap,
      });
    } catch (err) {
      console.error('[Knowledge History Revert]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readCurrentSnapshot(
  workspaceId: string,
  tableName: string,
  recordKey: string
): Promise<Record<string, any> | null> {
  const { keyCol } = tableConfig(tableName);
  const result = await dbQuery(
    `SELECT * FROM ${tableName} WHERE workspace_id = $1 AND ${keyCol} = $2`,
    [workspaceId, recordKey]
  );
  return result.rows[0] || null;
}

async function deleteFromTable(
  workspaceId: string,
  tableName: string,
  recordKey: string
): Promise<void> {
  const { keyCol } = tableConfig(tableName);
  await dbQuery(
    `DELETE FROM ${tableName} WHERE workspace_id = $1 AND ${keyCol} = $2`,
    [workspaceId, recordKey]
  );
}

async function replaySnapshot(
  workspaceId: string,
  tableName: string,
  recordKey: string,
  snap: Record<string, any>
): Promise<void> {
  switch (tableName) {
    case 'data_dictionary': {
      await dbQuery(
        `INSERT INTO data_dictionary
           (workspace_id, term, definition, sql_definition, source, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, term)
         DO UPDATE SET
           definition     = EXCLUDED.definition,
           sql_definition = EXCLUDED.sql_definition,
           source         = EXCLUDED.source,
           is_active      = EXCLUDED.is_active,
           updated_at     = NOW()`,
        [
          workspaceId,
          snap.term,
          snap.definition ?? null,
          snap.sql_definition ?? null,
          snap.source ?? 'reverted',
          snap.is_active ?? true,
          snap.created_at ?? new Date().toISOString(),
        ]
      );
      break;
    }

    case 'workspace_knowledge': {
      await dbQuery(
        `INSERT INTO workspace_knowledge
           (workspace_id, key, value, source, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, key)
         DO UPDATE SET
           value        = EXCLUDED.value,
           source       = EXCLUDED.source,
           confidence   = EXCLUDED.confidence,
           last_used_at = NOW()`,
        [
          workspaceId,
          snap.key,
          snap.value,
          snap.source ?? 'reverted',
          snap.confidence ?? 0.7,
          snap.created_at ?? new Date().toISOString(),
        ]
      );
      break;
    }

    case 'metric_definitions': {
      await dbQuery(
        `INSERT INTO metric_definitions
           (workspace_id, metric_key, label, unit, description, calibration_source,
            formula, confirmed, confirmed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (workspace_id, metric_key)
         DO UPDATE SET
           label              = EXCLUDED.label,
           unit               = EXCLUDED.unit,
           description        = EXCLUDED.description,
           calibration_source = EXCLUDED.calibration_source,
           formula            = EXCLUDED.formula,
           confirmed          = EXCLUDED.confirmed,
           confirmed_at       = EXCLUDED.confirmed_at,
           updated_at         = NOW()`,
        [
          workspaceId,
          snap.metric_key,
          snap.label ?? snap.metric_key,
          snap.unit ?? null,
          snap.description ?? null,
          snap.calibration_source ?? 'reverted',
          snap.formula ? JSON.stringify(snap.formula) : '{}',
          snap.confirmed ?? false,
          snap.confirmed_at ?? null,
          snap.created_at ?? new Date().toISOString(),
        ]
      );
      break;
    }

    case 'business_dimensions': {
      await dbQuery(
        `UPDATE business_dimensions
         SET filter_definition = $1::jsonb,
             description       = $2,
             confirmed         = $3,
             updated_at        = NOW()
         WHERE workspace_id  = $4
           AND dimension_key = $5`,
        [
          snap.filter_definition ? JSON.stringify(snap.filter_definition) : null,
          snap.description ?? null,
          snap.confirmed ?? false,
          workspaceId,
          recordKey,
        ]
      );
      break;
    }

    default:
      throw new Error(`Unknown table: ${tableName}`);
  }
}

function tableConfig(tableName: string): { keyCol: string } {
  switch (tableName) {
    case 'data_dictionary':      return { keyCol: 'term' };
    case 'workspace_knowledge':  return { keyCol: 'key' };
    case 'metric_definitions':   return { keyCol: 'metric_key' };
    case 'business_dimensions':  return { keyCol: 'dimension_key' };
    default: throw new Error(`Unknown table: ${tableName}`);
  }
}

export default router;
