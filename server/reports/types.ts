// Report Builder Types

export type ReportCadence = 'manual' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
export type ReportFormat = 'pdf' | 'docx' | 'pptx';
export type DetailLevel = 'executive' | 'manager' | 'analyst';
export type GenerationTrigger = 'schedule' | 'manual' | 'api';
export type GenerationStatus = 'success' | 'failed' | 'partial';

// Report Section Configuration
export interface ReportSection {
  id: string;                          // e.g., "the-number"
  label: string;                       // "The Number"
  description: string;                 // "Forecast landing zone with bear/base/bull cases"
  skills: string[];                    // ["forecast-rollup", "monte-carlo"]
  config: {
    detail_level: DetailLevel;
    metrics?: string[];                // Which metrics to include (if configurable)
    threshold_overrides?: Record<string, number>;  // e.g., coverage_target: 3.0
    include_deal_list?: boolean;       // For sections that can show deal-level detail
    include_chart?: boolean;           // For sections with visual elements
    max_items?: number;                // Limit number of deals/reps shown
  };
  order: number;                       // Position in the report
  enabled: boolean;                    // Can be toggled off without removing
}

// Delivery Channel Types
export type DeliveryChannel =
  | { type: 'email'; config: { subject_template: string } }
  | { type: 'google_drive'; config: { folder_id: string; folder_name: string; versioning: 'new_file' | 'overwrite' } }
  | { type: 'slack'; config: { channel_id: string; channel_name: string; include_inline?: boolean } }
  | { type: 'download_only'; config: Record<string, never> };

// Voice Configuration
export interface VoiceConfig {
  detail_level: DetailLevel;
  framing: 'direct' | 'consultative' | 'executive';
  tone?: 'analytical' | 'conversational' | 'formal';
}

// Report Template (from database)
export interface ReportTemplate {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  sections: ReportSection[];
  cadence: ReportCadence;
  schedule_day?: number;
  schedule_time?: string;
  schedule_day_of_month?: number;
  timezone: string;
  formats: ReportFormat[];
  delivery_channels: DeliveryChannel[];
  recipients: string[];
  branding_override?: any;
  voice_config: VoiceConfig;
  is_active: boolean;
  last_generated_at?: string;
  last_generation_status?: GenerationStatus;
  last_generation_error?: string;
  next_due_at?: string;
  created_from_template?: string;
  created_at: string;
  updated_at: string;
}

// Section Content (output from section generation)
export interface SectionContent {
  section_id: string;
  title: string;

  // Narrative block (always present)
  narrative: string;                    // 1-3 paragraph summary

  // Optional structured elements
  metrics?: MetricCard[];               // Key numbers (e.g., $1.33M closed)
  table?: {                             // Tabular data (e.g., rep performance)
    headers: string[];
    rows: TableRow[];
  };
  deal_cards?: DealCard[];              // Risk deals, closed deals, etc.
  chart_data?: ChartData;               // For renderers that support charts
  action_items?: ActionItem[];          // Recommended actions

  // Metadata
  source_skills: string[];
  data_freshness: string;               // ISO timestamp
  confidence: number;                   // 0-1, from underlying evidence
}

export interface MetricCard {
  label: string;
  value: string;
  delta?: string;
  delta_direction?: 'up' | 'down' | 'flat';
  severity?: 'good' | 'warning' | 'critical';
}

export interface TableRow {
  [key: string]: string | number | null;
}

export interface DealCard {
  name: string;
  amount: string;
  owner: string;
  stage: string;
  signal: string;
  signal_severity: 'critical' | 'warning' | 'info';
  detail: string;
  action: string;
}

export interface ChartData {
  type: 'bar' | 'line' | 'waterfall' | 'funnel';
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}

export interface ActionItem {
  owner: string;                        // Role or name
  action: string;
  urgency: 'today' | 'this_week' | 'this_month';
  related_deal?: string;
}

// Report Generation Result
export interface ReportGeneration {
  id: string;
  report_template_id: string;
  workspace_id: string;
  formats_generated: Record<ReportFormat, {
    filepath: string;
    size_bytes: number;
    download_url: string;
  }>;
  delivery_status: Record<string, string>;
  sections_snapshot: ReportSection[];
  skills_run?: string[];
  total_tokens: number;
  generation_duration_ms?: number;
  render_duration_ms?: number;
  triggered_by: GenerationTrigger;
  data_as_of: string;
  error_message?: string;
  created_at: string;
}

// Report Generation Request
export interface GenerateReportRequest {
  workspace_id: string;
  report_template_id: string;
  triggered_by: GenerationTrigger;
  preview_only?: boolean;              // Don't save to history or deliver
}

// Report Generation Context (internal)
export interface ReportGenerationContext {
  workspace_id: string;
  template: ReportTemplate;
  sections_content: SectionContent[];
  branding: any;                        // From workspace or override
  triggered_by: GenerationTrigger;
  preview_only: boolean;
}
