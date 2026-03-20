import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import pool from '../db.js';
import { renderChartFromSpec } from '../orchestrator/chart-renderer.js';

const router = Router();

const CHARTABLE_SKILLS = [
  'deal-risk-review',
  'pipeline-hygiene',
  'pipeline-coverage',
  'forecast-rollup',
];

router.get('/:workspaceId/chart-data/sources', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const result = await query(`
      SELECT DISTINCT ON (skill_id)
        skill_id,
        id as run_id,
        created_at,
        jsonb_array_length(
          output->'evidence'->'evaluated_records'
        ) as record_count
      FROM skill_runs
      WHERE workspace_id = $1
        AND status = 'completed'
        AND skill_id = ANY($2)
        AND output->'evidence'->'evaluated_records' IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY skill_id, created_at DESC
    `, [workspaceId, CHARTABLE_SKILLS]);

    res.json({ sources: result.rows });
  } catch (err: any) {
    console.error('[ChartData] Failed to get sources:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/chart-data/:skillId', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, skillId } = req.params;

    if (!CHARTABLE_SKILLS.includes(skillId)) {
      return res.status(400).json({ error: 'Skill not chartable' });
    }

    const result = await query(`
      SELECT
        output->'evidence'->'evaluated_records' as records,
        output->'evidence'->'claims' as claims,
        created_at
      FROM skill_runs
      WHERE workspace_id = $1
        AND skill_id = $2
        AND status = 'completed'
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 1
    `, [workspaceId, skillId]);

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'No recent skill run found' });
    }

    res.json({
      records: result.rows[0].records || [],
      claims: result.rows[0].claims || [],
      fetched_at: result.rows[0].created_at,
    });
  } catch (err: any) {
    console.error('[ChartData] Failed to get records:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Living Document: Query live data for charts/tables (with field whitelisting)
const QUERYABLE_FIELDS: Record<string, { table: string; fields: string[] }> = {
  deals: {
    table: 'deals',
    fields: ['id', 'name', 'stage', 'amount', 'close_date', 'probability', 'owner_id', 'created_at', 'last_activity_at'],
  },
  contacts: {
    table: 'contacts',
    fields: ['id', 'name', 'email', 'title', 'account_name', 'created_at'],
  },
  activities: {
    table: 'activities',
    fields: ['id', 'type', 'subject', 'deal_id', 'contact_id', 'owner_id', 'completed_at', 'created_at'],
  },
};

const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
const AGGREGATES = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

router.post('/:workspaceId/chart-data/query', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { entity_type, filters = [], group_by, aggregate, render_chart } = req.body;

    // Validate entity_type
    const entityConfig = QUERYABLE_FIELDS[entity_type];
    if (!entityConfig) {
      res.status(400).json({
        error: 'Invalid entity_type',
        allowed: Object.keys(QUERYABLE_FIELDS)
      });
      return;
    }

    const { table, fields: allowedFields } = entityConfig;

    // Build WHERE clause from filters (with field whitelisting)
    const conditions: string[] = [`${table}.workspace_id = $1`];
    const values: any[] = [workspaceId];
    let paramCount = 1;

    for (const filter of filters) {
      const { field, operator, value } = filter;

      // Validate field is whitelisted
      if (!allowedFields.includes(field)) {
        res.status(400).json({
          error: `Field '${field}' not allowed for ${entity_type}`,
          allowed_fields: allowedFields
        });
        return;
      }

      // Validate operator
      if (!OPERATORS.includes(operator.toUpperCase())) {
        res.status(400).json({
          error: `Operator '${operator}' not allowed`,
          allowed_operators: OPERATORS
        });
        return;
      }

      // Build condition (field is whitelisted, so safe to interpolate)
      if (operator.toUpperCase() === 'IN') {
        values.push(value); // value should be an array
        conditions.push(`${table}.${field} = ANY($${++paramCount})`);
      } else if (operator.toUpperCase().includes('NULL')) {
        conditions.push(`${table}.${field} ${operator.toUpperCase()}`);
      } else {
        values.push(value);
        conditions.push(`${table}.${field} ${operator} $${++paramCount}`);
      }
    }

    // Build SELECT clause
    let selectClause: string;
    let orderByClause = '';

    if (aggregate && group_by) {
      // Validate group_by field
      if (!allowedFields.includes(group_by)) {
        res.status(400).json({
          error: `Group by field '${group_by}' not allowed`,
          allowed_fields: allowedFields
        });
        return;
      }

      // Validate aggregate function
      const aggUpper = aggregate.func.toUpperCase();
      if (!AGGREGATES.includes(aggUpper)) {
        res.status(400).json({
          error: `Aggregate function '${aggregate.func}' not allowed`,
          allowed_aggregates: AGGREGATES
        });
        return;
      }

      // Validate aggregate field (if specified, e.g., SUM(amount))
      const aggField = aggregate.field || '*';
      if (aggField !== '*' && !allowedFields.includes(aggField)) {
        res.status(400).json({
          error: `Aggregate field '${aggField}' not allowed`,
          allowed_fields: allowedFields
        });
        return;
      }

      selectClause = `${table}.${group_by} as label, ${aggUpper}(${table}.${aggField}) as value`;
      orderByClause = `ORDER BY value DESC`;
    } else {
      // Simple query: return all whitelisted fields
      selectClause = allowedFields.map(f => `${table}.${f}`).join(', ');
      orderByClause = `ORDER BY ${table}.created_at DESC LIMIT 100`;
    }

    const sql = `
      SELECT ${selectClause}
      FROM ${table}
      WHERE ${conditions.join(' AND ')}
      ${group_by ? `GROUP BY ${table}.${group_by}` : ''}
      ${orderByClause}
    `;

    const result = await query(sql, values);

    // If render_chart is requested, convert to chart PNG
    if (render_chart && aggregate && group_by) {
      const chartSpec = {
        chart_type: render_chart.chart_type || 'bar',
        data_points: result.rows.map((row: any) => ({
          label: String(row.label || 'Unknown'),
          value: parseFloat(row.value) || 0,
        })),
        color_scheme: render_chart.color_scheme || 'uniform',
      };

      const chartBuffer = await renderChartFromSpec(
        chartSpec as any,
        render_chart.width || 560,
        render_chart.height || 220
      );

      // Return chart as base64 data URL
      const base64Chart = chartBuffer.toString('base64');
      res.json({
        data: result.rows,
        chart: `data:image/png;base64,${base64Chart}`,
      });
      return;
    }

    res.json({ data: result.rows });
  } catch (err: any) {
    console.error('[ChartData] Query failed:', err);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Living Document: Get schema (whitelisted fields only, no SQL column names exposed)
router.get('/:workspaceId/chart-data/schema', async (_req: Request, res: Response) => {
  try {
    const schema = Object.entries(QUERYABLE_FIELDS).map(([entityType, config]) => ({
      entity_type: entityType,
      fields: config.fields.map(field => ({
        name: field,
        label: field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      })),
    }));

    res.json({ schema });
  } catch (err: any) {
    console.error('[ChartData] Failed to get schema:', err);
    res.status(500).json({ error: 'Failed to get schema' });
  }
});

// Living Document: Get saved queries for chart builder
router.get('/:workspaceId/chart-data/queries', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const result = await query(
      `SELECT
        id,
        name,
        description,
        sql_text,
        last_run_rows,
        last_run_ms,
        created_at,
        updated_at
      FROM workspace_saved_queries
      WHERE workspace_id = $1
      ORDER BY updated_at DESC`,
      [workspaceId]
    );

    res.json({
      queries: result.rows,
      count: result.rows.length,
    });
  } catch (err: any) {
    console.error('[ChartData] Failed to get saved queries:', err);
    res.status(500).json({ error: 'Failed to get saved queries' });
  }
});

// Living Document: Execute saved query for chart builder
const QUERY_TIMEOUT_MS = 30_000;
const MAX_ROWS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/:workspaceId/chart-data/queries/:queryId/run', async (req: Request, res: Response) => {
  try {
    const { workspaceId, queryId } = req.params;

    if (!UUID_RE.test(workspaceId)) {
      res.status(400).json({ error: 'Invalid workspace ID format' });
      return;
    }

    // Look up the saved query — verify ownership
    const queryRow = await query(
      `SELECT id, name, sql_text, last_run_rows, last_run_ms
       FROM workspace_saved_queries
       WHERE id = $1 AND workspace_id = $2`,
      [queryId, workspaceId]
    );

    if (queryRow.rows.length === 0) {
      res.status(404).json({ error: 'Query not found' });
      return;
    }

    const savedQuery = queryRow.rows[0];

    // Execute via the same security-enforced path as /sql/execute
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Set workspace scoping for RLS (workspaceId already validated as UUID)
      await client.query(`SET LOCAL app.current_workspace_id = '${workspaceId}'`);
      await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
      await client.query(`SET LOCAL ROLE pandora_rls_user`);

      const startTime = Date.now();
      const result = await client.query(savedQuery.sql_text);
      const duration = Date.now() - startTime;

      await client.query('COMMIT');

      const rows = result.rows.slice(0, MAX_ROWS);
      const rowCount = rows.length;

      // Update last_run stats
      await query(
        `UPDATE workspace_saved_queries
         SET last_run_rows = $1,
             last_run_ms = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [rowCount, duration, queryId]
      );

      // Extract column names for chart builder
      const columns = result.fields.map((f: any) => f.name);

      console.log(
        `[ChartData] Ran saved query "${savedQuery.name}" for workspace ${workspaceId}: ${rowCount} rows in ${duration}ms`
      );

      res.json({
        query_id: queryId,
        query_name: savedQuery.name,
        columns,
        rows,
        row_count: rowCount,
        duration_ms: duration,
      });
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {}
      client.release();
    }
  } catch (err: any) {
    console.error('[ChartData] Query execution failed:', err);
    res.status(500).json({
      error: 'Query execution failed',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
