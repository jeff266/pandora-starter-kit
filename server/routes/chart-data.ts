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

// Rep-level roles that are restricted to their own records
const REP_ROLES = new Set(['ae']);

// Manager/admin roles that can see all records
const MANAGER_ROLES = new Set(['cro', 'manager', 'revops', 'admin']);

// Field type metadata for picklist rendering in the frontend
type FieldType = 'id' | 'categorical' | 'numeric' | 'date' | 'text';

interface FieldDef {
  name: string;
  field_type: FieldType;
  // For owner field: reps cannot filter on this — it is auto-injected
  owner_field?: boolean;
}

const QUERYABLE_FIELDS: Record<string, { table: string; owner_field: string; fields: FieldDef[] }> = {
  deals: {
    table: 'deals',
    owner_field: 'owner',
    fields: [
      { name: 'name',              field_type: 'text' },
      { name: 'stage',             field_type: 'categorical' },
      { name: 'stage_normalized',  field_type: 'categorical' },
      { name: 'amount',            field_type: 'numeric' },
      { name: 'close_date',        field_type: 'date' },
      { name: 'probability',       field_type: 'numeric' },
      { name: 'forecast_category', field_type: 'categorical' },
      { name: 'pipeline',          field_type: 'categorical' },
      { name: 'owner',             field_type: 'categorical', owner_field: true },
      { name: 'days_in_stage',     field_type: 'numeric' },
      { name: 'health_score',      field_type: 'numeric' },
      { name: 'deal_risk',         field_type: 'numeric' },
      { name: 'created_at',        field_type: 'date' },
    ],
  },
  contacts: {
    table: 'contacts',
    owner_field: 'owner_email',
    fields: [
      { name: 'name',         field_type: 'text' },
      { name: 'email',        field_type: 'text' },
      { name: 'title',        field_type: 'categorical' },
      { name: 'account_name', field_type: 'categorical' },
      { name: 'created_at',   field_type: 'date' },
    ],
  },
  activities: {
    table: 'activities',
    owner_field: 'owner_id',
    fields: [
      { name: 'type',         field_type: 'categorical' },
      { name: 'subject',      field_type: 'text' },
      { name: 'completed_at', field_type: 'date' },
      { name: 'created_at',   field_type: 'date' },
    ],
  },
};

// Fields that are always blocked from user filters (always injected server-side)
const BLOCKED_FILTER_FIELDS = new Set(['workspace_id', 'id']);

const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
const AGGREGATES = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

/**
 * Resolve the rep name from sales_reps for a given user email + workspace.
 * Returns null if the user is not found or has no rep record.
 */
async function resolveRepName(workspaceId: string, email: string): Promise<string | null> {
  const result = await query(
    `SELECT rep_name FROM sales_reps WHERE workspace_id = $1 AND rep_email = $2 LIMIT 1`,
    [workspaceId, email]
  );
  return result.rows[0]?.rep_name ?? null;
}

// ─── SOURCES ──────────────────────────────────────────────────────────────────

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

// ─── SCHEMA — must be before /:skillId wildcard ───────────────────────────────

router.get('/:workspaceId/chart-data/schema', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const workspaceMemberRole = req.workspaceMember?.role ?? '';
    const isRep = REP_ROLES.has(workspaceMemberRole);

    const schema = Object.entries(QUERYABLE_FIELDS).map(([entityType, config]) => ({
      entity_type: entityType,
      fields: config.fields
        // Reps cannot filter on the owner field manually — it's auto-injected
        .filter(f => !(isRep && f.owner_field))
        .map(f => ({
          name: f.name,
          label: f.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          field_type: f.field_type,
        })),
    }));

    res.json({ schema });
  } catch (err: any) {
    console.error('[ChartData] Failed to get schema:', err);
    res.status(500).json({ error: 'Failed to get schema' });
  }
});

// ─── FIELD VALUES (picklist) — must be before /:skillId wildcard ──────────────

router.get('/:workspaceId/chart-data/field-values/:entityType/:fieldName', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, entityType, fieldName } = req.params;

    const entityConfig = QUERYABLE_FIELDS[entityType];
    if (!entityConfig) {
      return res.status(400).json({ error: 'Invalid entity_type' });
    }

    const fieldDef = entityConfig.fields.find(f => f.name === fieldName);
    if (!fieldDef) {
      return res.status(400).json({ error: `Field '${fieldName}' not allowed for ${entityType}` });
    }

    if (BLOCKED_FILTER_FIELDS.has(fieldName)) {
      return res.status(400).json({ error: 'Field not queryable' });
    }

    // Only categorical/text fields warrant distinct value loading
    if (fieldDef.field_type !== 'categorical' && fieldDef.field_type !== 'text') {
      return res.status(400).json({ error: 'Field does not support picklist values' });
    }

    const { table, owner_field } = entityConfig;
    const conditions: string[] = [`${table}.workspace_id = $1`];
    const values: any[] = [workspaceId];

    // Rep enforcement: if ae role, restrict to their own records
    const workspaceMemberRole = req.workspaceMember?.role ?? '';
    if (REP_ROLES.has(workspaceMemberRole) && req.user?.email) {
      const repName = await resolveRepName(workspaceId, req.user.email);
      if (repName) {
        conditions.push(`${table}.${owner_field} = $2`);
        values.push(repName);
      }
    }

    const result = await query(
      `SELECT DISTINCT ${table}.${fieldName} as value
       FROM ${table}
       WHERE ${conditions.join(' AND ')}
         AND ${table}.${fieldName} IS NOT NULL
         AND ${table}.${fieldName} != ''
       ORDER BY value
       LIMIT 200`,
      values
    );

    res.json({ values: result.rows.map((r: any) => r.value) });
  } catch (err: any) {
    console.error('[ChartData] Failed to get field values:', err.message);
    res.status(500).json({ error: 'Failed to get field values' });
  }
});

// ─── SAVED QUERIES — must be before /:skillId wildcard ───────────────────────

router.get('/:workspaceId/chart-data/queries', requirePermission('agents.view'), async (req: Request, res: Response) => {
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

// ─── SKILL RECORDS ────────────────────────────────────────────────────────────

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

// ─── LIVE QUERY ───────────────────────────────────────────────────────────────

router.post('/:workspaceId/chart-data/query', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { entity_type, filters = [], group_by, aggregate, render_chart, limit: rawLimit } = req.body;

    // Clamp limit
    const queryLimit = Math.min(Math.max(1, parseInt(rawLimit) || DEFAULT_LIMIT), MAX_LIMIT);

    // Validate entity_type
    const entityConfig = QUERYABLE_FIELDS[entity_type];
    if (!entityConfig) {
      res.status(400).json({
        error: 'Invalid entity_type',
        allowed: Object.keys(QUERYABLE_FIELDS)
      });
      return;
    }

    const { table, owner_field, fields: fieldDefs } = entityConfig;
    const allowedFieldNames = fieldDefs.map(f => f.name);

    // workspace_id is ALWAYS injected — never user-controlled
    const conditions: string[] = [`${table}.workspace_id = $1`];
    const values: any[] = [workspaceId];
    let paramCount = 1;

    // Role-based ownership enforcement
    const workspaceMemberRole = req.workspaceMember?.role ?? '';
    const isRep = REP_ROLES.has(workspaceMemberRole);

    if (isRep) {
      if (!req.user?.email) {
        res.status(403).json({ error: 'User identity required for rep-level queries' });
        return;
      }
      const repName = await resolveRepName(workspaceId, req.user.email);
      if (repName) {
        conditions.push(`${table}.${owner_field} = $${++paramCount}`);
        values.push(repName);
      }
    }

    // Process user filters
    for (const filter of filters) {
      const { field, operator, value } = filter;

      // Block protected fields regardless of what the user sends
      if (BLOCKED_FILTER_FIELDS.has(field) || field === 'workspace_id') {
        res.status(400).json({ error: `Field '${field}' cannot be used as a filter` });
        return;
      }

      // Reps cannot override the auto-injected owner filter
      const fieldDef = fieldDefs.find(f => f.name === field);
      if (isRep && fieldDef?.owner_field) {
        res.status(400).json({ error: `Field '${field}' is not available as a filter for your role` });
        return;
      }

      // Validate field is whitelisted
      if (!allowedFieldNames.includes(field)) {
        res.status(400).json({
          error: `Field '${field}' not allowed for ${entity_type}`,
          allowed_fields: allowedFieldNames
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

      // Build condition — field is whitelisted, safe to interpolate field name only
      if (operator.toUpperCase() === 'IN') {
        values.push(value);
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
    let groupByClause = '';

    if (aggregate && group_by) {
      // Validate group_by
      if (!allowedFieldNames.includes(group_by)) {
        res.status(400).json({
          error: `Group by field '${group_by}' not allowed`,
          allowed_fields: allowedFieldNames
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

      // Validate aggregate field
      const aggField = aggregate.field || '*';
      if (aggField !== '*' && !allowedFieldNames.includes(aggField)) {
        res.status(400).json({
          error: `Aggregate field '${aggField}' not allowed`,
          allowed_fields: allowedFieldNames
        });
        return;
      }

      selectClause = `${table}.${group_by} as label, ${aggUpper}(${aggField === '*' ? '*' : `${table}.${aggField}`}) as value`;
      groupByClause = `GROUP BY ${table}.${group_by}`;
      orderByClause = `ORDER BY value DESC LIMIT ${queryLimit}`;
    } else {
      selectClause = allowedFieldNames.map(f => `${table}.${f}`).join(', ');
      orderByClause = `ORDER BY ${table}.created_at DESC LIMIT ${queryLimit}`;
    }

    const sql = `
      SELECT ${selectClause}
      FROM ${table}
      WHERE ${conditions.join(' AND ')}
      ${groupByClause}
      ${orderByClause}
    `;

    const result = await query(sql, values);

    // Optional inline chart render
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

// ─── SAVED QUERY EXECUTION ────────────────────────────────────────────────────

const QUERY_TIMEOUT_MS = 30_000;
const MAX_ROWS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/:workspaceId/chart-data/queries/:queryId/run', requirePermission('agents.view'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, queryId } = req.params;

    if (!UUID_RE.test(workspaceId)) {
      res.status(400).json({ error: 'Invalid workspace ID format' });
      return;
    }

    // Look up the saved query — verify workspace ownership
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_workspace_id = '${workspaceId}'`);
      await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
      await client.query(`SET LOCAL ROLE pandora_rls_user`);

      const startTime = Date.now();
      const result = await client.query(savedQuery.sql_text);
      const duration = Date.now() - startTime;

      await client.query('COMMIT');

      const rows = result.rows.slice(0, MAX_ROWS);
      const rowCount = rows.length;

      await query(
        `UPDATE workspace_saved_queries
         SET last_run_rows = $1,
             last_run_ms = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [rowCount, duration, queryId]
      );

      const columns = result.fields.map((f: any) => f.name);

      console.log(
        `[ChartData] Ran saved query "${savedQuery.name}" for workspace ${workspaceId}: ${rowCount} rows in ${duration}ms`
      );

      res.json({
        query_id: queryId,
        query_name: savedQuery.name,
        columns,
        data: rows,
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
