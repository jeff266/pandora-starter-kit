import { Router, Request, Response } from 'express';
import pool from '../db.js';
import { query } from '../db.js';

const router = Router();

// Maximum query timeout (30 seconds)
const QUERY_TIMEOUT_MS = 30_000;
// Maximum rows returned
const MAX_ROWS = 10_000;

// Blocked SQL keywords (case-insensitive)
const BLOCKED_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
  'GRANT', 'REVOKE', 'EXECUTE', 'COPY', 'VACUUM', 'REINDEX',
  'SET', 'RESET', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'LOCK', 'NOTIFY', 'LISTEN',
];

/**
 * POST /api/workspaces/:workspaceId/sql/execute
 *
 * Execute a read-only SQL query with automatic workspace_id scoping.
 * - Only SELECT and WITH (CTEs) are allowed
 * - Queries automatically filtered by workspace_id
 * - Timeout after 30 seconds
 * - Maximum 10,000 rows returned
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/:workspaceId/sql/execute', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { sql } = req.body;

  if (!UUID_RE.test(workspaceId)) {
    return res.status(400).json({ error: 'Invalid workspace ID format' });
  }

  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid SQL query',
      message: 'Request body must include "sql" field with a valid query string',
    });
  }

  const trimmed = sql.trim();
  if (!trimmed) {
    return res.status(400).json({
      error: 'Empty query',
      message: 'SQL query cannot be empty',
    });
  }

  // Check for blocked operations
  const upperSQL = trimmed.toUpperCase();
  const firstWord = trimmed.split(/\s+/)[0].toUpperCase();

  if (BLOCKED_KEYWORDS.includes(firstWord)) {
    return res.status(403).json({
      error: 'Forbidden operation',
      message: `${firstWord} operations are not permitted`,
      hint: 'The SQL Workspace is read-only. Only SELECT queries are allowed.',
    });
  }

  // Check for blocked keywords anywhere in the query
  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upperSQL)) {
      return res.status(403).json({
        error: 'Forbidden operation',
        message: `${keyword} is not permitted in any context`,
        hint: 'Read-only workspace. Only SELECT queries allowed.',
      });
    }
  }

  // Ensure query starts with SELECT or WITH
  if (!upperSQL.startsWith('SELECT') && !upperSQL.startsWith('WITH')) {
    return res.status(400).json({
      error: 'Invalid query type',
      message: 'Query must start with SELECT or WITH',
      hint: 'Only SELECT statements and CTEs (WITH ... AS) are supported.',
    });
  }

  // Execute query with workspace scoping and timeout
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_workspace_id = $1', [workspaceId]);
    await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
    await client.query(`SET LOCAL ROLE pandora_rls_user`);

    console.log('[sql-workspace] Session workspace_id:', workspaceId, '(role: pandora_rls_user)');

    // Execute the query (RLS policies will automatically filter by workspace_id)
    const startTime = Date.now();
    const result = await client.query(sql);
    const executionTime = Date.now() - startTime;

    console.log('[sql-workspace] Query returned', result.rows.length, 'rows');

    await client.query('COMMIT');

    // Limit rows returned
    const rows = result.rows.slice(0, MAX_ROWS);
    const truncated = result.rows.length > MAX_ROWS;

    res.json({
      rows,
      rowCount: rows.length,
      totalRows: result.rowCount || 0,
      truncated,
      executionTime,
      fields: result.fields.map((f: any) => ({
        name: f.name,
        dataTypeID: f.dataTypeID,
      })),
    });
  } catch (err: any) {
    console.error('[sql-workspace] Query execution error:', err);

    // Parse common Postgres error types
    let errorMessage = err.message || 'Unknown database error';
    let hint: string | undefined;

    if (err.code === '42P01') {
      // Undefined table
      errorMessage = err.message;
      hint = 'Check that the table name is spelled correctly and exists in your workspace.';
    } else if (err.code === '42703') {
      // Undefined column
      errorMessage = err.message;
      const match = err.message.match(/column "(\w+)" does not exist/i);
      if (match) {
        hint = `The column "${match[1]}" does not exist. Check the schema panel for available columns.`;
      }
    } else if (err.code === '42803') {
      // Grouping error
      errorMessage = err.message;
      hint = 'When using GROUP BY, every column in SELECT must either be in the GROUP BY list or wrapped in an aggregate (COUNT, SUM, MAX, etc.).';
    } else if (err.message.includes('canceling statement due to statement timeout')) {
      errorMessage = 'Query exceeded the 30-second execution limit';
      hint = 'Try adding a LIMIT clause, removing expensive JOINs, or narrowing your WHERE filters.';
    } else if (err.code === '42601') {
      // Syntax error
      errorMessage = err.message;
      hint = 'Check your SQL syntax. Common issues: unmatched parentheses, missing commas, or typos in keywords.';
    }

    res.status(400).json({
      error: 'Query execution failed',
      message: errorMessage,
      hint,
      code: err.code,
    });
  } finally {
    // Rollback transaction and release client
    try {
      await client.query('ROLLBACK');
    } catch {}
    client.release();
  }
});

/**
 * GET /api/workspaces/:workspaceId/sql/saved
 *
 * Get all saved queries for a workspace
 */
router.get('/:workspaceId/sql/saved', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;

  try {
    const result = await query(
      `SELECT id, workspace_id, name, description, sql_text, source_type, source_id, source_name,
              predicates, applicable_skills, last_run_at, last_run_rows, last_run_ms,
              created_at, updated_at, created_by
       FROM workspace_saved_queries
       WHERE workspace_id = $1
       ORDER BY updated_at DESC`,
      [workspaceId]
    );

    res.json(result.rows);
  } catch (err: any) {
    console.error('[sql-workspace] Error fetching saved queries:', err);
    res.status(500).json({
      error: 'Failed to fetch saved queries',
      message: err.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/workspaces/:workspaceId/sql/saved
 *
 * Create a new saved query
 */
router.post('/:workspaceId/sql/saved', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { name, sql_text, source_type, source_id, source_name, description } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid name',
      message: 'Request body must include a "name" field',
    });
  }

  if (!sql_text || typeof sql_text !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid sql_text',
      message: 'Request body must include a "sql_text" field',
    });
  }

  try {
    const result = await query(
      `INSERT INTO workspace_saved_queries
         (workspace_id, name, description, sql_text, source_type, source_id, source_name, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        workspaceId,
        name,
        description || null,
        sql_text,
        source_type || 'scratch',
        source_id || null,
        source_name || null,
        (req as any).user?.email || null,
      ]
    );

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[sql-workspace] Error creating saved query:', err);
    res.status(500).json({
      error: 'Failed to create saved query',
      message: err.message || 'Unknown error',
    });
  }
});

/**
 * PUT /api/workspaces/:workspaceId/sql/saved/:queryId
 *
 * Update an existing saved query
 */
router.put('/:workspaceId/sql/saved/:queryId', async (req: Request, res: Response) => {
  const { workspaceId, queryId } = req.params;
  const { name, sql_text, description } = req.body;

  // Build SET clause dynamically
  const updates: string[] = [];
  const values: any[] = [workspaceId, queryId];
  let idx = 3;

  if (name !== undefined) {
    updates.push(`name = $${idx}`);
    values.push(name);
    idx++;
  }

  if (sql_text !== undefined) {
    updates.push(`sql_text = $${idx}`);
    values.push(sql_text);
    idx++;
  }

  if (description !== undefined) {
    updates.push(`description = $${idx}`);
    values.push(description);
    idx++;
  }

  if (updates.length === 0) {
    return res.status(400).json({
      error: 'No updates provided',
      message: 'Request body must include at least one field to update',
    });
  }

  updates.push(`updated_at = NOW()`);

  try {
    const result = await query(
      `UPDATE workspace_saved_queries
       SET ${updates.join(', ')}
       WHERE workspace_id = $1 AND id = $2
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Saved query not found',
        message: `No saved query found with ID ${queryId}`,
      });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[sql-workspace] Error updating saved query:', err);
    res.status(500).json({
      error: 'Failed to update saved query',
      message: err.message || 'Unknown error',
    });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/sql/saved/:queryId
 *
 * Delete a saved query
 */
router.delete('/:workspaceId/sql/saved/:queryId', async (req: Request, res: Response) => {
  const { workspaceId, queryId } = req.params;

  try {
    const result = await query(
      `DELETE FROM workspace_saved_queries
       WHERE workspace_id = $1 AND id = $2
       RETURNING id`,
      [workspaceId, queryId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Saved query not found',
        message: `No saved query found with ID ${queryId}`,
      });
    }

    res.json({ deleted: true });
  } catch (err: any) {
    console.error('[sql-workspace] Error deleting saved query:', err);
    res.status(500).json({
      error: 'Failed to delete saved query',
      message: err.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/workspaces/:workspaceId/sql/saved/:queryId/run
 *
 * Execute a saved query and update its run metadata
 */
router.post('/:workspaceId/sql/saved/:queryId/run', async (req: Request, res: Response) => {
  const { workspaceId, queryId } = req.params;

  if (!UUID_RE.test(workspaceId)) {
    return res.status(400).json({ error: 'Invalid workspace ID format' });
  }

  try {
    // Fetch the saved query
    const savedQueryResult = await query(
      `SELECT sql_text FROM workspace_saved_queries
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, queryId]
    );

    if (savedQueryResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Saved query not found',
        message: `No saved query found with ID ${queryId}`,
      });
    }

    const { sql_text } = savedQueryResult.rows[0];

    // Execute the query using the same logic as /sql/execute
    const client = await pool.connect();
    try {
      // CRITICAL: Set workspace_id session variable for Row-Level Security
      await client.query('BEGIN');
      await client.query('SET LOCAL app.current_workspace_id = $1', [workspaceId]);
      await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
      await client.query('SET LOCAL ROLE pandora_rls_user');

      const startTime = Date.now();
      const result = await client.query(sql_text);
      const executionTime = Date.now() - startTime;

      await client.query('COMMIT');

      const rows = result.rows.slice(0, MAX_ROWS);
      const truncated = result.rows.length > MAX_ROWS;
      const rowCount = rows.length;

      // Update the saved query's run metadata
      await query(
        `UPDATE workspace_saved_queries
         SET last_run_at = NOW(),
             last_run_rows = $1,
             last_run_ms = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [rowCount, executionTime, queryId]
      );

      res.json({
        rows,
        rowCount,
        totalRows: result.rowCount || 0,
        truncated,
        executionTime,
        fields: result.fields.map((f: any) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
      });
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {}
      client.release();
    }
  } catch (err: any) {
    console.error('[sql-workspace] Error running saved query:', err);

    // Parse common Postgres error types (same as /sql/execute)
    let errorMessage = err.message || 'Unknown database error';
    let hint: string | undefined;

    if (err.code === '42P01') {
      errorMessage = err.message;
      hint = 'Check that the table name is spelled correctly and exists in your workspace.';
    } else if (err.code === '42703') {
      errorMessage = err.message;
      const match = err.message.match(/column "(\w+)" does not exist/i);
      if (match) {
        hint = `The column "${match[1]}" does not exist. Check the schema panel for available columns.`;
      }
    } else if (err.code === '42803') {
      errorMessage = err.message;
      hint = 'When using GROUP BY, every column in SELECT must either be in the GROUP BY list or wrapped in an aggregate (COUNT, SUM, MAX, etc.).';
    } else if (err.message.includes('canceling statement due to statement timeout')) {
      errorMessage = 'Query exceeded the 30-second execution limit';
      hint = 'Try adding a LIMIT clause, removing expensive JOINs, or narrowing your WHERE filters.';
    } else if (err.code === '42601') {
      errorMessage = err.message;
      hint = 'Check your SQL syntax. Common issues: unmatched parentheses, missing commas, or typos in keywords.';
    }

    res.status(400).json({
      error: 'Query execution failed',
      message: errorMessage,
      hint,
      code: err.code,
    });
  }
});

export default router;
