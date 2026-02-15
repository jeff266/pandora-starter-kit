/**
 * Dimension Registry
 *
 * Static catalog of every possible dimension that could appear in a template-driven deliverable.
 * Each dimension defines:
 * - What it represents (Purpose of Stage, MEDDPICC Focus, etc.)
 * - How to populate it (static, config, computed, synthesize)
 * - When to include it (universal vs conditional with inclusion criteria)
 */

export type SourceType = 'static' | 'config' | 'computed' | 'synthesize';
export type DimensionCategory = 'universal' | 'conditional' | 'custom';

export interface DimensionDefinition {
  key: string;                           // Unique identifier: 'purpose_of_stage', 'meddpicc_focus'
  label: string;                         // Display name: 'Purpose of Stage', 'MEDDPICC Focus'
  description: string;                   // What this dimension captures
  category: DimensionCategory;
  display_order: number;                 // Sort position within the template (lower = higher)

  // How to populate this dimension's cells
  source_type: SourceType;
  skill_inputs: string[];                // Which skill IDs provide evidence for this dimension

  // Inclusion criteria (only evaluated for 'conditional' dimensions)
  inclusion_criteria?: InclusionCriteria;

  // Stage restrictions
  only_stages?: string[];                // Only populate for these normalized stages
  exclude_stages?: string[];             // Skip these stages

  // Synthesis guidance (for source_type = 'synthesize')
  synthesis_prompt_template?: string;    // Per-cell prompt template with {{stage}} and {{evidence}} placeholders

  // Config mapping (for source_type = 'config')
  config_path?: string;                  // Dot-notation path into workspace config

  // Compute function (for source_type = 'computed')
  compute_function?: string;             // Name of registered compute function
}

export interface InclusionCriteria {
  description: string;                   // Human-readable: "MEDDPICC fields detected in CRM"

  // What data to check
  check_type:
    | 'config_field_exists'              // A field exists in workspace config
    | 'config_field_value'               // A field has a specific value
    | 'skill_evidence_threshold'         // A skill's evidence meets a threshold
    | 'data_coverage_threshold'          // A data source has sufficient coverage
    | 'crm_field_pattern'               // CRM fields match a pattern
    | 'compound';                        // Multiple criteria combined with AND/OR

  // Parameters per check_type
  config_field?: string;                 // For config_field_exists/value: dot-path into config
  expected_value?: any;                  // For config_field_value
  skill_id?: string;                     // For skill_evidence_threshold
  evidence_field?: string;               // Field in skill evidence to check
  threshold?: number;                    // Minimum value
  threshold_type?: 'percentage' | 'count' | 'boolean';

  // For compound criteria
  operator?: 'AND' | 'OR';
  criteria?: InclusionCriteria[];        // Nested criteria

  // Fallback behavior if check cannot be evaluated (skill hasn't run, data missing)
  on_missing: 'exclude' | 'include_degraded';
}

// ============================================================================
// Universal Dimensions (always included, display_order 100-199)
// ============================================================================

export const UNIVERSAL_DIMENSIONS: DimensionDefinition[] = [
  {
    key: 'hubspot_object',
    label: 'CRM Object',
    description: 'Which CRM object type is tracked at this stage',
    category: 'universal',
    display_order: 100,
    source_type: 'static',
    skill_inputs: [],
    // Populated by: static value based on CRM type — always 'Deal' for deal pipelines
  },
  {
    key: 'forecast_probability',
    label: 'Forecast Probability',
    description: 'Default win probability assigned to this stage',
    category: 'universal',
    display_order: 110,
    source_type: 'config',
    skill_inputs: ['workspace-config-audit'],
    config_path: 'pipelines.stages.probability',
  },
  {
    key: 'forecast_category',
    label: 'Forecast Category',
    description: 'Forecast bucket assigned at this stage (Pipeline, Best Case, Commit)',
    category: 'universal',
    display_order: 115,
    source_type: 'config',
    skill_inputs: ['workspace-config-audit'],
    config_path: 'pipelines.stages.forecast_category',
  },
  {
    key: 'purpose_of_stage',
    label: 'Purpose of Stage',
    description: 'What should be accomplished and validated at this stage',
    category: 'universal',
    display_order: 120,
    source_type: 'synthesize',
    skill_inputs: ['workspace-config-audit', 'pipeline-hygiene'],
    synthesis_prompt_template: `You are writing the purpose statement for one stage in a B2B sales process.

Stage: {{stage_name}} ({{stage_normalized}})
Stage position: {{display_order}} of {{total_stages}}

Workspace context:
{{workspace_description}}

Evidence from workspace config:
{{config_evidence}}

Evidence from pipeline hygiene (what happens at this stage):
{{hygiene_evidence}}

Write a 2-3 sentence purpose statement for this stage. Be specific to this company's
actual sales motion — reference their product, buyer persona, and deal patterns.
Do not write generic sales process descriptions.`,
  },
  {
    key: 'exit_criteria',
    label: 'Exit Criteria',
    description: 'What must be true before a deal advances from this stage',
    category: 'universal',
    display_order: 130,
    source_type: 'synthesize',
    skill_inputs: ['workspace-config-audit', 'pipeline-hygiene', 'pipeline-waterfall'],
    synthesis_prompt_template: `You are defining exit criteria for one stage in a B2B sales process.

Stage: {{stage_name}} ({{stage_normalized}})

Evidence from winning deals:
- Deals that advanced from this stage to the next had these characteristics: {{advance_patterns}}
- Deals that stalled at this stage had these characteristics: {{stall_patterns}}
- Required fields at this stage: {{required_fields}}

Evidence from stage transitions:
- Median days in this stage (won deals): {{median_days_won}}
- Median days in this stage (lost deals): {{median_days_lost}}
- Regression rate from next stage back to this one: {{regression_rate}}

Write 4-6 specific, verifiable exit criteria as bullet points. Each criterion should be
something a sales manager can objectively validate. Derive criteria from the actual data
patterns — what did winning deals have that losing deals didn't at this stage?`,
  },
  {
    key: 'required_fields',
    label: 'Validation Rules (Required Fields)',
    description: 'CRM fields that must be populated at this stage',
    category: 'universal',
    display_order: 140,
    source_type: 'config',
    skill_inputs: ['workspace-config-audit'],
    config_path: 'pipelines.stages.required_properties',
  },
  {
    key: 'typical_duration',
    label: 'Typical Duration',
    description: 'How long deals normally spend at this stage',
    category: 'universal',
    display_order: 150,
    source_type: 'computed',
    skill_inputs: ['pipeline-waterfall'],
    compute_function: 'computeStageDuration',
  },
  {
    key: 'able_to_move_backwards',
    label: 'Able to Move Backwards',
    description: 'Whether deals can regress to an earlier stage from this one',
    category: 'universal',
    display_order: 160,
    source_type: 'computed',
    skill_inputs: ['pipeline-waterfall'],
    compute_function: 'computeStageRegression',
  },
  {
    key: 'red_flags',
    label: 'Red Flags / DQ Triggers',
    description: 'Warning signs that a deal at this stage is at risk or should be disqualified',
    category: 'universal',
    display_order: 190,
    source_type: 'synthesize',
    skill_inputs: ['pipeline-hygiene', 'icp-discovery'],
    synthesis_prompt_template: `You are identifying red flags and disqualification triggers for one stage.

Stage: {{stage_name}} ({{stage_normalized}})

Evidence from pipeline hygiene:
- Common issues at this stage: {{hygiene_findings}}
- Deals that eventually lost from this stage had these patterns: {{loss_patterns}}

Evidence from ICP discovery:
- ICP-misfit deals at this stage: {{icp_mismatch_patterns}}

Evidence from loss reasons:
- Top loss reasons for deals that were at this stage: {{loss_reasons}}

Write 3-5 specific red flags or disqualification triggers. Each should be an observable
signal, not a vague warning. Derive from actual loss patterns in the data.`,
  },
];

// ============================================================================
// Conditional Dimensions (included when data supports, display_order 200-399)
// ============================================================================

export const CONDITIONAL_DIMENSIONS: DimensionDefinition[] = [
  // --- Methodology dimensions (200-229) ---
  {
    key: 'meddpicc_focus',
    label: 'MEDDPICC Focus',
    description: 'Which MEDDPICC elements are critical at this stage',
    category: 'conditional',
    display_order: 200,
    source_type: 'synthesize',
    skill_inputs: ['workspace-config-audit', 'icp-discovery'],
    inclusion_criteria: {
      description: 'MEDDPICC fields or methodology detected in CRM, docs, or config',
      check_type: 'compound',
      operator: 'OR',
      criteria: [
        {
          description: 'MEDDPICC detected in workspace config methodology',
          check_type: 'config_field_value',
          config_field: 'detected_methodology',
          expected_value: 'MEDDPICC',
          on_missing: 'exclude',
        },
        {
          description: 'MEDDPICC-related CRM fields detected',
          check_type: 'crm_field_pattern',
          evidence_field: 'crm_fields_matching_pattern',
          threshold: 2,
          threshold_type: 'count',
          on_missing: 'exclude',
        },
      ],
      on_missing: 'exclude',
    },
    synthesis_prompt_template: `You are mapping MEDDPICC elements to a specific sales stage.

Stage: {{stage_name}} ({{stage_normalized}})
Stage position: {{display_order}} of {{total_stages}}

MEDDPICC elements: Metrics, Economic Buyer, Decision Criteria, Decision Process,
Paper Process, Identify Pain, Champion, Competition

Evidence from ICP Discovery:
- Buyer personas that appear at this stage: {{personas_at_stage}}
- Buying committee patterns: {{committee_patterns}}

Evidence from CRM:
- MEDDPICC fields required at this stage: {{meddpicc_required_fields}}
- MEDDPICC fields typically populated at this stage: {{meddpicc_populated}}

For this specific stage, identify which 2-3 MEDDPICC elements are PRIMARY focus areas.
For each, explain specifically what "good" looks like at this stage for this company.
Do not list all 8 elements — focus on the ones that matter most at this stage.`,
  },
  {
    key: 'bant_qualification',
    label: 'BANT Qualification',
    description: 'Budget, Authority, Need, Timeline qualification status expected at this stage',
    category: 'conditional',
    display_order: 210,
    source_type: 'synthesize',
    skill_inputs: ['workspace-config-audit', 'icp-discovery'],
    inclusion_criteria: {
      description: 'BANT methodology detected in CRM, docs, or config',
      check_type: 'config_field_value',
      config_field: 'detected_methodology',
      expected_value: 'BANT',
      on_missing: 'exclude',
    },
    synthesis_prompt_template: `You are mapping BANT qualification to a specific sales stage.

Stage: {{stage_name}} ({{stage_normalized}})

For this stage, describe what qualification looks like across all four BANT dimensions:
- Budget: What should be known/confirmed at this stage?
- Authority: Which stakeholders should be identified/engaged?
- Need: What pain/value should be articulated?
- Timeline: What timing signals should exist?

Use evidence from actual deal patterns:
{{deal_pattern_evidence}}

Be specific to this company. Use actual deal sizes, buyer titles, and timeline patterns from the data.`,
  },
  {
    key: 'plg_signals',
    label: 'PLG Signals to Watch',
    description: 'Product-led growth signals indicating sales-assist readiness',
    category: 'conditional',
    display_order: 230,
    source_type: 'synthesize',
    skill_inputs: ['icp-discovery', 'workspace-config-audit'],
    inclusion_criteria: {
      description: 'More than 15% of deals originate from self-serve or product signup',
      check_type: 'skill_evidence_threshold',
      skill_id: 'icp-discovery',
      evidence_field: 'deal_source_distribution.self_serve_percentage',
      threshold: 15,
      threshold_type: 'percentage',
      on_missing: 'exclude',
    },
  },
  {
    key: 'channel_partner',
    label: 'Channel / Partner Involvement',
    description: 'When and how channel partners are involved in the sales process',
    category: 'conditional',
    display_order: 240,
    source_type: 'synthesize',
    skill_inputs: ['icp-discovery', 'workspace-config-audit'],
    inclusion_criteria: {
      description: 'More than 10% of deals have a partner source',
      check_type: 'skill_evidence_threshold',
      skill_id: 'icp-discovery',
      evidence_field: 'deal_source_distribution.partner_percentage',
      threshold: 10,
      threshold_type: 'percentage',
      on_missing: 'exclude',
    },
  },
  {
    key: 'closed_won_process',
    label: 'Closed Won Process',
    description: 'Post-signature workflow: handoff, automation, revenue recognition',
    category: 'conditional',
    display_order: 310,
    source_type: 'synthesize',
    skill_inputs: ['workspace-config-audit'],
    only_stages: ['closed_won'],
    inclusion_criteria: {
      description: 'Post-close workflow or automation detected',
      check_type: 'compound',
      operator: 'OR',
      criteria: [
        {
          description: 'Post-close automation detected in CRM',
          check_type: 'config_field_exists',
          config_field: 'post_close_workflow',
          on_missing: 'include_degraded',
        },
        {
          description: 'Always include for closed_won stage',
          check_type: 'config_field_exists',
          config_field: 'pipelines',
          on_missing: 'include_degraded',
        },
      ],
      on_missing: 'include_degraded',
    },
  },
  {
    key: 'closed_lost_capture',
    label: 'Closed Lost Capture',
    description: 'What data is captured when a deal is lost',
    category: 'conditional',
    display_order: 320,
    source_type: 'synthesize',
    skill_inputs: ['workspace-config-audit', 'data-quality-audit'],
    only_stages: ['closed_lost'],
    inclusion_criteria: {
      description: 'Loss reason field exists or loss analysis data available',
      check_type: 'compound',
      operator: 'OR',
      criteria: [
        {
          description: 'Loss reason field detected in CRM',
          check_type: 'config_field_exists',
          config_field: 'crm_schema.loss_reason_field',
          on_missing: 'include_degraded',
        },
        {
          description: 'Always include for closed_lost stage',
          check_type: 'config_field_exists',
          config_field: 'pipelines',
          on_missing: 'include_degraded',
        },
      ],
      on_missing: 'include_degraded',
    },
  },
];

// ============================================================================
// Registry API
// ============================================================================

export const DIMENSION_REGISTRY: DimensionDefinition[] = [
  ...UNIVERSAL_DIMENSIONS,
  ...CONDITIONAL_DIMENSIONS,
].sort((a, b) => a.display_order - b.display_order);

export function getDimension(key: string): DimensionDefinition | undefined {
  return DIMENSION_REGISTRY.find(d => d.key === key);
}

export function getDimensionsByCategory(category: DimensionCategory): DimensionDefinition[] {
  return DIMENSION_REGISTRY.filter(d => d.category === category);
}
