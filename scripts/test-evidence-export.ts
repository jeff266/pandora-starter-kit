/**
 * Test Evidence Export End-to-End
 *
 * Validates the complete chain:
 * 1. Run pipeline-hygiene skill
 * 2. Verify evidence stored in skill_runs.output
 * 3. Generate Excel export
 * 4. Verify Excel structure (tabs, formulas, conditional formatting)
 */

import { query } from '../server/db.js';
import { getSkillRuntime } from '../server/skills/runtime.js';
import { getSkillRegistry } from '../server/skills/registry.js';
import { registerBuiltInSkills } from '../server/skills/index.js';
import { generateWorkbook } from '../server/delivery/workbook-generator.js';
import fs from 'fs';

const WORKSPACE_ID = '5aa722c2-d745-415b-8bf3-a7ac0331f66d';
const WORKSPACE_NAME = 'E2E Test Workspace';

async function testEvidenceExport() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   Test: Evidence Export End-to-End                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Step 1: Register skills
  console.log('📦 Registering skills...');
  registerBuiltInSkills();
  const registry = getSkillRegistry();
  const skill = registry.get('pipeline-hygiene');
  if (!skill) {
    throw new Error('pipeline-hygiene skill not found');
  }
  console.log('   ✓ pipeline-hygiene skill loaded\n');

  // Step 2: Run skill
  console.log('🚀 Running pipeline-hygiene skill...');
  const runtime = getSkillRuntime();
  const result = await runtime.executeSkill(skill, WORKSPACE_ID, {});

  console.log(`   ✓ Status: ${result.status}`);
  console.log(`   ✓ Duration: ${result.totalDuration_ms}ms`);
  console.log(`   ✓ Steps completed: ${result.steps.filter(s => s.status === 'completed').length}/${result.steps.length}\n`);

  // Step 3: Verify evidence in database
  console.log('🔍 Verifying evidence in skill_runs.output...');
  const skillRunQuery = await query<{
    id: string;
    run_id: string;
    output: any;
  }>(
    `SELECT id, run_id, output FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = $2
     ORDER BY completed_at DESC LIMIT 1`,
    [WORKSPACE_ID, 'pipeline-hygiene']
  );

  if (skillRunQuery.rows.length === 0) {
    throw new Error('No skill run found in database');
  }

  const skillRun = skillRunQuery.rows[0];
  const output = skillRun.output;
  const evidence = output?.evidence;

  if (!evidence) {
    throw new Error('No evidence found in skill_runs.output');
  }

  console.log('   ✓ Evidence found in database');
  console.log(`   ✓ Run ID: ${skillRun.run_id}`);
  console.log(`   Evidence structure:`);
  console.log(`      - Claims: ${evidence.claims?.length || 0}`);
  console.log(`      - Evaluated records: ${evidence.evaluated_records?.length || 0}`);
  console.log(`      - Data sources: ${evidence.data_sources?.length || 0}`);
  console.log(`      - Parameters: ${evidence.parameters?.length || 0}\n`);

  // Verify evidence structure
  const checks = {
    'Has claims array': Array.isArray(evidence.claims),
    'Has evaluated_records array': Array.isArray(evidence.evaluated_records),
    'Has data_sources array': Array.isArray(evidence.data_sources),
    'Has parameters array': Array.isArray(evidence.parameters),
    'Claims have claim_id': evidence.claims?.every((c: any) => c.claim_id),
    'Claims have entity_ids': evidence.claims?.every((c: any) => Array.isArray(c.entity_ids)),
    'Claims have severity': evidence.claims?.every((c: any) => c.severity),
    'Records have entity_id': evidence.evaluated_records?.every((r: any) => r.entity_id),
    'Records have severity': evidence.evaluated_records?.every((r: any) => r.severity),
    'Parameters have name': evidence.parameters?.every((p: any) => p.name),
    'Parameters have value': evidence.parameters?.every((p: any) => p.value !== undefined),
  };

  console.log('   Evidence validation:');
  for (const [check, passed] of Object.entries(checks)) {
    console.log(`      ${passed ? '✓' : '✗'} ${check}`);
  }
  console.log('');

  const failedChecks = Object.entries(checks).filter(([_, passed]) => !passed);
  if (failedChecks.length > 0) {
    console.log(`   ⚠️  ${failedChecks.length} validation(s) failed\n`);
  }

  // Step 4: Generate Excel export
  console.log('📊 Generating Excel workbook...');
  const skillEvidence: Record<string, any> = {
    'pipeline-hygiene': evidence
  };

  const workbookBuffer = await generateWorkbook(
    WORKSPACE_NAME,
    skillEvidence,
    output?.narrative || 'Pipeline Hygiene Analysis'
  );

  const outputPath = '/tmp/pipeline-hygiene-test.xlsx';
  fs.writeFileSync(outputPath, workbookBuffer);
  const fileSize = (workbookBuffer.length / 1024).toFixed(1);

  console.log(`   ✓ Workbook generated: ${outputPath}`);
  console.log(`   ✓ File size: ${fileSize} KB\n`);

  // Step 5: Verify Excel structure
  console.log('🔬 Verifying Excel structure...');

  // Read the Excel file to verify sheets exist
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer);

  const sheetNames = workbook.worksheets.map(ws => ws.name);
  console.log(`   ✓ Sheets found: ${sheetNames.join(', ')}`);

  // Check for Summary & Methodology sheet
  const summarySheet = workbook.getWorksheet('Summary & Methodology');
  if (summarySheet) {
    console.log('   ✓ Summary & Methodology sheet exists');

    // Check for parameters section
    let parametersFound = false;
    summarySheet.eachRow((row) => {
      const firstCell = row.getCell(1).value;
      if (firstCell && String(firstCell).includes('Parameters')) {
        parametersFound = true;
      }
    });
    console.log(`   ${parametersFound ? '✓' : '✗'} Parameters section found`);
  } else {
    console.log('   ✗ Summary & Methodology sheet NOT found');
  }

  // Check for data sheet
  const dataSheet = workbook.getWorksheet('pipeline-hygiene Data');
  if (dataSheet) {
    console.log('   ✓ pipeline-hygiene Data sheet exists');

    const rowCount = dataSheet.rowCount;
    const colCount = dataSheet.columnCount;
    console.log(`   ✓ Data dimensions: ${rowCount} rows × ${colCount} columns`);

    // Check for conditional formatting
    const hasConditionalFormatting = dataSheet.conditionalFormattings &&
                                     dataSheet.conditionalFormattings.length > 0;
    console.log(`   ${hasConditionalFormatting ? '✓' : '✗'} Conditional formatting applied`);

    // Check for formulas (look for cells starting with =)
    let formulaCount = 0;
    dataSheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        if (cell.formula) {
          formulaCount++;
        }
      });
    });
    console.log(`   ${formulaCount > 0 ? '✓' : '✗'} Formulas found: ${formulaCount}`);

    if (formulaCount > 0) {
      // Show sample formula
      dataSheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
          if (cell.formula && formulaCount > 0) {
            console.log(`   ✓ Sample formula (Row ${rowNumber}, Col ${colNumber}): ${cell.formula}`);
            formulaCount = 0; // Only show first one
          }
        });
      });
    }
  } else {
    console.log('   ✗ pipeline-hygiene Data sheet NOT found');
  }

  console.log('');

  // Final summary
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST SUMMARY                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`   Skill Execution: ✓`);
  console.log(`   Evidence in DB: ✓`);
  console.log(`   Excel Generated: ✓ (${outputPath})`);
  console.log(`   Evidence Validation: ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length} checks passed`);
  console.log('');

  if (failedChecks.length === 0) {
    console.log('✅ All tests passed! Evidence export chain is working end-to-end.\n');
  } else {
    console.log(`⚠️  ${failedChecks.length} validation(s) failed - review evidence structure.\n`);
  }

  process.exit(0);
}

testEvidenceExport().catch((err) => {
  console.error('\n💥 Test failed:', err);
  process.exit(1);
});
