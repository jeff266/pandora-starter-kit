/**
 * Tool Filter Injector
 *
 * Injects workspace tool filter config into SQL queries.
 * Reads tool_filters from workspace config and builds WHERE clause fragments.
 */

import { configLoader } from './workspace-config-loader.js';
import type { FilterRule } from '../types/workspace-config.js';

export type MetricContext = 'win_rate' | 'pipeline_value' | 'forecast' | 'velocity' | 'activity' | 'general';

export interface ToolFilterResult {
  whereClause: string;
  params: any[];
  paramOffset: number;
  appliedRules: string[];
}

/**
 * Build a SQL WHERE clause fragment from a FilterRule
 */
function buildRuleClause(
  rule: FilterRule,
  paramOffset: number,
  tableAlias: string
): { clause: string; params: any[]; nextOffset: number } {
  let fieldRef: string;
  if (rule.field.startsWith('custom_fields.')) {
    const key = rule.field.replace('custom_fields.', '');
    fieldRef = `${tableAlias}.custom_fields->>'${key}'`;
  } else {
    fieldRef = `${tableAlias}.${rule.field}`;
  }

  switch (rule.operator) {
    case 'eq':
      return {
        clause: `${fieldRef} = $${paramOffset}`,
        params: [rule.value],
        nextOffset: paramOffset + 1,
      };
    case 'neq':
      return {
        clause: `${fieldRef} != $${paramOffset}`,
        params: [rule.value],
        nextOffset: paramOffset + 1,
      };
    case 'contains':
      return {
        clause: `${fieldRef} ILIKE $${paramOffset}`,
        params: [`%${rule.value}%`],
        nextOffset: paramOffset + 1,
      };
    case 'in':
      if (Array.isArray(rule.value) && rule.value.length > 0) {
        const placeholders = rule.value.map((_: any, i: number) => `$${paramOffset + i}`).join(', ');
        return {
          clause: `${fieldRef} IN (${placeholders})`,
          params: rule.value as any[],
          nextOffset: paramOffset + (rule.value as any[]).length,
        };
      }
      return { clause: 'false', params: [], nextOffset: paramOffset };
    case 'not_in':
      if (Array.isArray(rule.value) && rule.value.length > 0) {
        const placeholders = rule.value.map((_: any, i: number) => `$${paramOffset + i}`).join(', ');
        return {
          clause: `${fieldRef} NOT IN (${placeholders})`,
          params: rule.value as any[],
          nextOffset: paramOffset + (rule.value as any[]).length,
        };
      }
      return { clause: 'true', params: [], nextOffset: paramOffset };
    case 'gt':
      return {
        clause: `${fieldRef}::numeric > $${paramOffset}`,
        params: [rule.value],
        nextOffset: paramOffset + 1,
      };
    case 'lt':
      return {
        clause: `${fieldRef}::numeric < $${paramOffset}`,
        params: [rule.value],
        nextOffset: paramOffset + 1,
      };
    case 'is_null':
      return { clause: `${fieldRef} IS NULL`, params: [], nextOffset: paramOffset };
    case 'is_not_null':
      return { clause: `${fieldRef} IS NOT NULL`, params: [], nextOffset: paramOffset };
    default:
      return { clause: 'true', params: [], nextOffset: paramOffset };
  }
}

/**
 * Get the tool filter WHERE clause for a given workspace and metric context.
 *
 * @param workspaceId - The workspace ID
 * @param metricContext - Which metric context to apply filters for
 * @param paramOffset - Starting parameter index (e.g. values.length + 1)
 * @param tableAlias - SQL table alias for the deals table (default: 'd')
 * @returns ToolFilterResult with whereClause (starting with AND if non-empty), params, and appliedRules
 */
export async function getToolFilters(
  workspaceId: string,
  metricContext: MetricContext,
  paramOffset: number,
  tableAlias: string = 'd'
): Promise<ToolFilterResult> {
  const config = await configLoader.getConfig(workspaceId);
  const toolFilters = config.tool_filters;

  if (!toolFilters) {
    return { whereClause: '', params: [], paramOffset, appliedRules: [] };
  }

  const clauses: string[] = [];
  const params: any[] = [];
  const appliedRules: string[] = [];
  let currentOffset = paramOffset;

  // ── Global stage exclusions ──────────────────────────────────────────────
  const globalExcludeStages = toolFilters.global?.exclude_stages || [];
  if (globalExcludeStages.length > 0) {
    const placeholders = globalExcludeStages.map((_: string, i: number) => `$${currentOffset + i}`).join(', ');
    clauses.push(`${tableAlias}.stage NOT IN (${placeholders})`);
    params.push(...globalExcludeStages);
    currentOffset += globalExcludeStages.length;
    appliedRules.push(`global.exclude_stages: ${globalExcludeStages.join(', ')}`);
  }

  // ── Global pipeline exclusions ───────────────────────────────────────────
  const globalExcludePipelines = toolFilters.global?.exclude_pipelines || [];
  if (globalExcludePipelines.length > 0) {
    const placeholders = globalExcludePipelines.map((_: string, i: number) => `$${currentOffset + i}`).join(', ');
    clauses.push(`${tableAlias}.pipeline NOT IN (${placeholders})`);
    params.push(...globalExcludePipelines);
    currentOffset += globalExcludePipelines.length;
    appliedRules.push(`global.exclude_pipelines: ${globalExcludePipelines.join(', ')}`);
  }

  // ── Global custom exclusion rules ────────────────────────────────────────
  const globalCustomExclusions: FilterRule[] = toolFilters.global?.custom_exclusions || [];
  for (const rule of globalCustomExclusions) {
    const { clause, params: ruleParams, nextOffset } = buildRuleClause(rule, currentOffset, tableAlias);
    if (ruleParams.length > 0 || rule.operator === 'is_null' || rule.operator === 'is_not_null') {
      clauses.push(`NOT (${clause})`);
      params.push(...ruleParams);
      currentOffset = nextOffset;
      appliedRules.push(`global.custom_exclusion: ${rule.label || rule.id}`);
    }
  }

  // ── Metric-specific overrides ────────────────────────────────────────────
  if (metricContext !== 'general') {
    const override = toolFilters.metric_overrides?.[metricContext];
    if (override?.enabled) {
      // Metric-specific stage exclusions
      const metricExcludeStages = override.exclude_stages || [];
      if (metricExcludeStages.length > 0) {
        const placeholders = metricExcludeStages.map((_: string, i: number) => `$${currentOffset + i}`).join(', ');
        clauses.push(`${tableAlias}.stage NOT IN (${placeholders})`);
        params.push(...metricExcludeStages);
        currentOffset += metricExcludeStages.length;
        appliedRules.push(`${metricContext}.exclude_stages: ${metricExcludeStages.join(', ')}`);
      }

      // Metric-specific additional exclusion rules
      const additionalExclusions: FilterRule[] = override.additional_exclusions || [];
      for (const rule of additionalExclusions) {
        const { clause, params: ruleParams, nextOffset } = buildRuleClause(rule, currentOffset, tableAlias);
        if (ruleParams.length > 0 || rule.operator === 'is_null' || rule.operator === 'is_not_null') {
          clauses.push(`NOT (${clause})`);
          params.push(...ruleParams);
          currentOffset = nextOffset;
          appliedRules.push(`${metricContext}.additional_exclusion: ${rule.label || rule.id}`);
        }
      }
    }
  }

  const whereClause = clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '';

  return {
    whereClause,
    params,
    paramOffset: currentOffset,
    appliedRules,
  };
}
