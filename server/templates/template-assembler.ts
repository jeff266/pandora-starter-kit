/**
 * Template Assembler (Layer 4)
 *
 * Transforms a DiscoveryOutput into a TemplateMatrix — the fully specified
 * skeleton with every cell tagged, ready for population.
 *
 * This is purely structural: no LLM calls, no data fetching beyond what
 * Discovery already provided.
 */

import { DiscoveryOutput, DiscoveredDimension, DiscoveredStage } from '../discovery/discovery-engine.js';

export type CellStatus = 'pending' | 'populated' | 'degraded' | 'not_applicable';
export type CellSourceType = 'static' | 'config' | 'computed' | 'synthesize';

export interface TemplateCell {
  // Position
  dimension_key: string;
  stage_normalized: string;
  stage_name: string;

  // Source specification (from Discovery)
  source_type: CellSourceType;

  // For static cells
  static_value?: string;

  // For config cells
  config_path?: string;              // Dot-notation path into workspace config

  // For computed cells
  compute_function?: string;         // Name of registered compute function

  // For synthesize cells
  synthesis_prompt?: string;         // Fully resolved prompt (template variables filled)
  skill_evidence?: Record<string, any>;  // Pre-gathered evidence for this cell

  // Population state (starts as 'pending', updated by Layer 5)
  status: CellStatus;
  content: string | null;

  // Metadata
  confidence?: number;               // How confident we are in this cell's content
  data_sources?: string[];           // Which skills contributed
  degradation_reason?: string;       // If degraded, why
  tokens_used?: number;              // Tokens consumed for synthesis cells
}

export interface TemplateRow {
  dimension_key: string;
  dimension_label: string;
  display_order: number;
  source_type: CellSourceType;
  cells: Record<string, TemplateCell>;  // Keyed by stage_normalized
}

export interface TemplateMatrix {
  // Identity
  workspace_id: string;
  template_type: string;
  assembled_at: string;

  // Structure
  stages: {
    stage_normalized: string;
    stage_name: string;
    display_order: number;
    is_open: boolean;
    probability?: number;
    forecast_category?: string;
  }[];

  rows: TemplateRow[];

  // Population tracking
  cell_count: {
    total: number;
    static: number;
    config: number;
    computed: number;
    synthesize: number;
    not_applicable: number;
  };

  // Cost estimate (from Discovery, passed through)
  estimated_tokens: number;
  estimated_cost_usd: number;

  // State
  population_status: 'pending' | 'in_progress' | 'complete' | 'partial';
  populated_at?: string;
}

/**
 * Assemble a template matrix from dimension discovery output
 */
export function assembleTemplate(discovery: DiscoveryOutput): TemplateMatrix {
  const { stages, dimensions, workspace_id, template_type, cell_budget } = discovery;

  const rows: TemplateRow[] = [];
  let totalCells = 0;
  let staticCells = 0;
  let configCells = 0;
  let computedCells = 0;
  let synthesizeCells = 0;
  let naCells = 0;

  for (const dim of dimensions) {
    // Only included dimensions make it to the template
    if (!dim.included) continue;

    const cells: Record<string, TemplateCell> = {};

    for (const stage of stages) {
      // Check if this dimension applies to this stage
      const isApplicable = dim.applicable_stages.includes(stage.stage_normalized);
      const isDegraded = dim.degraded_stages.includes(stage.stage_normalized);

      if (!isApplicable) {
        cells[stage.stage_normalized] = {
          dimension_key: dim.key,
          stage_normalized: stage.stage_normalized,
          stage_name: stage.stage_name,
          source_type: dim.source_type as CellSourceType,
          status: 'not_applicable',
          content: null,
        };
        naCells++;
        totalCells++;
        continue;
      }

      const cell: TemplateCell = {
        dimension_key: dim.key,
        stage_normalized: stage.stage_normalized,
        stage_name: stage.stage_name,
        source_type: dim.source_type as CellSourceType,
        status: isDegraded ? 'degraded' : 'pending',
        content: null,
      };

      // Tag cell with source-specific metadata
      switch (dim.source_type) {
        case 'static':
          // Static cells can be populated immediately during assembly
          cell.static_value = resolveStaticValue(dim, stage);
          cell.content = cell.static_value || null;
          cell.status = cell.content ? 'populated' : 'degraded';
          staticCells++;
          break;

        case 'config':
          cell.config_path = dim.config_path || undefined;
          configCells++;
          break;

        case 'computed':
          cell.compute_function = dim.compute_function || undefined;
          computedCells++;
          break;

        case 'synthesize':
          cell.synthesis_prompt = dim.synthesis_prompt_template || undefined;
          // Evidence will be gathered during population (Layer 5)
          if (isDegraded) {
            cell.degradation_reason = dim.degradation_reason || 'Insufficient evidence for full synthesis';
          }
          synthesizeCells++;
          break;
      }

      cell.data_sources = dim.skill_inputs;
      cells[stage.stage_normalized] = cell;
      totalCells++;
    }

    rows.push({
      dimension_key: dim.key,
      dimension_label: dim.label,
      display_order: dim.display_order,
      source_type: dim.source_type as CellSourceType,
      cells,
    });
  }

  return {
    workspace_id,
    template_type,
    assembled_at: new Date().toISOString(),
    stages: stages.map(s => ({
      stage_normalized: s.stage_normalized,
      stage_name: s.stage_name,
      display_order: s.display_order,
      is_open: s.is_open,
      probability: s.probability,
      forecast_category: s.forecast_category,
    })),
    rows: rows.sort((a, b) => a.display_order - b.display_order),
    cell_count: {
      total: totalCells,
      static: staticCells,
      config: configCells,
      computed: computedCells,
      synthesize: synthesizeCells,
      not_applicable: naCells,
    },
    estimated_tokens: cell_budget.estimated_tokens,
    estimated_cost_usd: cell_budget.estimated_cost_usd,
    population_status: 'pending',
  };
}

/**
 * Resolve static values that are known at assembly time
 */
function resolveStaticValue(dim: DiscoveredDimension, stage: DiscoveredStage): string | null {
  // Known static values
  switch (dim.key) {
    case 'crm_object':
    case 'hubspot_object':
      return 'Deal'; // Always "Deal" for sales process maps
    default:
      return null;
  }
}
