/**
 * Metric Seeder — Phase 5
 *
 * Seeds standard metrics into metric_definitions table per workspace.
 * Idempotent: never overwrites existing metrics.
 */

import { query } from '../db.js';
import { STANDARD_METRIC_LIBRARY } from './standard-metrics.js';
import { invalidateWorkspaceIntelligence } from './workspace-intelligence.js';

export interface SeedResult {
  workspace_id: string;
  inserted: string[];      // metric_keys newly inserted
  skipped: string[];       // metric_keys already present
  errors: string[];        // metric_keys that failed with reason
}

/**
 * Seeds standard metrics for a single workspace.
 * Idempotent - skips metrics that already exist.
 */
export async function seedStandardMetrics(workspaceId: string): Promise<SeedResult> {
  const result: SeedResult = {
    workspace_id: workspaceId,
    inserted: [],
    skipped: [],
    errors: [],
  };

  console.log(`[MetricSeeder] Seeding ${STANDARD_METRIC_LIBRARY.length} standard metrics for workspace ${workspaceId}`);

  for (const metric of STANDARD_METRIC_LIBRARY) {
    try {
      // Check if metric already exists
      const existsResult = await query<{ exists: boolean }>(
        `SELECT EXISTS(
          SELECT 1 FROM metric_definitions
          WHERE workspace_id = $1 AND metric_key = $2
        ) as exists`,
        [workspaceId, metric.metric_key]
      );

      if (existsResult.rows[0]?.exists) {
        result.skipped.push(metric.metric_key);
        console.log(`[MetricSeeder]   - ${metric.metric_key}: skipped (already exists)`);
        continue;
      }

      // Insert new metric
      await query(
        `INSERT INTO metric_definitions (
          workspace_id,
          metric_key,
          label,
          description,
          numerator,
          denominator,
          aggregation_method,
          unit,
          segmentation_defaults,
          confidence,
          source,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
        )`,
        [
          workspaceId,
          metric.metric_key,
          metric.label,
          metric.description,
          JSON.stringify(metric.numerator),
          metric.denominator ? JSON.stringify(metric.denominator) : null,
          metric.aggregation_method,
          metric.unit,
          metric.segmentation_defaults.length > 0 ? metric.segmentation_defaults : null,
          'INFERRED',  // All standard metrics start as INFERRED
          'SYSTEM',     // Source is SYSTEM for standard library
        ]
      );

      result.inserted.push(metric.metric_key);
      console.log(`[MetricSeeder]   ✓ ${metric.metric_key}: inserted`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push(`${metric.metric_key}: ${errorMessage}`);
      console.error(`[MetricSeeder]   ✗ ${metric.metric_key}: ${errorMessage}`);
    }
  }

  // Invalidate WorkspaceIntelligence cache after seeding
  if (result.inserted.length > 0) {
    invalidateWorkspaceIntelligence(workspaceId);
    console.log(`[MetricSeeder] Cache invalidated for workspace ${workspaceId}`);
  }

  console.log(`[MetricSeeder] Seed complete for ${workspaceId}: ${result.inserted.length} inserted, ${result.skipped.length} skipped, ${result.errors.length} errors`);
  return result;
}

/**
 * Seeds standard metrics for all workspaces in the database.
 * Useful for bulk forward deployment.
 */
export async function seedAllWorkspaces(): Promise<SeedResult[]> {
  console.log('[MetricSeeder] Starting bulk seed for all workspaces');

  // Get all workspace IDs
  const workspacesResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM workspaces ORDER BY created_at ASC`
  );

  const workspaces = workspacesResult.rows;
  console.log(`[MetricSeeder] Found ${workspaces.length} workspaces to seed`);

  const results: SeedResult[] = [];

  for (const workspace of workspaces) {
    console.log(`\n[MetricSeeder] === Seeding workspace: ${workspace.name} (${workspace.id}) ===`);
    const result = await seedStandardMetrics(workspace.id);
    results.push(result);
  }

  // Summary
  const totalInserted = results.reduce((sum, r) => sum + r.inserted.length, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  console.log('\n' + '='.repeat(80));
  console.log('[MetricSeeder] BULK SEED SUMMARY');
  console.log('='.repeat(80));
  console.log(`Workspaces processed: ${workspaces.length}`);
  console.log(`Total metrics inserted: ${totalInserted}`);
  console.log(`Total metrics skipped: ${totalSkipped}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log('='.repeat(80));

  return results;
}
