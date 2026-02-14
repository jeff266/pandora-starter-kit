/**
 * Workspace Configuration Schema
 *
 * Centralizes all workspace-specific settings that skills need to adapt to.
 * Replaces hardcoded assumptions about pipelines, win rates, thresholds, teams, etc.
 */

// ===== META =====

export interface ConfigMeta {
  source: string;
  confidence: number;
  evidence: string;
  last_validated?: string;
}

// ===== MAIN CONFIG =====

export interface WorkspaceConfig {
  workspace_id: string;

  /** Pipeline definitions and scope */
  pipelines: PipelineConfig[];

  /** Win rate calculation rules */
  win_rate: WinRateConfig;

  /** Team structure and rep definitions */
  teams: TeamConfig;

  /** Activity tracking and weighting */
  activities: ActivityConfig;

  /** Time periods and cadence */
  cadence: CadenceConfig;

  /** Thresholds for alerts and scoring */
  thresholds: ThresholdConfig;

  /** ICP scoring dimensions */
  scoring: ScoringConfig;

  /** Last update timestamp */
  updated_at: Date;

  /** Has user reviewed and confirmed this config? */
  confirmed: boolean;
}

// ===== PIPELINE CONFIG =====

export type PipelineType = 'new_business' | 'renewal' | 'expansion' | 'partner' | 'services' | 'custom';

export interface PipelineConfig {
  /** Unique identifier for this pipeline */
  id: string;

  /** Display name */
  name: string;

  /** Pipeline type/category */
  type: PipelineType;

  /** How to identify deals in this pipeline */
  filter: {
    /** CRM field to check (e.g., "pipeline", "custom_fields->>'deal_type'") */
    field: string;
    /** Values that identify this pipeline */
    values: string[];
  };

  /** Pipeline-to-quota coverage target (e.g., 3.0 = 3x coverage) */
  coverage_target: number;

  /** Stage-specific close probabilities */
  stage_probabilities: Record<string, number>;

  /** Only count wins/losses from deals that reached this stage or later */
  qualified_stage_threshold?: string;

  /** Deal outcomes that count as losses */
  loss_values: string[];

  /** Deal outcomes that are disqualifications (not real losses) */
  disqualified_values?: string[];

  /** Include this pipeline in default skill scope? */
  included_in_default_scope: boolean;

  /** Forecast category configuration for this pipeline */
  forecast?: {
    /** Valid forecast categories */
    categories: string[];
    /** Field that stores forecast category */
    category_field: string;
  };
}

// ===== WIN RATE CONFIG =====

export interface WinRateConfig {
  /** Stage values that count as wins */
  won_values: string[];

  /** Stage values that count as losses */
  lost_values: string[];

  /** Stage values to exclude from denominator (disqualified, junk, etc.) */
  excluded_values: string[];

  /** Only count deals that reached at least this stage */
  minimum_stage?: string;

  /** Field to check for minimum stage (e.g., "stage_normalized") */
  minimum_stage_field?: string;

  /** Calculate win rate separately for these dimensions */
  segment_by?: Array<'pipeline' | 'record_type' | 'owner' | 'team' | 'deal_size_bucket' | 'source'>;

  /** Deal size buckets for segmentation */
  deal_size_buckets?: Array<{
    label: string;
    min: number;
    max: number;
  }>;

  /** Months of history to include in win rate calculation */
  lookback_months: number;
}

export interface WinRateResult {
  won: number;
  lost: number;
  excluded: number;
  rate: number;
  pipeline: string;
  lookback_months: number;
  minimum_stage: string | null;
}

// ===== TEAM CONFIG =====

export interface TeamConfig {
  /** Field that identifies the deal owner/rep */
  rep_field: string;

  /** Role definitions */
  roles: TeamRole[];

  /** Team groupings */
  groups: TeamGroup[];

  /** Owners to exclude from rep-level analysis */
  excluded_owners: string[];
}

export interface TeamRole {
  /** Role identifier (e.g., "ae", "sdr", "am", "se") */
  id: string;

  /** Display name */
  label: string;

  /** Members of this role (emails or names) */
  members: string[];

  /** OR: infer from stage ownership */
  owns_stages?: string[];

  /** Pipelines this role works */
  pipelines?: string[];

  /** Scorecard configuration for this role */
  scorecard?: {
    /** Metrics to include */
    metrics: string[];
    /** Metrics to exclude (e.g., SDRs don't have win rate) */
    excluded_metrics?: string[];
  };
}

export interface TeamGroup {
  /** Group identifier (e.g., "east", "enterprise") */
  id: string;

  /** Display name */
  label: string;

  /** Members of this group */
  members: string[];

  /** Team-level quota */
  quota?: number;
}

// ===== ACTIVITY CONFIG =====

export interface ActivityConfig {
  /** Activity types being tracked */
  tracked_types: ActivityTypeConfig[];

  /** Engagement scoring weights by activity type */
  engagement_weights: Record<string, number>;

  /** Exclude activities from internal domains? */
  exclude_internal: boolean;

  /** Domains to treat as internal */
  internal_domains: string[];

  /** Minimum activities to consider a deal "actively worked" */
  minimum_activities_for_active: number;
}

export interface ActivityTypeConfig {
  /** Activity type identifier */
  type: string;

  /** Display label */
  label: string;

  /** Importance weight (1-10) */
  weight: number;

  /** Does this activity reset the "stale deal" clock? */
  counts_as_engagement: boolean;

  /** CRM values that map to this activity type */
  crm_values: string[];
}

// ===== CADENCE CONFIG =====

export type QuotaPeriod = 'monthly' | 'quarterly' | 'annual';
export type PlanningCadence = 'weekly' | 'biweekly' | 'monthly';

export interface CadenceConfig {
  /** Quota period type */
  quota_period: QuotaPeriod;

  /** Fiscal year start month (1 = January, 4 = April, etc.) */
  fiscal_year_start_month: number;

  /** Planning/review cadence */
  planning_cadence: PlanningCadence;

  /** Week start day (0 = Sunday, 1 = Monday) */
  week_start_day: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  /** Timezone for scheduling */
  timezone: string;
}

export interface QuotaPeriodResult {
  type: QuotaPeriod;
  start: Date;
  end: Date;
  days_remaining: number;
}

// ===== THRESHOLD CONFIG =====

export interface ThresholdConfig {
  /** Days without activity before deal is "stale" (warning) */
  stale_deal_days: number | Record<string, number>;

  /** Days without activity before deal is critically stale */
  critical_stale_days: number | Record<string, number>;

  /** Pipeline coverage target (can be per-pipeline) */
  coverage_target: number | Record<string, number>;

  /** Minimum contacts required per deal (single-threading alert) */
  minimum_contacts_per_deal: number;

  /** What makes threading "distinct"? */
  threading_requires_distinct?: 'department' | 'role' | 'seniority' | 'none';

  /** Expected days in each stage (for velocity alerts) */
  expected_days_in_stage?: Record<string, number>;

  /** Required fields by object type */
  required_fields: RequiredFieldConfig[];
}

export interface RequiredFieldConfig {
  /** Field name */
  field: string;

  /** Object type */
  object: 'deals' | 'contacts' | 'leads' | 'accounts';

  /** Only required for this pipeline */
  pipeline?: string;

  /** Only required after this stage */
  stage_after?: string;
}

// ===== SCORING CONFIG =====

export type ScoringModel = 'auto' | 'custom' | 'hybrid';

export interface ScoringConfig {
  /** ICP scoring dimensions */
  icp_dimensions: ICPDimension[];

  /** Custom weight overrides */
  custom_weights?: Record<string, number>;

  /** Scoring model type */
  scoring_model: ScoringModel;
}

export interface ICPDimension {
  /** Dimension identifier */
  id: string;

  /** Display label */
  label: string;

  /** Field path to analyze */
  field: string;

  /** Data type */
  type: 'categorical' | 'numeric' | 'boolean';

  /** Importance weight (0-100) */
  weight: number;

  /** Is this dimension enabled? */
  enabled: boolean;

  /** For categorical: ideal values */
  ideal_values?: string[];

  /** For numeric: ideal range */
  ideal_range?: {
    min: number;
    max: number;
  };
}

// ===== VALIDATION =====

export interface ConfigValidationError {
  section: string;
  field: string;
  message: string;
}

/**
 * Validates a workspace configuration
 */
export function validateWorkspaceConfig(config: Partial<WorkspaceConfig>): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  // Validate pipelines
  if (config.pipelines) {
    if (config.pipelines.length === 0) {
      errors.push({ section: 'pipelines', field: 'pipelines', message: 'At least one pipeline required' });
    }

    const pipelineIds = new Set<string>();
    for (const pipeline of config.pipelines) {
      if (pipelineIds.has(pipeline.id)) {
        errors.push({
          section: 'pipelines',
          field: `pipelines.${pipeline.id}`,
          message: `Duplicate pipeline ID: ${pipeline.id}`,
        });
      }
      pipelineIds.add(pipeline.id);

      if (!pipeline.filter.field) {
        errors.push({
          section: 'pipelines',
          field: `pipelines.${pipeline.id}.filter.field`,
          message: 'Pipeline filter field is required',
        });
      }

      if (pipeline.coverage_target <= 0) {
        errors.push({
          section: 'pipelines',
          field: `pipelines.${pipeline.id}.coverage_target`,
          message: 'Coverage target must be positive',
        });
      }
    }
  }

  // Validate win rate
  if (config.win_rate) {
    if (config.win_rate.won_values.length === 0) {
      errors.push({ section: 'win_rate', field: 'won_values', message: 'At least one won value required' });
    }
    if (config.win_rate.lookback_months <= 0) {
      errors.push({
        section: 'win_rate',
        field: 'lookback_months',
        message: 'Lookback months must be positive',
      });
    }
  }

  // Validate cadence
  if (config.cadence) {
    if (config.cadence.fiscal_year_start_month < 1 || config.cadence.fiscal_year_start_month > 12) {
      errors.push({
        section: 'cadence',
        field: 'fiscal_year_start_month',
        message: 'Fiscal year start month must be 1-12',
      });
    }
  }

  return errors;
}
