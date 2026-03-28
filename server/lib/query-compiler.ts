/**
 * WorkspaceIntelligence Query Compiler — Phase 4
 *
 * Pure, synchronous function. No DB calls. No async.
 * Takes a QueryDefinition + resolved WorkspaceIntelligence → parameterized SQL.
 */

import type {
  QueryDefinition,
  CompiledQuery,
  ConditionSource,
  ConditionOperator,
  WorkspaceIntelligence,
  ConfidenceLevel,
  Condition,
  DateScope,
} from '../types/workspace-intelligence.js';

// ============================================================
// ENTITY TABLE MAPPING
// ============================================================

const ENTITY_TABLE: Record<string, string> = {
  deal: 'deals',
  company: 'companies',
  contact: 'contacts',
  activity: 'activities',
  deal_stage_history: 'deal_stage_history',
};

// ============================================================
// EXTENDED CONDITION TYPE (local only — adds optional flag)
// ============================================================

type OptionalCondition = Condition & { optional?: boolean };

// Input definition allows optional flag on any condition
type QueryDefinitionInput = Omit<QueryDefinition, 'conditions'> & {
  conditions: OptionalCondition[];
};

// ============================================================
// DOT-PATH RESOLVER
// ============================================================

function resolveDotPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

// ============================================================
// CONFIDENCE INFERENCE FROM DOMAIN PATH
// ============================================================

function inferConfidenceFromPath(
  path: string,
  wi: WorkspaceIntelligence
): ConfidenceLevel {
  const domain = path.split('.')[0];
  switch (domain) {
    case 'pipeline':
      return wi.readiness.by_domain.pipeline > 50 ? 'CONFIRMED' : 'INFERRED';
    case 'segmentation':
      return wi.readiness.by_domain.segmentation > 50 ? 'CONFIRMED' : 'INFERRED';
    case 'taxonomy':
      return wi.readiness.by_domain.taxonomy > 50 ? 'CONFIRMED' : 'INFERRED';
    case 'metrics': {
      const parts = path.split('.');
      if (parts.length >= 2) {
        const metricKey = parts[1];
        return wi.metrics[metricKey]?.confidence ?? 'INFERRED';
      }
      return 'INFERRED';
    }
    default:
      return 'INFERRED';
  }
}

// ============================================================
// DATE SCOPE RESOLVER
// ============================================================

function resolveDateScope(scope: DateScope): { start: Date; end: Date } {
  const now = new Date();
  const endOfToday = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999
  );
  const startOfToday = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0
  );

  switch (scope) {
    case 'current_period': {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return {
        start: new Date(now.getFullYear(), qStartMonth, 1),
        end: endOfToday,
      };
    }
    case 'prior_period': {
      const currentQStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const priorQStartMonth = currentQStartMonth - 3;
      const priorYear =
        priorQStartMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const priorMonthNorm = ((priorQStartMonth % 12) + 12) % 12;
      return {
        start: new Date(priorYear, priorMonthNorm, 1),
        end: new Date(now.getFullYear(), currentQStartMonth, 0, 23, 59, 59, 999),
      };
    }
    case 'rolling_30':
      return {
        start: new Date(startOfToday.getTime() - 30 * 86400000),
        end: endOfToday,
      };
    case 'rolling_60':
      return {
        start: new Date(startOfToday.getTime() - 60 * 86400000),
        end: endOfToday,
      };
    case 'rolling_90':
      return {
        start: new Date(startOfToday.getTime() - 90 * 86400000),
        end: endOfToday,
      };
    case 'ytd':
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: endOfToday,
      };
    case 'custom':
    default:
      return { start: new Date(now.getFullYear(), 0, 1), end: endOfToday };
  }
}

// ============================================================
// CONDITION SOURCE RESOLVER
// ============================================================

interface ResolvedValue {
  value: unknown;
  confidence: ConfidenceLevel;
  resolved: boolean;
}

function resolveConditionSource(
  source: ConditionSource,
  wi: WorkspaceIntelligence
): ResolvedValue {
  switch (source.type) {
    case 'literal':
      return { value: source.value, confidence: 'CONFIRMED', resolved: true };

    case 'config_ref': {
      const value = resolveDotPath(wi, source.path);
      const isEmpty =
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0);
      if (isEmpty) {
        return { value: undefined, confidence: 'UNKNOWN', resolved: false };
      }
      return {
        value,
        confidence: inferConfidenceFromPath(source.path, wi),
        resolved: true,
      };
    }

    case 'metric_ref': {
      const metric = wi.metrics[source.metric_key];
      if (
        !metric ||
        metric.last_computed_value === null ||
        metric.last_computed_value === undefined
      ) {
        return { value: undefined, confidence: 'UNKNOWN', resolved: false };
      }
      return {
        value: metric.last_computed_value,
        confidence: metric.confidence,
        resolved: true,
      };
    }

    case 'date_scope': {
      const dates = resolveDateScope(source.scope);
      return { value: dates, confidence: 'CONFIRMED', resolved: true };
    }

    default:
      return { value: undefined, confidence: 'UNKNOWN', resolved: false };
  }
}

// ============================================================
// CONFIDENCE MERGE
// ============================================================

function mergeConfidence(levels: ConfidenceLevel[]): ConfidenceLevel {
  if (levels.length === 0) return 'CONFIRMED';
  if (levels.includes('UNKNOWN')) return 'UNKNOWN';
  if (levels.includes('INFERRED')) return 'INFERRED';
  return 'CONFIRMED';
}

// ============================================================
// SQL OPERATOR MAPPING
// ============================================================

function operatorToSQL(
  op: ConditionOperator,
  field: string,
  paramIdx: number
): { clause: string; hasParam: boolean } {
  switch (op) {
    case 'eq':      return { clause: `${field} = $${paramIdx}`,      hasParam: true };
    case 'neq':     return { clause: `${field} != $${paramIdx}`,     hasParam: true };
    case 'in':      return { clause: `${field} = ANY($${paramIdx})`, hasParam: true };
    case 'not_in':  return { clause: `${field} != ALL($${paramIdx})`,hasParam: true };
    case 'gt':      return { clause: `${field} > $${paramIdx}`,      hasParam: true };
    case 'lt':      return { clause: `${field} < $${paramIdx}`,      hasParam: true };
    case 'gte':     return { clause: `${field} >= $${paramIdx}`,     hasParam: true };
    case 'lte':     return { clause: `${field} <= $${paramIdx}`,     hasParam: true };
    case 'is_null': return { clause: `${field} IS NULL`,             hasParam: false };
    case 'not_null':return { clause: `${field} IS NOT NULL`,         hasParam: false };
    default:        return { clause: `${field} = $${paramIdx}`,      hasParam: true };
  }
}

// ============================================================
// SQL BUILDER (pure, no DB calls)
// ============================================================

interface ReadyCondition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

function buildSQL(
  definition: QueryDefinitionInput,
  workspaceId: string,
  readyConditions: ReadyCondition[],
  dateRange: { start: Date; end: Date } | null,
  wi: WorkspaceIntelligence
): { sql: string; params: unknown[]; warnings: string[] } {
  const warnings: string[] = [];
  const params: unknown[] = [workspaceId]; // $1 always
  let paramIdx = 2;

  const table = ENTITY_TABLE[definition.entity] ?? definition.entity;

  // SELECT clause
  const { fn, field } = definition.aggregation;
  let selectClause: string;
  if (fn === 'COUNT' && field === null) {
    selectClause = 'COUNT(*)';
  } else if (fn === 'COUNT_DISTINCT' && field) {
    selectClause = `COUNT(DISTINCT ${field})`;
  } else if (field) {
    selectClause = `${fn}(${field})`;
  } else {
    selectClause = 'COUNT(*)';
  }

  // JOIN clauses — explicit joins from definition
  const joinLines: string[] = [];
  let hasCompanyJoin = false;
  for (const join of definition.joins ?? []) {
    const joinTable = ENTITY_TABLE[join.entity] ?? join.entity;
    joinLines.push(`${join.type} JOIN ${joinTable} ON ${join.on}`);
    if (join.entity === 'company') hasCompanyJoin = true;
  }

  // Auto-inject company join for segmented pipeline queries
  let autoSegmentField: string | null = null;
  if (
    definition.entity === 'deal' &&
    wi.pipeline.coverage_requires_segmentation &&
    !hasCompanyJoin
  ) {
    const confirmedCompanyDim = Object.entries(wi.segmentation.dimensions).find(
      ([, dim]) => dim.entity === 'company' && dim.confirmed && dim.crm_field
    );
    if (confirmedCompanyDim) {
      const [, dim] = confirmedCompanyDim;
      autoSegmentField = `companies.${dim.crm_field}`;
      joinLines.push(`LEFT JOIN companies ON deals.company_id = companies.id`);
      warnings.push(
        `Segmentation auto-injected: pipeline requires breakdown by segment (${dim.crm_field})`
      );
    }
  }

  // WHERE clause — workspace_id always first
  const whereClauses: string[] = ['workspace_id = $1'];
  for (const cond of readyConditions) {
    const { clause, hasParam } = operatorToSQL(cond.operator, cond.field, paramIdx);
    whereClauses.push(clause);
    if (hasParam) {
      params.push(cond.value);
      paramIdx++;
    }
  }

  // Date scope WHERE conditions
  if (dateRange && definition.date_scope) {
    whereClauses.push(`${definition.date_scope.field} >= $${paramIdx}`);
    params.push(dateRange.start);
    paramIdx++;
    whereClauses.push(`${definition.date_scope.field} <= $${paramIdx}`);
    params.push(dateRange.end);
    paramIdx++;
  }

  // GROUP BY
  const groupByClauses: string[] = [...(definition.group_by ?? [])];
  if (autoSegmentField) {
    groupByClauses.push(autoSegmentField);
  }

  // Assemble
  let sql = `SELECT ${selectClause} FROM ${table}`;
  if (joinLines.length > 0) {
    sql += '\n' + joinLines.join('\n');
  }
  sql += '\nWHERE ' + whereClauses.join(' AND ');
  if (groupByClauses.length > 0) {
    sql += '\nGROUP BY ' + groupByClauses.join(', ');
  }

  return { sql, params, warnings };
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function compileQuery(
  definition: QueryDefinitionInput,
  wi: WorkspaceIntelligence
): CompiledQuery {
  const allConfidenceLevels: ConfidenceLevel[] = [];
  const unresolved_refs: string[] = [];
  const warnings: string[] = [];
  let hasRequiredUnresolved = false;

  // Resolve top-level date_scope
  let dateRange: { start: Date; end: Date } | null = null;
  if (definition.date_scope) {
    const resolved = resolveConditionSource(
      { type: 'date_scope', scope: definition.date_scope.scope },
      wi
    );
    allConfidenceLevels.push(resolved.confidence);
    if (resolved.resolved) {
      dateRange = resolved.value as { start: Date; end: Date };
    }
  }

  // Resolve each condition
  const readyConditions: ReadyCondition[] = [];

  for (const condition of definition.conditions) {
    const isOptional = condition.optional === true;
    const resolved = resolveConditionSource(condition.value, wi);
    allConfidenceLevels.push(resolved.confidence);

    if (!resolved.resolved) {
      // Record what couldn't be resolved
      if (condition.value.type === 'config_ref') {
        unresolved_refs.push(condition.value.path);
        warnings.push(
          `config_ref '${condition.value.path}' is empty or missing — ` +
          (isOptional ? 'condition skipped (optional)' : 'query blocked (required)')
        );
      } else if (condition.value.type === 'metric_ref') {
        unresolved_refs.push(condition.value.metric_key);
        warnings.push(
          `metric_ref '${condition.value.metric_key}' has no computed value — ` +
          (isOptional ? 'condition skipped (optional)' : 'query blocked (required)')
        );
      }

      if (!isOptional) {
        hasRequiredUnresolved = true;
      }
      continue; // Do not include in SQL
    }

    readyConditions.push({
      field: condition.field,
      operator: condition.operator,
      value: resolved.value,
    });
  }

  // Any required unresolved → null SQL
  if (hasRequiredUnresolved) {
    return {
      sql: null,
      params: [],
      confidence: mergeConfidence(allConfidenceLevels),
      unresolved_refs,
      fallback_used: unresolved_refs.length > 0,
      warnings,
    };
  }

  // Build the SQL
  const { sql, params, warnings: buildWarnings } = buildSQL(
    definition,
    wi.workspace_id,
    readyConditions,
    dateRange,
    wi
  );
  warnings.push(...buildWarnings);

  return {
    sql,
    params,
    confidence: mergeConfidence(
      allConfidenceLevels.length > 0 ? allConfidenceLevels : ['CONFIRMED']
    ),
    unresolved_refs,
    fallback_used: unresolved_refs.length > 0,
    warnings,
  };
}

export type { CompiledQuery };
