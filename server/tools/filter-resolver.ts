import { configLoader } from '../config/workspace-config-loader.js';
import { query } from '../db.js';
import type {
  NamedFilter,
  FilterConditionGroup,
  FilterCondition,
  FilterResolution,
  FilterResolutionMetadata,
  FilterValue,
  RelativeDateValue,
} from '../types/workspace-config.js';

export class FilterNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterNotFoundError';
  }
}

export class FilterResolver {

  async resolve(
    workspaceId: string,
    filterIdOrInline: string | FilterConditionGroup,
    options?: {
      table_alias?: string;
      parameter_offset?: number;
    }
  ): Promise<FilterResolution> {

    let filter: NamedFilter | null = null;
    let conditions: FilterConditionGroup;

    if (typeof filterIdOrInline === 'string') {
      const config = await configLoader.getConfig(workspaceId);
      const filters = config.named_filters || [];
      filter = filters.find(f => f.id === filterIdOrInline) || null;

      if (!filter) {
        const available = filters.map(f => f.id).join(', ') || '(none)';
        throw new FilterNotFoundError(
          `Named filter "${filterIdOrInline}" not found in workspace config. Available: ${available}`
        );
      }

      conditions = filter.conditions;

      this.recordUsage(workspaceId, filter.id).catch(() => {});
    } else {
      conditions = filterIdOrInline;
    }

    const { sql, params } = this.compileToSQL(conditions, options);

    return {
      sql,
      params,
      filter_metadata: {
        filter_id: filter?.id || '_inline',
        filter_label: filter?.label || 'Inline filter',
        filter_source: filter?.source || 'user_defined',
        confidence: filter?.confidence ?? 1.0,
        confirmed: filter?.confirmed ?? false,
        conditions_summary: this.summarizeConditions(conditions),
      },
    };
  }

  async resolveMultiple(
    workspaceId: string,
    filterIds: string[],
    options?: {
      table_alias?: string;
      parameter_offset?: number;
    }
  ): Promise<{
    sql: string;
    params: any[];
    filter_metadata: FilterResolutionMetadata[];
  }> {
    let combinedSQL = '';
    const combinedParams: any[] = [];
    const metadata: FilterResolutionMetadata[] = [];
    let offset = options?.parameter_offset ?? 1;

    for (const filterId of filterIds) {
      const resolution = await this.resolve(workspaceId, filterId, {
        table_alias: options?.table_alias,
        parameter_offset: offset,
      });
      if (resolution.sql && resolution.sql.trim()) {
        combinedSQL += ` AND (${resolution.sql})`;
        combinedParams.push(...resolution.params);
        offset += resolution.params.length;
      }
      metadata.push(resolution.filter_metadata);
    }

    return { sql: combinedSQL, params: combinedParams, filter_metadata: metadata };
  }

  private compileToSQL(
    group: FilterConditionGroup,
    options?: { table_alias?: string; parameter_offset?: number }
  ): { sql: string; params: any[] } {
    const alias = options?.table_alias ? `${options.table_alias}.` : '';
    let paramIndex = options?.parameter_offset ?? 1;
    const params: any[] = [];
    const parts: string[] = [];

    for (const condition of group.conditions) {
      if ('conditions' in condition && 'operator' in condition && Array.isArray((condition as any).conditions)) {
        const nested = this.compileToSQL(condition as FilterConditionGroup, {
          table_alias: options?.table_alias,
          parameter_offset: paramIndex,
        });
        parts.push(`(${nested.sql})`);
        params.push(...nested.params);
        paramIndex += nested.params.length;
      } else {
        const leaf = condition as FilterCondition;
        const { sql: leafSql, leafParams } = this.compileCondition(leaf, alias, paramIndex);
        parts.push(leafSql);
        params.push(...leafParams);
        paramIndex += leafParams.length;
      }
    }

    const joiner = group.operator === 'AND' ? ' AND ' : ' OR ';
    return { sql: parts.join(joiner), params };
  }

  private compileCondition(
    condition: FilterCondition,
    alias: string,
    paramIndex: number
  ): { sql: string; leafParams: any[] } {
    const field = `${alias}${condition.field}`;

    if (condition.cross_object) {
      return this.compileCrossObjectCondition(condition, alias, paramIndex);
    }

    if (this.isRelativeDate(condition.value)) {
      return this.compileRelativeDate(condition, field, paramIndex);
    }

    switch (condition.operator) {
      case 'eq':
        return { sql: `${field} = $${paramIndex}`, leafParams: [condition.value] };
      case 'neq':
        return { sql: `${field} != $${paramIndex}`, leafParams: [condition.value] };
      case 'gt':
        return { sql: `${field} > $${paramIndex}`, leafParams: [condition.value] };
      case 'gte':
        return { sql: `${field} >= $${paramIndex}`, leafParams: [condition.value] };
      case 'lt':
        return { sql: `${field} < $${paramIndex}`, leafParams: [condition.value] };
      case 'lte':
        return { sql: `${field} <= $${paramIndex}`, leafParams: [condition.value] };
      case 'in': {
        const vals = condition.value as any[];
        const placeholders = vals.map((_, i) => `$${paramIndex + i}`).join(', ');
        return { sql: `${field} IN (${placeholders})`, leafParams: vals };
      }
      case 'not_in': {
        const vals = condition.value as any[];
        const placeholders = vals.map((_, i) => `$${paramIndex + i}`).join(', ');
        return { sql: `${field} NOT IN (${placeholders})`, leafParams: vals };
      }
      case 'contains':
        return { sql: `${field} ILIKE $${paramIndex}`, leafParams: [`%${condition.value}%`] };
      case 'not_contains':
        return { sql: `${field} NOT ILIKE $${paramIndex}`, leafParams: [`%${condition.value}%`] };
      case 'is_null':
        return { sql: `${field} IS NULL`, leafParams: [] };
      case 'is_not_null':
        return { sql: `${field} IS NOT NULL`, leafParams: [] };
      case 'is_true':
        return { sql: `${field} = true`, leafParams: [] };
      case 'is_false':
        return { sql: `${field} = false`, leafParams: [] };
      case 'between': {
        const [min, max] = condition.value as [number, number];
        return { sql: `${field} BETWEEN $${paramIndex} AND $${paramIndex + 1}`, leafParams: [min, max] };
      }
      case 'relative_date':
        return this.compileRelativeDate(condition, field, paramIndex);
      default:
        throw new Error(`Unknown filter operator: ${condition.operator}`);
    }
  }

  private compileCrossObjectCondition(
    condition: FilterCondition,
    alias: string,
    paramIndex: number
  ): { sql: string; leafParams: any[] } {
    const co = condition.cross_object!;
    const subAlias = `_sub_${co.target_object}`;

    if (co.aggregate === 'count' && condition.operator === 'eq' && condition.value === 0) {
      return {
        sql: `NOT EXISTS (SELECT 1 FROM ${co.target_object} ${subAlias} WHERE ${subAlias}.${co.join_field} = ${alias}id AND ${subAlias}.workspace_id = ${alias}workspace_id)`,
        leafParams: [],
      };
    }

    const aggFn = co.aggregate || 'count';
    const aggField = condition.field === '*' ? '*' : `${subAlias}.${condition.field}`;
    const aggExpr = aggFn === 'count' ? 'COUNT(*)' : `${aggFn.toUpperCase()}(${aggField})`;

    return {
      sql: `(SELECT ${aggExpr} FROM ${co.target_object} ${subAlias} WHERE ${subAlias}.${co.join_field} = ${alias}id AND ${subAlias}.workspace_id = ${alias}workspace_id) ${this.operatorToSQL(condition.operator)} $${paramIndex}`,
      leafParams: [condition.value],
    };
  }

  private compileRelativeDate(
    condition: FilterCondition,
    field: string,
    paramIndex: number
  ): { sql: string; leafParams: any[] } {
    const val = condition.value as RelativeDateValue;
    const unit = val.unit === 'quarters' ? 'months' : val.unit;
    const offset = val.unit === 'quarters' ? Math.abs(val.offset) * 3 : Math.abs(val.offset);

    if (val.offset < 0) {
      return {
        sql: `${field} >= NOW() - INTERVAL '${offset} ${unit}'`,
        leafParams: [],
      };
    } else if (val.offset > 0) {
      return {
        sql: `${field} <= NOW() + INTERVAL '${offset} ${unit}'`,
        leafParams: [],
      };
    }
    return {
      sql: `${field} >= NOW() - INTERVAL '1 day'`,
      leafParams: [],
    };
  }

  private isRelativeDate(value: FilterValue): value is RelativeDateValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as any).type === 'relative';
  }

  private operatorToSQL(op: string): string {
    const map: Record<string, string> = {
      eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
    };
    return map[op] || '=';
  }

  summarizeConditions(group: FilterConditionGroup): string {
    const parts = group.conditions.map(c => {
      if ('conditions' in c && Array.isArray((c as any).conditions)) {
        return `(${this.summarizeConditions(c as FilterConditionGroup)})`;
      }
      const leaf = c as FilterCondition;
      const valStr = typeof leaf.value === 'object' && leaf.value !== null && !Array.isArray(leaf.value) && (leaf.value as any).type === 'relative'
        ? `last ${Math.abs((leaf.value as RelativeDateValue).offset)} ${(leaf.value as RelativeDateValue).unit}`
        : JSON.stringify(leaf.value);
      return `${leaf.field} ${leaf.operator} ${valStr}`;
    });
    return parts.join(` ${group.operator} `);
  }

  private async recordUsage(workspaceId: string, filterId: string): Promise<void> {
    try {
      await query(
        `INSERT INTO filter_usage_log (workspace_id, filter_id, used_by, used_at)
         VALUES ($1, $2, 'tool_query', NOW())`,
        [workspaceId, filterId]
      );
    } catch {
    }
  }
}

export const filterResolver = new FilterResolver();
