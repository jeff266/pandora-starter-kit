/**
 * Forward Deploy Seeder — Phase 8
 *
 * Seeds workspaces with metric definitions and calibration checklist questions.
 * Pre-populates answers from existing workspace_config where possible.
 */

import { query } from '../db.js';
import { seedStandardMetrics, type SeedResult } from './metric-seeder.js';
import { CALIBRATION_QUESTIONS } from './calibration-questions.js';
import { invalidateWorkspaceIntelligence } from './workspace-intelligence.js';

// ============================================================
// INTERFACES
// ============================================================

export interface ChecklistSeedResult {
  inserted: string[];      // question_ids newly inserted
  skipped: string[];       // question_ids already present
  pre_populated: string[]; // question_ids pre-populated from config
  errors: string[];        // question_ids that failed with reason
}

export interface WorkspaceSeedResult {
  workspace_id: string;
  workspace_name: string;
  metrics: SeedResult;
  checklist: ChecklistSeedResult;
  pre_populated: string[];  // question_ids pre-populated from existing config
  errors: string[];
}

// ============================================================
// SEED WORKSPACE FOR FORWARD DEPLOY
// ============================================================

/**
 * Seeds a single workspace with metric definitions and calibration checklist.
 * Pre-populates answers from existing workspace_config where possible.
 * Idempotent - safe to run multiple times.
 */
export async function seedWorkspaceForForwardDeploy(
  workspaceId: string
): Promise<WorkspaceSeedResult> {
  console.log(`\n[ForwardDeploySeeder] === Seeding workspace: ${workspaceId} ===`);

  // Get workspace name
  const workspaceResult = await query<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  const workspaceName = workspaceResult.rows[0]?.name || 'Unknown';

  const result: WorkspaceSeedResult = {
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    metrics: { workspace_id: workspaceId, inserted: [], skipped: [], errors: [] },
    checklist: { inserted: [], skipped: [], pre_populated: [], errors: [] },
    pre_populated: [],
    errors: [],
  };

  try {
    // Step 1: Seed metrics
    console.log(`[ForwardDeploySeeder] Step 1: Seeding metrics`);
    result.metrics = await seedStandardMetrics(workspaceId);

    // Step 2: Seed calibration checklist questions
    console.log(`[ForwardDeploySeeder] Step 2: Seeding calibration checklist`);
    result.checklist = await seedCalibrationChecklist(workspaceId);

    // Step 3: Pre-populate from existing workspace_config
    console.log(`[ForwardDeploySeeder] Step 3: Pre-populating from workspace_config`);
    const prePopulated = await prePopulateFromConfig(workspaceId);
    result.pre_populated = prePopulated;
    result.checklist.pre_populated = prePopulated;

    // Step 4: Invalidate cache
    invalidateWorkspaceIntelligence(workspaceId);
    console.log(`[ForwardDeploySeeder] Cache invalidated for workspace ${workspaceId}`);

    console.log(`[ForwardDeploySeeder] Seed complete for ${workspaceName}:`);
    console.log(`  Metrics: ${result.metrics.inserted.length} inserted, ${result.metrics.skipped.length} skipped`);
    console.log(`  Checklist: ${result.checklist.inserted.length} inserted, ${result.checklist.skipped.length} skipped`);
    console.log(`  Pre-populated: ${result.pre_populated.length} questions`);

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result.errors.push(errorMessage);
    console.error(`[ForwardDeploySeeder] Seed failed for ${workspaceId}:`, errorMessage);
    return result;
  }
}

// ============================================================
// SEED CALIBRATION CHECKLIST
// ============================================================

/**
 * Seeds calibration checklist questions for a workspace.
 * Idempotent - skips questions that already exist.
 */
async function seedCalibrationChecklist(workspaceId: string): Promise<ChecklistSeedResult> {
  const result: ChecklistSeedResult = {
    inserted: [],
    skipped: [],
    pre_populated: [],
    errors: [],
  };

  for (const question of CALIBRATION_QUESTIONS) {
    try {
      // Check if question already exists
      const existsResult = await query<{ exists: boolean }>(
        `SELECT EXISTS(
          SELECT 1 FROM calibration_checklist
          WHERE workspace_id = $1 AND question_id = $2
        ) as exists`,
        [workspaceId, question.question_id]
      );

      if (existsResult.rows[0]?.exists) {
        result.skipped.push(question.question_id);
        continue;
      }

      // Insert new question
      await query(
        `INSERT INTO calibration_checklist (
          workspace_id,
          question_id,
          domain,
          question,
          status,
          confidence,
          answer,
          answer_source,
          depends_on,
          skill_dependencies,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
        )`,
        [
          workspaceId,
          question.question_id,
          question.domain,
          question.question,
          'UNKNOWN',  // Default status
          0.5,        // Default confidence
          null,       // No answer yet
          null,       // No answer source yet
          question.depends_on.length > 0 ? question.depends_on : null,
          question.skill_dependencies.length > 0 ? question.skill_dependencies : null,
        ]
      );

      result.inserted.push(question.question_id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push(`${question.question_id}: ${errorMessage}`);
      console.error(`[ForwardDeploySeeder]   ✗ ${question.question_id}: ${errorMessage}`);
    }
  }

  console.log(`[ForwardDeploySeeder] Checklist seed: ${result.inserted.length} inserted, ${result.skipped.length} skipped`);
  return result;
}

// ============================================================
// PRE-POPULATE FROM WORKSPACE CONFIG
// ============================================================

/**
 * Pre-populates calibration checklist answers from existing workspace_config.
 * Updates status to INFERRED and sets answer_source to CRM_SCAN.
 */
async function prePopulateFromConfig(workspaceId: string): Promise<string[]> {
  const prePopulated: string[] = [];

  try {
    // Fetch workspace_config and business_dimensions
    const [configResult, dimensionsResult] = await Promise.all([
      query<{ workspace_config: any }>(
        `SELECT workspace_config FROM workspaces WHERE id = $1`,
        [workspaceId]
      ),
      query<{ crm_field: string; crm_values: string[]; entity: string }>(
        `SELECT crm_field, crm_values, entity
         FROM business_dimensions
         WHERE workspace_id = $1 AND confirmed = true
         LIMIT 1`,
        [workspaceId]
      ),
    ]);

    const config = configResult.rows[0]?.workspace_config;
    const dimension = dimensionsResult.rows[0];

    if (!config && !dimension) {
      console.log(`[ForwardDeploySeeder] No existing config to pre-populate from`);
      return prePopulated;
    }

    // Pre-population mappings
    const mappings: Array<{
      questionId: string;
      value: any;
      condition: boolean;
    }> = [];

    // Pipeline active stages
    if (config?.pipelines?.[0]?.stages && Array.isArray(config.pipelines[0].stages)) {
      const stages = config.pipelines[0].stages;
      if (stages.length > 0) {
        mappings.push({
          questionId: 'pipeline_active_stages',
          value: stages,
          condition: true,
        });
      }
    }

    // Pipeline coverage target
    if (config?.pipelines?.[0]?.coverageTarget) {
      mappings.push({
        questionId: 'pipeline_coverage_target',
        value: config.pipelines[0].coverageTarget,
        condition: typeof config.pipelines[0].coverageTarget === 'number',
      });
    }

    // Win rate denominator
    if (config?.win_rate?.method) {
      mappings.push({
        questionId: 'win_rate_denominator',
        value: config.win_rate.method,
        condition: true,
      });
    }

    // At-risk definition
    if (config?.thresholds?.atRisk) {
      mappings.push({
        questionId: 'at_risk_definition',
        value: JSON.stringify(config.thresholds.atRisk),
        condition: true,
      });
    }

    // Segmentation from business_dimensions
    if (dimension) {
      if (dimension.crm_field) {
        mappings.push({
          questionId: 'segmentation_field',
          value: dimension.crm_field,
          condition: true,
        });
      }
      if (dimension.crm_values && Array.isArray(dimension.crm_values) && dimension.crm_values.length > 0) {
        mappings.push({
          questionId: 'segmentation_values',
          value: dimension.crm_values,
          condition: true,
        });
      }
      if (dimension.entity) {
        mappings.push({
          questionId: 'segmentation_entity',
          value: dimension.entity,
          condition: true,
        });
      }
    }

    // Apply mappings
    for (const mapping of mappings) {
      if (!mapping.condition) continue;

      try {
        const updateResult = await query(
          `UPDATE calibration_checklist
           SET status = 'INFERRED',
               answer_source = 'CRM_SCAN',
               answer = $1,
               confidence = 0.7,
               updated_at = NOW()
           WHERE workspace_id = $2 AND question_id = $3 AND status = 'UNKNOWN'
           RETURNING question_id`,
          [JSON.stringify({ value: mapping.value }), workspaceId, mapping.questionId]
        );

        if (updateResult.rows.length > 0) {
          prePopulated.push(mapping.questionId);
          console.log(`[ForwardDeploySeeder]   ✓ Pre-populated: ${mapping.questionId}`);
        }
      } catch (err) {
        console.error(`[ForwardDeploySeeder]   ✗ Failed to pre-populate ${mapping.questionId}:`, err);
      }
    }

    console.log(`[ForwardDeploySeeder] Pre-populated ${prePopulated.length} questions`);
    return prePopulated;
  } catch (err) {
    console.error(`[ForwardDeploySeeder] Pre-population failed:`, err);
    return prePopulated;
  }
}

// ============================================================
// SEED ALL EXISTING WORKSPACES
// ============================================================

/**
 * Seeds all existing workspaces with metrics and calibration checklist.
 * Useful for bulk forward deployment.
 */
export async function seedAllExistingWorkspaces(): Promise<WorkspaceSeedResult[]> {
  console.log('[ForwardDeploySeeder] Starting bulk seed for all workspaces');

  // Get all workspace IDs
  const workspacesResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM workspaces ORDER BY created_at ASC`
  );

  const workspaces = workspacesResult.rows;
  console.log(`[ForwardDeploySeeder] Found ${workspaces.length} workspaces to seed`);

  const results: WorkspaceSeedResult[] = [];

  for (const workspace of workspaces) {
    const result = await seedWorkspaceForForwardDeploy(workspace.id);
    results.push(result);
  }

  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('[ForwardDeploySeeder] BULK SEED SUMMARY');
  console.log('='.repeat(80));
  console.log(
    `${'Workspace'.padEnd(20)} ${'Metrics'.padEnd(15)} ${'Checklist'.padEnd(15)} ${'Pre-populated'.padEnd(15)}`
  );
  console.log('-'.repeat(80));

  for (const result of results) {
    const metricsStr = `${result.metrics.inserted.length}/${result.metrics.skipped.length}/${result.metrics.errors.length}`;
    const checklistStr = `${result.checklist.inserted.length}/${result.checklist.skipped.length}/${result.checklist.errors.length}`;
    const prePopStr = `${result.pre_populated.length} questions`;

    console.log(
      `${result.workspace_name.padEnd(20)} ${metricsStr.padEnd(15)} ${checklistStr.padEnd(15)} ${prePopStr.padEnd(15)}`
    );
  }

  console.log('='.repeat(80));
  console.log(`Workspaces processed: ${workspaces.length}`);
  console.log('='.repeat(80));

  return results;
}
