/**
 * Skill Dimension Resolver
 *
 * Shared framework for all 38 skills to resolve business dimensions.
 * Implements 4-step fallback: explicit key → default → first confirmed → hardcoded.
 * Keeps skill wiring DRY and ensures consistent fallback behavior.
 */

import { query } from '../db.js';
import {
  getDimension,
  getDimensions,
  getDefaultDimension,
  type BusinessDimension,
  type DimensionFilter,
  type FilterCondition,
  type ValueTransform,
} from './data-dictionary.js';

export type SkillCategory =
  | 'pipeline'      // active pipeline definition
  | 'forecast'      // forecast/commit definition
  | 'rep'           // rep-scoped queries
  | 'deal'          // deal-level queries
  | 'leads'         // lead/contact queries
  | 'activities';   // activity queries

export interface SkillDimensionContext {
  // The resolved dimension (confirmed or default)
  dimension_key:    string;
  dimension_label:  string;
  // Whether this came from a confirmed calibration
  calibrated:       boolean;
  // The SQL WHERE clause fragment to inject into skill queries
  where_clause:     string;
  params:           any[];
  param_offset:     number;
  // The value field to use (may differ from amount)
  value_field:      string;
  value_expression: string;
  // quota if the skill needs it
  quota?:           number;
}

interface ResolveOptions {
  dimensionKey?:   string;        // Explicit override from MCP tool param
  skillCategory?:  SkillCategory; // Hint for which default dimension to use
  includeQuota?:   boolean;       // Whether to resolve quota
  paramOffset?:    number;        // Starting param index for SQL ($1 = workspaceId)
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
  console.warn(`[SkillDimensionResolver] Unsafe identifier rejected: "${name}", using fallback "${fallback}"`);
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
      return { clause: 'TRUE', consumed: 0 };
    }

    default:
      params.push(c.value);
      return { clause: `${fieldRef} = $${pIdx}`, consumed: 1 };
  }
}

function buildWhereClauseInternal(
  filter: DimensionFilter,
  params: any[],
  paramOffset = 2
): { clause: string; nextParam: number } {
  let nextParam = paramOffset;

  const clauses: string[] = [];
  for (const condition of filter.conditions) {
    if ('operator' in condition && 'conditions' in condition) {
      const nested = buildWhereClauseInternal(condition as DimensionFilter, params, nextParam);
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

function buildValueExpressionInternal(
  field: string,
  fieldType: string,
  transform?: ValueTransform
): string {
  const safeField = sanitizeIdentifier(field, 'amount');

  const base = fieldType === 'custom'
    ? `(d.custom_fields->>'${safeField}')::numeric`
    : `d.${safeField}`;

  if (!transform) return base;

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

async function resolveQuotaInternal(workspaceId: string, dim: BusinessDimension): Promise<number | undefined> {
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
      // Silent fail - quota is optional
    }
  }
  return undefined;
}

function buildHardcodedDefault(
  workspaceId: string,
  options: ResolveOptions
): SkillDimensionContext {
  // The fallback that was hardcoded before Phase 1.
  // Used only for uncalibrated workspaces.
  return {
    dimension_key:   '_default',
    dimension_label: 'All Open Pipeline',
    calibrated:      false,
    where_clause:    "d.stage_normalized NOT IN ('closed_won', 'closed_lost')",
    params:          [],
    param_offset:    options.paramOffset ?? 2,
    value_field:     'amount',
    value_expression: 'd.amount',
    quota:           undefined,
  };
}

/**
 * Primary function — all skills call this.
 *
 * Implements 4-step fallback:
 * 1. Explicit dimension key (MCP override)
 * 2. Confirmed default dimension
 * 3. First confirmed dimension of any kind
 * 4. Hardcoded default (no calibration at all)
 */
export async function resolveSkillDimension(
  workspaceId: string,
  options: ResolveOptions = {}
): Promise<SkillDimensionContext> {
  let dim: BusinessDimension | null = null;

  // Step 1: Explicit dimension key (MCP override)
  if (options.dimensionKey) {
    dim = await getDimension(workspaceId, options.dimensionKey);
  }

  // Step 2: Confirmed default dimension
  if (!dim) {
    const defaultDim = await getDefaultDimension(workspaceId);
    if (defaultDim && defaultDim.confirmed) {
      dim = defaultDim;
    }
  }

  // Step 3: First confirmed dimension of any kind
  if (!dim) {
    const all = await getDimensions(workspaceId, { confirmedOnly: true });
    dim = all[0] ?? null;
  }

  // Step 4: Hardcoded default (no calibration at all)
  if (!dim || !dim.confirmed) {
    return buildHardcodedDefault(workspaceId, options);
  }

  // Build the WHERE clause and value expression from the confirmed dimension
  const offset = options.paramOffset ?? 2;
  const params: any[] = [];
  const { clause, nextParam } = buildWhereClauseInternal(
    dim.filter_definition,
    params,
    offset
  );
  const valueExpr = buildValueExpressionInternal(
    dim.value_field,
    dim.value_field_type,
    dim.value_transform
  );

  let quota: number | undefined;
  if (options.includeQuota) {
    quota = await resolveQuotaInternal(workspaceId, dim);
  }

  return {
    dimension_key:    dim.dimension_key,
    dimension_label:  dim.label,
    calibrated:       true,
    where_clause:     clause,
    params,
    param_offset:     nextParam,
    value_field:      dim.value_field,
    value_expression: valueExpr,
    quota,
  };
}
