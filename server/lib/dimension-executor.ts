import { query } from '../db.js';
import {
  getDimension,
  type BusinessDimension,
  type DimensionFilter,
  type FilterCondition,
  type ValueTransform,
} from './data-dictionary.js';

export interface DimensionResult {
  dimension_id:      string;
  dimension_key:     string;
  dimension_label:   string;
  value_field:       string;
  value_field_label: string;
  deal_count:        number;
  total_value:       number;
  avg_deal_size:     number;
  median_deal_size:  number;
  earliest_close:    string | null;
  latest_close:      string | null;
  quota?:            number;
  coverage_ratio?:   number;
}

export interface ExecuteOptions {
  additionalFilters?: FilterCondition[];
  overrideValueField?: string;
  includeQuota?: boolean;
}

const FIELD_MAP: Record<string, string> = {
  stage:       'd.stage_normalized',
  amount:      'd.amount',
  close_date:  'd.close_date',
  owner_email: 'd.owner_email',
  owner:       'd.owner',
  pipeline:    'd.pipeline',
  lead_source: 'd.lead_source',
};

const COMPUTED_MAP: Record<string, string> = {
  days_since_activity: 'EXTRACT(days FROM now() - d.last_activity_date)',
  deal_age_days:       'EXTRACT(days FROM now() - d.created_at)',
};

const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9_]{1,128}$/;

function sanitizeIdentifier(name: string, fallback: string): string {
  if (SAFE_IDENTIFIER_RE.test(name)) return name;
  console.warn(`[DimensionExecutor] Unsafe identifier rejected: "${name}", using fallback "${fallback}"`);
  return fallback;
}

function buildFieldReference(c: FilterCondition): string {
  if (c.field_type === 'standard') {
    return FIELD_MAP[c.field] ?? `d.${sanitizeIdentifier(c.field, 'amount')}`;
  }
  if (c.field_type === 'custom') {
    const safeField = sanitizeIdentifier(c.field, 'amount');
    return `d.custom_fields->>'${safeField}'`;
  }
  if (c.field_type === 'computed') {
    return COMPUTED_MAP[c.field] ?? `d.${sanitizeIdentifier(c.field, 'amount')}`;
  }
  return `d.${sanitizeIdentifier(c.field, 'amount')}`;
}

function buildCondition(
  fieldRef: string,
  c: FilterCondition,
  params: any[],
  pIdx: number
): { clause: string; consumed: number } {
  switch (c.operator) {
    case 'equals':
      params.push(c.value);
      return { clause: `${fieldRef} = $${pIdx}`, consumed: 1 };

    case 'not_equals':
      params.push(c.value);
      return { clause: `${fieldRef} != $${pIdx}`, consumed: 1 };

    case 'in':
      params.push(c.value);
      return { clause: `${fieldRef} = ANY($${pIdx})`, consumed: 1 };

    case 'not_in':
      params.push(c.value);
      return { clause: `${fieldRef} != ALL($${pIdx})`, consumed: 1 };

    case 'contains':
      params.push(`%${c.value}%`);
      return { clause: `${fieldRef} ILIKE $${pIdx}`, consumed: 1 };

    case 'not_contains':
      params.push(`%${c.value}%`);
      return { clause: `${fieldRef} NOT ILIKE $${pIdx}`, consumed: 1 };

    case 'greater_than':
      params.push(c.value);
      return { clause: `${fieldRef} > $${pIdx}`, consumed: 1 };

    case 'less_than':
      params.push(c.value);
      return { clause: `${fieldRef} < $${pIdx}`, consumed: 1 };

    case 'greater_than_or_equal':
      params.push(c.value);
      return { clause: `${fieldRef} >= $${pIdx}`, consumed: 1 };

    case 'less_than_or_equal':
      params.push(c.value);
      return { clause: `${fieldRef} <= $${pIdx}`, consumed: 1 };

    case 'is_null':
      return { clause: `${fieldRef} IS NULL`, consumed: 0 };

    case 'is_not_null':
      return { clause: `${fieldRef} IS NOT NULL`, consumed: 0 };

    case 'this_quarter': {
      const now = new Date();
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const qEnd = new Date(qStart);
      qEnd.setMonth(qEnd.getMonth() + 3);
      params.push(qStart.toISOString(), qEnd.toISOString());
      return { clause: `${fieldRef} >= $${pIdx} AND ${fieldRef} < $${pIdx + 1}`, consumed: 2 };
    }

    case 'last_quarter': {
      const now = new Date();
      const currentQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const lastQStart = new Date(currentQStart);
      lastQStart.setMonth(lastQStart.getMonth() - 3);
      params.push(lastQStart.toISOString(), currentQStart.toISOString());
      return { clause: `${fieldRef} >= $${pIdx} AND ${fieldRef} < $${pIdx + 1}`, consumed: 2 };
    }

    case 'next_quarter': {
      const now = new Date();
      const nextQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 1);
      const nextQEnd = new Date(nextQStart);
      nextQEnd.setMonth(nextQEnd.getMonth() + 3);
      params.push(nextQStart.toISOString(), nextQEnd.toISOString());
      return { clause: `${fieldRef} >= $${pIdx} AND ${fieldRef} < $${pIdx + 1}`, consumed: 2 };
    }

    case 'trailing_30d':
      params.push(new Date(Date.now() - 30 * 86400000).toISOString());
      return { clause: `${fieldRef} >= $${pIdx}`, consumed: 1 };

    case 'trailing_90d':
      params.push(new Date(Date.now() - 90 * 86400000).toISOString());
      return { clause: `${fieldRef} >= $${pIdx}`, consumed: 1 };

    case 'custom_date_range': {
      const start = c.value?.start;
      const end   = c.value?.end;
      if (start != null && end != null) {
        params.push(new Date(start).toISOString(), new Date(end).toISOString());
        return { clause: `${fieldRef} >= $${pIdx} AND ${fieldRef} <= $${pIdx + 1}`, consumed: 2 };
      }
      if (start != null) {
        params.push(new Date(start).toISOString());
        return { clause: `${fieldRef} >= $${pIdx}`, consumed: 1 };
      }
      if (end != null) {
        params.push(new Date(end).toISOString());
        return { clause: `${fieldRef} <= $${pIdx}`, consumed: 1 };
      }
      // No bounds provided — no-op (match all)
      return { clause: 'TRUE', consumed: 0 };
    }

    default:
      params.push(c.value);
      return { clause: `${fieldRef} = $${pIdx}`, consumed: 1 };
  }
}

function buildWhereClause(
  filter: DimensionFilter,
  params: any[],
  paramOffset = 2
): { clause: string; nextParam: number } {
  let nextParam = paramOffset;

  const clauses: string[] = [];
  for (const condition of filter.conditions) {
    if ('operator' in condition && 'conditions' in condition) {
      const nested = buildWhereClause(condition as DimensionFilter, params, nextParam);
      nextParam = nested.nextParam;
      clauses.push(`(${nested.clause})`);
    } else {
      const c = condition as FilterCondition;
      const fieldRef = buildFieldReference(c);
      const { clause, consumed } = buildCondition(fieldRef, c, params, nextParam);
      nextParam += consumed;
      clauses.push(clause);
    }
  }

  const joined = clauses.length > 0 ? clauses.join(` ${filter.operator} `) : 'TRUE';
  return { clause: joined, nextParam };
}

function buildValueExpression(
  field: string,
  fieldType: string,
  transform?: ValueTransform
): string {
  const safeField = sanitizeIdentifier(field, 'amount');

  const base = fieldType === 'custom'
    ? `(d.custom_fields->>'${safeField}')::numeric`
    : `d.${safeField}`;

  if (!transform) return base;

  // Validate factor as a finite, positive number before interpolating into SQL.
  const factor = Number(transform.factor);
  if (!Number.isFinite(factor) || factor <= 0) return base;

  if (transform.type === 'multiply') {
    return `(${base} * ${factor})`;
  }
  if (transform.type === 'divide') {
    return `(${base} / ${factor})`;
  }
  return base;
}

export async function executeDefaultDimension(workspaceId: string): Promise<DimensionResult> {
  const result = await query(
    `SELECT
       COUNT(*)::int                                         AS deal_count,
       COALESCE(SUM(amount), 0)                             AS total_value,
       COALESCE(AVG(amount), 0)                             AS avg_deal_size,
       COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount), 0) AS median_deal_size,
       MIN(close_date)                                      AS earliest_close,
       MAX(close_date)                                      AS latest_close
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  );

  const row = result.rows[0];
  return {
    dimension_id:      'default',
    dimension_key:     'active_pipeline',
    dimension_label:   'Active Pipeline (default)',
    value_field:       'amount',
    value_field_label: 'Amount',
    deal_count:        Number(row.deal_count ?? 0),
    total_value:       Number(row.total_value ?? 0),
    avg_deal_size:     Number(row.avg_deal_size ?? 0),
    median_deal_size:  Number(row.median_deal_size ?? 0),
    earliest_close:    row.earliest_close ? new Date(row.earliest_close).toISOString().split('T')[0] : null,
    latest_close:      row.latest_close   ? new Date(row.latest_close).toISOString().split('T')[0]  : null,
  };
}

async function resolveQuota(workspaceId: string, dim: BusinessDimension): Promise<number | undefined> {
  if (dim.quota_source === 'manual' && dim.quota_value != null) {
    return dim.quota_value;
  }
  if (dim.quota_source === 'workspace_quota') {
    try {
      const result = await query(
        `SELECT sections->'goals_and_targets' AS goals FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
        [workspaceId]
      );
      const goals = result.rows[0]?.goals;
      if (goals) {
        if (goals.quarterly_quota) return Number(goals.quarterly_quota);
        if (goals.revenue_target)  return Number(goals.revenue_target) / 4;
        if (goals.monthly_quota)   return Number(goals.monthly_quota) * 3;
      }
    } catch {
    }
  }
  return undefined;
}

export async function executeDimension(
  workspaceId: string,
  dimensionKeyOrObject: string | BusinessDimension,
  options: ExecuteOptions = {}
): Promise<DimensionResult> {
  let dim: BusinessDimension;

  if (typeof dimensionKeyOrObject === 'string') {
    const found = await getDimension(workspaceId, dimensionKeyOrObject);
    if (!found || !found.confirmed) {
      return executeDefaultDimension(workspaceId);
    }
    dim = found;
  } else {
    dim = dimensionKeyOrObject;
    if (!dim.confirmed) {
      return executeDefaultDimension(workspaceId);
    }
  }

  const params: any[] = [workspaceId];
  const { clause, nextParam } = buildWhereClause(dim.filter_definition, params, 2);

  let fullClause = clause;
  let currentParam = nextParam;

  if (options.additionalFilters?.length) {
    const extraClauses: string[] = [];
    for (const f of options.additionalFilters) {
      const fieldRef = buildFieldReference(f);
      const { clause: ec, consumed } = buildCondition(fieldRef, f, params, currentParam);
      currentParam += consumed;
      extraClauses.push(ec);
    }
    fullClause = `(${clause}) AND ${extraClauses.join(' AND ')}`;
  }

  const valueField = options.overrideValueField ?? dim.value_field;
  const valueExpr = buildValueExpression(
    valueField,
    options.overrideValueField ? 'standard' : dim.value_field_type,
    options.overrideValueField ? undefined : dim.value_transform
  );

  const result = await query(
    `SELECT
       COUNT(*)::int                                         AS deal_count,
       COALESCE(SUM(${valueExpr}), 0)                       AS total_value,
       COALESCE(AVG(${valueExpr}), 0)                       AS avg_deal_size,
       COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${valueExpr}), 0) AS median_deal_size,
       MIN(d.close_date)                                     AS earliest_close,
       MAX(d.close_date)                                     AS latest_close
     FROM deals d
     WHERE d.workspace_id = $1
       AND ${fullClause}`,
    params
  );

  const row = result.rows[0];
  const dealCount  = Number(row.deal_count ?? 0);
  const totalValue = Number(row.total_value ?? 0);

  let quotaAmount: number | undefined;
  let coverageRatio: number | undefined;

  if (options.includeQuota) {
    quotaAmount = await resolveQuota(workspaceId, dim);
    if (quotaAmount && quotaAmount > 0) {
      coverageRatio = totalValue / quotaAmount;
    }
  }

  return {
    dimension_id:      dim.id,
    dimension_key:     dim.dimension_key,
    dimension_label:   dim.label,
    value_field:       valueField,
    value_field_label: dim.value_field_label,
    deal_count:        dealCount,
    total_value:       totalValue,
    avg_deal_size:     Number(row.avg_deal_size ?? 0),
    median_deal_size:  Number(row.median_deal_size ?? 0),
    earliest_close:    row.earliest_close ? new Date(row.earliest_close).toISOString().split('T')[0] : null,
    latest_close:      row.latest_close   ? new Date(row.latest_close).toISOString().split('T')[0]  : null,
    quota:             quotaAmount,
    coverage_ratio:    coverageRatio,
  };
}

export async function executeDimensions(
  workspaceId: string,
  dimensionKeys: string[],
  options?: ExecuteOptions
): Promise<DimensionResult[]> {
  return Promise.all(dimensionKeys.map(key => executeDimension(workspaceId, key, options)));
}

export async function previewFilter(
  workspaceId: string,
  filter: DimensionFilter,
  valueField: string,
  valueFieldType: 'standard' | 'custom'
): Promise<{ deal_count: number; total_value: number; sample_deals: any[] }> {
  const params: any[] = [workspaceId];
  const { clause } = buildWhereClause(filter, params, 2);
  const valueExpr = buildValueExpression(valueField, valueFieldType);

  const [totals, samples] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS deal_count,
              COALESCE(SUM(${valueExpr}), 0) AS total_value
       FROM deals d
       WHERE d.workspace_id = $1 AND ${clause}`,
      params
    ),
    query(
      `SELECT d.name, ${valueExpr} AS amount,
              d.stage_normalized AS stage,
              d.owner_email AS owner,
              d.close_date
       FROM deals d
       WHERE d.workspace_id = $1 AND ${clause}
       ORDER BY ${valueExpr} DESC NULLS LAST
       LIMIT 5`,
      params
    ),
  ]);

  return {
    deal_count:  Number(totals.rows[0]?.deal_count ?? 0),
    total_value: Number(totals.rows[0]?.total_value ?? 0),
    sample_deals: samples.rows.map(r => ({
      name:       r.name,
      amount:     Number(r.amount ?? 0),
      stage:      r.stage,
      owner:      r.owner,
      close_date: r.close_date ? new Date(r.close_date).toISOString().split('T')[0] : null,
    })),
  };
}
