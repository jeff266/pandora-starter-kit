/**
 * Discovery Engine
 *
 * Evaluates workspace data against dimension inclusion criteria to determine
 * which dimensions should appear in a template-driven deliverable.
 *
 * Core workflow:
 * 1. Load workspace context (config, skill evidence, CRM schema)
 * 2. Discover stages from workspace config or deals table
 * 3. Evaluate every dimension's inclusion criteria
 * 4. Return discovered structure with dimensions, stages, and coverage analysis
 */

import { DIMENSION_REGISTRY, DimensionDefinition, InclusionCriteria } from './dimension-registry.js';
import { query } from '../db.js';

export interface DiscoveryInput {
  workspaceId: string;
  templateType?: string;
  customDimensions?: DimensionDefinition[];
}

export interface DiscoveredDimension {
  key: string;
  label: string;
  description: string;
  source_type: string;
  skill_inputs: string[];
  display_order: number;

  // Discovery results
  included: boolean;
  include_reason: string;
  confidence: number;
  status: 'ready' | 'degraded' | 'excluded';
  degradation_reason?: string;

  // Stage applicability
  applicable_stages: string[];       // Which stages this dimension applies to
  degraded_stages: string[];         // Stages where data is insufficient

  // Synthesis metadata (if source_type = 'synthesize')
  synthesis_prompt_template?: string;

  // Config path (if source_type = 'config')
  config_path?: string;

  // Compute function (if source_type = 'computed')
  compute_function?: string;
}

export interface DiscoveredStage {
  stage_name: string;
  stage_normalized: string;
  display_order: number;
  is_open: boolean;
  probability?: number;
  forecast_category?: string;
}

export interface DiscoveryOutput {
  workspace_id: string;
  template_type: string;
  discovered_at: string;

  // The discovered structure
  stages: DiscoveredStage[];
  dimensions: DiscoveredDimension[];

  // Exclusions (for transparency)
  excluded_dimensions: {
    key: string;
    label: string;
    reason: string;
    would_include_if: string;
  }[];

  // Coverage summary
  coverage: {
    total_dimensions_evaluated: number;
    included: number;
    excluded: number;
    degraded: number;
    skills_available: string[];
    skills_missing: string[];
    data_gaps: string[];
  };

  // Cost estimate for cell population
  cell_budget: {
    total_cells: number;
    static_cells: number;
    config_cells: number;
    computed_cells: number;
    synthesize_cells: number;
    estimated_tokens: number;
    estimated_cost_usd: number;
  };
}

interface WorkspaceContext {
  workspace_config: any;
  business_model: any;
  goals_and_targets: any;

  crm_type: 'hubspot' | 'salesforce' | null;
  crm_schema: {
    deal_fields: string[];
    contact_fields: string[];
    custom_fields: string[];
    meddpicc_fields: string[];
    bant_fields: string[];
    competitor_field: string | null;
    loss_reason_field: string | null;
    partner_field: string | null;
  };
  conversation_connected: boolean;
  conversation_source: 'gong' | 'fireflies' | null;

  skill_evidence: {
    [skillId: string]: {
      last_run: string;
      is_stale: boolean;
      evidence: any;
    } | null;
  };

  detected_methodology: string | null;
  detected_motion: string | null;
}

export async function runDimensionDiscovery(input: DiscoveryInput): Promise<DiscoveryOutput> {
  const { workspaceId, templateType = 'sales_process_map', customDimensions = [] } = input;

  // Step 1: Load workspace context
  const context = await loadWorkspaceContext(workspaceId);

  // Step 2: Discover stages
  const stages = await discoverStages(workspaceId, context);

  // Step 3: Evaluate every dimension in the registry
  const allDimensions = [...DIMENSION_REGISTRY, ...customDimensions];
  const evaluationResults = await Promise.all(
    allDimensions.map(dim => evaluateDimension(dim, context, stages))
  );

  // Step 4: Separate included, excluded, degraded
  const included = evaluationResults.filter(r => r.included);
  const excluded = evaluationResults.filter(r => !r.included);

  // Step 5: Calculate cell budget
  const cellBudget = calculateCellBudget(included, stages);

  // Step 6: Determine coverage gaps
  const coverage = calculateCoverage(evaluationResults, context);

  return {
    workspace_id: workspaceId,
    template_type: templateType,
    discovered_at: new Date().toISOString(),
    stages,
    dimensions: included.sort((a, b) => a.display_order - b.display_order),
    excluded_dimensions: excluded.map(d => ({
      key: d.key,
      label: d.label,
      reason: d.include_reason,
      would_include_if: d.degradation_reason || 'Data not available',
    })),
    coverage,
    cell_budget: cellBudget,
  };
}

async function loadWorkspaceContext(workspaceId: string): Promise<WorkspaceContext> {
  // 1. Load context layer values
  const contextRows = await query(`
    SELECT business_model, team_structure, goals_and_targets, definitions
    FROM context_layer
    WHERE workspace_id = $1
  `, [workspaceId]);

  const contextData = contextRows.rows[0] || {
    business_model: {},
    team_structure: {},
    goals_and_targets: {},
    definitions: {},
  };

  // 2. Load connector configs for CRM schema
  const connectors = await query(`
    SELECT connector_name, status
    FROM connections
    WHERE workspace_id = $1 AND status = 'active'
  `, [workspaceId]);

  const crmConnector = connectors.rows.find(
    (c: any) => c.connector_name === 'hubspot' || c.connector_name === 'salesforce'
  );
  const convConnector = connectors.rows.find(
    (c: any) => c.connector_name === 'gong' || c.connector_name === 'fireflies'
  );

  // 3. Load most recent skill evidence
  const referencedSkills = new Set<string>();
  DIMENSION_REGISTRY.forEach(d => d.skill_inputs.forEach(s => referencedSkills.add(s)));

  const skillEvidence: Record<string, any> = {};
  for (const skillId of Array.from(referencedSkills)) {
    const run = await query(`
      SELECT output, completed_at
      FROM skill_runs
      WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    `, [workspaceId, skillId]);

    if (run.rows.length > 0) {
      const staleness = getStalenessThreshold(skillId);
      const lastRun = new Date(run.rows[0].completed_at);
      const isStale = (Date.now() - lastRun.getTime()) > staleness;

      skillEvidence[skillId] = {
        last_run: run.rows[0].completed_at,
        is_stale: isStale,
        evidence: run.rows[0].output,
      };
    } else {
      skillEvidence[skillId] = null;
    }
  }

  // 4. Extract CRM schema metadata (simplified - would query actual CRM fields in production)
  const crmSchema = {
    deal_fields: [],
    contact_fields: [],
    custom_fields: [],
    meddpicc_fields: [],
    bant_fields: [],
    competitor_field: null,
    loss_reason_field: null,
    partner_field: null,
  };

  // 5. Detect methodology from config or CRM fields
  const detected_methodology = detectMethodology(
    contextData.business_model,
    crmSchema
  );

  // 6. Detect sales motion
  const detected_motion = detectMotion(
    skillEvidence['icp-discovery'],
    contextData.business_model
  );

  return {
    workspace_config: contextData,
    business_model: contextData.business_model || {},
    goals_and_targets: contextData.goals_and_targets || {},
    crm_type: crmConnector?.connector_name || null,
    crm_schema: crmSchema,
    conversation_connected: !!convConnector,
    conversation_source: convConnector?.connector_name || null,
    skill_evidence: skillEvidence,
    detected_methodology,
    detected_motion,
  };
}

function detectMethodology(businessModel: any, crmSchema: any): string | null {
  // Priority 1: Explicitly set in workspace config
  if (businessModel?.methodology) {
    return businessModel.methodology;
  }

  // Priority 2: Detected from config inference
  if (businessModel?.detected_methodology) {
    return businessModel.detected_methodology;
  }

  // Priority 3: Infer from CRM fields
  const meddpiccPatterns = [
    'meddpicc', 'meddicc', 'meddic',
    'champion', 'economic_buyer', 'decision_criteria',
    'decision_process', 'paper_process', 'identify_pain',
    'metrics', 'competition'
  ];

  const bantPatterns = [
    'bant', 'budget', 'authority', 'need', 'timeline'
  ];

  const allFields = [
    ...(crmSchema.deal_fields || []),
    ...(crmSchema.custom_fields || []),
  ].map((f: string) => f.toLowerCase());

  const meddpiccMatches = allFields.filter(
    f => meddpiccPatterns.some(p => f.includes(p))
  ).length;

  const bantMatches = allFields.filter(
    f => bantPatterns.some(p => f.includes(p))
  ).length;

  // Require at least 2 field matches to detect a methodology
  if (meddpiccMatches >= 2) return 'MEDDPICC';
  if (bantMatches >= 2) return 'BANT';

  return null;
}

function detectMotion(icpEvidence: any, businessModel: any): string | null {
  // Priority 1: Explicitly set
  if (businessModel?.sales_motion) {
    return businessModel.sales_motion;
  }

  // Priority 2: From ICP Discovery deal source analysis
  if (icpEvidence?.evidence) {
    const dealSources = icpEvidence.evidence.deal_source_distribution
      || icpEvidence.evidence.parameters?.deal_sources;

    if (dealSources) {
      const selfServePercent = dealSources.self_serve_percentage
        || dealSources.product_signup_percentage || 0;
      const outboundPercent = dealSources.outbound_percentage || 0;
      const partnerPercent = dealSources.partner_percentage || 0;

      if (selfServePercent > 40) return 'plg';
      if (selfServePercent > 15) return 'hybrid';
      if (outboundPercent > 60) return 'outbound';
      if (partnerPercent > 30) return 'channel';
    }
  }

  return null;
}

async function discoverStages(
  workspaceId: string,
  context: WorkspaceContext
): Promise<DiscoveredStage[]> {
  // Priority 1: From workspace config (already normalized by config inference)
  const configStages = context.workspace_config?.pipelines?.[0]?.stages;
  if (configStages && configStages.length > 0) {
    return configStages.map((s: any, i: number) => ({
      stage_name: s.name || s.stage_name,
      stage_normalized: s.normalized || s.stage_normalized,
      display_order: s.display_order || i + 1,
      is_open: s.is_open !== false,
      probability: s.probability,
      forecast_category: s.forecast_category,
    }));
  }

  // Priority 2: From deals table directly (fallback)
  const dealStages = await query(`
    SELECT DISTINCT stage,
      CASE
        WHEN stage ILIKE '%discovery%' THEN 'discovery'
        WHEN stage ILIKE '%qualif%' THEN 'qualification'
        WHEN stage ILIKE '%proposal%' OR stage ILIKE '%quote%' THEN 'proposal'
        WHEN stage ILIKE '%negoti%' OR stage ILIKE '%contract%' THEN 'negotiation'
        WHEN stage ILIKE '%won%' AND stage ILIKE '%close%' THEN 'closed_won'
        WHEN stage ILIKE '%lost%' AND stage ILIKE '%close%' THEN 'closed_lost'
        ELSE 'other'
      END as stage_normalized,
      COUNT(*) as deal_count
    FROM deals
    WHERE workspace_id = $1 AND stage IS NOT NULL
    GROUP BY stage, stage_normalized
    ORDER BY deal_count DESC
  `, [workspaceId]);

  return dealStages.rows.map((r: any, i: number) => ({
    stage_name: r.stage,
    stage_normalized: r.stage_normalized,
    display_order: i + 1,
    is_open: r.stage_normalized !== 'closed_won' && r.stage_normalized !== 'closed_lost',
    probability: null,
    forecast_category: null,
  }));
}

async function evaluateDimension(
  dimension: DimensionDefinition,
  context: WorkspaceContext,
  stages: DiscoveredStage[]
): Promise<DiscoveredDimension> {
  // Universal dimensions are always included
  if (dimension.category === 'universal') {
    const applicableStages = filterApplicableStages(dimension, stages);
    return {
      key: dimension.key,
      label: dimension.label,
      description: dimension.description,
      source_type: dimension.source_type,
      skill_inputs: dimension.skill_inputs,
      display_order: dimension.display_order,
      included: true,
      include_reason: 'Universal dimension — always included',
      confidence: 1.0,
      status: checkSkillAvailability(dimension, context) ? 'ready' : 'degraded',
      degradation_reason: checkSkillAvailability(dimension, context)
        ? undefined
        : `Missing skill data: ${getMissingSkills(dimension, context).join(', ')}`,
      applicable_stages: applicableStages.map(s => s.stage_normalized),
      degraded_stages: getDegradedStages(dimension, context, applicableStages),
      synthesis_prompt_template: dimension.synthesis_prompt_template,
      config_path: dimension.config_path,
      compute_function: dimension.compute_function,
    };
  }

  // Conditional dimensions — evaluate inclusion criteria
  if (!dimension.inclusion_criteria) {
    return makeExcluded(dimension, 'No inclusion criteria defined');
  }

  const evaluation = evaluateCriteria(dimension.inclusion_criteria, context);

  if (!evaluation.include) {
    return makeExcluded(dimension, evaluation.reason);
  }

  const applicableStages = filterApplicableStages(dimension, stages);

  return {
    key: dimension.key,
    label: dimension.label,
    description: dimension.description,
    source_type: dimension.source_type,
    skill_inputs: dimension.skill_inputs,
    display_order: dimension.display_order,
    included: true,
    include_reason: evaluation.reason,
    confidence: evaluation.confidence,
    status: evaluation.degraded ? 'degraded' : 'ready',
    degradation_reason: evaluation.degraded ? evaluation.degradation_reason : undefined,
    applicable_stages: applicableStages.map(s => s.stage_normalized),
    degraded_stages: getDegradedStages(dimension, context, applicableStages),
    synthesis_prompt_template: dimension.synthesis_prompt_template,
    config_path: dimension.config_path,
    compute_function: dimension.compute_function,
  };
}

interface CriteriaResult {
  include: boolean;
  confidence: number;
  reason: string;
  degraded: boolean;
  degradation_reason?: string;
}

function evaluateCriteria(
  criteria: InclusionCriteria,
  context: WorkspaceContext
): CriteriaResult {
  switch (criteria.check_type) {
    case 'config_field_exists':
      return evaluateConfigFieldExists(criteria, context);
    case 'config_field_value':
      return evaluateConfigFieldValue(criteria, context);
    case 'skill_evidence_threshold':
      return evaluateSkillEvidenceThreshold(criteria, context);
    case 'data_coverage_threshold':
      return evaluateDataCoverageThreshold(criteria, context);
    case 'crm_field_pattern':
      return evaluateCrmFieldPattern(criteria, context);
    case 'compound':
      return evaluateCompound(criteria, context);
    default:
      return { include: false, confidence: 0, reason: `Unknown check type: ${criteria.check_type}`, degraded: false };
  }
}

function evaluateConfigFieldExists(criteria: InclusionCriteria, context: WorkspaceContext): CriteriaResult {
  const value = getNestedValue(context.workspace_config, criteria.config_field!);
  if (value !== undefined && value !== null) {
    return {
      include: true,
      confidence: 0.9,
      reason: `Config field '${criteria.config_field}' exists`,
      degraded: false
    };
  }
  return handleMissing(criteria, `Config field '${criteria.config_field}' not found`);
}

function evaluateConfigFieldValue(criteria: InclusionCriteria, context: WorkspaceContext): CriteriaResult {
  // Handle methodology detection specially
  if (criteria.config_field === 'detected_methodology') {
    const detected = context.detected_methodology;
    if (!detected) {
      return handleMissing(criteria, 'No methodology detected');
    }

    const expectedNorm = (criteria.expected_value as string).toUpperCase();
    const detectedNorm = detected.toUpperCase();

    const methodologyFamilies: Record<string, string[]> = {
      'MEDDPICC': ['MEDDPICC', 'MEDDICC', 'MEDDIC'],
      'BANT': ['BANT'],
      'SPICED': ['SPICED'],
    };

    const family = methodologyFamilies[expectedNorm] || [expectedNorm];
    const matches = family.includes(detectedNorm);

    // For inverted checks
    if (criteria.threshold_type === 'boolean') {
      return matches
        ? { include: false, confidence: 0.9, reason: `${detected} detected — excluding`, degraded: false }
        : { include: true, confidence: 0.9, reason: `${expectedNorm} not detected`, degraded: false };
    }

    return matches
      ? { include: true, confidence: 0.9, reason: `${detected} methodology detected`, degraded: false }
      : { include: false, confidence: 0.8, reason: `Expected ${expectedNorm} but found ${detected}`, degraded: false };
  }

  const value = getNestedValue(context.workspace_config, criteria.config_field!);
  if (value === criteria.expected_value) {
    return { include: true, confidence: 0.9, reason: `${criteria.config_field} = ${value}`, degraded: false };
  }
  return handleMissing(criteria, `${criteria.config_field} is '${value}', expected '${criteria.expected_value}'`);
}

function evaluateSkillEvidenceThreshold(criteria: InclusionCriteria, context: WorkspaceContext): CriteriaResult {
  const skillData = context.skill_evidence[criteria.skill_id!];

  if (!skillData) {
    return handleMissing(criteria, `Skill '${criteria.skill_id}' has never run`);
  }

  const value = getNestedValue(skillData.evidence, criteria.evidence_field!);

  if (value === undefined || value === null) {
    return handleMissing(criteria, `Evidence field '${criteria.evidence_field}' not found in ${criteria.skill_id} output`);
  }

  const numValue = Number(value);
  const threshold = criteria.threshold!;

  if (numValue >= threshold) {
    return {
      include: true,
      confidence: Math.min(0.95, 0.7 + (numValue / threshold) * 0.1),
      reason: `${criteria.evidence_field} = ${numValue}${criteria.threshold_type === 'percentage' ? '%' : ''} (threshold: ${threshold}${criteria.threshold_type === 'percentage' ? '%' : ''})`,
      degraded: false
    };
  }

  return {
    include: false,
    confidence: 0.7,
    reason: `${criteria.evidence_field} = ${numValue}${criteria.threshold_type === 'percentage' ? '%' : ''}, below threshold of ${threshold}${criteria.threshold_type === 'percentage' ? '%' : ''}`,
    degraded: false
  };
}

function evaluateDataCoverageThreshold(criteria: InclusionCriteria, context: WorkspaceContext): CriteriaResult {
  // Simplified implementation - would check actual data coverage in production
  return handleMissing(criteria, 'Data coverage threshold check not implemented');
}

function evaluateCrmFieldPattern(criteria: InclusionCriteria, context: WorkspaceContext): CriteriaResult {
  // Simplified implementation - would check CRM field patterns in production
  return handleMissing(criteria, 'CRM field pattern check not implemented');
}

function evaluateCompound(criteria: InclusionCriteria, context: WorkspaceContext): CriteriaResult {
  if (!criteria.criteria || criteria.criteria.length === 0) {
    return { include: false, confidence: 0, reason: 'Empty compound criteria', degraded: false };
  }

  const results = criteria.criteria.map(c => evaluateCriteria(c, context));

  if (criteria.operator === 'AND') {
    const allInclude = results.every(r => r.include);
    const minConfidence = Math.min(...results.map(r => r.confidence));
    const reasons = results.map(r => r.reason).join('; ');
    const anyDegraded = results.some(r => r.degraded);

    return {
      include: allInclude,
      confidence: allInclude ? minConfidence : 0,
      reason: allInclude ? reasons : `AND condition failed: ${reasons}`,
      degraded: anyDegraded,
      degradation_reason: anyDegraded
        ? results.filter(r => r.degraded).map(r => r.degradation_reason).join('; ')
        : undefined,
    };
  }

  // OR
  const anyInclude = results.some(r => r.include);
  const included = results.filter(r => r.include);
  const maxConfidence = included.length > 0
    ? Math.max(...included.map(r => r.confidence))
    : 0;
  const bestReason = included.length > 0
    ? included.sort((a, b) => b.confidence - a.confidence)[0].reason
    : results.map(r => r.reason).join('; ');

  return {
    include: anyInclude,
    confidence: maxConfidence,
    reason: anyInclude ? bestReason : `OR condition failed: ${bestReason}`,
    degraded: anyInclude && included.some(r => r.degraded),
    degradation_reason: included.find(r => r.degraded)?.degradation_reason,
  };
}

function handleMissing(criteria: InclusionCriteria, reason: string): CriteriaResult {
  if (criteria.on_missing === 'include_degraded') {
    return {
      include: true,
      confidence: 0.3,
      reason: `${reason} — included as degraded`,
      degraded: true,
      degradation_reason: reason,
    };
  }
  return { include: false, confidence: 0, reason, degraded: false };
}

function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function filterApplicableStages(dimension: DimensionDefinition, stages: DiscoveredStage[]): DiscoveredStage[] {
  let applicable = stages;

  if (dimension.only_stages && dimension.only_stages.length > 0) {
    applicable = applicable.filter(s => dimension.only_stages!.includes(s.stage_normalized));
  }

  if (dimension.exclude_stages && dimension.exclude_stages.length > 0) {
    applicable = applicable.filter(s => !dimension.exclude_stages!.includes(s.stage_normalized));
  }

  return applicable;
}

function checkSkillAvailability(dimension: DimensionDefinition, context: WorkspaceContext): boolean {
  return dimension.skill_inputs.every(
    skillId => context.skill_evidence[skillId] !== null
  );
}

function getMissingSkills(dimension: DimensionDefinition, context: WorkspaceContext): string[] {
  return dimension.skill_inputs.filter(
    skillId => context.skill_evidence[skillId] === null
  );
}

function getDegradedStages(
  dimension: DimensionDefinition,
  context: WorkspaceContext,
  applicableStages: DiscoveredStage[]
): string[] {
  if (!checkSkillAvailability(dimension, context)) {
    return applicableStages.map(s => s.stage_normalized);
  }
  return [];
}

function getStalenessThreshold(skillId: string): number {
  const thresholds: Record<string, number> = {
    'pipeline-hygiene': 24 * 60 * 60 * 1000,
    'single-thread-alert': 24 * 60 * 60 * 1000,
    'data-quality-audit': 7 * 24 * 60 * 60 * 1000,
    'pipeline-coverage': 24 * 60 * 60 * 1000,
    'icp-discovery': 30 * 24 * 60 * 60 * 1000,
    'lead-scoring': 24 * 60 * 60 * 1000,
    'workspace-config-audit': 7 * 24 * 60 * 60 * 1000,
    'forecast-rollup': 24 * 60 * 60 * 1000,
    'pipeline-waterfall': 7 * 24 * 60 * 60 * 1000,
  };
  return thresholds[skillId] || 7 * 24 * 60 * 60 * 1000;
}

function calculateCellBudget(
  dimensions: DiscoveredDimension[],
  stages: DiscoveredStage[]
): DiscoveryOutput['cell_budget'] {
  let static_cells = 0;
  let config_cells = 0;
  let computed_cells = 0;
  let synthesize_cells = 0;

  for (const dim of dimensions) {
    const stageCount = dim.applicable_stages.length;
    switch (dim.source_type) {
      case 'static': static_cells += stageCount; break;
      case 'config': config_cells += stageCount; break;
      case 'computed': computed_cells += stageCount; break;
      case 'synthesize': synthesize_cells += stageCount; break;
    }
  }

  const total_cells = static_cells + config_cells + computed_cells + synthesize_cells;
  const estimated_tokens = synthesize_cells * 600;
  const estimated_cost_usd = estimated_tokens * 0.000015;

  return { total_cells, static_cells, config_cells, computed_cells, synthesize_cells, estimated_tokens, estimated_cost_usd };
}

function calculateCoverage(
  results: DiscoveredDimension[],
  context: WorkspaceContext
): DiscoveryOutput['coverage'] {
  const included = results.filter(r => r.included);
  const excluded = results.filter(r => !r.included);
  const degraded = included.filter(r => r.status === 'degraded');

  const allSkillInputs = new Set<string>();
  results.forEach(r => r.skill_inputs.forEach(s => allSkillInputs.add(s)));

  const skillsAvailable = Array.from(allSkillInputs).filter(s => context.skill_evidence[s] !== null);
  const skillsMissing = Array.from(allSkillInputs).filter(s => context.skill_evidence[s] === null);

  const dataGaps: string[] = [];
  if (!context.conversation_connected) {
    dataGaps.push('No conversation intelligence connected — limited dimensions');
  }
  if (!context.detected_methodology) {
    dataGaps.push('No sales methodology detected — methodology-specific dimensions excluded');
  }
  if (context.detected_motion === null) {
    dataGaps.push('Sales motion not determined — motion-specific dimensions excluded');
  }

  return {
    total_dimensions_evaluated: results.length,
    included: included.length,
    excluded: excluded.length,
    degraded: degraded.length,
    skills_available: skillsAvailable,
    skills_missing: skillsMissing,
    data_gaps: dataGaps,
  };
}

function makeExcluded(dimension: DimensionDefinition, reason: string): DiscoveredDimension {
  return {
    key: dimension.key,
    label: dimension.label,
    description: dimension.description,
    source_type: dimension.source_type,
    skill_inputs: dimension.skill_inputs,
    display_order: dimension.display_order,
    included: false,
    include_reason: reason,
    confidence: 0,
    status: 'excluded',
    applicable_stages: [],
    degraded_stages: [],
  };
}
