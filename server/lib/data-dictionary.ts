import { query } from '../db.js';

export interface FilterCondition {
  field:        string;
  field_type:   'standard' | 'custom' | 'computed' | 'relationship';
  field_label:  string;
  operator:     FilterOperator;
  value:        any;
  value_label?: string;
}

export type FilterOperator =
  | 'equals' | 'not_equals'
  | 'in' | 'not_in'
  | 'contains' | 'not_contains'
  | 'greater_than' | 'less_than'
  | 'greater_than_or_equal' | 'less_than_or_equal'
  | 'is_null' | 'is_not_null'
  | 'this_quarter' | 'last_quarter' | 'next_quarter'
  | 'trailing_30d' | 'trailing_90d'
  | 'custom_date_range';

export interface DimensionFilter {
  operator:   'AND' | 'OR';
  conditions: Array<FilterCondition | DimensionFilter>;
}

export interface BusinessDimension {
  id:                  string;
  workspace_id:        string;
  dimension_key:       string;
  label:               string;
  description?:        string;
  filter_definition:   DimensionFilter;
  value_field:         string;
  value_field_label:   string;
  value_field_type:    'standard' | 'custom';
  value_transform?:    ValueTransform;
  quota_source:        'workspace_quota' | 'custom_field' | 'manual' | 'none';
  quota_field?:        string;
  quota_value?:        number;
  quota_period:        'annual' | 'quarterly' | 'monthly';
  target_coverage_ratio?:    number;
  target_win_rate?:          number;
  target_avg_sales_cycle?:   number;
  target_avg_deal_size?:     number;
  exclusivity:         'exclusive' | 'overlapping';
  exclusivity_group?:  string;
  parent_dimension?:   string;
  child_dimensions:    string[];
  confirmed:           boolean;
  confirmed_at?:       string;
  confirmed_value?:    number;
  confirmed_deal_count?: number;
  calibration_source?: 'interview' | 'upload' | 'manual';
  calibration_notes?:  string;
  display_order:       number;
  is_default:          boolean;
}

export interface ValueTransform {
  type:    'multiply' | 'divide' | 'formula';
  factor?: number;
  formula?: string;
}

export interface MetricDefinition {
  id:           string;
  workspace_id: string;
  metric_key:   string;
  label:        string;
  description?: string;
  formula:      MetricFormula;
  format:       string;
  unit:         string;
  dimension_overrides: Record<string, Partial<MetricFormula>>;
  threshold_critical_below?:  number;
  threshold_warning_below?:   number;
  threshold_warning_above?:   number;
  threshold_critical_above?:  number;
  confirmed:    boolean;
  confirmed_at?: string;
}

export interface MetricFormula {
  type: 'ratio' | 'count' | 'sum' | 'average' | 'median';
  numerator?: {
    dimension:    string;
    aggregate:    'sum' | 'count';
    value_field?: string;
  };
  denominator?: {
    source:     'quota' | 'dimension' | 'metric' | 'manual';
    dimension?: string;
    metric?:    string;
    value?:     number;
  };
  dimension?:       string;
  aggregate_field?: string;
  lookback_days?:   number;
  period?: 'qtd' | 'mtd' | 'trailing_30d' | 'trailing_90d';
  exclusions?:      FilterCondition[];
}

export interface CalibrationStatus {
  status: 'not_started' | 'in_progress' | 'complete';
  started_at: string | null;
  completed_at: string | null;
  sections_calibrated: string[];
  calibration_method: 'interview' | 'upload' | 'manual' | null;
  stage_mappings: Record<string, string>;
}

function rowToDimension(row: any): BusinessDimension {
  return {
    id:                  row.id,
    workspace_id:        row.workspace_id,
    dimension_key:       row.dimension_key,
    label:               row.label,
    description:         row.description ?? undefined,
    filter_definition:   typeof row.filter_definition === 'string'
                           ? JSON.parse(row.filter_definition)
                           : row.filter_definition,
    value_field:         row.value_field,
    value_field_label:   row.value_field_label,
    value_field_type:    row.value_field_type as 'standard' | 'custom',
    value_transform:     row.value_transform
                           ? (typeof row.value_transform === 'string'
                               ? JSON.parse(row.value_transform)
                               : row.value_transform)
                           : undefined,
    quota_source:        row.quota_source,
    quota_field:         row.quota_field ?? undefined,
    quota_value:         row.quota_value != null ? Number(row.quota_value) : undefined,
    quota_period:        row.quota_period ?? 'quarterly',
    target_coverage_ratio:  row.target_coverage_ratio != null ? Number(row.target_coverage_ratio) : undefined,
    target_win_rate:        row.target_win_rate != null ? Number(row.target_win_rate) : undefined,
    target_avg_sales_cycle: row.target_avg_sales_cycle != null ? Number(row.target_avg_sales_cycle) : undefined,
    target_avg_deal_size:   row.target_avg_deal_size != null ? Number(row.target_avg_deal_size) : undefined,
    exclusivity:         row.exclusivity ?? 'overlapping',
    exclusivity_group:   row.exclusivity_group ?? undefined,
    parent_dimension:    row.parent_dimension ?? undefined,
    child_dimensions:    row.child_dimensions ?? [],
    confirmed:           Boolean(row.confirmed),
    confirmed_at:        row.confirmed_at ? new Date(row.confirmed_at).toISOString() : undefined,
    confirmed_value:     row.confirmed_value != null ? Number(row.confirmed_value) : undefined,
    confirmed_deal_count: row.confirmed_deal_count != null ? Number(row.confirmed_deal_count) : undefined,
    calibration_source:  row.calibration_source ?? undefined,
    calibration_notes:   row.calibration_notes ?? undefined,
    display_order:       Number(row.display_order ?? 0),
    is_default:          Boolean(row.is_default),
  };
}

function rowToMetric(row: any): MetricDefinition {
  return {
    id:           row.id,
    workspace_id: row.workspace_id,
    metric_key:   row.metric_key,
    label:        row.label,
    description:  row.description ?? undefined,
    formula:      typeof row.formula === 'string' ? JSON.parse(row.formula) : row.formula,
    format:       row.format,
    unit:         row.unit,
    dimension_overrides: typeof row.dimension_overrides === 'string'
                           ? JSON.parse(row.dimension_overrides)
                           : (row.dimension_overrides ?? {}),
    threshold_critical_below: row.threshold_critical_below != null ? Number(row.threshold_critical_below) : undefined,
    threshold_warning_below:  row.threshold_warning_below  != null ? Number(row.threshold_warning_below)  : undefined,
    threshold_warning_above:  row.threshold_warning_above  != null ? Number(row.threshold_warning_above)  : undefined,
    threshold_critical_above: row.threshold_critical_above != null ? Number(row.threshold_critical_above) : undefined,
    confirmed:    Boolean(row.confirmed),
    confirmed_at: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : undefined,
  };
}

export async function getDimensions(
  workspaceId: string,
  options?: { confirmedOnly?: boolean }
): Promise<BusinessDimension[]> {
  try {
    const confirmedClause = options?.confirmedOnly ? 'AND confirmed = TRUE' : '';
    const result = await query(
      `SELECT * FROM business_dimensions
       WHERE workspace_id = $1
       ${confirmedClause}
       ORDER BY display_order ASC, created_at ASC`,
      [workspaceId]
    );
    return result.rows.map(rowToDimension);
  } catch (err: any) {
    console.log('[DataDictionary] getDimensions error:', err.message);
    return [];
  }
}

export async function getDimension(
  workspaceId: string,
  dimensionKey: string
): Promise<BusinessDimension | null> {
  try {
    const result = await query(
      `SELECT * FROM business_dimensions
       WHERE workspace_id = $1 AND dimension_key = $2
       LIMIT 1`,
      [workspaceId, dimensionKey]
    );
    if (result.rows.length === 0) return null;
    return rowToDimension(result.rows[0]);
  } catch (err: any) {
    console.log('[DataDictionary] getDimension error:', err.message);
    return null;
  }
}

const HARDCODED_DEFAULT_DIMENSION: BusinessDimension = {
  id:                  'default',
  workspace_id:        '',
  dimension_key:       'active_pipeline',
  label:               'Active Pipeline',
  description:         'All open deals (not closed won or closed lost)',
  filter_definition:   {
    operator: 'AND',
    conditions: [
      {
        field:       'stage',
        field_type:  'standard',
        field_label: 'Stage',
        operator:    'not_in',
        value:       ['closed_won', 'closed_lost'],
      } as FilterCondition,
    ],
  },
  value_field:         'amount',
  value_field_label:   'Amount',
  value_field_type:    'standard',
  quota_source:        'workspace_quota',
  quota_period:        'quarterly',
  exclusivity:         'overlapping',
  child_dimensions:    [],
  confirmed:           false,
  display_order:       0,
  is_default:          false,
};

export async function getDefaultDimension(
  workspaceId: string
): Promise<BusinessDimension | null> {
  try {
    // Step 1: explicitly-flagged confirmed default (best case)
    const confirmedDefault = await query(
      `SELECT * FROM business_dimensions
       WHERE workspace_id = $1 AND is_default = TRUE AND confirmed = TRUE
       ORDER BY created_at ASC
       LIMIT 1`,
      [workspaceId]
    );
    if (confirmedDefault.rows.length > 0) {
      return rowToDimension(confirmedDefault.rows[0]);
    }

    // Step 2: first confirmed dimension by display order (not necessarily flagged default)
    const firstConfirmed = await query(
      `SELECT * FROM business_dimensions
       WHERE workspace_id = $1 AND confirmed = TRUE
       ORDER BY display_order ASC, created_at ASC
       LIMIT 1`,
      [workspaceId]
    );
    if (firstConfirmed.rows.length > 0) {
      return rowToDimension(firstConfirmed.rows[0]);
    }

    // Step 3: any dimension flagged as default, even if not yet confirmed
    const unconfirmedDefault = await query(
      `SELECT * FROM business_dimensions
       WHERE workspace_id = $1 AND is_default = TRUE
       ORDER BY created_at ASC
       LIMIT 1`,
      [workspaceId]
    );
    if (unconfirmedDefault.rows.length > 0) {
      return rowToDimension(unconfirmedDefault.rows[0]);
    }

    // Step 4: hardcoded fallback (not null — ensures callers always get a usable definition)
    return { ...HARDCODED_DEFAULT_DIMENSION, workspace_id: workspaceId };
  } catch (err: any) {
    console.log('[DataDictionary] getDefaultDimension error:', err.message);
    return { ...HARDCODED_DEFAULT_DIMENSION, workspace_id: workspaceId };
  }
}

export async function getMetricDefinitions(
  workspaceId: string
): Promise<MetricDefinition[]> {
  try {
    const result = await query(
      `SELECT * FROM metric_definitions WHERE workspace_id = $1 ORDER BY created_at ASC`,
      [workspaceId]
    );
    return result.rows.map(rowToMetric);
  } catch (err: any) {
    console.log('[DataDictionary] getMetricDefinitions error:', err.message);
    return [];
  }
}

export async function getMetricDefinition(
  workspaceId: string,
  metricKey: string
): Promise<MetricDefinition | null> {
  try {
    const result = await query(
      `SELECT * FROM metric_definitions WHERE workspace_id = $1 AND metric_key = $2 LIMIT 1`,
      [workspaceId, metricKey]
    );
    if (result.rows.length === 0) return null;
    return rowToMetric(result.rows[0]);
  } catch (err: any) {
    console.log('[DataDictionary] getMetricDefinition error:', err.message);
    return null;
  }
}

export async function getStageMappings(
  workspaceId: string
): Promise<Record<string, string>> {
  try {
    const result = await query(
      `SELECT workspace_config FROM workspaces WHERE id = $1 LIMIT 1`,
      [workspaceId]
    );
    const config = result.rows[0]?.workspace_config;
    if (!config) return {};
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;
    return parsed?.calibration?.stage_mappings ?? {};
  } catch (err: any) {
    console.log('[DataDictionary] getStageMappings error:', err.message);
    return {};
  }
}

export async function getCalibrationStatus(
  workspaceId: string
): Promise<CalibrationStatus> {
  const defaultStatus: CalibrationStatus = {
    status: 'not_started',
    started_at: null,
    completed_at: null,
    sections_calibrated: [],
    calibration_method: null,
    stage_mappings: {},
  };

  try {
    const result = await query(
      `SELECT workspace_config FROM workspaces WHERE id = $1 LIMIT 1`,
      [workspaceId]
    );
    if (result.rows.length === 0) return defaultStatus;

    const row = result.rows[0];
    const config = row.workspace_config;
    const parsed = config
      ? (typeof config === 'string' ? JSON.parse(config) : config)
      : {};
    const cal = parsed?.calibration ?? {};

    const resolvedStatus = (cal.status ?? 'not_started') as CalibrationStatus['status'];

    return {
      status:               resolvedStatus,
      started_at:           cal.started_at ?? null,
      completed_at:         cal.completed_at ?? null,
      sections_calibrated:  cal.sections_calibrated ?? [],
      calibration_method:   cal.calibration_method ?? null,
      stage_mappings:       cal.stage_mappings ?? {},
    };
  } catch (err: any) {
    console.log('[DataDictionary] getCalibrationStatus error:', err.message);
    return defaultStatus;
  }
}

export async function saveDimension(
  workspaceId: string,
  dimension: Omit<BusinessDimension, 'id' | 'workspace_id'>
): Promise<BusinessDimension> {
  const result = await query(
    `INSERT INTO business_dimensions (
       workspace_id, dimension_key, label, description,
       filter_definition, value_field, value_field_label, value_field_type, value_transform,
       quota_source, quota_field, quota_value, quota_period,
       target_coverage_ratio, target_win_rate, target_avg_sales_cycle, target_avg_deal_size,
       exclusivity, exclusivity_group, parent_dimension, child_dimensions,
       confirmed, confirmed_at, confirmed_value, confirmed_deal_count,
       calibration_source, calibration_notes, display_order, is_default
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8, $9,
       $10, $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20, $21,
       $22, $23, $24, $25,
       $26, $27, $28, $29
     )
     ON CONFLICT (workspace_id, dimension_key)
     DO UPDATE SET
       label                = EXCLUDED.label,
       description          = EXCLUDED.description,
       filter_definition    = EXCLUDED.filter_definition,
       value_field          = EXCLUDED.value_field,
       value_field_label    = EXCLUDED.value_field_label,
       value_field_type     = EXCLUDED.value_field_type,
       value_transform      = EXCLUDED.value_transform,
       quota_source         = EXCLUDED.quota_source,
       quota_field          = EXCLUDED.quota_field,
       quota_value          = EXCLUDED.quota_value,
       quota_period         = EXCLUDED.quota_period,
       target_coverage_ratio    = EXCLUDED.target_coverage_ratio,
       target_win_rate          = EXCLUDED.target_win_rate,
       target_avg_sales_cycle   = EXCLUDED.target_avg_sales_cycle,
       target_avg_deal_size     = EXCLUDED.target_avg_deal_size,
       exclusivity          = EXCLUDED.exclusivity,
       exclusivity_group    = EXCLUDED.exclusivity_group,
       parent_dimension     = EXCLUDED.parent_dimension,
       child_dimensions     = EXCLUDED.child_dimensions,
       display_order        = EXCLUDED.display_order,
       is_default           = EXCLUDED.is_default,
       updated_at           = NOW()
     RETURNING *`,
    [
      workspaceId,
      dimension.dimension_key,
      dimension.label,
      dimension.description ?? null,
      JSON.stringify(dimension.filter_definition),
      dimension.value_field,
      dimension.value_field_label,
      dimension.value_field_type,
      dimension.value_transform ? JSON.stringify(dimension.value_transform) : null,
      dimension.quota_source,
      dimension.quota_field ?? null,
      dimension.quota_value ?? null,
      dimension.quota_period ?? 'quarterly',
      dimension.target_coverage_ratio ?? null,
      dimension.target_win_rate ?? null,
      dimension.target_avg_sales_cycle ?? null,
      dimension.target_avg_deal_size ?? null,
      dimension.exclusivity ?? 'overlapping',
      dimension.exclusivity_group ?? null,
      dimension.parent_dimension ?? null,
      dimension.child_dimensions ?? [],
      dimension.confirmed ?? false,
      dimension.confirmed_at ?? null,
      dimension.confirmed_value ?? null,
      dimension.confirmed_deal_count ?? null,
      dimension.calibration_source ?? null,
      dimension.calibration_notes ?? null,
      dimension.display_order ?? 0,
      dimension.is_default ?? false,
    ]
  );

  return rowToDimension(result.rows[0]);
}

export async function confirmDimension(
  workspaceId: string,
  dimensionKey: string,
  confirmedValue: number,
  confirmedDealCount: number,
  source: 'interview' | 'upload' | 'manual',
  notes?: string
): Promise<void> {
  try {
    await query(
      `UPDATE business_dimensions
       SET confirmed = TRUE,
           confirmed_at = NOW(),
           confirmed_value = $3,
           confirmed_deal_count = $4,
           calibration_source = $5,
           calibration_notes = $6,
           updated_at = NOW()
       WHERE workspace_id = $1 AND dimension_key = $2`,
      [workspaceId, dimensionKey, confirmedValue, confirmedDealCount, source, notes ?? null]
    );
  } catch (err: any) {
    console.log('[DataDictionary] confirmDimension error:', err.message);
    throw err;
  }
}

export async function saveMetricDefinition(
  workspaceId: string,
  metric: Omit<MetricDefinition, 'id' | 'workspace_id'>
): Promise<MetricDefinition> {
  const result = await query(
    `INSERT INTO metric_definitions (
       workspace_id, metric_key, label, description,
       formula, format, unit, dimension_overrides,
       threshold_critical_below, threshold_warning_below,
       threshold_warning_above, threshold_critical_above,
       confirmed, confirmed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (workspace_id, metric_key)
     DO UPDATE SET
       label                    = EXCLUDED.label,
       description              = EXCLUDED.description,
       formula                  = EXCLUDED.formula,
       format                   = EXCLUDED.format,
       unit                     = EXCLUDED.unit,
       dimension_overrides      = EXCLUDED.dimension_overrides,
       threshold_critical_below = EXCLUDED.threshold_critical_below,
       threshold_warning_below  = EXCLUDED.threshold_warning_below,
       threshold_warning_above  = EXCLUDED.threshold_warning_above,
       threshold_critical_above = EXCLUDED.threshold_critical_above,
       confirmed                = EXCLUDED.confirmed,
       confirmed_at             = EXCLUDED.confirmed_at,
       updated_at               = NOW()
     RETURNING *`,
    [
      workspaceId,
      metric.metric_key,
      metric.label,
      metric.description ?? null,
      JSON.stringify(metric.formula),
      metric.format ?? 'number',
      metric.unit ?? '$',
      JSON.stringify(metric.dimension_overrides ?? {}),
      metric.threshold_critical_below ?? null,
      metric.threshold_warning_below  ?? null,
      metric.threshold_warning_above  ?? null,
      metric.threshold_critical_above ?? null,
      metric.confirmed ?? false,
      metric.confirmed_at ?? null,
    ]
  );

  return rowToMetric(result.rows[0]);
}

export async function saveStageMappings(
  workspaceId: string,
  mappings: Record<string, string>
): Promise<void> {
  try {
    await query(
      `UPDATE workspaces
       SET workspace_config = COALESCE(workspace_config, '{}'::jsonb)
           || jsonb_build_object(
                'calibration',
                COALESCE(workspace_config->'calibration', '{}'::jsonb)
                || jsonb_build_object('stage_mappings', $2::jsonb)
              )
       WHERE id = $1`,
      [workspaceId, JSON.stringify(mappings)]
    );
  } catch (err: any) {
    console.log('[DataDictionary] saveStageMappings error:', err.message);
    throw err;
  }
}

export async function updateCalibrationStatus(
  workspaceId: string,
  status: 'not_started' | 'in_progress' | 'complete'
): Promise<void> {
  try {
    await query(
      `UPDATE workspaces
       SET calibration_status = $2,
           workspace_config = COALESCE(workspace_config, '{}'::jsonb)
             || jsonb_build_object(
                  'calibration',
                  COALESCE(workspace_config->'calibration', '{}'::jsonb)
                  || jsonb_build_object('status', $2::text)
                )
       WHERE id = $1`,
      [workspaceId, status]
    );
  } catch (err: any) {
    console.log('[DataDictionary] updateCalibrationStatus error:', err.message);
    throw err;
  }
}
