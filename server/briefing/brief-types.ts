export type BriefType = 'monday_setup' | 'pulse' | 'friday_recap' | 'quarter_close';

export interface EditorialFocus {
  primary: string;
  open_sections: string[];
  suppress: string[];
  reason: string;
  highlight_reps?: string[];
  highlight_deals?: string[];
}

export interface TheNumber {
  pipeline_total: number;
  deal_count: number;
  won_this_period: number;
  forecast: {
    commit: number;
    best_case: number;
    weighted: number;
    win_rate: number;
  };
  attainment_pct: number;
  gap: number;
  coverage_on_gap: number;
  direction: 'up' | 'down' | 'flat';
  wow_pts?: number;
  days_remaining: number;
  delta_since_monday?: number;
  forecast_delta?: number;
  attainment_delta?: number;
  omitted?: boolean;
  reason?: string;
  required_pipeline?: number;
  coverage_ratio?: number;
  avg_deal_size?: number;
  weeks_remaining?: number;
  required_deals_to_close?: number;
}

export interface WhatChanged {
  created: { count: number; amount: number; prev_count?: number; prev_amount?: number };
  won: { count: number; amount: number; prev_count?: number; prev_amount?: number };
  lost: { count: number; amount: number; prev_count?: number; prev_amount?: number };
  pushed: { count: number; amount: number; prev_count?: number; prev_amount?: number };
  streak?: string;
  nothing_moved?: boolean;
  since_date?: string;
}

export interface Segment {
  label: string;
  pipeline: number;
  count: number;
  avg_deal: number;
}

export interface Segments {
  dimension: string;
  items: Segment[];
  omitted?: boolean;
  reason?: string;
}

export interface RepPerformance {
  email: string;
  name: string;
  pipeline: number;
  closed: number;
  attainment: number;
  quota: number;
  gap: number;
  findings_count: number;
  flag_weeks: number;
  escalation_level: number;
}

export interface Reps {
  items: RepPerformance[];
  omitted?: boolean;
  reason?: string;
}

export interface DealToWatch {
  id: string;
  name: string;
  amount: number;
  stage: string;
  owner: string;
  severity: 'critical' | 'warning' | 'info' | 'positive';
  signal?: string;
  signal_text?: string;
  close_date?: string;
}

export interface DealsToWatch {
  items: DealToWatch[];
  omitted?: boolean;
  reason?: string;
}

export interface AiBlurbClaim {
  text: string;
  drilldown: string;
  verified?: boolean;
}

export interface AiBlurbs {
  overall_summary?: string;
  rep_conversation?: string;
  deal_recommendation?: string;
  pulse_summary?: string;
  key_action?: string;
  week_summary?: string;
  next_week_focus?: string;
  quarter_situation?: string;
  close_plan?: string;
  claims?: AiBlurbClaim[];
}

export interface WeeklyBriefRow {
  id: string;
  workspace_id: string;
  brief_type: BriefType;
  generated_date: string;
  period_start: string;
  period_end: string;
  days_in_quarter: number;
  days_remaining: number;
  the_number: TheNumber;
  what_changed: WhatChanged;
  segments: Segments;
  reps: Reps;
  deals_to_watch: DealsToWatch;
  ai_blurbs: AiBlurbs;
  editorial_focus: EditorialFocus;
  section_refreshed_at: Record<string, string>;
  status: 'assembling' | 'ready' | 'sent' | 'edited' | 'failed';
  error_message?: string;
  sent_to: any[];
  edited_sections: any;
  edited_by?: string;
  edited_at?: string;
  assembly_duration_ms: number;
  ai_tokens_used: number;
  skill_runs_used: string[];
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface AssembledBrief extends WeeklyBriefRow {}
