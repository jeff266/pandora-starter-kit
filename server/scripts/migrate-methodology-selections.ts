/**
 * Methodology Selections Migration Script
 *
 * Migrates existing workspace methodology selections from context_layer.definitions
 * to the new methodology_configs table with proper scope cascade setup.
 *
 * Run with: npx ts-node server/scripts/migrate-methodology-selections.ts
 *
 * Safe to re-run - uses ON CONFLICT DO NOTHING for idempotency.
 */

import { query } from '../db.js';

interface Workspace {
  id: string;
  name: string;
}

interface MigrationResult {
  workspace_id: string;
  workspace_name: string;
  status: 'created' | 'skipped' | 'defaulted';
  methodology: string | null;
  error?: string;
}

async function migrateMethodologySelections(): Promise<void> {
  console.log('[Methodology Migration] Starting migration of workspace methodology selections...\n');

  const results: MigrationResult[] = [];

  try {
    // Fetch all workspaces
    const workspacesResult = await query<Workspace>(
      `SELECT id, name FROM workspaces ORDER BY name`
    );

    const workspaces = workspacesResult.rows;
    console.log(`[Methodology Migration] Found ${workspaces.length} workspaces to process\n`);

    for (const workspace of workspaces) {
      console.log(`[Methodology Migration] Processing workspace: ${workspace.name} (${workspace.id})`);

      try {
        // Check if workspace already has a methodology config
        const existingConfigResult = await query(
          `SELECT id FROM methodology_configs
           WHERE workspace_id = $1 AND scope_type = 'workspace' AND is_current = true
           LIMIT 1`,
          [workspace.id]
        );

        if (existingConfigResult.rows.length > 0) {
          console.log(`  → Skipped: Workspace already has a methodology config\n`);
          results.push({
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            status: 'skipped',
            methodology: null
          });
          continue;
        }

        // Read current methodology from context_layer.definitions
        const contextResult = await query(
          `SELECT definitions FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
          [workspace.id]
        );

        let methodology = 'meddpicc'; // Default methodology
        let displayName = 'Workspace Default Qualification';

        if (contextResult.rows.length > 0) {
          const definitions = contextResult.rows[0].definitions || {};
          const methodologyValue = definitions.onboarding_Q11_methodology?.value?.methodology;

          if (methodologyValue) {
            methodology = methodologyValue.toLowerCase().replace(/\s+/g, '_');
            displayName = `${methodologyValue} Qualification`;
            console.log(`  → Found methodology: ${methodologyValue}`);
          } else {
            console.log(`  → No methodology found, using default: MEDDPICC`);
          }
        } else {
          console.log(`  → No context layer found, using default: MEDDPICC`);
        }

        // Create methodology_configs row
        // Use ON CONFLICT DO NOTHING to make this script safe to re-run
        const insertResult = await query(
          `INSERT INTO methodology_configs (
            workspace_id,
            scope_type,
            scope_segment,
            scope_product,
            base_methodology,
            display_name,
            config,
            version,
            is_current,
            created_by
          )
          VALUES ($1, 'workspace', NULL, NULL, $2, $3, '{}'::jsonb, 1, true, NULL)
          ON CONFLICT (workspace_id, scope_type, COALESCE(scope_segment, ''), COALESCE(scope_product, ''))
          WHERE is_current = true
          DO NOTHING
          RETURNING id`,
          [workspace.id, methodology, displayName]
        );

        if (insertResult.rows.length > 0) {
          console.log(`  → Created workspace config: ${displayName} (${methodology})\n`);
          results.push({
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            status: 'created',
            methodology
          });
        } else {
          console.log(`  → Skipped: Config already exists (from previous run)\n`);
          results.push({
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            status: 'skipped',
            methodology
          });
        }
      } catch (error: any) {
        console.error(`  → Error processing workspace: ${error.message}\n`);
        results.push({
          workspace_id: workspace.id,
          workspace_name: workspace.name,
          status: 'defaulted',
          methodology: null,
          error: error.message
        });
      }
    }

    // Print summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Migration Summary');
    console.log('═══════════════════════════════════════════════════════════\n');

    const created = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const defaulted = results.filter(r => r.status === 'defaulted').length;

    console.log(`Total workspaces processed: ${results.length}`);
    console.log(`Configs created:           ${created}`);
    console.log(`Configs skipped:           ${skipped}`);
    console.log(`Errors (defaulted):        ${defaulted}\n`);

    if (defaulted > 0) {
      console.log('Workspaces with errors:');
      results
        .filter(r => r.status === 'defaulted')
        .forEach(r => console.log(`  - ${r.workspace_name}: ${r.error}`));
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════\n');

    // Validate by fetching configs for a few workspaces
    console.log('[Methodology Migration] Validating migration...\n');

    const validationWorkspaces = workspaces.slice(0, Math.min(4, workspaces.length));

    for (const workspace of validationWorkspaces) {
      const configsResult = await query(
        `SELECT base_methodology, display_name, version, is_current
         FROM methodology_configs
         WHERE workspace_id = $1 AND scope_type = 'workspace' AND is_current = true`,
        [workspace.id]
      );

      if (configsResult.rows.length > 0) {
        const config = configsResult.rows[0];
        console.log(`✓ ${workspace.name}: ${config.base_methodology} v${config.version} (${config.display_name})`);
      } else {
        console.log(`✗ ${workspace.name}: No config found`);
      }
    }

    console.log('\n[Methodology Migration] Migration completed successfully!');
  } catch (error: any) {
    console.error('\n[Methodology Migration] Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run migration
migrateMethodologySelections()
  .then(() => {
    console.log('\n[Methodology Migration] Exiting...');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[Methodology Migration] Unhandled error:', error);
    process.exit(1);
  });
