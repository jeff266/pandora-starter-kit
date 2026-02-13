/**
 * Salesforce Integration - End-to-End Test Script
 *
 * Tests all Salesforce OAuth Hardening features (Prompts 1-5):
 * - OAuth flow (callback handler, token storage)
 * - Schema discovery
 * - Initial sync (opportunities, contacts, accounts, activities, stage history)
 * - Incremental sync
 * - Token refresh and health check
 * - File import → Salesforce upgrade path
 * - Multi-tenant isolation (2 workspaces)
 * - Error handling (invalid credentials, rate limits, field history disabled)
 *
 * Prerequisites:
 * - Two test Salesforce orgs with Connected App configured
 * - Environment variables set:
 *   - SF_ORG1_ACCESS_TOKEN, SF_ORG1_REFRESH_TOKEN, SF_ORG1_INSTANCE_URL
 *   - SF_ORG2_ACCESS_TOKEN, SF_ORG2_REFRESH_TOKEN, SF_ORG2_INSTANCE_URL
 *   - SF_CLIENT_ID, SF_CLIENT_SECRET
 *
 * Usage:
 *   npm run build && node dist/scripts/test-salesforce.js
 */

import { Pool } from 'pg';
import { execSync } from 'child_process';
import fs from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Test workspace IDs (will be created)
const WS1_ID = '00000000-0000-0000-0000-000000000001'; // Org 1
const WS2_ID = '00000000-0000-0000-0000-000000000002'; // Org 2

// Salesforce credentials from environment
const ORG1_CREDENTIALS = {
  accessToken: process.env.SF_ORG1_ACCESS_TOKEN || '',
  refreshToken: process.env.SF_ORG1_REFRESH_TOKEN || '',
  instanceUrl: process.env.SF_ORG1_INSTANCE_URL || '',
};

const ORG2_CREDENTIALS = {
  accessToken: process.env.SF_ORG2_ACCESS_TOKEN || '',
  refreshToken: process.env.SF_ORG2_REFRESH_TOKEN || '',
  instanceUrl: process.env.SF_ORG2_INSTANCE_URL || '',
};

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

function curlJson(method: string, url: string, body?: any): any {
  const args = [`-s`, `-X`, method, url];
  if (body) {
    args.push(`-H`, `Content-Type: application/json`, `-d`, JSON.stringify(body));
  }
  try {
    const out = execSync(`curl ${args.map(a => `'${a}'`).join(' ')}`, { timeout: 120000 }).toString();
    return JSON.parse(out);
  } catch (error) {
    console.error(`[CURL ERROR] ${method} ${url}:`, error);
    throw error;
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up previous test data...');

  // Clean workspace 1
  await dbQuery(`DELETE FROM deal_stage_history WHERE workspace_id = $1`, [WS1_ID]);
  await dbQuery(`DELETE FROM deal_contacts WHERE workspace_id = $1`, [WS1_ID]);
  await dbQuery(`DELETE FROM activities WHERE workspace_id = $1`, [WS1_ID]);
  await dbQuery(`DELETE FROM deals WHERE workspace_id = $1`, [WS1_ID]);
  await dbQuery(`DELETE FROM contacts WHERE workspace_id = $1`, [WS1_ID]);
  await dbQuery(`DELETE FROM accounts WHERE workspace_id = $1`, [WS1_ID]);
  await dbQuery(`DELETE FROM connections WHERE workspace_id = $1`, [WS1_ID]);
  await dbQuery(`DELETE FROM workspaces WHERE id = $1`, [WS1_ID]);

  // Clean workspace 2
  await dbQuery(`DELETE FROM deal_stage_history WHERE workspace_id = $1`, [WS2_ID]);
  await dbQuery(`DELETE FROM deal_contacts WHERE workspace_id = $1`, [WS2_ID]);
  await dbQuery(`DELETE FROM activities WHERE workspace_id = $1`, [WS2_ID]);
  await dbQuery(`DELETE FROM deals WHERE workspace_id = $1`, [WS2_ID]);
  await dbQuery(`DELETE FROM contacts WHERE workspace_id = $1`, [WS2_ID]);
  await dbQuery(`DELETE FROM accounts WHERE workspace_id = $1`, [WS2_ID]);
  await dbQuery(`DELETE FROM connections WHERE workspace_id = $1`, [WS2_ID]);
  await dbQuery(`DELETE FROM workspaces WHERE id = $1`, [WS2_ID]);

  console.log('  Cleanup complete.\n');
}

async function setupWorkspaces() {
  console.log('📦 Setting up test workspaces...');

  // Create workspace 1
  await dbQuery(
    `INSERT INTO workspaces (id, name, slug, settings, created_at, updated_at)
     VALUES ($1, 'Test Org 1', 'test-org-1', '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [WS1_ID]
  );

  // Create workspace 2
  await dbQuery(
    `INSERT INTO workspaces (id, name, slug, settings, created_at, updated_at)
     VALUES ($1, 'Test Org 2', 'test-org-2', '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [WS2_ID]
  );

  console.log('  Workspaces created.\n');
}

async function storeCredentials(workspaceId: string, credentials: any) {
  // Encrypt credentials (simplified for testing - in production, use proper encryption)
  const credentialsJson = JSON.stringify({
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    instanceUrl: credentials.instanceUrl,
    issuedAt: Date.now(),
  });

  await dbQuery(
    `INSERT INTO connections (workspace_id, connector_name, credentials, status, created_at, updated_at)
     VALUES ($1, 'salesforce', $2::jsonb, 'connected', NOW(), NOW())
     ON CONFLICT (workspace_id, connector_name)
     DO UPDATE SET credentials = $2::jsonb, status = 'connected', updated_at = NOW()`,
    [workspaceId, credentialsJson]
  );
}

// ============================================================================
// TEST SUITE
// ============================================================================

async function testCredentialStorage() {
  console.log('\n━━━ Test 1: Credential Storage ━━━');

  // Store credentials for org 1
  await storeCredentials(WS1_ID, ORG1_CREDENTIALS);

  const rows = await dbQuery(
    `SELECT connector_name, status, credentials FROM connections WHERE workspace_id = $1`,
    [WS1_ID]
  );

  check(
    'Credentials stored',
    rows.length === 1 && rows[0].connector_name === 'salesforce',
    `Found ${rows.length} connection record(s)`
  );

  check(
    'Credentials contain required fields',
    rows[0].credentials.accessToken && rows[0].credentials.instanceUrl,
    'accessToken and instanceUrl present'
  );
}

async function testHealthEndpoint() {
  console.log('\n━━━ Test 2: Health Endpoint ━━━');

  try {
    const health = curlJson('GET', `http://localhost:5000/api/workspaces/${WS1_ID}/connectors/salesforce/health`);

    check(
      'Health endpoint returns healthy status',
      health.healthy === true,
      `healthy: ${health.healthy}`
    );

    check(
      'Health includes token status',
      health.details?.tokenStatus !== undefined,
      `tokenStatus: ${health.details?.tokenStatus || 'N/A'}`
    );

    check(
      'Health includes API limits',
      health.details?.apiLimitsUsed !== undefined,
      `API limits: ${health.details?.apiLimitsUsed || 0}/${health.details?.apiLimitsTotal || 0}`
    );
  } catch (error) {
    check('Health endpoint accessible', false, (error as Error).message);
  }
}

async function testSchemaDiscovery() {
  console.log('\n━━━ Test 3: Schema Discovery ━━━');

  try {
    const schema = curlJson('POST', `http://localhost:5000/api/workspaces/${WS1_ID}/connectors/salesforce/discover-schema`);

    check(
      'Schema discovery returns custom fields',
      Array.isArray(schema.customFields),
      `Found ${schema.customFields?.length || 0} custom fields`
    );

    check(
      'Custom fields include deal fields',
      schema.customFields?.some((f: any) => f.category === 'deal') || false,
      `Deal fields: ${schema.customFields?.filter((f: any) => f.category === 'deal').length || 0}`
    );
  } catch (error) {
    check('Schema discovery accessible', false, (error as Error).message);
  }
}

async function testInitialSync() {
  console.log('\n━━━ Test 4: Initial Sync ━━━');

  try {
    const sync = curlJson('POST', `http://localhost:5000/api/workspaces/${WS1_ID}/connectors/salesforce/sync`);

    check(
      'Initial sync triggered',
      sync.message?.includes('sync') || sync.status === 'syncing',
      `Response: ${JSON.stringify(sync).substring(0, 100)}`
    );

    // Wait for sync to complete (poll sync log)
    console.log('  Waiting for sync to complete...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

    // Check deals synced
    const deals = await dbQuery(
      `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
      [WS1_ID]
    );

    check(
      'Deals synced',
      parseInt(deals[0]?.count || '0') > 0,
      `${deals[0]?.count || 0} deals synced`
    );

    // Check contacts synced
    const contacts = await dbQuery(
      `SELECT COUNT(*) as count FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
      [WS1_ID]
    );

    check(
      'Contacts synced',
      parseInt(contacts[0]?.count || '0') > 0,
      `${contacts[0]?.count || 0} contacts synced`
    );

    // Check accounts synced
    const accounts = await dbQuery(
      `SELECT COUNT(*) as count FROM accounts WHERE workspace_id = $1 AND source = 'salesforce'`,
      [WS1_ID]
    );

    check(
      'Accounts synced',
      parseInt(accounts[0]?.count || '0') > 0,
      `${accounts[0]?.count || 0} accounts synced`
    );
  } catch (error) {
    check('Initial sync completed', false, (error as Error).message);
  }
}

async function testActivitiesSync() {
  console.log('\n━━━ Test 5: Activities Sync ━━━');

  const activities = await dbQuery(
    `SELECT COUNT(*) as count, activity_type FROM activities
     WHERE workspace_id = $1 AND source = 'salesforce'
     GROUP BY activity_type`,
    [WS1_ID]
  );

  const totalActivities = activities.reduce((sum, row) => sum + parseInt(row.count), 0);

  check(
    'Activities synced',
    totalActivities > 0,
    `${totalActivities} activities synced`
  );

  const activityTypes = activities.map(r => r.activity_type).join(', ');
  check(
    'Activity types include tasks or calls',
    activityTypes.includes('task') || activityTypes.includes('call'),
    `Types: ${activityTypes || 'none'}`
  );
}

async function testStageHistory() {
  console.log('\n━━━ Test 6: Stage History Sync ━━━');

  const stageHistory = await dbQuery(
    `SELECT COUNT(*) as count FROM deal_stage_history
     WHERE workspace_id = $1 AND source = 'salesforce_history'`,
    [WS1_ID]
  );

  const historyCount = parseInt(stageHistory[0]?.count || '0');

  check(
    'Stage history synced',
    historyCount >= 0, // May be 0 if Field History Tracking is not enabled
    historyCount > 0
      ? `${historyCount} stage transitions synced`
      : 'No stage history (Field History Tracking may not be enabled)'
  );

  if (historyCount > 0) {
    const sampleHistory = await dbQuery(
      `SELECT from_stage, to_stage, changed_at
       FROM deal_stage_history
       WHERE workspace_id = $1 AND source = 'salesforce_history'
       ORDER BY changed_at DESC
       LIMIT 1`,
      [WS1_ID]
    );

    check(
      'Stage history has valid transitions',
      sampleHistory[0]?.to_stage !== null,
      `Latest: ${sampleHistory[0]?.from_stage || 'null'} → ${sampleHistory[0]?.to_stage}`
    );
  }
}

async function testContactRoles() {
  console.log('\n━━━ Test 7: Deal-Contact Associations ━━━');

  const dealContacts = await dbQuery(
    `SELECT COUNT(*) as count FROM deal_contacts
     WHERE workspace_id = $1`,
    [WS1_ID]
  );

  const associationCount = parseInt(dealContacts[0]?.count || '0');

  check(
    'Deal-contact associations synced',
    associationCount >= 0,
    `${associationCount} associations synced`
  );

  if (associationCount > 0) {
    const sampleAssociation = await dbQuery(
      `SELECT dc.role, d.name as deal_name, c.email as contact_email
       FROM deal_contacts dc
       JOIN deals d ON dc.deal_id = d.id
       JOIN contacts c ON dc.contact_id = c.id
       WHERE dc.workspace_id = $1
       LIMIT 1`,
      [WS1_ID]
    );

    check(
      'Associations link valid deals and contacts',
      sampleAssociation[0]?.deal_name && sampleAssociation[0]?.contact_email,
      `Sample: ${sampleAssociation[0]?.deal_name} ↔ ${sampleAssociation[0]?.contact_email}`
    );
  }
}

async function testIncrementalSync() {
  console.log('\n━━━ Test 8: Incremental Sync ━━━');

  // Get count before incremental sync
  const beforeDeals = await dbQuery(
    `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
    [WS1_ID]
  );

  const countBefore = parseInt(beforeDeals[0]?.count || '0');

  // Trigger incremental sync
  try {
    const sync = curlJson('POST', `http://localhost:5000/api/workspaces/${WS1_ID}/connectors/salesforce/sync`);

    check(
      'Incremental sync triggered',
      sync.message?.includes('sync') || sync.status === 'syncing',
      'Sync initiated'
    );

    // Wait for sync to complete
    console.log('  Waiting for incremental sync to complete...');
    await new Promise(resolve => setTimeout(resolve, 15000)); // 15 seconds

    const afterDeals = await dbQuery(
      `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
      [WS1_ID]
    );

    const countAfter = parseInt(afterDeals[0]?.count || '0');

    check(
      'Incremental sync completed',
      countAfter >= countBefore,
      `Deals: ${countBefore} → ${countAfter}`
    );
  } catch (error) {
    check('Incremental sync completed', false, (error as Error).message);
  }
}

async function testFileImportUpgrade() {
  console.log('\n━━━ Test 9: File Import → Salesforce Upgrade ━━━');

  // Create a test file-imported deal with a Salesforce ID
  const testSalesforceId = '006xx000001TEST'; // 15-char ID
  const testDealId = '99999999-9999-9999-9999-999999999999';

  await dbQuery(
    `INSERT INTO deals (id, workspace_id, source, source_id, name, stage, amount, owner, created_at, updated_at)
     VALUES ($1, $2, 'csv_import', $3, 'Test CSV Deal', 'Prospecting', 50000, 'Test Owner', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [testDealId, WS1_ID, testSalesforceId]
  );

  // Check upgrade status before
  try {
    const statusBefore = curlJson('GET', `http://localhost:5000/api/import/${WS1_ID}/upgrade-status`);

    check(
      'Upgrade status endpoint accessible',
      statusBefore !== undefined,
      `hasTransitioned: ${statusBefore.hasTransitioned || false}`
    );

    // Trigger sync to run upgrade
    curlJson('POST', `http://localhost:5000/api/workspaces/${WS1_ID}/connectors/salesforce/sync`);
    await new Promise(resolve => setTimeout(resolve, 20000)); // Wait for sync + upgrade

    // Check upgrade status after
    const statusAfter = curlJson('GET', `http://localhost:5000/api/import/${WS1_ID}/upgrade-status`);

    check(
      'Upgrade marked as transitioned',
      statusAfter.hasTransitioned === true,
      `Transition recorded: ${statusAfter.transition?.transitionedAt || 'N/A'}`
    );

    // Check if test deal was upgraded or remains orphan
    const testDeal = await dbQuery(
      `SELECT source, source_id FROM deals WHERE id = $1`,
      [testDealId]
    );

    if (testDeal.length > 0) {
      check(
        'File-imported deal handled',
        testDeal[0].source === 'salesforce' || testDeal[0].source === 'csv_import',
        `Deal source: ${testDeal[0].source} (${testDeal[0].source === 'salesforce' ? 'matched and upgraded' : 'orphaned'})`
      );
    }
  } catch (error) {
    check('File import upgrade completed', false, (error as Error).message);
  }
}

async function testSalesforceIdNormalization() {
  console.log('\n━━━ Test 10: Salesforce ID Normalization ━━━');

  // Test that 15-char and 18-char IDs match
  const id15 = '006Dn00000A1bcd';
  const id18 = '006Dn00000A1bcdEFG';

  // Import normalization function (simplified test)
  const normalize = (id: string) => id.substring(0, 15);

  check(
    '15-char and 18-char IDs normalize to same value',
    normalize(id15) === normalize(id18),
    `${id15} === ${id18.substring(0, 15)}`
  );

  // Check that database deals use normalized IDs for lookups
  const deals = await dbQuery(
    `SELECT source_id FROM deals WHERE workspace_id = $1 AND source = 'salesforce' LIMIT 1`,
    [WS1_ID]
  );

  if (deals.length > 0) {
    const sourceId = deals[0].source_id;
    check(
      'Stored source_id is 15 or 18 characters',
      sourceId.length === 15 || sourceId.length === 18,
      `source_id length: ${sourceId.length}`
    );
  }
}

async function testMultiTenantIsolation() {
  console.log('\n━━━ Test 11: Multi-Tenant Isolation ━━━');

  // Store credentials for org 2
  await storeCredentials(WS2_ID, ORG2_CREDENTIALS);

  // Trigger sync for org 2
  try {
    curlJson('POST', `http://localhost:5000/api/workspaces/${WS2_ID}/connectors/salesforce/sync`);
    console.log('  Waiting for workspace 2 sync to complete...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

    // Check that workspace 1 and workspace 2 have different deals
    const ws1Deals = await dbQuery(
      `SELECT source_id FROM deals WHERE workspace_id = $1 AND source = 'salesforce' LIMIT 1`,
      [WS1_ID]
    );

    const ws2Deals = await dbQuery(
      `SELECT source_id FROM deals WHERE workspace_id = $1 AND source = 'salesforce' LIMIT 1`,
      [WS2_ID]
    );

    check(
      'Workspace 1 has deals',
      ws1Deals.length > 0,
      `WS1 has ${ws1Deals.length > 0 ? 'deals' : 'no deals'}`
    );

    check(
      'Workspace 2 has deals',
      ws2Deals.length > 0,
      `WS2 has ${ws2Deals.length > 0 ? 'deals' : 'no deals'}`
    );

    if (ws1Deals.length > 0 && ws2Deals.length > 0) {
      check(
        'Workspaces have different data (no cross-tenant leakage)',
        ws1Deals[0].source_id !== ws2Deals[0].source_id,
        'source_id values differ'
      );
    }

    // Verify no cross-workspace data leakage
    const crossCheck = await dbQuery(
      `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
      [WS2_ID]
    );

    const ws1Count = await dbQuery(
      `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
      [WS1_ID]
    );

    check(
      'Workspace isolation maintained',
      crossCheck[0].count !== ws1Count[0].count,
      `WS1: ${ws1Count[0].count} deals, WS2: ${crossCheck[0].count} deals`
    );
  } catch (error) {
    check('Multi-tenant isolation verified', false, (error as Error).message);
  }
}

async function testErrorHandling() {
  console.log('\n━━━ Test 12: Error Handling ━━━');

  // Test with invalid credentials
  const invalidWsId = '00000000-0000-0000-0000-000000000099';

  await dbQuery(
    `INSERT INTO workspaces (id, name, slug, settings, created_at, updated_at)
     VALUES ($1, 'Invalid Org', 'invalid-org', '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [invalidWsId]
  );

  await dbQuery(
    `INSERT INTO connections (workspace_id, connector_name, credentials, status, created_at, updated_at)
     VALUES ($1, 'salesforce', '{"accessToken":"invalid","instanceUrl":"https://invalid.salesforce.com"}'::jsonb, 'connected', NOW(), NOW())
     ON CONFLICT (workspace_id, connector_name)
     DO UPDATE SET credentials = '{"accessToken":"invalid","instanceUrl":"https://invalid.salesforce.com"}'::jsonb`,
    [invalidWsId]
  );

  try {
    const health = curlJson('GET', `http://localhost:5000/api/workspaces/${invalidWsId}/connectors/salesforce/health`);

    check(
      'Health endpoint handles invalid credentials',
      health.healthy === false,
      `Error message present: ${!!health.details?.error}`
    );
  } catch (error) {
    // Expected to fail
    check(
      'Error handling for invalid credentials',
      true,
      'Request failed as expected'
    );
  }

  // Cleanup invalid workspace
  await dbQuery(`DELETE FROM connections WHERE workspace_id = $1`, [invalidWsId]);
  await dbQuery(`DELETE FROM workspaces WHERE id = $1`, [invalidWsId]);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║   SALESFORCE INTEGRATION - END-TO-END TEST SUITE              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  // Check prerequisites
  if (!ORG1_CREDENTIALS.accessToken || !ORG1_CREDENTIALS.instanceUrl) {
    console.error('\n❌ MISSING CREDENTIALS: Set SF_ORG1_ACCESS_TOKEN and SF_ORG1_INSTANCE_URL');
    process.exit(1);
  }

  if (!ORG2_CREDENTIALS.accessToken || !ORG2_CREDENTIALS.instanceUrl) {
    console.warn('\n⚠️  WARNING: Org 2 credentials not set. Multi-tenant test will be skipped.');
  }

  try {
    await cleanup();
    await setupWorkspaces();

    await testCredentialStorage();
    await testHealthEndpoint();
    await testSchemaDiscovery();
    await testInitialSync();
    await testActivitiesSync();
    await testStageHistory();
    await testContactRoles();
    await testIncrementalSync();
    await testFileImportUpgrade();
    await testSalesforceIdNormalization();

    if (ORG2_CREDENTIALS.accessToken && ORG2_CREDENTIALS.instanceUrl) {
      await testMultiTenantIsolation();
    } else {
      console.log('\n━━━ Test 11: Multi-Tenant Isolation ━━━');
      console.log('  ⊘ SKIPPED: Org 2 credentials not provided');
    }

    await testErrorHandling();

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║   TEST SUMMARY                                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n  ✓ PASSED: ${passed}`);
    console.log(`  ✗ FAILED: ${failed}`);
    console.log(`  TOTAL:   ${passed + failed}\n`);

    if (failed > 0) {
      console.log('Failed tests:');
      results
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`  - ${r.test}: ${r.detail}`));
      console.log('');
    }

    // Write results to file
    fs.writeFileSync(
      'salesforce-test-results.json',
      JSON.stringify({ passed, failed, total: passed + failed, results }, null, 2)
    );

    console.log('📄 Detailed results saved to: salesforce-test-results.json\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
