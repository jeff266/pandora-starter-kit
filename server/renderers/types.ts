/**
 * Renderer Types
 *
 * Common interfaces for all renderers in the system.
 * Renderers transform populated templates and skill evidence into deliverable formats.
 */

import type { SkillEvidence, EvidenceColumnDef } from '../skills/types.js';

// ============================================================================
// Renderer Input/Output
// ============================================================================

export interface RendererInput {
  // One of these will be provided based on what's being rendered
  templateMatrix?: PopulatedTemplateMatrix;  // From Layer 4-5 (template-driven deliverables)
  agentOutput?: AgentOutput;                 // From Layer 2 (agent evidence accumulation)
  skillEvidence?: SkillEvidence;             // From Layer 1 (single skill output)

  // Always provided
  workspace: {
    id: string;
    name: string;
    branding?: BrandingConfig;
    voice?: VoiceConfig;
  };

  // Rendering options
  options: RenderOptions;
}

export interface RenderOptions {
  detail_level: 'summary_only' | 'summary_and_data' | 'full_audit';
  include_methodology?: boolean;    // Include data sources, parameters, confidence notes
  include_evidence_tables?: boolean; // Include per-skill evaluated_records tabs
  time_range_label?: string;        // "Week of Feb 10, 2026" for headers
  generated_at?: string;            // ISO timestamp
}

export interface RenderOutput {
  format: 'slack_blocks' | 'xlsx' | 'pdf' | 'pptx' | 'html' | 'command_center';
  filename?: string;                // For file-based outputs
  filepath?: string;                // Temp path to generated file
  buffer?: Buffer;                  // File contents
  slack_blocks?: any[];             // For Slack output
  html?: string;                    // For Command Center output
  metadata: {
    pages?: number;
    tabs?: number;
    slides?: number;
    file_size_bytes?: number;
    render_duration_ms: number;
  };
}

// ============================================================================
// Branding & Voice Configuration
// ============================================================================

export interface BrandingConfig {
  logo_url?: string;
  primary_color: string;            // Hex, e.g. "#2563EB"
  secondary_color?: string;
  company_name: string;
  prepared_by?: string;             // "Prepared by Acme Consulting"
  confidentiality_notice?: string;  // Footer text
  font_family?: string;             // For PDF/PPTX
}

export interface VoiceConfig {
  detail_level: 'executive' | 'manager' | 'analyst';
  framing: 'direct' | 'diplomatic' | 'consultative';
  alert_threshold: 'conservative' | 'balanced' | 'aggressive';
}

// ============================================================================
// Populated Template Matrix (from Layer 4-5)
// ============================================================================

export interface PopulatedTemplateMatrix {
  template_type: 'stage_matrix' | 'ranked_list' | 'waterfall' | 'profile_card' | 'audit_table' | 'hybrid';
  template_id?: string;
  template_name?: string;

  // Stage matrix / hybrid fields
  stages?: TemplateStage[];
  rows?: TemplateRow[];

  // Ranked list fields
  records?: any[];
  ranking_field?: string;
  column_schema?: EvidenceColumnDef[];

  // Waterfall fields
  starting_value?: { label: string; amount: number };
  adjustments?: Array<{ label: string; amount: number; category?: string }>;

  // Hybrid sections
  sections?: TemplateSection[];

  // Metadata
  cell_count?: {
    total: number;
    static: number;
    config: number;
    computed: number;
    synthesize: number;
    degraded: number;
    not_applicable: number;
  };
  population_status?: 'complete' | 'partial' | 'degraded';
  populated_at?: string;
  estimated_tokens?: number;
  estimated_cost_usd?: number;
}

export interface TemplateStage {
  stage_name: string;
  stage_normalized: string;
  probability?: number;
  display_order: number;
}

export interface TemplateRow {
  dimension_key: string;
  dimension_label: string;
  dimension_type: string;
  source_type: string;
  display_order: number;
  cells: Record<string, TemplateCell>;
}

export interface TemplateCell {
  content: string | null;
  status: 'populated' | 'degraded' | 'not_applicable';
  source: 'static' | 'config' | 'computed' | 'synthesize';
  degradation_reason?: string;
  confidence?: number;
  evidence_used?: string[];
  tokens_used?: number;
}

export interface TemplateSection {
  type: 'narrative' | 'stage_matrix' | 'ranked_list' | 'evidence_table';
  label: string;
  title?: string;
  content?: string;
  evidence?: SkillEvidence;
  [key: string]: any;
}

// ============================================================================
// Agent Output (from Layer 2)
// ============================================================================

export interface AgentOutput {
  run_id?: string;
  agent_id?: string;
  agent_name?: string;
  narrative?: string;                                           // Cross-skill synthesis
  skill_evidence: Record<string, SkillEvidence>;                // Evidence per skill
  all_claims: Claim[];                                          // All claims across skills
  skills_run?: string[];
  skills_from_cache?: string[];
  total_tokens?: number;
  completed_at?: string;
}

export interface Claim {
  id?: string;
  severity: 'critical' | 'warning' | 'info';
  skill_id?: string;
  message: string;
  claim_text?: string;
  entity_type?: string;
  entity_id?: string;
  category?: string;
  metric_value?: number;
  metric_threshold?: string;
}

// ============================================================================
// Renderer Interface
// ============================================================================

/**
 * All renderers implement this interface.
 * Renderers are stateless - they receive input and produce output.
 */
export interface Renderer {
  /** Format identifier: 'xlsx', 'pdf', 'slack_blocks', 'command_center', 'pptx' */
  format: string;

  /** Render the input into the target format */
  render(input: RendererInput): Promise<RenderOutput>;
}

// ============================================================================
// Chart Spec Types
// ============================================================================

export type ChartType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'stacked_bar'
  | 'waterfall'
  | 'donut';

export interface ChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  segment?: string;
  annotation?: string;
}

export interface ChartSpec {
  type: 'chart';
  chartType: ChartType;
  title: string;
  subtitle?: string;
  annotation?: string;
  referenceValue?: number;
  data: ChartDataPoint[];
  xAxis?: { label: string };
  yAxis?: { label: string; format: 'currency' | 'number' | 'percent' };
  colorMap?: Record<string, string>;
  source: {
    calculation_id: string;
    run_at: string;
    record_count: number;
  };
}

export interface ChartBlock {
  blockType: 'chart';
  spec: ChartSpec;
}

interface CalculationContext {
  calculation_id?: string;
}

/**
 * Validate a ChartSpec before passing to the frontend.
 * Returns false and logs a warning if the spec is invalid.
 */
export function validateChartSpec(spec: any, context: CalculationContext): spec is ChartSpec {
  if (!spec || typeof spec !== 'object') {
    console.warn('[ChartEmitter] Invalid chart spec: not an object');
    return false;
  }
  if (!spec.chartType) {
    console.warn('[ChartEmitter] Invalid chart spec: missing chartType');
    return false;
  }
  if (!Array.isArray(spec.data) || spec.data.length === 0) {
    console.warn('[ChartEmitter] Invalid chart spec: data must be a non-empty array');
    return false;
  }
  for (const pt of spec.data) {
    if (typeof pt.label !== 'string' || typeof pt.value !== 'number') {
      console.warn('[ChartEmitter] Invalid chart spec: each data point must have label (string) and value (number)');
      return false;
    }
  }
  if (!spec.source?.calculation_id) {
    console.warn('[ChartEmitter] Chart spec missing source.calculation_id — using fallback');
    spec.source = { ...spec.source, calculation_id: 'unknown' };
  }
  return true;
}
