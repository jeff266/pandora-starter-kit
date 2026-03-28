/**
 * WorkspaceIntelligence Type Definitions
 *
 * Unified runtime object that replaces 6 competing context sources.
 * This is the canonical schema for how Pandora understands a workspace.
 */

// ============================================================
// QUERY DEFINITION — how metrics are expressed as structured queries
// ============================================================

export type AggregationFn = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';

export type ConditionSource =
  | { type: 'literal'; value: string | string[] | number | boolean }
  | { type: 'config_ref'; path: string }        // resolves from WorkspaceIntelligence
  | { type: 'metric_ref'; metric_key: string }  // another metric's computed result
  | { type: 'date_scope'; scope: DateScope };

export type DateScope =
  | 'current_period'
  | 'prior_period'
  | 'rolling_30'
  | 'rolling_60'
  | 'rolling_90'
  | 'ytd'
  | 'custom';

export type ConditionOperator =
  | 'eq' | 'neq'
  | 'in' | 'not_in'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'is_null' | 'not_null';

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: ConditionSource;
}

export interface JoinDefinition {
  entity: 'company' | 'contact';
  on: string;
  type: 'INNER' | 'LEFT';
}

export interface QueryDefinition {
  entity: 'deal' | 'company' | 'contact' | 'activity' | 'deal_stage_history';
  aggregation: {
    fn: AggregationFn;
    field: string | null;  // null for COUNT(*)
  };
  conditions: Condition[];
  joins?: JoinDefinition[];
  date_scope?: {
    field: string;
    scope: DateScope;
  };
  group_by?: string[];
}

// ============================================================
// COMPILED QUERY RESULT
// ============================================================

export type ConfidenceLevel = 'CONFIRMED' | 'INFERRED' | 'UNKNOWN';

export interface CompiledQuery {
  sql: string | null;
  params: unknown[];
  confidence: ConfidenceLevel;
  unresolved_refs: string[];   // config_ref paths that couldn't be resolved
  fallback_used: boolean;
  warnings: string[];
}

// ============================================================
// WORKSPACE INTELLIGENCE — the canonical runtime object
// ============================================================

export interface WorkspaceIntelligence {
  workspace_id: string;
  resolved_at: Date;
  cache_ttl_seconds: number;

  // WHO THEY ARE
  business: {
    gtm_motion: 'new_logo' | 'expansion' | 'hybrid' | null;
    growth_stage: 'early' | 'scaling' | 'mature' | null;
    revenue_model: 'arr' | 'bookings' | 'usage' | null;
    board_metrics: string[];
    cro_primary_concern: string | null;
    sells_multiple_products: boolean;
    products: string[];
    forecast_methodology: 'bottom_up' | 'top_down' | 'category_based' | null;
    quota_currency: 'arr' | 'bookings' | null;
    multi_year_reporting: 'tcv' | 'acv' | null;
    nrr_tracked: boolean;
  };

  // HOW THEY MEASURE
  metrics: {
    [metric_key: string]: {
      id: string;
      label: string;
      numerator: QueryDefinition;
      denominator: QueryDefinition | null;
      aggregation_method: 'ratio' | 'sum' | 'count' | 'avg' | 'days';
      unit: 'ratio' | 'currency' | 'count' | 'days' | 'percentage';
      segmentation_defaults: string[];
      confidence: ConfidenceLevel;
      confirmed_value: number | null;
      last_computed_value: number | null;
    };
  };

  // HOW THEY SEGMENT
  segmentation: {
    default_dimensions: string[];  // always required in analysis
    dimensions: {
      [key: string]: {
        crm_field: string;
        entity: 'deal' | 'company' | 'contact';
        values: string[];
        confirmed: boolean;
      };
    };
  };

  // HOW THEY CLASSIFY DEALS
  taxonomy: {
    land_field: string | null;
    land_values: string[];
    expand_field: string | null;
    expand_values: string[];
    renew_field: string | null;
    renew_values: string[];
    custom_aliases: {
      [internal_term: string]: string;  // 'SOW' → 'deal_type'
    };
  };

  // WHAT COUNTS AS PIPELINE
  pipeline: {
    active_stages: string[];
    excluded_stages: string[];
    coverage_targets: {
      [segment_or_default: string]: number;  // 'ENT': 3.5, 'default': 3.0
    };
    weighted: boolean;
    coverage_requires_segmentation: boolean;
  };

  // WHETHER TO TRUST THE DATA
  data_quality: {
    fields: {
      [field_name: string]: {
        completion_rate: number | null;
        trust_score: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
        is_trusted_for_reporting: boolean;
        last_audited: Date | null;
      };
    };
    stage_history_available: boolean;
    close_dates_reliable: boolean;
  };

  // WHAT THEY KNOW ABOUT THEMSELVES
  knowledge: {
    [domain: string]: Array<{
      key: string;
      value: string;
      source: string;
      confidence: number;
    }>;
  };

  // HOW COMPLETE THIS PICTURE IS
  readiness: {
    overall_score: number;          // 0–100
    by_domain: {
      business: number;
      metrics: number;
      segmentation: number;
      taxonomy: number;
      pipeline: number;
      data_quality: number;
    };
    blocking_gaps: string[];        // question_ids that are UNKNOWN and block live skills
    skill_gates: {
      [skill_id: string]: 'LIVE' | 'DRAFT' | 'BLOCKED';
    };
  };
}

// ============================================================
// SKILL MANIFEST — dependency declaration per skill
// ============================================================

export interface SkillManifest {
  skill_id: string;
  required_checklist_items: string[];   // must be CONFIRMED to run LIVE
  preferred_checklist_items: string[];  // degrades gracefully if UNKNOWN
  required_metric_keys: string[];       // metric_definitions that must exist
  fallback_behavior: 'draft_mode' | 'block' | 'warn';
}

export interface SkillGateResult {
  gate: 'LIVE' | 'DRAFT' | 'BLOCKED';
  missing_required: string[];
  missing_preferred: string[];
  warnings: string[];
}

// ============================================================
// DATABASE ROW TYPES — for type-safe queries
// ============================================================

export interface MetricDefinitionRow {
  id: string;
  workspace_id: string;
  metric_key: string;
  label: string;
  description: string | null;
  numerator: any; // JSONB
  denominator: any | null; // JSONB
  aggregation_method: 'ratio' | 'sum' | 'count' | 'avg' | 'days';
  unit: 'ratio' | 'currency' | 'count' | 'days' | 'percentage';
  segmentation_defaults: string[] | null;
  confidence: 'CONFIRMED' | 'INFERRED' | 'UNKNOWN';
  confirmed_by: string | null;
  confirmed_at: Date | null;
  confirmed_value: number | null;
  last_computed_value: number | null;
  last_computed_at: Date | null;
  source: 'SYSTEM' | 'FORWARD_DEPLOY' | 'INFERRED' | 'USER';
  created_at: Date;
  updated_at: Date;
}

export interface CalibrationChecklistRow {
  id: string;
  workspace_id: string;
  question_id: string;
  domain: 'business' | 'metrics' | 'taxonomy' | 'pipeline' | 'segmentation' | 'data_quality';
  question: string;
  answer: any | null; // JSONB
  answer_source: 'TRANSCRIPT' | 'DOCUMENT' | 'CRM_SCAN' | 'FORWARD_DEPLOY' | 'CONFIRMATION_LOOP' | 'USER' | null;
  status: 'CONFIRMED' | 'INFERRED' | 'UNKNOWN' | 'BLOCKED';
  confidence: number;
  depends_on: string[] | null;
  skill_dependencies: string[] | null;
  pandora_computed_answer: any | null; // JSONB
  human_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BusinessDimensionRow {
  id: string;
  workspace_id: string;
  dimension_key: string;
  label: string;
  description: string | null;
  filter_definition: any; // JSONB
  entity: 'deal' | 'company' | 'contact';
  crm_field: string | null;
  crm_values: string[] | null;
  confirmed: boolean;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceKnowledgeRow {
  id: string;
  workspace_id: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  domain: 'business' | 'metrics' | 'taxonomy' | 'pipeline' | 'segmentation' | 'data_quality' | 'general' | null;
  structured_ref: string | null; // UUID
  used_count: number;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DataDictionaryRow {
  id: string;
  workspace_id: string;
  term: string;
  definition: string | null;
  technical_definition: string | null;
  sql_definition: string | null;
  completion_rate: number | null;
  trust_score: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  trust_reason: string | null;
  last_audited: Date | null;
  is_trusted_for_reporting: boolean;
  source: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TargetRow {
  id: string;
  workspace_id: string;
  metric: string;
  period_type: 'annual' | 'quarterly' | 'monthly';
  period_start: Date;
  period_end: Date;
  period_label: string;
  amount: number;
  segment_scope: string | null;
  deal_type_scope: string | null;
  set_by: string | null;
  set_at: Date | null;
  notes: string | null;
  is_active: boolean;
  supersedes_id: string | null;
  created_at: Date;
}

// ============================================================
// CALIBRATION QUESTION — for 100-question bank
// ============================================================

export interface CalibrationQuestion {
  question_id: string;
  domain: 'business' | 'metrics' | 'taxonomy' | 'pipeline' | 'segmentation' | 'data_quality';
  question: string;
  skill_dependencies: string[];
  depends_on: string[];
  answer_schema?: {
    type: 'text' | 'array' | 'object' | 'boolean' | 'enum';
    enum_values?: string[];
    fields?: Record<string, string>; // for object types
  };
}
