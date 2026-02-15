/**
 * Deliverable Pipeline (Full Orchestration)
 *
 * Chains Discovery → Assembly → Population into a single pipeline that
 * produces a fully populated TemplateMatrix ready for rendering.
 */

import { runDimensionDiscovery, DiscoveryOutput } from '../discovery/discovery-engine.js';
import { assembleTemplate, TemplateMatrix } from './template-assembler.js';
import { populateTemplate, PopulationResult, PopulationContext } from './cell-populator.js';
import { query } from '../db.js';

export interface DeliverablePipelineInput {
  workspaceId: string;
  templateType?: string;                     // Default: 'sales_process_map'
  customDimensions?: any[];                  // Optional consultant dimensions
  voiceConfig?: PopulationContext['voiceConfig'];
  skipSynthesis?: boolean;                   // For preview mode — assemble but don't populate synthesis cells
}

export interface DeliverablePipelineOutput {
  discovery: DiscoveryOutput;
  matrix: TemplateMatrix;
  populationStats?: PopulationResult['stats'];

  // Timing
  discovery_ms: number;
  assembly_ms: number;
  population_ms: number;
  total_ms: number;
}

/**
 * Main pipeline: Discovery → Assembly → Population → Persistence
 */
export async function generateDeliverable(
  input: DeliverablePipelineInput
): Promise<DeliverablePipelineOutput> {
  const totalStart = Date.now();
  const { workspaceId, templateType, customDimensions, voiceConfig, skipSynthesis } = input;

  // --- Step 1: Dimension Discovery ---
  const discoveryStart = Date.now();
  const discovery = await runDimensionDiscovery({
    workspaceId,
    templateType,
    customDimensions,
  });
  const discoveryMs = Date.now() - discoveryStart;

  console.log(`[Deliverable] Discovery: ${discovery.dimensions.length} dimensions, ` +
    `${discovery.stages.length} stages, ${discovery.cell_budget.synthesize_cells} synthesis cells`);

  // --- Step 2: Template Assembly ---
  const assemblyStart = Date.now();
  const matrix = assembleTemplate(discovery);
  const assemblyMs = Date.now() - assemblyStart;

  console.log(`[Deliverable] Assembly: ${matrix.cell_count.total} total cells ` +
    `(${matrix.cell_count.static} static, ${matrix.cell_count.config} config, ` +
    `${matrix.cell_count.computed} computed, ${matrix.cell_count.synthesize} synthesize)`);

  // --- Step 3: Cell Population ---
  const populationStart = Date.now();

  // Load workspace config and skill evidence
  const populationContext = await buildPopulationContext(workspaceId, discovery, voiceConfig);

  let populationStats: PopulationResult['stats'] | undefined;

  if (skipSynthesis) {
    // Preview mode — skip synthesis, just populate config and computed
    console.log(`[Deliverable] Preview mode — skipping synthesis cells`);
    // For preview, we don't need to populate at all - just return the assembled matrix
    populationStats = {
      cells_populated: 0,
      cells_degraded: 0,
      cells_failed: 0,
      total_tokens_used: 0,
      total_duration_ms: 0,
      synthesis_calls: 0,
      synthesis_parallelism: 0,
    };
  } else {
    const result = await populateTemplate(matrix, populationContext);
    populationStats = result.stats;

    console.log(`[Deliverable] Population: ${result.stats.cells_populated} populated, ` +
      `${result.stats.cells_degraded} degraded, ${result.stats.cells_failed} failed, ` +
      `${result.stats.total_tokens_used} tokens in ${result.stats.total_duration_ms}ms`);
  }

  const populationMs = Date.now() - populationStart;

  // --- Step 4: Persist the result ---
  await persistDeliverableResult(
    workspaceId,
    templateType || 'sales_process_map',
    matrix,
    discovery,
    populationStats
  );

  return {
    discovery,
    matrix,
    populationStats,
    discovery_ms: discoveryMs,
    assembly_ms: assemblyMs,
    population_ms: populationMs,
    total_ms: Date.now() - totalStart,
  };
}

/**
 * Build population context by loading workspace config and skill evidence
 */
async function buildPopulationContext(
  workspaceId: string,
  discovery: DiscoveryOutput,
  voiceConfig?: PopulationContext['voiceConfig']
): Promise<PopulationContext> {
  // Load workspace config from context_layer
  const configResult = await query(`
    SELECT business_model, team_structure, goals_and_targets, definitions
    FROM context_layer
    WHERE workspace_id = $1
  `, [workspaceId]);

  const workspaceConfig = configResult.rows[0] || {};

  // Load voice config from workspace settings if not provided
  // For now, voice config can be passed in or default to undefined

  // Load latest skill evidence for all skills referenced by included dimensions
  const neededSkills = new Set<string>();
  for (const dim of discovery.dimensions) {
    for (const skillId of dim.skill_inputs) {
      neededSkills.add(skillId);
    }
  }

  const skillEvidence: Record<string, any> = {};
  for (const skillId of neededSkills) {
    const run = await query(`
      SELECT output FROM skill_runs
      WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed' AND output IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1
    `, [workspaceId, skillId]);

    if (run.rows.length > 0) {
      skillEvidence[skillId] = run.rows[0].output;
    }
  }

  return {
    workspaceId,
    workspaceConfig,
    skillEvidence,
    voiceConfig,
  };
}

/**
 * Persist deliverable result to database for caching
 */
async function persistDeliverableResult(
  workspaceId: string,
  templateType: string,
  matrix: TemplateMatrix,
  discovery: DiscoveryOutput,
  populationStats?: PopulationResult['stats']
): Promise<void> {
  // Persist the populated matrix for caching and re-rendering
  await query(`
    INSERT INTO deliverable_results (
      workspace_id,
      template_type,
      discovery,
      matrix,
      generated_at,
      total_tokens,
      total_duration_ms,
      cells_populated,
      cells_degraded
    )
    VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8)
    ON CONFLICT (workspace_id, template_type)
    DO UPDATE SET
      discovery = EXCLUDED.discovery,
      matrix = EXCLUDED.matrix,
      generated_at = EXCLUDED.generated_at,
      total_tokens = EXCLUDED.total_tokens,
      total_duration_ms = EXCLUDED.total_duration_ms,
      cells_populated = EXCLUDED.cells_populated,
      cells_degraded = EXCLUDED.cells_degraded
  `, [
    workspaceId,
    templateType,
    JSON.stringify(discovery),
    JSON.stringify(matrix),
    populationStats?.total_tokens_used || 0,
    populationStats?.total_duration_ms || 0,
    populationStats?.cells_populated || 0,
    populationStats?.cells_degraded || 0,
  ]);
}
