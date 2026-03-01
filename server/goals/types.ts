export interface FunnelModel {
  win_rate: number;
  avg_deal_size: number;
  avg_cycle_days: number;
  stage_conversion_rates: Record<string, number>;
  source: 'inferred' | 'manual';
  computed_at: string;
}

export interface RevenueMotion {
  id: string;
  workspace_id: string;
  type: 'new_business' | 'expansion' | 'renewal';
  sub_type: string | null;
  label: string;
  pipeline_names: string[];
  deal_filters: Record<string, any>;
  team_labels: string[];
  funnel_model: FunnelModel;
  thresholds_override: Record<string, any>;
  is_active: boolean;
  source: 'manual' | 'inferred' | 'crm_import';
  confidence: number;
  created_at: string;
  updated_at: string;
}

export type CreateMotionInput = Omit<RevenueMotion, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
};

export interface InferredMotion {
  type: 'new_business' | 'expansion' | 'renewal';
  sub_type?: string | null;
  label: string;
  pipeline_names: string[];
  deal_filters?: Record<string, any>;
  team_labels?: string[];
  funnel_model?: FunnelModel;
  confidence: number;
  source: 'inferred';
}

export type GoalMetricType =
  | 'bookings'
  | 'pipeline'
  | 'opportunities'
  | 'sqls'
  | 'mqls'
  | 'leads'
  | 'visits'
  | 'win_rate'
  | 'cycle_time'
  | 'retention'
  | 'expansion_revenue'
  | 'churn'
  | 'nrr'
  | 'custom';

export type GoalLevel = 'board' | 'company' | 'team' | 'individual';
export type GoalOwnerType = 'workspace' | 'team' | 'rep';
export type GoalPeriod = 'monthly' | 'quarterly' | 'annual';
export type GoalSource = 'manual' | 'inferred' | 'quota_import' | 'crm_import';
export type GoalTrajectory = 'ahead' | 'on_track' | 'at_risk' | 'behind' | 'critical';

export interface Goal {
  id: string;
  workspace_id: string;
  metric_type: GoalMetricType;
  label: string;
  level: GoalLevel;
  parent_goal_id: string | null;
  owner_type: GoalOwnerType;
  owner_id: string;
  motion_id: string | null;
  upstream_goal_id: string | null;
  conversion_assumption: number | null;
  target_value: number;
  target_unit: string;
  period: GoalPeriod;
  period_start: string;
  period_end: string;
  source: GoalSource;
  confidence: number;
  inferred_from: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type CreateGoalInput = Omit<Goal, 'id' | 'created_at' | 'updated_at'>;

export interface GoalCurrentValue {
  current_value: number;
  deal_count: number;
  computation_detail: Record<string, any>;
}

export interface GoalTree {
  goal: Goal;
  parent?: Goal;
  children: Goal[];
  upstream?: Goal;
  downstream: Goal[];
}

export interface GoalSnapshot {
  id: string;
  goal_id: string;
  workspace_id: string;
  snapshot_date: string;
  current_value: number;
  attainment_pct: number | null;
  gap: number | null;
  required_run_rate: number | null;
  actual_run_rate: number | null;
  trajectory: GoalTrajectory | null;
  projected_landing: number | null;
  days_remaining: number | null;
  top_risk: string | null;
  top_opportunity: string | null;
  notable_changes: string[] | null;
  computation_detail: Record<string, any>;
  created_at: string;
}

export interface InvestigationStep {
  index: number;
  operator_name: string;
  skill_id: string;
  trigger: 'initial' | 'follow_up';
  triggered_by?: {
    step_index: number;
    finding_type: string;
    reasoning: string;
  };
  status: 'pending' | 'executing' | 'complete' | 'skipped';
  used_cache: boolean;
  result_summary?: string;
  key_findings?: string[];
  follow_up_decision?: 'satisfied' | 'investigate_further';
  follow_up_question?: string;
  follow_up_skill?: string;
}

export interface InvestigationPlan {
  id: string;
  workspace_id: string;
  question: string;
  goal_context: any[];
  steps: InvestigationStep[];
  current_step: number;
  status: 'planning' | 'executing' | 'synthesizing' | 'complete' | 'error';
  max_steps: number;
  total_tokens: number;
}

export interface InvestigationResult {
  plan: InvestigationPlan;
  synthesis: string;
  total_tokens: number;
  steps_executed: number;
  cache_hits: number;
}
