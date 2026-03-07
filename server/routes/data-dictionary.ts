import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { randomUUID } from 'crypto';

const router = Router();

// GET /:workspaceId/dictionary — paginated list with search; joins reference counts
router.get('/:workspaceId/dictionary', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { search, source, limit = 50, offset = 0 } = req.query;

  let queryText = `
    SELECT d.*, 
           (
             SELECT COUNT(*) FROM filter_usage_log ful 
             WHERE ful.workspace_id = d.workspace_id 
               AND ful.filter_id = d.source_id 
               AND d.source = 'filter'
           ) + (
             SELECT COUNT(*) FROM tool_call_logs tcl
             WHERE tcl.workspace_id = d.workspace_id
               AND tcl.tool_name = d.technical_definition
               AND d.source = 'system'
           ) as reference_count
    FROM data_dictionary d
    WHERE d.workspace_id = $1 AND d.is_active = TRUE
  `;
  const params: any[] = [workspaceId];

  if (search) {
    queryText += ` AND (d.term ILIKE $${params.length + 1} OR d.definition ILIKE $${params.length + 1})`;
    params.push(`%${search}%`);
  }

  if (source) {
    queryText += ` AND d.source = $${params.length + 1}`;
    params.push(source);
  }

  queryText += ` ORDER BY d.term ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[dictionary-router] GET failed:', err);
    res.status(500).json({ error: 'Failed to fetch dictionary' });
  }
});

// POST /:workspaceId/dictionary — create user term
router.post('/:workspaceId/dictionary', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { term, definition, technical_definition, sql_definition, segmentable_by } = req.body;

  if (!term) return res.status(400).json({ error: 'Term is required' });

  try {
    const result = await query(
      `INSERT INTO data_dictionary (workspace_id, term, definition, technical_definition, sql_definition, segmentable_by, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'user', $7)
       ON CONFLICT (workspace_id, term) DO UPDATE SET
         definition = EXCLUDED.definition,
         technical_definition = EXCLUDED.technical_definition,
         sql_definition = EXCLUDED.sql_definition,
         segmentable_by = EXCLUDED.segmentable_by,
         is_active = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [workspaceId, term, definition, technical_definition, sql_definition, segmentable_by || [], (req as any).user?.email || 'system']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[dictionary-router] POST failed:', err);
    res.status(500).json({ error: 'Failed to create dictionary entry' });
  }
});

// PUT /:workspaceId/dictionary/:id — edit term/definition
router.put('/:workspaceId/dictionary/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { term, definition, technical_definition, sql_definition, segmentable_by } = req.body;

  try {
    const result = await query(
      `UPDATE data_dictionary
       SET term = COALESCE($2, term),
           definition = COALESCE($3, definition),
           technical_definition = COALESCE($4, technical_definition),
           sql_definition = COALESCE($5, sql_definition),
           segmentable_by = COALESCE($6, segmentable_by),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, term, definition, technical_definition, sql_definition, segmentable_by]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Entry not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[dictionary-router] PUT failed:', err);
    res.status(500).json({ error: 'Failed to update dictionary entry' });
  }
});

// DELETE /:workspaceId/dictionary/:id — soft delete
router.delete('/:workspaceId/dictionary/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      `UPDATE data_dictionary SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[dictionary-router] DELETE failed:', err);
    res.status(500).json({ error: 'Failed to delete dictionary entry' });
  }
});

// GET /:workspaceId/dictionary/context — returns compact term: definition map for AI
router.get('/:workspaceId/dictionary/context', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;

  try {
    // Get top 50 terms by reference count desc
    const result = await query(
      `SELECT term, definition
       FROM data_dictionary
       WHERE workspace_id = $1 AND is_active = TRUE
       ORDER BY (
         SELECT COUNT(*) FROM filter_usage_log ful 
         WHERE ful.workspace_id = data_dictionary.workspace_id 
           AND ful.filter_id = data_dictionary.source_id 
           AND data_dictionary.source = 'filter'
       ) DESC
       LIMIT 50`,
      [workspaceId]
    );
    
    const context: Record<string, string> = {};
    result.rows.forEach(row => {
      context[row.term] = row.definition || '';
    });
    
    res.json(context);
  } catch (err) {
    console.error('[dictionary-router] GET context failed:', err);
    res.status(500).json({ error: 'Failed to fetch dictionary context' });
  }
});

export default router;
