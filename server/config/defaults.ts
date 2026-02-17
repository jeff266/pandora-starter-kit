import type { WorkspaceConfig } from '../types/workspace-config.js';

export function getDefaultConfig(workspaceId: string): WorkspaceConfig & { _meta: Record<string, any> } {
  return {
    workspace_id: workspaceId,
    pipelines: [
      {
        id: 'default',
        name: 'All Deals',
        type: 'new_business',
        filter: { field: '1', values: ['1'] },
        coverage_target: 3.0,
        stage_probabilities: {},
        loss_values: ['closed_lost'],
        included_in_default_scope: true,
      },
    ],
    win_rate: {
      won_values: ['closed_won'],
      lost_values: ['closed_lost'],
      excluded_values: [],
      lookback_months: 6,
    },
    teams: {
      rep_field: 'owner_email',
      roles: [],
      groups: [],
      excluded_owners: [],
    },
    activities: {
      tracked_types: [],
      engagement_weights: {
        meeting: 10,
        call: 5,
        email: 2,
        note: 1,
      },
      exclude_internal: false,
      internal_domains: [],
      minimum_activities_for_active: 1,
    },
    cadence: {
      quota_period: 'monthly',
      fiscal_year_start_month: 1,
      planning_cadence: 'weekly',
      week_start_day: 1,
      timezone: 'America/New_York',
    },
    thresholds: {
      stale_deal_days: 14,
      critical_stale_days: 30,
      coverage_target: 3.0,
      minimum_contacts_per_deal: 2,
      required_fields: [
        { field: 'amount', object: 'deals' },
        { field: 'close_date', object: 'deals' },
      ],
    },
    scoring: {
      icp_dimensions: [],
      scoring_model: 'auto',
    },
    voice: {
      detail_level: 'standard',
      framing: 'balanced',
      alert_threshold: 'watch_and_act',
    },
    tool_filters: {
      global: {
        exclude_stages: [],
        exclude_pipelines: [],
        exclude_deal_types: [],
        custom_exclusions: [],
      },
      metric_overrides: {
        win_rate: { enabled: false },
        pipeline_value: { enabled: false },
        forecast: { enabled: false },
        velocity: { enabled: false },
        activity: { enabled: false },
      },
    },
    updated_at: new Date(),
    confirmed: false,
    _meta: {},
  };
}
