/**
 * Test Quota Upload Feature
 *
 * Tests the Excel/CSV upload flow end-to-end:
 * 1. Create sample CSV
 * 2. POST to upload endpoint
 * 3. Review preview
 * 4. POST to confirm endpoint
 * 5. GET quotas to verify
 * 6. Run forecast-rollup skill to verify attainment
 */

import { query } from '../server/db.js';
import { parseQuotaFile, classifyColumns, buildPreview, applyQuotas } from '../server/quotas/upload-parser.js';

async function testQuotaUpload() {
  console.log('===================================');
  console.log('Quota Upload Test');
  console.log('===================================\n');

  // Step 1: Get Frontera workspace
  const workspaceResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM workspaces WHERE name ILIKE '%frontera%' LIMIT 1`
  );

  if (workspaceResult.rows.length === 0) {
    console.error('❌ No Frontera workspace found');
    process.exit(1);
  }

  const workspace = workspaceResult.rows[0];
  console.log(`✓ Found workspace: ${workspace.name} (${workspace.id})\n`);

  // Step 2: Create sample CSV
  const csvContent = `Rep Name,Email,Q1 2026 Quota
Nate Phillips,nate@frontera.com,1000000
Sara Bollman,sara@frontera.com,800000
Carter McKay,carter@frontera.com,500000
Jack McArdle,jack@frontera.com,500000`;

  const csvBuffer = Buffer.from(csvContent, 'utf-8');
  console.log('✓ Created sample CSV with 4 reps\n');
  console.log('Sample data:');
  console.log(csvContent);
  console.log();

  // Step 3: Parse file
  console.log('[Step 1/5] Parsing CSV file...');
  const parsed = parseQuotaFile(csvBuffer, 'test-quotas.csv');
  console.log(`✓ Parsed: ${parsed.totalRows} rows, ${parsed.headers.length} columns`);
  console.log(`  Headers: ${parsed.headers.join(', ')}`);
  console.log(`  Has header row: ${parsed.hasHeaderRow}\n`);

  // Step 4: Classify columns with AI
  console.log('[Step 2/5] Classifying columns with DeepSeek...');
  try {
    const classification = await classifyColumns(
      parsed.headers,
      parsed.sampleRows,
      workspace.id
    );
    console.log('✓ AI Classification completed:');
    console.log(`  Rep Name: Column ${classification.mapping.rep_name.column_index} (${classification.mapping.rep_name.confidence * 100}% confident)`);
    console.log(`  Rep Email: Column ${classification.mapping.rep_email.column_index} (${classification.mapping.rep_email.confidence * 100}% confident)`);
    console.log(`  Quota Amount: Column ${classification.mapping.quota_amount.column_index} (${classification.mapping.quota_amount.confidence * 100}% confident)`);
    console.log(`  Period: ${classification.inferred_period}`);
    console.log(`  Period Type: ${classification.period_type}`);
    console.log(`  Total Quota: $${classification.total_quota_amount.toLocaleString()}`);
    console.log(`  Notes: ${classification.notes}\n`);

    // Step 5: Build preview
    console.log('[Step 3/5] Building preview...');
    const preview = buildPreview(parsed, classification);
    console.log('✓ Preview generated:');
    console.log(`  Period: ${preview.preview.period} (${preview.preview.periodStart} to ${preview.preview.periodEnd})`);
    console.log(`  Team Total: $${preview.preview.teamTotal.toLocaleString()}`);
    console.log(`  Rep Count: ${preview.preview.repCount}`);
    console.log('  Reps:');
    preview.preview.reps.forEach(rep => {
      console.log(`    - ${rep.name} (${rep.email || 'no email'}): $${rep.quota.toLocaleString()}`);
    });
    if (preview.warnings.length > 0) {
      console.log('  Warnings:');
      preview.warnings.forEach(w => console.log(`    ⚠️  ${w}`));
    }
    console.log();

    // Step 6: Apply quotas
    console.log('[Step 4/5] Applying quotas to database...');
    const result = await applyQuotas(workspace.id, preview);
    console.log('✓ Quotas applied:');
    console.log(`  Inserted: ${result.inserted}`);
    console.log(`  Updated: ${result.updated}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Batch ID: ${result.batchId}`);
    console.log(`  Period ID: ${result.periodId}\n`);

    // Step 7: Verify quotas
    console.log('[Step 5/5] Verifying quotas in database...');
    const verifyResult = await query<{
      rep_name: string;
      rep_email: string | null;
      quota_amount: number;
      period_name: string;
    }>(
      `SELECT rq.rep_name, rq.rep_email, rq.quota_amount, qp.name as period_name
       FROM rep_quotas rq
       JOIN quota_periods qp ON qp.id = rq.period_id
       WHERE qp.workspace_id = $1 AND rq.upload_batch_id = $2
       ORDER BY rq.quota_amount DESC`,
      [workspace.id, result.batchId]
    );

    console.log(`✓ Found ${verifyResult.rows.length} quotas in database:`);
    verifyResult.rows.forEach(q => {
      console.log(`  - ${q.rep_name} (${q.rep_email || 'no email'}): $${Number(q.quota_amount).toLocaleString()} [${q.period_name}]`);
    });
    console.log();

    console.log('===================================');
    console.log('✓ Test Completed Successfully!');
    console.log('===================================\n');

    console.log('Next: Run the forecast-rollup skill to see attainment %');
    console.log(`  curl -X POST http://localhost:3000/api/skills/forecast-rollup/run \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"workspaceId": "${workspace.id}"}'`);
    console.log();

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run test
testQuotaUpload()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
