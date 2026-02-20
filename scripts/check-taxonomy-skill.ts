/**
 * Check ICP Taxonomy Builder skill status and recent runs
 * Run with: npx tsx scripts/check-taxonomy-skill.ts <workspace-name>
 */

import { query } from '../server/db.js';
import { getSkillRegistry } from '../server/skills/registry.js';
import { registerBuiltInSkills } from '../server/skills/index.js';

const workspaceName = process.argv[2] || 'Frontera';

async function main() {
  console.log(`\n🔍 Checking ICP Taxonomy Builder for workspace: ${workspaceName}\n`);

  // Register skills
  registerBuiltInSkills();
  const registry = getSkillRegistry();
  const skill = registry.get('icp-taxonomy-builder');

  if (!skill) {
    console.error('❌ ICP Taxonomy Builder skill not found in registry');
    process.exit(1);
  }

  console.log('✅ Skill registered:', skill.name);
  console.log('   Description:', skill.description);
  console.log('   Category:', skill.category);
  console.log('   Tier:', skill.tier);
  console.log('   Steps:', skill.steps.length);
  console.log('');

  // Get workspace
  const wsResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM workspaces WHERE name ILIKE $1 LIMIT 1`,
    [workspaceName]
  );

  if (wsResult.rows.length === 0) {
    console.error(`❌ Workspace "${workspaceName}" not found`);
    process.exit(1);
  }

  const workspace = wsResult.rows[0];
  console.log(`✅ Workspace found: ${workspace.name} (${workspace.id})\n`);

  // Check recent runs
  const runsResult = await query<{
    run_id: string;
    status: string;
    created_at: string;
    duration_ms: number | null;
    error: string | null;
    output_text: string | null;
  }>(
    `SELECT run_id, status, created_at, duration_ms, error,
            LEFT(output_text, 100) as output_text
     FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = 'icp-taxonomy-builder'
     ORDER BY created_at DESC
     LIMIT 5`,
    [workspace.id]
  );

  console.log(`📊 Recent runs: ${runsResult.rows.length}\n`);

  if (runsResult.rows.length === 0) {
    console.log('⚠️  No runs found. Skill has never been executed.');
    console.log('\n💡 To run the skill:');
    console.log('   1. Navigate to /skills in the UI');
    console.log('   2. Find "ICP Taxonomy Builder" in INTELLIGENCE section');
    console.log('   3. Click "Run Now ▶" button\n');
  } else {
    runsResult.rows.forEach((run, i) => {
      console.log(`Run #${i + 1}:`);
      console.log(`  Run ID: ${run.run_id}`);
      console.log(`  Status: ${run.status}`);
      console.log(`  Created: ${run.created_at}`);
      console.log(`  Duration: ${run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : 'N/A'}`);
      if (run.error) {
        console.log(`  ❌ Error: ${run.error}`);
      }
      if (run.output_text) {
        console.log(`  Output preview: ${run.output_text}...`);
      }
      console.log('');
    });
  }

  // Check if taxonomy data exists
  const taxonomyResult = await query<{
    cnt: string;
    latest_date: string | null;
  }>(
    `SELECT COUNT(*)::text as cnt, MAX(generated_at)::text as latest_date
     FROM icp_taxonomy
     WHERE workspace_id = $1`,
    [workspace.id]
  );

  const taxCount = parseInt(taxonomyResult.rows[0]?.cnt || '0', 10);
  console.log(`📈 Taxonomy records: ${taxCount}`);
  if (taxCount > 0) {
    console.log(`   Latest: ${taxonomyResult.rows[0].latest_date}`);
  } else {
    console.log('   ⚠️  No taxonomy data generated yet');
  }

  // Check prerequisites
  console.log('\n🔧 Checking prerequisites:\n');

  // Check won deals count
  const dealsResult = await query<{ won: string; total: string }>(
    `SELECT
       SUM(CASE WHEN is_won = true THEN 1 ELSE 0 END)::text as won,
       COUNT(*)::text as total
     FROM deals
     WHERE workspace_id = $1 AND is_closed = true`,
    [workspace.id]
  );

  const wonDeals = parseInt(dealsResult.rows[0]?.won || '0', 10);
  const totalClosed = parseInt(dealsResult.rows[0]?.total || '0', 10);

  console.log(`  Won deals: ${wonDeals} (minimum 10 required)`);
  console.log(`  Total closed: ${totalClosed}`);

  if (wonDeals < 10) {
    console.log('  ⚠️  WARNING: Less than 10 won deals. Skill will run but with limited data.');
  } else {
    console.log('  ✅ Sufficient won deals');
  }

  // Check Serper API key
  const serperResult = await query<{ value: string }>(
    `SELECT value FROM credentials
     WHERE workspace_id = $1 AND service = 'serper' AND key = 'api_key'`,
    [workspace.id]
  );

  if (serperResult.rows.length === 0) {
    console.log('  ⚠️  No Serper API key found. Web signals will be skipped.');
    console.log('     Add Serper API key in Settings → Connectors for full enrichment.');
  } else {
    console.log('  ✅ Serper API key configured');
  }

  console.log('\n✨ Done!\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
