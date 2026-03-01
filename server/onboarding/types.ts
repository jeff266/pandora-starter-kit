export interface CRMScanResult {
  pipelines: PipelineStat[];
  deal_types: DimensionStat[];
  record_types: DimensionStat[];
  stages: StageStat[];
  won_lost: WonLostStat[];
  owners: OwnerStat[];
  close_date_clusters: { month: string; count: number; total_amount: number }[];
  amount_distribution: AmountDistribution | null;
  custom_field_fill_rates: FieldFillRate[];
  contacts_per_deal: { avg_contacts: number; median_contacts: number } | null;
  new_owners: string[];
  unused_stages: string[];
  amount_cycle_buckets: AmountCycleBucket[];
  segment_analysis: SegmentAnalysis | null;
}

export interface PipelineStat {
  pipeline: string;
  count: number;
  total_amount: number;
  avg_amount: number;
  avg_cycle_days: number | null;
  median_cycle_days: number | null;
}

export interface DimensionStat {
  value: string;
  count: number;
  avg_amount: number;
}

export interface StageStat {
  stage: string;
  deals: number;
  avg_amount: number;
  avg_days: number | null;
}

export interface WonLostStat {
  stage: string;
  count: number;
  total_amount: number;
}

export interface OwnerStat {
  owner_name: string;
  deal_count: number;
  total_amount: number;
  last_deal_created: string | null;
  first_deal_created: string | null;
}

export interface AmountDistribution {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface FieldFillRate {
  key: string;
  filled_count: number;
  fill_pct: number;
}

export interface AmountCycleBucket {
  bucket: string;
  bucket_order: number;
  deals: number;
  median_amount: number;
  median_cycle_days: number | null;
  avg_cycle_days: number | null;
  win_rate_pct: number | null;
}

export interface SegmentAnalysisSegment {
  name: string;
  min_amount: number | null;
  max_amount: number | null;
  deals: number;
  median_amount: number;
  median_cycle_days: number | null;
  win_rate_pct: number | null;
  rationale: string;
  confidence: number;
  anomalous: boolean;
  anomaly_question?: string;
}

export interface SegmentAnalysis {
  segments: SegmentAnalysisSegment[];
  single_motion: boolean;
  confidence: number;
  notes: string;
}

export interface CompanyResearch {
  company_size_estimate: string;
  industry: string;
  likely_gtm_motion: string;
  pricing_model: string;
  competitors: string[];
  funding_stage: string;
  confidence: number;
  evidence_urls: string[];
}

export interface Hypothesis {
  summary: string;
  table?: HypothesisRow[];
  columns?: string[];
  confidence: number;
  evidence: string;
  suggested_value: unknown;
  options?: HypothesisOption[];
}

export interface HypothesisRow {
  [key: string]: string | number | null;
}

export interface HypothesisOption {
  id: string;
  label: string;
  description: string;
}

export interface OnboardingQuestion {
  id: string;
  tier: 0 | 1 | 2 | 3;
  title: string;
  config_targets: string[];
  requires_data: string[];
  requires_questions: string[];
  trigger: string | null;
  hypothesis_generator: string;
  prompt_intro: string;
  input_hint: string;
  can_skip: boolean;
  skip_message: string;
  skip_default: Record<string, unknown>;
  show_artifact: boolean;
}

export interface OnboardingState {
  workspace_id: string;
  started_at: string;
  completed_at: string | null;
  role: 'admin' | 'cro' | 'manager' | 'consultant';
  questions: Record<string, QuestionState>;
  tier0_complete: boolean;
  tier1_complete: boolean;
  first_brief_generated: boolean;
  can_resume: boolean;
  resume_from: string;
}

export interface QuestionState {
  status: 'pending' | 'answered' | 'skipped' | 'deferred';
  answered_at?: string;
  skipped_at?: string;
  response_source?: 'text' | 'upload' | 'select';
  config_patches_applied: string[];
  hypothesis_confidence: number;
  user_changed_hypothesis: boolean;
}

export interface ConfigPatch {
  [key: string]: unknown;
  _parser_confidence?: number;
  _interpretation_notes?: string;
  parse_error?: boolean;
  raw?: string;
}

export interface ConfigArtifact {
  type: 'named_filter' | 'stage_update' | 'goal_set' | 'rep_classified' | 'config_saved';
  label: string;
  detail: string;
  items?: string[];
}

export interface ExtractedContent {
  text: string;
  structured?: unknown;
  pages?: number;
  confidence: number;
  mime_type: string;
}

export interface InferenceResult {
  fiscal_year_start_month?: number;
  quota_period?: string;
  stage_0_stages?: string[];
  parking_lot_stages?: string[];
  rep_patterns?: { active_reps: string[]; excluded_owners: string[] };
  amount_distribution?: AmountDistribution;
  field_fill_rates?: FieldFillRate[];
}
