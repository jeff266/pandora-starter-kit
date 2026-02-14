/**
 * Funnel Definition Types
 *
 * Workspace-level funnel definitions that replace hardcoded Lead → MQL → SQL → SAO → Won
 * assumptions. Supports multiple sales motion types (B2B, PLG, Enterprise, Velocity, Channel)
 * with custom stage names and CRM field mappings.
 */

export type ModelType = 'classic_b2b' | 'plg' | 'enterprise' | 'velocity' | 'channel' | 'custom';
export type FunnelSide = 'pre_sale' | 'center' | 'post_sale';
export type FunnelStatus = 'discovered' | 'template' | 'confirmed';
export type StageMatchType = 'field_value' | 'object_exists' | 'field_not_null';
export type CRMObject = 'leads' | 'contacts' | 'deals' | 'accounts';

export interface FunnelStageSource {
  /** Which CRM object this stage maps to */
  object: CRMObject;

  /** Field name on the object (e.g., 'status', 'lifecyclestage', 'stage_normalized') */
  field: string;

  /** CRM values that map to this stage (e.g., ['Working', 'Contacted']) */
  values: string[];

  /** For fields nested in JSONB custom_fields (e.g., "custom_fields->>'lifecyclestage'") */
  field_path?: string;

  /** How to match this stage */
  match_type?: StageMatchType;
}

export interface FunnelStage {
  /** Short slug for this stage (e.g., 'lead', 'mql', 'activated', 'tech_eval') */
  id: string;

  /** User-facing label (e.g., 'Marketing Qualified Lead', 'Technical Evaluation') */
  label: string;

  /** Which part of the funnel this stage belongs to */
  side: FunnelSide;

  /** Sequential order (1, 2, 3...) determines funnel position */
  order: number;

  /** CRM mapping for this stage */
  source: FunnelStageSource;

  /** Optional human-readable description */
  description?: string;

  /** Expected time in this stage (for velocity alerts) */
  sla_days?: number;

  /** Can deals skip this stage? */
  is_required?: boolean;
}

export interface FunnelDefinition {
  /** Auto-generated UUID */
  id: string;

  /** Workspace this funnel belongs to */
  workspace_id: string;

  /** What motion does this company run? */
  model_type: ModelType;

  /** User-facing name (e.g., 'Classic B2B', 'Product-Led Growth') */
  model_label: string;

  /** The stages in order */
  stages: FunnelStage[];

  /** Discovery/confirmation status */
  status: FunnelStatus;

  /** When the funnel was discovered (if auto-detected) */
  discovered_at?: Date;

  /** When the user confirmed/customized the funnel */
  confirmed_at?: Date;

  /** Who confirmed the funnel (user email or 'system') */
  confirmed_by?: string;

  created_at: Date;
  updated_at: Date;
}

/**
 * Template for creating new funnels (omits runtime fields)
 */
export type FunnelTemplate = Omit<FunnelDefinition,
  'id' | 'workspace_id' | 'status' | 'discovered_at' | 'confirmed_at' | 'confirmed_by' | 'created_at' | 'updated_at'
>;

/**
 * Discovery result from AI-assisted analysis
 */
export interface FunnelDiscoveryResult {
  funnel: FunnelDefinition;
  recommendation: {
    template: string;
    confidence: number;
    reasoning: string;
    stages_removed: Array<{ stage_id: string; reason: string }>;
    stages_added: Array<{ id: string; label: string; side: FunnelSide; after_stage: string; reason: string }>;
    post_sale_available: boolean;
  };
}

/**
 * Stage data source for discovery
 */
export interface StageDataSource {
  source: string;
  object: CRMObject;
  field: string;
  normalized_field?: string;
  field_path?: string;
  values: Array<Record<string, any>>;
}

/**
 * Stage mapping from DeepSeek recommendation
 */
export interface StageMappingRecommendation {
  template_stage_id: string;
  crm_object: CRMObject;
  crm_field: string;
  crm_values: string[];
  confidence: number;
  note: string;
}

/**
 * Stage volume metrics (for bowtie analysis)
 */
export interface StageVolume {
  stage_id: string;
  label: string;
  side: FunnelSide;
  order: number;
  total: number;
  new_this_month: number;
  new_last_month: number;
  total_value?: number;
  value_this_month?: number;
  unmapped: boolean;
}

/**
 * Conversion rate between two stages
 */
export interface ConversionRate {
  from_stage: string;
  from_label: string;
  to_stage: string;
  to_label: string;
  current_month: {
    converted: number;
    total: number;
    rate: number;
  };
  prior_month: {
    converted: number;
    total: number;
    rate: number;
  };
  trend: 'improving' | 'stable' | 'declining';
  delta_pp: string;
}

/**
 * Validation errors for funnel definitions
 */
export interface FunnelValidationError {
  field: string;
  message: string;
}

/**
 * Validates a funnel definition
 */
export function validateFunnelDefinition(funnel: Partial<FunnelDefinition>): FunnelValidationError[] {
  const errors: FunnelValidationError[] = [];

  // Must have stages
  if (!funnel.stages || funnel.stages.length === 0) {
    errors.push({ field: 'stages', message: 'Funnel must have at least one stage' });
    return errors;
  }

  // Exactly ONE center stage
  const centerStages = funnel.stages.filter(s => s.side === 'center');
  if (centerStages.length === 0) {
    errors.push({ field: 'stages', message: 'Funnel must have exactly one center stage (won/converted)' });
  } else if (centerStages.length > 1) {
    errors.push({ field: 'stages', message: 'Funnel can only have one center stage' });
  }

  // At least 2 pre_sale stages
  const preSaleStages = funnel.stages.filter(s => s.side === 'pre_sale');
  if (preSaleStages.length < 2) {
    errors.push({ field: 'stages', message: 'Funnel must have at least 2 pre-sale stages' });
  }

  // Order must be sequential with no gaps
  const orders = funnel.stages.map(s => s.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      errors.push({ field: 'stages', message: `Stage order must be sequential (missing order ${i + 1})` });
      break;
    }
  }

  // Stage IDs must be unique
  const stageIds = new Set<string>();
  for (const stage of funnel.stages) {
    if (stageIds.has(stage.id)) {
      errors.push({ field: 'stages', message: `Duplicate stage ID: ${stage.id}` });
    }
    stageIds.add(stage.id);
  }

  // Validate stage sources
  for (const stage of funnel.stages) {
    if (!stage.source.object) {
      errors.push({ field: `stages.${stage.id}.source.object`, message: 'Stage source object is required' });
    }
    if (!stage.source.field && !stage.source.field_path && stage.source.match_type !== 'object_exists') {
      errors.push({ field: `stages.${stage.id}.source.field`, message: 'Stage source field is required (unless match_type is object_exists)' });
    }
  }

  return errors;
}

/**
 * Renumbers stage orders sequentially after modifications
 */
export function renumberStageOrders(stages: FunnelStage[]): FunnelStage[] {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  return sorted.map((stage, index) => ({
    ...stage,
    order: index + 1,
  }));
}
