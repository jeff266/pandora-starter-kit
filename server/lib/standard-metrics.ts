/**
 * Standard Metric Library — Phase 5
 *
 * 15 canonical metrics with structured QueryDefinition expressions.
 * Used by the metric seeder to populate metric_definitions table per workspace.
 */

import type {
  QueryDefinition,
  ConditionSource,
} from '../types/workspace-intelligence.js';

export interface StandardMetricTemplate {
  metric_key: string;
  label: string;
  description: string;
  numerator: QueryDefinition;
  denominator: QueryDefinition | null;
  aggregation_method: 'ratio' | 'sum' | 'count' | 'avg' | 'days';
  unit: 'ratio' | 'currency' | 'count' | 'days' | 'percentage';
  segmentation_defaults: string[];
}

// ============================================================
// HELPER FUNCTIONS FOR BUILDING QUERY DEFINITIONS
// ============================================================

function literal(value: string | string[] | number | boolean): ConditionSource {
  return { type: 'literal', value };
}

function configRef(path: string): ConditionSource {
  return { type: 'config_ref', path };
}

function metricRef(metric_key: string): ConditionSource {
  return { type: 'metric_ref', metric_key };
}

function dateScope(
  scope: 'current_period' | 'prior_period' | 'rolling_30' | 'rolling_60' | 'rolling_90' | 'ytd' | 'custom'
): ConditionSource {
  return { type: 'date_scope', scope };
}

// ============================================================
// STANDARD METRIC LIBRARY — 15 METRICS
// ============================================================

export const STANDARD_METRIC_LIBRARY: StandardMetricTemplate[] = [
  // 1. WIN RATE
  {
    metric_key: 'win_rate',
    label: 'Win Rate',
    description:
      'Percentage of closed deals that were won (closed_won / (closed_won + closed_lost)). ' +
      'Calculated for current period. Does not include excluded/disqualified deals.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [
        { field: 'stage_normalized', operator: 'eq', value: literal('closed_won') },
      ],
      date_scope: { field: 'close_date', scope: 'current_period' },
    },
    denominator: {
      entity: 'deal',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [
        {
          field: 'stage_normalized',
          operator: 'in',
          value: literal(['closed_won', 'closed_lost']),
        },
      ],
      date_scope: { field: 'close_date', scope: 'current_period' },
    },
    aggregation_method: 'ratio',
    unit: 'ratio',
    segmentation_defaults: [],
  },

  // 2. PIPELINE COVERAGE
  {
    metric_key: 'pipeline_coverage',
    label: 'Pipeline Coverage',
    description:
      'Total pipeline value divided by remaining quota. Automatically segments by company field when ' +
      'coverage_requires_segmentation = true (Frontera fix). Active stages pulled from workspace config. ' +
      'Requires quota_remaining metric to be computed first.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'SUM', field: 'amount' },
      conditions: [
        {
          field: 'stage_normalized',
          operator: 'in',
          value: configRef('pipeline.active_stages'),
        },
      ],
    },
    denominator: null, // Uses metric_ref('quota_remaining') but can't express in simple QueryDefinition
    aggregation_method: 'ratio',
    unit: 'ratio',
    segmentation_defaults: [], // Auto-injected by compiler when coverage_requires_segmentation = true
  },

  // 3. ATTAINMENT
  {
    metric_key: 'attainment',
    label: 'Quota Attainment',
    description:
      'Closed won amount for current period. Quota value comes from targets table. ' +
      'Attainment % = closed_won / quota. Default segmentation by owner to show rep-level attainment.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'SUM', field: 'amount' },
      conditions: [
        { field: 'stage_normalized', operator: 'eq', value: literal('closed_won') },
      ],
      date_scope: { field: 'close_date', scope: 'current_period' },
    },
    denominator: null, // Quota comes from targets table, not a deal query
    aggregation_method: 'sum',
    unit: 'currency',
    segmentation_defaults: ['owner'],
  },

  // 4. AVERAGE DEAL SIZE
  {
    metric_key: 'average_deal_size',
    label: 'Average Deal Size',
    description:
      'Average amount of closed won deals in current period. ' +
      'Useful for capacity planning and pipeline coverage calculations.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'AVG', field: 'amount' },
      conditions: [
        { field: 'stage_normalized', operator: 'eq', value: literal('closed_won') },
      ],
      date_scope: { field: 'close_date', scope: 'current_period' },
    },
    denominator: null,
    aggregation_method: 'avg',
    unit: 'currency',
    segmentation_defaults: [],
  },

  // 5. SALES CYCLE
  {
    metric_key: 'sales_cycle',
    label: 'Sales Cycle Length',
    description:
      'Average days from deal creation to close for won deals in current period. ' +
      'Computed as AVG(EXTRACT(EPOCH FROM (close_date - create_date)) / 86400). ' +
      'Helps forecast deal velocity and pipeline capacity.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'AVG', field: 'EXTRACT(EPOCH FROM (close_date - create_date)) / 86400' },
      conditions: [
        { field: 'stage_normalized', operator: 'eq', value: literal('closed_won') },
      ],
      date_scope: { field: 'close_date', scope: 'current_period' },
    },
    denominator: null,
    aggregation_method: 'days',
    unit: 'days',
    segmentation_defaults: [],
  },

  // 6. EXPANSION RATE
  {
    metric_key: 'expansion_rate',
    label: 'Expansion Revenue',
    description:
      'Total closed won amount from expansion deals (deal_type matches taxonomy.expand_values). ' +
      'Requires taxonomy.expand_field and taxonomy.expand_values to be configured. ' +
      'Rate calculation requires prior period ARR as denominator context.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'SUM', field: 'amount' },
      conditions: [
        { field: 'stage_normalized', operator: 'eq', value: literal('closed_won') },
        {
          field: 'deal_type',
          operator: 'in',
          value: configRef('taxonomy.expand_values'),
        },
      ],
      date_scope: { field: 'close_date', scope: 'current_period' },
    },
    denominator: null, // Requires prior period ARR as context for rate calculation
    aggregation_method: 'sum',
    unit: 'currency',
    segmentation_defaults: [],
  },

  // 7. PIPELINE CREATED
  {
    metric_key: 'pipeline_created',
    label: 'Pipeline Created',
    description:
      'Total deal amount created in current period. Measures new pipeline generation. ' +
      'Uses create_date field for date scoping.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'SUM', field: 'amount' },
      conditions: [],
      date_scope: { field: 'create_date', scope: 'current_period' },
    },
    denominator: null,
    aggregation_method: 'sum',
    unit: 'currency',
    segmentation_defaults: [],
  },

  // 8. PIPELINE VELOCITY
  {
    metric_key: 'pipeline_velocity',
    label: 'Pipeline Velocity',
    description:
      'Derived metric: (pipeline_count × win_rate × avg_deal_size) / sales_cycle. ' +
      'Computed by the velocity skill, not by the query compiler. ' +
      'Sentinel QueryDefinition used as placeholder.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [],
    },
    denominator: null,
    aggregation_method: 'sum',
    unit: 'currency',
    segmentation_defaults: [],
  },

  // 9. STAGE CONVERSION
  {
    metric_key: 'stage_conversion',
    label: 'Stage Conversion Rate',
    description:
      'Percentage of deals progressing from one stage to the next. ' +
      'Requires per-stage parameterization at skill level. ' +
      'Uses pipeline.active_stages[0] as sentinel - actual implementation needs stage pair configuration.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [
        {
          field: 'stage_normalized',
          operator: 'eq',
          value: configRef('pipeline.active_stages'),
        },
      ],
    },
    denominator: {
      entity: 'deal',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [], // Requires prior stage filter - skill-level config needed
    },
    aggregation_method: 'ratio',
    unit: 'ratio',
    segmentation_defaults: [],
  },

  // 10. MQL TO SQL
  {
    metric_key: 'mql_to_sql',
    label: 'MQL to SQL Conversion',
    description:
      'Sales Qualified Leads divided by Marketing Qualified Leads in current period. ' +
      'Depends on contact.lifecycle_stage field being populated. ' +
      'Requires contact lifecycle stage tracking to be active.',
    numerator: {
      entity: 'contact',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [
        {
          field: 'lifecycle_stage',
          operator: 'eq',
          value: literal('salesqualifiedlead'),
        },
      ],
      date_scope: { field: 'create_date', scope: 'current_period' },
    },
    denominator: {
      entity: 'contact',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [
        {
          field: 'lifecycle_stage',
          operator: 'eq',
          value: literal('marketingqualifiedlead'),
        },
      ],
      date_scope: { field: 'create_date', scope: 'current_period' },
    },
    aggregation_method: 'ratio',
    unit: 'ratio',
    segmentation_defaults: [],
  },

  // 11. QUOTA REMAINING
  {
    metric_key: 'quota_remaining',
    label: 'Quota Remaining',
    description:
      'Amount remaining to hit quota for current period. ' +
      'Computed as quota_amount (from targets table) minus closed_won SUM. ' +
      'Requires targets table to have active rows for this workspace. ' +
      'Requires forward deployment to populate targets before this metric is meaningful.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'SUM', field: 'amount' },
      conditions: [
        { field: 'stage_normalized', operator: 'eq', value: literal('closed_won') },
      ],
      date_scope: { field: 'close_date', scope: 'current_period' },
    },
    denominator: null, // Computed as (targets.amount - numerator), not a simple query
    aggregation_method: 'sum',
    unit: 'currency',
    segmentation_defaults: [],
  },

  // 12. CALLS PER MEETING
  {
    metric_key: 'calls_per_meeting',
    label: 'Calls per Meeting',
    description:
      'Activity efficiency metric: call count divided by meeting count in current period. ' +
      'Depends on activities.type field being populated with "call" and "meeting" values. ' +
      'Useful for measuring SDR/BDR efficiency.',
    numerator: {
      entity: 'activity',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [
        { field: 'type', operator: 'eq', value: literal('call') },
      ],
      date_scope: { field: 'activity_date', scope: 'current_period' },
    },
    denominator: {
      entity: 'activity',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [
        { field: 'type', operator: 'eq', value: literal('meeting') },
      ],
      date_scope: { field: 'activity_date', scope: 'current_period' },
    },
    aggregation_method: 'ratio',
    unit: 'ratio',
    segmentation_defaults: [],
  },

  // 13. ATTAINMENT DISTRIBUTION
  {
    metric_key: 'attainment_distribution',
    label: 'Attainment Distribution',
    description:
      'Percentage of reps achieving 100%, 75%, and 50% of quota. ' +
      'Computed by the rep scorecard skill against the attainment metric per rep. ' +
      'Cannot be expressed as a simple QueryDefinition - requires aggregation over rep-level attainment values. ' +
      'Sentinel QueryDefinition used as placeholder.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'COUNT', field: null },
      conditions: [],
    },
    denominator: null,
    aggregation_method: 'count',
    unit: 'count',
    segmentation_defaults: [],
  },

  // 14. NRR (NET REVENUE RETENTION)
  {
    metric_key: 'nrr',
    label: 'Net Revenue Retention',
    description:
      'Multi-component metric: (Beginning ARR + Expansion - Contraction - Churn) / Beginning ARR. ' +
      'Requires arr_decomposed = true in calibration checklist. ' +
      'Not computable until GrowthBook-style ARR decomposition is confirmed. ' +
      'Requires expansion, contraction, and churn to be tracked separately with deal type taxonomy.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'SUM', field: 'amount' },
      conditions: [], // Complex multi-component calculation required
    },
    denominator: null,
    aggregation_method: 'ratio',
    unit: 'ratio',
    segmentation_defaults: [],
  },

  // 15. PIPELINE AT RISK
  {
    metric_key: 'pipeline_at_risk',
    label: 'Pipeline at Risk',
    description:
      'Total pipeline amount for deals in active stages with no activity in last 30 days. ' +
      'Identifies stale deals that need attention. ' +
      'Uses last_activity_date field - requires activity tracking to be enabled.',
    numerator: {
      entity: 'deal',
      aggregation: { fn: 'SUM', field: 'amount' },
      conditions: [
        {
          field: 'stage_normalized',
          operator: 'in',
          value: configRef('pipeline.active_stages'),
        },
        {
          field: 'last_activity_date',
          operator: 'lt',
          value: dateScope('rolling_30'),
        },
      ],
    },
    denominator: null,
    aggregation_method: 'sum',
    unit: 'currency',
    segmentation_defaults: [],
  },
];
