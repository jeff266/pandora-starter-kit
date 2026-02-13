import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BASE = 'http://localhost:5000/api/workspaces';
const WS_ID = '4160191d-73bc-414b-97dd-5a1853190378';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
let failed = 0;
const results: { test: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];

function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    results.push({ test: name, status: 'PASS', detail });
    console.log(`  ✓ PASS: ${name} — ${detail}`);
  } else {
    failed++;
    results.push({ test: name, status: 'FAIL', detail });
    console.log(`  ✗ FAIL: ${name} — ${detail}`);
  }
}

async function dbQuery(sql: string, params: any[] = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function uploadCSV(entityType: string, csv: string, filename: string): Promise<any> {
  const tmpPath = `/tmp/test_upload_${Date.now()}.csv`;
  fs.writeFileSync(tmpPath, csv);
  try {
    const out = execSync(
      `curl -s -X POST "${BASE}/${WS_ID}/import/upload?entityType=${entityType}" -F "file=@${tmpPath};filename=${filename}"`,
      { timeout: 60000 }
    ).toString();
    return JSON.parse(out);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

function curlJson(method: string, url: string, body?: any): any {
  const args = [`-s`, `-X`, method, url];
  if (body) {
    args.push(`-H`, `Content-Type: application/json`, `-d`, JSON.stringify(body));
  }
  const out = execSync(`curl ${args.map(a => `'${a}'`).join(' ')}`, { timeout: 120000 }).toString();
  return JSON.parse(out);
}

async function confirmImport(batchId: string, strategy: string, overrides?: any): Promise<any> {
  const body: any = { batchId, strategy };
  if (overrides) body.overrides = overrides;
  return curlJson('POST', `${BASE}/${WS_ID}/import/confirm`, body);
}

async function rollbackBatch(batchId: string): Promise<any> {
  return curlJson('DELETE', `${BASE}/${WS_ID}/import/batch/${batchId}`);
}

async function cleanup() {
  console.log('\n🧹 Cleaning up previous test data...');
  await dbQuery(`DELETE FROM deal_stage_history WHERE workspace_id = $1 AND source IN ('file_import_diff', 'file_import_new', 'file_import_removed')`, [WS_ID]);
  await dbQuery(`DELETE FROM deal_contacts WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]).catch(() => {});
  await dbQuery(`DELETE FROM contacts WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM deals WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM accounts WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM import_batches WHERE workspace_id = $1`, [WS_ID]);
  await dbQuery(`DELETE FROM stage_mappings WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM connections WHERE workspace_id = $1 AND connector_name = 'csv_import'`, [WS_ID]);
  console.log('  Cleanup complete.\n');
}

// ============================================================================
// TEST DATA
// ============================================================================

const dealsCsvV1 = `Record ID,Deal Name,Amount,Deal Stage,Close Date,Deal Owner,Company Name,Pipeline,Create Date
HS-001,Acme Corp Expansion,$125000,Proposal Sent,2026-04-15,Nate Phillips,Acme Corp,Enterprise,2026-01-10
HS-002,Globex Industries,$85000,Discovery Call,2026-05-01,Sara Bollman,Globex Industries Inc.,Enterprise,2026-01-20
HS-003,Initech Migration,$200000,Negotiation,2026-03-31,Carter McKay,Initech LLC,Enterprise,2026-01-05
HS-004,Umbrella Corp,$50000,Qualified,2026-06-15,Jack McArdle,Umbrella Corporation,SMB,2026-02-01
HS-005,Wonka Industries,$0,Closed Lost,2025-12-31,Nate Phillips,Wonka Industries,,2025-11-01
HS-006,Stark Enterprises,$350000,Closed Won,2026-01-20,Sara Bollman,Stark Enterprises,Enterprise,2025-10-15
HS-007,Wayne Corp,$175000,Decision Maker Bought-In,2026-04-01,Nate Phillips,Wayne Corp,Enterprise,2026-01-25
HS-008,,missing amount,Discovery Call,2026-07-01,Jack McArdle,Test Co,SMB,2026-02-05`;

const dealsCsvV2 = `Record ID,Deal Name,Amount,Deal Stage,Close Date,Deal Owner,Company Name,Pipeline,Create Date
HS-001,Acme Corp Expansion,$125000,Negotiation,2026-04-15,Nate Phillips,Acme Corp,Enterprise,2026-01-10
HS-002,Globex Industries,$95000,Qualified,2026-05-01,Sara Bollman,Globex Industries Inc.,Enterprise,2026-01-20
HS-003,Initech Migration,$200000,Closed Won,2026-03-31,Carter McKay,Initech LLC,Enterprise,2026-01-05
HS-004,Umbrella Corp,$50000,Qualified,2026-06-15,Jack McArdle,Umbrella Corporation,SMB,2026-02-01
HS-006,Stark Enterprises,$350000,Closed Won,2026-01-20,Sara Bollman,Stark Enterprises,Enterprise,2025-10-15
HS-007,Wayne Corp,$175000,Contract Sent,2026-04-01,Nate Phillips,Wayne Corp,Enterprise,2026-01-25
HS-009,New Deal Co,$100000,Discovery Call,2026-08-01,Carter McKay,New Deal Corp,Enterprise,2026-02-10`;

const accountsCsv = `Company ID,Company Name,Website,Industry,Employees,Annual Revenue
AC-001,Acme Corp,acme.com,Technology,500,50000000
AC-002,Globex Industries,globex.com,Manufacturing,2000,200000000
AC-003,Initech,initech.com,Technology,150,15000000
AC-004,Umbrella Corporation,umbrella.com,Healthcare,10000,5000000000
AC-005,Stark Enterprises,stark.com,Technology,8000,3000000000`;

const contactsCsv = `Contact ID,First Name,Last Name,Email,Job Title,Company,Phone
CT-001,John,Smith,john@acme.com,VP Engineering,Acme Corp,555-0101
CT-002,Jane,Doe,jane@acme.com,CFO,Acme Corp,555-0102
CT-003,Bob,Wilson,bob@globex.com,CTO,Globex Industries,555-0201
CT-004,Alice,Johnson,alice@initech.com,CEO,Initech,555-0301
CT-005,Charlie,Brown,charlie@test.com,Intern,Unknown Corp,555-0401`;

// ============================================================================
// TESTS
// ============================================================================

let dealBatchId1: string;
let dealBatchId2: string;
let accountBatchId: string;
let contactBatchId: string;

async function test1_DealImport() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 1: Deal Import — HubSpot-style CSV');
  console.log('═══════════════════════════════════════════════════════');

  const preview = await uploadCSV('deal', dealsCsvV1, 'frontera_deals_v1.csv');
  dealBatchId1 = preview.batchId;
  console.log(`  Batch ID: ${dealBatchId1}`);
  console.log(`  Classification source: ${preview.stageMapping?.source || 'unknown'}`);

  check('1a. Row count', preview.totalRows === 8, `Expected 8 rows, got ${preview.totalRows}`);

  const mapping = preview.mapping || {};
  const nameCol = mapping.name?.columnName || mapping.name?.sourceColumn || '';
  const amountCol = mapping.amount?.columnName || mapping.amount?.sourceColumn || '';
  const stageCol = mapping.stage?.columnName || mapping.stage?.sourceColumn || '';
  const closeDateCol = mapping.close_date?.columnName || mapping.close_date?.sourceColumn || '';

  check('1b. Name mapped', !!mapping.name, `name → "${nameCol}"`);
  check('1c. Amount mapped', !!mapping.amount, `amount → "${amountCol}"`);
  check('1d. Stage mapped', !!mapping.stage, `stage → "${stageCol}"`);
  check('1e. Close date mapped', !!mapping.close_date, `close_date → "${closeDateCol}"`);

  const stages = preview.stageMapping?.uniqueStages || [];
  const expectedStages = ['Proposal Sent', 'Discovery Call', 'Negotiation', 'Qualified', 'Closed Lost', 'Closed Won', 'Decision Maker Bought-In'];
  const foundAll = expectedStages.every((s: string) => stages.includes(s));
  check('1f. All 7 stages detected', foundAll, `Found ${stages.length} stages: ${stages.join(', ')}`);

  const allMappings = { ...(preview.stageMapping?.existingMappings || {}), ...(preview.stageMapping?.newMappings || {}) };
  const stagesMapped = Object.keys(allMappings).length;
  check('1g. Stage mappings suggested', stagesMapped > 0, `${stagesMapped} stage mappings provided`);

  const warnings = preview.warnings || [];
  console.log(`  Warnings (${warnings.length}): ${warnings.map((w: string) => `\n    - ${w}`).join('')}`);

  const stageMappingOverrides = { ...(preview.stageMapping?.existingMappings || {}), ...(preview.stageMapping?.newMappings || {}) };
  const result = await confirmImport(dealBatchId1, 'replace', { stageMapping: stageMappingOverrides });
  console.log(`  Import result: inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}`);

  check('1h. Deals inserted', result.inserted >= 7, `Expected ≥7 inserted, got ${result.inserted}`);

  const deals = await dbQuery(
    `SELECT name, amount, stage, stage_normalized, source_id FROM deals WHERE workspace_id = $1 AND source = 'csv_import' ORDER BY source_id`,
    [WS_ID]
  );
  check('1i. Deals in DB', deals.length >= 7, `Expected ≥7 deals in DB, got ${deals.length}`);

  const acmeDeal = deals.find((d: any) => d.source_id === 'HS-001');
  check('1j. Acme amount parsed', acmeDeal && parseFloat(acmeDeal.amount) === 125000, `Acme amount: ${acmeDeal?.amount}`);

  const wonka = deals.find((d: any) => d.source_id === 'HS-005');
  check('1k. Wonka $0 amount', wonka && parseFloat(wonka.amount) === 0, `Wonka amount: ${wonka?.amount}`);

  const starkDeal = deals.find((d: any) => d.source_id === 'HS-006');
  check('1l. Stark stage_normalized', starkDeal && starkDeal.stage_normalized === 'closed_won',
    `Stark stage_normalized: ${starkDeal?.stage_normalized}`);

  const closedLostDeal = deals.find((d: any) => d.source_id === 'HS-005');
  check('1m. Wonka stage_normalized', closedLostDeal && closedLostDeal.stage_normalized === 'closed_lost',
    `Wonka stage_normalized: ${closedLostDeal?.stage_normalized}`);

  console.log('\n  Deals imported:');
  for (const d of deals) {
    console.log(`    ${d.source_id} | ${d.name} | $${d.amount} | ${d.stage} → ${d.stage_normalized}`);
  }
}

async function test2_AccountImport() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 2: Account Import + Deal Linking');
  console.log('═══════════════════════════════════════════════════════');

  const preview = await uploadCSV('account', accountsCsv, 'frontera_accounts.csv');
  accountBatchId = preview.batchId;

  check('2a. Account rows detected', preview.totalRows === 5, `Expected 5 rows, got ${preview.totalRows}`);

  const result = await confirmImport(accountBatchId, 'replace');
  check('2b. Accounts inserted', result.inserted === 5, `Expected 5 inserted, got ${result.inserted}`);

  const accounts = await dbQuery(
    `SELECT name, domain, source_id FROM accounts WHERE workspace_id = $1 AND source = 'csv_import' ORDER BY source_id`,
    [WS_ID]
  );
  check('2c. Accounts in DB', accounts.length === 5, `Expected 5 accounts, got ${accounts.length}`);

  const linkedDeals = await dbQuery(
    `SELECT d.name, d.source_id, a.name as account_name
     FROM deals d JOIN accounts a ON d.account_id = a.id
     WHERE d.workspace_id = $1 AND d.source = 'csv_import'
     ORDER BY d.source_id`,
    [WS_ID]
  );
  const dealsLinked = result.postActions?.dealsLinkedToAccounts || linkedDeals.length;
  check('2d. Deals linked to accounts', dealsLinked >= 4, `Expected ≥4 deals linked, got ${dealsLinked}`);

  console.log('\n  Deal→Account links:');
  for (const d of linkedDeals) {
    console.log(`    ${d.source_id} ${d.name} → ${d.account_name}`);
  }

  const unlinkedDeals = await dbQuery(
    `SELECT name, source_id FROM deals WHERE workspace_id = $1 AND source = 'csv_import' AND account_id IS NULL ORDER BY source_id`,
    [WS_ID]
  );
  if (unlinkedDeals.length > 0) {
    console.log('  Unlinked deals:');
    for (const d of unlinkedDeals) {
      console.log(`    ${d.source_id} ${d.name}`);
    }
  }
}

async function test3_ContactImport() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 3: Contact Import + Association');
  console.log('═══════════════════════════════════════════════════════');

  const preview = await uploadCSV('contact', contactsCsv, 'frontera_contacts.csv');
  contactBatchId = preview.batchId;

  check('3a. Contact rows detected', preview.totalRows === 5, `Expected 5 rows, got ${preview.totalRows}`);

  const result = await confirmImport(contactBatchId, 'replace');
  check('3b. Contacts inserted', result.inserted === 5, `Expected 5 inserted, got ${result.inserted}`);

  const contacts = await dbQuery(
    `SELECT c.first_name, c.last_name, c.email, c.source_id, a.name as account_name
     FROM contacts c
     LEFT JOIN accounts a ON c.account_id = a.id
     WHERE c.workspace_id = $1 AND c.source = 'csv_import'
     ORDER BY c.source_id`,
    [WS_ID]
  );
  check('3c. Contacts in DB', contacts.length === 5, `Expected 5 contacts, got ${contacts.length}`);

  const linkedContacts = contacts.filter((c: any) => c.account_name);
  check('3d. Contacts linked to accounts', linkedContacts.length >= 4,
    `Expected ≥4 linked, got ${linkedContacts.length}`);

  const charlie = contacts.find((c: any) => c.source_id === 'CT-005');
  check('3e. Charlie NOT linked', !charlie?.account_name,
    `Charlie account: ${charlie?.account_name || 'null (correct)'}`);

  console.log('\n  Contact→Account links:');
  for (const c of contacts) {
    console.log(`    ${c.source_id} ${c.first_name} ${c.last_name} (${c.email}) → ${c.account_name || 'UNLINKED'}`);
  }
}

async function test4_ReUpload() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 4: Re-Upload (Replace Strategy)');
  console.log('═══════════════════════════════════════════════════════');

  const preview = await uploadCSV('deal', dealsCsvV2, 'frontera_deals_v2.csv');
  dealBatchId2 = preview.batchId;

  const dedup = preview.deduplication;
  check('4a. Deduplication detected', dedup && dedup.existingRecords > 0,
    `Existing: ${dedup?.existingRecords}, matching: ${dedup?.matchingRecords}, recommendation: ${dedup?.recommendation}`);

  const existingMappings = preview.stageMapping?.existingMappings || {};
  const newMappings = preview.stageMapping?.newMappings || {};
  const reusedCount = Object.keys(existingMappings).length;
  const newCount = Object.keys(newMappings).length;
  const knownReused = ['Discovery Call', 'Negotiation', 'Qualified', 'Closed Won'].filter(s => s in existingMappings).length;
  check('4b. Stage mappings reused', knownReused >= 3,
    `Reused ${reusedCount} existing mappings, ${newCount} new. Known reused: ${knownReused}`);

  console.log(`  Reused mappings: ${JSON.stringify(existingMappings)}`);
  console.log(`  New mappings: ${JSON.stringify(newMappings)}`);

  const v2StageMappings = { ...existingMappings, ...newMappings };
  const result = await confirmImport(dealBatchId2, 'replace', { stageMapping: v2StageMappings });
  console.log(`  Import result: inserted=${result.inserted}, updated=${result.updated}`);

  const deals = await dbQuery(
    `SELECT name, stage, source_id FROM deals WHERE workspace_id = $1 AND source = 'csv_import' ORDER BY source_id`,
    [WS_ID]
  );
  check('4c. 7 deals in DB after replace', deals.length === 7,
    `Expected 7 deals, got ${deals.length}`);

  const wonkaGone = !deals.find((d: any) => d.source_id === 'HS-005');
  check('4d. Wonka removed', wonkaGone, wonkaGone ? 'HS-005 not in DB' : 'HS-005 still present');

  const newDeal = deals.find((d: any) => d.source_id === 'HS-009');
  check('4e. New Deal added', !!newDeal, `HS-009: ${newDeal?.name || 'not found'}`);

  const sc = result.stageChanges;
  if (sc) {
    check('4f. Stage changes detected', sc.stageChanges >= 3,
      `${sc.stageChanges} stage changes, ${sc.newDeals} new, ${sc.removedDeals} removed`);

    console.log('\n  Stage change details:');
    for (const c of sc.changeDetails || []) {
      console.log(`    ${c.dealName}: ${c.from || 'null'} → ${c.to} (${c.type})`);
    }

    const acmeChange = sc.changeDetails?.find((c: any) => c.dealName?.includes('Acme'));
    check('4g. Acme stage change', acmeChange && acmeChange.from === 'Proposal Sent' && acmeChange.to === 'Negotiation',
      `Acme: ${acmeChange?.from} → ${acmeChange?.to}`);

    const initechChange = sc.changeDetails?.find((c: any) => c.dealName?.includes('Initech'));
    check('4h. Initech stage change', initechChange && initechChange.to === 'Closed Won',
      `Initech: ${initechChange?.from} → ${initechChange?.to}`);

    const newDealChange = sc.changeDetails?.find((c: any) => c.type === 'new');
    check('4i. New deal in diff', !!newDealChange,
      `New: ${newDealChange?.dealName} → ${newDealChange?.to}`);

    const removedDeals = sc.changeDetails?.filter((c: any) => c.type === 'removed') || [];
    check('4j. Removed deals in diff', removedDeals.length >= 1,
      `${removedDeals.length} removed: ${removedDeals.map((r: any) => r.dealName).join(', ')}`);
  } else {
    check('4f. Stage changes detected', false, 'No stageChanges in result');
  }

  const history = await dbQuery(
    `SELECT deal_source_id, from_stage, to_stage, source FROM deal_stage_history
     WHERE workspace_id = $1 AND source IN ('file_import_diff', 'file_import_new')
     ORDER BY changed_at`,
    [WS_ID]
  );
  check('4k. Stage history in DB', history.length >= 4,
    `${history.length} stage history records written`);
  console.log('\n  Stage history in DB:');
  for (const h of history) {
    console.log(`    ${h.deal_source_id}: ${h.from_stage || 'null'} → ${h.to_stage} (${h.source})`);
  }
}

async function test5_Freshness() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 5: Freshness Check');
  console.log('═══════════════════════════════════════════════════════');

  const freshness = curlJson('GET', `${BASE}/${WS_ID}/import/freshness`);

  check('5a. Freshness endpoint works', Array.isArray(freshness), `Got ${Array.isArray(freshness) ? freshness.length : 0} entries`);

  const dealFreshness = freshness.find((f: any) => f.entityType === 'deal');
  check('5b. Deal freshness present', !!dealFreshness, `lastImportedAt: ${dealFreshness?.lastImportedAt}`);
  check('5c. Deal not stale', dealFreshness && !dealFreshness.isStale, `isStale: ${dealFreshness?.isStale}`);

  const accountFreshness = freshness.find((f: any) => f.entityType === 'account');
  check('5d. Account freshness present', !!accountFreshness, `lastImportedAt: ${accountFreshness?.lastImportedAt}`);

  const contactFreshness = freshness.find((f: any) => f.entityType === 'contact');
  check('5e. Contact freshness present', !!contactFreshness, `lastImportedAt: ${contactFreshness?.lastImportedAt}`);

  console.log('\n  Freshness data:');
  for (const f of freshness) {
    console.log(`    ${f.entityType}: imported ${f.daysSinceImport} days ago, ${f.recordCount} records, stale=${f.isStale}`);
  }
}

async function test6_Rollback() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 6: Rollback');
  console.log('═══════════════════════════════════════════════════════');

  const dealsBefore = await dbQuery(
    `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'csv_import'`,
    [WS_ID]
  );
  const countBefore = parseInt(dealsBefore[0].count);
  console.log(`  Deals before rollback: ${countBefore}`);

  const result = await rollbackBatch(dealBatchId2);
  check('6a. Rollback returns count', result.deleted >= 0, `Deleted ${result.deleted} deals`);

  const dealsAfter = await dbQuery(
    `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'csv_import'`,
    [WS_ID]
  );
  const countAfter = parseInt(dealsAfter[0].count);
  check('6b. Deals removed', countAfter < countBefore, `Before: ${countBefore}, after: ${countAfter}`);

  const batchStatus = await dbQuery(
    `SELECT status FROM import_batches WHERE id = $1`,
    [dealBatchId2]
  );
  check('6c. Batch status rolled_back', batchStatus[0]?.status === 'rolled_back',
    `Status: ${batchStatus[0]?.status}`);

  const stageHistoryAfter = await dbQuery(
    `SELECT COUNT(*) as count FROM deal_stage_history
     WHERE workspace_id = $1 AND source IN ('file_import_diff', 'file_import_new')`,
    [WS_ID]
  );
  check('6d. Stage history cleaned up', parseInt(stageHistoryAfter[0].count) === 0,
    `${stageHistoryAfter[0].count} stage history records remaining`);

  console.log('\n  Re-importing deals for skill tests...');
  const preview = await uploadCSV('deal', dealsCsvV1, 'frontera_deals_restore.csv');
  const restoreMappings = { ...(preview.stageMapping?.existingMappings || {}), ...(preview.stageMapping?.newMappings || {}) };
  await confirmImport(preview.batchId, 'replace', { stageMapping: restoreMappings });
  dealBatchId2 = preview.batchId;
  const restored = await dbQuery(
    `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'csv_import'`,
    [WS_ID]
  );
  console.log(`  Restored ${restored[0].count} deals for skill tests.`);
}

async function test7_SkillExecution() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 7: Skill Execution with File-Import Data');
  console.log('═══════════════════════════════════════════════════════');

  const skills = ['pipeline-hygiene', 'data-quality-audit'];
  const labels = [
    ['7a', '7b', 'Pipeline-hygiene'],
    ['7c', '7d', 'Data-quality-audit'],
  ];

  for (let i = 0; i < skills.length; i++) {
    const skillId = skills[i];
    const [runLabel, outputLabel, displayName] = labels[i];
    console.log(`\n  Running ${skillId}...`);
    try {
      const raw = execSync(
        `curl -s --max-time 180 -X POST '${BASE}/${WS_ID}/skills/${skillId}/run' -H 'Content-Type: application/json' -d '{"params":{}}'`,
        { timeout: 200000 }
      ).toString();
      const skillResult = JSON.parse(raw);

      if (skillResult.error) {
        check(`${runLabel}. ${displayName} runs`, false, `Error: ${skillResult.error.substring(0, 200)}`);
        console.log(`  Note: Skill error may be pre-existing workspace data issue, not file import related.`);
        continue;
      }

      const outputText = skillResult.output_preview || skillResult.output || skillResult.outputText || '';
      const outputLen = outputText.length;
      const tokenUsage = skillResult.tokenUsage || skillResult.token_usage || {};
      const status = skillResult.status;
      const durationMs = skillResult.duration_ms || 0;

      check(`${runLabel}. ${displayName} runs`, status === 'completed' || status === 'success',
        `Status: ${status}, duration: ${durationMs}ms, output length: ${outputLen}`);
      check(`${outputLabel}. ${displayName} has output`, outputLen > 50,
        `Output length: ${outputLen} chars`);
      console.log(`  Token usage: ${JSON.stringify(tokenUsage)}`);
      console.log(`  Duration: ${durationMs}ms`);
      console.log(`  Output preview: ${outputText.substring(0, 300)}...`);
    } catch (err: any) {
      check(`${runLabel}. ${displayName} runs`, false, `Error: ${err.message}`);
    }
  }
}

async function finalCleanup() {
  console.log('\n🧹 Final cleanup...');
  await dbQuery(`DELETE FROM deal_stage_history WHERE workspace_id = $1 AND source IN ('file_import_diff', 'file_import_new', 'file_import_removed')`, [WS_ID]);
  await dbQuery(`DELETE FROM deal_contacts WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]).catch(() => {});
  await dbQuery(`DELETE FROM contacts WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM deals WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM accounts WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM import_batches WHERE workspace_id = $1`, [WS_ID]);
  await dbQuery(`DELETE FROM stage_mappings WHERE workspace_id = $1 AND source = 'csv_import'`, [WS_ID]);
  await dbQuery(`DELETE FROM connections WHERE workspace_id = $1 AND connector_name = 'csv_import'`, [WS_ID]);
  console.log('  Final cleanup complete.');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   Pandora File Import — End-to-End Test Suite        ║');
  console.log('║   Workspace: Frontera Health                         ║');
  console.log(`║   ${new Date().toISOString()}                    ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');

  await cleanup();

  try {
    await test1_DealImport();
    await test2_AccountImport();
    await test3_ContactImport();
    await test4_ReUpload();
    await test5_Freshness();
    await test6_Rollback();
    await test7_SkillExecution();
  } catch (err: any) {
    console.error(`\n\n❌ FATAL ERROR: ${err.message}`);
    console.error(err.stack);
  }

  await finalCleanup();
  await pool.end();

  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║   RESULTS SUMMARY                                   ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    console.log(`║ ${icon} ${r.status} | ${r.test.padEnd(40)} ║`);
  }
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║   PASSED: ${passed}  |  FAILED: ${failed}  |  TOTAL: ${passed + failed}          ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
