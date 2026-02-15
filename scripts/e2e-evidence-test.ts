/**
 * E2E Test: Evidence System & Workbook Generation
 *
 * Tests:
 * 1. Create test workspace with mock data
 * 2. Run pipeline-hygiene skill
 * 3. Verify evidence structure
 * 4. Generate Excel workbook
 * 5. Test CWD functions
 */

import { query, pool } from '../server/db.js';
import { getSkillRuntime } from '../server/skills/runtime.js';
import { getSkillRegistry, registerBuiltInSkills } from '../server/skills/index.js';
import { generateWorkbook } from '../server/delivery/workbook-generator.js';
import { writeFileSync } from 'fs';
import type { SkillEvidence } from '../server/skills/types.js';

const TEST_WORKSPACE_NAME = 'E2E Test Workspace';
let testWorkspaceId: string;

async function cleanup() {
  console.log('\n🧹 Cleaning up previous test data...');
  const existing = await query(
    `SELECT id FROM workspaces WHERE name = $1`,
    [TEST_WORKSPACE_NAME]
  );

  if (existing.rows.length > 0) {
    const wsId = existing.rows[0].id;
    await query(`DELETE FROM deals WHERE workspace_id = $1`, [wsId]);
    await query(`DELETE FROM accounts WHERE workspace_id = $1`, [wsId]);
    await query(`DELETE FROM contacts WHERE workspace_id = $1`, [wsId]);
    await query(`DELETE FROM conversations WHERE workspace_id = $1`, [wsId]);
    await query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    console.log('   ✓ Cleaned up existing test workspace');
  }
}

async function createTestWorkspace() {
  console.log('\n📦 Creating test workspace...');

  const slug = 'e2e-test-workspace';

  const result = await query<{ id: string }>(
    `INSERT INTO workspaces (name, slug, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     RETURNING id`,
    [TEST_WORKSPACE_NAME, slug]
  );

  testWorkspaceId = result.rows[0].id;
  console.log(`   ✓ Created workspace: ${testWorkspaceId}`);
  return testWorkspaceId;
}

async function insertMockAccounts() {
  console.log('\n🏢 Inserting mock accounts...');

  const accounts = [
    { name: 'Acme Corp', domain: 'acme.com', industry: 'Technology', employee_count: 500 },
    { name: 'Globex Industries', domain: 'globex.io', industry: 'Manufacturing', employee_count: 1200 },
    { name: 'Initech Solutions', domain: 'initech.com', industry: 'SaaS', employee_count: 250 },
    { name: 'Umbrella Corporation', domain: 'umbrella.co', industry: 'Biotech', employee_count: 800 },
    { name: 'Stark Industries', domain: 'stark.com', industry: 'Defense', employee_count: 2500 },
  ];

  const accountIds: string[] = [];

  for (const acc of accounts) {
    const source_id = `test-account-${acc.domain}`;
    const result = await query<{ id: string }>(
      `INSERT INTO accounts (workspace_id, name, domain, industry, employee_count, source, source_id, created_at)
       VALUES ($1, $2, $3, $4, $5, 'test', $6, NOW())
       RETURNING id`,
      [testWorkspaceId, acc.name, acc.domain, acc.industry, acc.employee_count, source_id]
    );
    accountIds.push(result.rows[0].id);
  }

  console.log(`   ✓ Created ${accountIds.length} accounts`);
  return accountIds;
}

async function insertMockContacts(accountIds: string[]) {
  console.log('\n👥 Inserting mock contacts...');

  const contacts = [
    { first_name: 'John', last_name: 'Smith', email: 'john@acme.com', account_idx: 0 },
    { first_name: 'Sarah', last_name: 'Chen', email: 'sarah@acme.com', account_idx: 0 },
    { first_name: 'Mike', last_name: 'Torres', email: 'mike@globex.io', account_idx: 1 },
    { first_name: 'Emily', last_name: 'Johnson', email: 'emily@initech.com', account_idx: 2 },
    { first_name: 'David', last_name: 'Kim', email: 'david@umbrella.co', account_idx: 3 },
  ];

  for (const c of contacts) {
    const source_id = `test-contact-${c.email}`;
    await query(
      `INSERT INTO contacts (workspace_id, account_id, first_name, last_name, email, full_name, source, source_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'test', $7, NOW())`,
      [testWorkspaceId, accountIds[c.account_idx], c.first_name, c.last_name, c.email, `${c.first_name} ${c.last_name}`, source_id]
    );
  }

  console.log(`   ✓ Created ${contacts.length} contacts`);
}

async function insertMockDeals(accountIds: string[]) {
  console.log('\n💰 Inserting mock deals...');

  const now = new Date();
  const pastDate = new Date(now.getTime() - 65 * 24 * 60 * 60 * 1000); // 65 days ago
  const recentDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); // 15 days ago
  const futureDate = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000); // 20 days from now
  const pastDueDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // Past due

  const deals = [
    // Stale deals (critical severity)
    {
      name: 'Acme Corp - Enterprise Platform',
      account_idx: 0,
      amount: 125000,
      stage: 'proposal',
      stage_normalized: 'proposal',
      close_date: futureDate,
      last_activity_date: pastDate, // 65 days stale - CRITICAL
      owner: 'Sarah Chen',
      owner_email: 'sarah.chen@company.com'
    },
    {
      name: 'Globex - Cloud Migration',
      account_idx: 1,
      amount: 85000,
      stage: 'qualification',
      stage_normalized: 'qualification',
      close_date: futureDate,
      last_activity_date: new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000), // 50 days stale - CRITICAL
      owner: 'Mike Torres',
      owner_email: 'mike.torres@company.com'
    },

    // Stale but not critical (warning)
    {
      name: 'Initech - Support Renewal',
      account_idx: 2,
      amount: 45000,
      stage: 'negotiation',
      stage_normalized: 'negotiation',
      close_date: futureDate,
      last_activity_date: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000), // 35 days stale - WARNING
      owner: 'Sarah Chen',
      owner_email: 'sarah.chen@company.com'
    },

    // Past due + high value (critical severity)
    {
      name: 'Umbrella Corp - Security Suite',
      account_idx: 3,
      amount: 150000,
      stage: 'negotiation',
      stage_normalized: 'negotiation',
      close_date: pastDueDate, // Past due
      last_activity_date: recentDate, // Recent activity but past due
      owner: 'Mike Torres',
      owner_email: 'mike.torres@company.com'
    },

    // Healthy deal
    {
      name: 'Stark Industries - Integration',
      account_idx: 4,
      amount: 200000,
      stage: 'proposal',
      stage_normalized: 'proposal',
      close_date: futureDate,
      last_activity_date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days - HEALTHY
      owner: 'Sarah Chen',
      owner_email: 'sarah.chen@company.com'
    }
  ];

  const dealIds: string[] = [];

  for (const deal of deals) {
    const source_id = `test-deal-${deal.name.toLowerCase().replace(/\s+/g, '-')}`;
    const result = await query<{ id: string }>(
      `INSERT INTO deals (
        workspace_id, account_id, name, amount, stage, stage_normalized,
        close_date, last_activity_date, owner,
        source, source_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'test', $10, NOW(), $8)
      RETURNING id`,
      [
        testWorkspaceId,
        accountIds[deal.account_idx],
        deal.name,
        deal.amount,
        deal.stage,
        deal.stage_normalized,
        deal.close_date,
        deal.last_activity_date,
        deal.owner,
        source_id
      ]
    );
    dealIds.push(result.rows[0].id);
  }

  console.log(`   ✓ Created ${dealIds.length} deals`);
  console.log(`      - 2 critically stale (65d, 50d)`);
  console.log(`      - 1 stale warning (35d)`);
  console.log(`      - 1 past due high value ($150K)`);
  console.log(`      - 1 healthy (5d)`);

  return dealIds;
}

async function insertMockConversations(accountIds: string[], dealIds: string[]) {
  console.log('\n🎤 Inserting mock conversations...');

  const now = new Date();

  const conversations = [
    // CWD: Conversation without deal (should be flagged)
    {
      title: 'Discovery Call - Acme Corp',
      account_idx: 0,
      deal_id: null, // No deal linked - CWD!
      call_date: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      duration_seconds: 1800, // 30 min
      is_internal: false,
    },

    // CWD: Demo call without deal (high severity)
    {
      title: 'Product Demo - Umbrella Corp',
      account_idx: 3,
      deal_id: null, // No deal linked - CWD!
      call_date: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
      duration_seconds: 2700, // 45 min demo
      is_internal: false,
    },

    // Normal: Call linked to deal
    {
      title: 'Proposal Review - Stark Industries',
      account_idx: 4,
      deal_id: dealIds[4],
      call_date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      duration_seconds: 1500,
      is_internal: false,
    },

    // Internal call (should be filtered out)
    {
      title: 'Team Standup',
      account_idx: null,
      deal_id: null,
      call_date: now,
      duration_seconds: 900,
      is_internal: true,
    }
  ];

  for (const conv of conversations) {
    const participants = conv.is_internal
      ? [{ name: 'Team Member', email: 'team@company.com', is_internal: true }]
      : [
          { name: 'Sales Rep', email: 'rep@company.com', is_internal: true },
          { name: 'Customer Contact', email: 'contact@customer.com', is_internal: false }
        ];

    const source_id = `test-conv-${conv.title.toLowerCase().replace(/\s+/g, '-')}`;

    await query(
      `INSERT INTO conversations (
        workspace_id, account_id, deal_id, title, call_date,
        duration_seconds, is_internal, participants, source, source_id, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test', $9, NOW())`,
      [
        testWorkspaceId,
        conv.account_idx !== null ? accountIds[conv.account_idx] : null,
        conv.deal_id,
        conv.title,
        conv.call_date,
        conv.duration_seconds,
        conv.is_internal,
        JSON.stringify(participants),
        source_id
      ]
    );
  }

  console.log(`   ✓ Created ${conversations.length} conversations`);
  console.log(`      - 2 CWD (conversations without deals)`);
  console.log(`      - 1 normal (linked to deal)`);
  console.log(`      - 1 internal (filtered out)`);
}

async function insertBusinessContext() {
  console.log('\n⚙️  Setting up business context...');

  // Business context will be loaded from defaults by the skill runtime
  // No need to pre-populate - context system handles missing data gracefully

  console.log('   ✓ Skill will use default business context');
}

async function runPipelineHygieneSkill() {
  console.log('\n🚀 Running pipeline-hygiene skill...');

  // Register built-in skills first
  registerBuiltInSkills();

  const registry = getSkillRegistry();
  const skill = registry.get('pipeline-hygiene');

  if (!skill) {
    throw new Error('pipeline-hygiene skill not found in registry');
  }

  console.log('   ⏳ Executing skill...');
  const runtime = getSkillRuntime();
  const result = await runtime.executeSkill(skill, testWorkspaceId, {});

  console.log(`   ✓ Skill completed with status: ${result.status}`);
  console.log(`   ⏱️  Duration: ${result.totalDuration_ms}ms`);
  console.log(`   🔢 Steps completed: ${result.steps.filter(s => s.status === 'completed').length}/${result.steps.length}`);

  return result;
}

function verifyEvidence(evidence: SkillEvidence) {
  console.log('\n🔍 Verifying evidence structure...');

  const checks = {
    'Has claims array': Array.isArray(evidence.claims),
    'Has evaluated_records array': Array.isArray(evidence.evaluated_records),
    'Has data_sources array': Array.isArray(evidence.data_sources),
    'Has parameters array': Array.isArray(evidence.parameters),
    'Claims have entity_ids': evidence.claims.length > 0 && evidence.claims.every(c => Array.isArray(c.entity_ids)),
    'Records have entity_id': evidence.evaluated_records.length > 0 && evidence.evaluated_records.every(r => r.entity_id),
    'Records have severity': evidence.evaluated_records.length > 0 && evidence.evaluated_records.every(r => r.severity),
    'Parameters have values': evidence.parameters.length > 0 && evidence.parameters.every(p => p.value !== undefined),
  };

  let passed = 0;
  for (const [check, result] of Object.entries(checks)) {
    const status = result ? '✓' : '✗';
    console.log(`   ${status} ${check}`);
    if (result) passed++;
  }

  console.log(`\n   📊 Evidence Stats:`);
  console.log(`      - ${evidence.claims.length} claims`);
  console.log(`      - ${evidence.evaluated_records.length} evaluated records`);
  console.log(`      - ${evidence.data_sources.length} data sources`);
  console.log(`      - ${evidence.parameters.length} parameters`);

  // Show claim examples
  if (evidence.claims.length > 0) {
    console.log(`\n   💡 Sample Claims:`);
    evidence.claims.slice(0, 3).forEach(claim => {
      console.log(`      - [${claim.claim_id}] ${claim.claim_text} (${claim.entity_ids.length} entities)`);
    });
  }

  // Show severity breakdown
  const severityCounts = evidence.evaluated_records.reduce((acc, r) => {
    acc[r.severity] = (acc[r.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`\n   🚨 Severity Breakdown:`);
  console.log(`      - Critical: ${severityCounts.critical || 0}`);
  console.log(`      - Warning: ${severityCounts.warning || 0}`);
  console.log(`      - Healthy: ${severityCounts.healthy || 0}`);

  return { passed, total: Object.keys(checks).length };
}

async function generateTestWorkbook(evidence: SkillEvidence, narrative: string) {
  console.log('\n📊 Generating Excel workbook...');

  const buffer = await generateWorkbook({
    skillId: 'pipeline-hygiene',
    runDate: new Date().toISOString(),
    workspaceName: TEST_WORKSPACE_NAME,
    narrative,
    evidence,
  });

  const filename = '/tmp/pandora-e2e-test.xlsx';
  writeFileSync(filename, buffer);

  console.log(`   ✓ Workbook generated: ${filename}`);
  console.log(`   📏 File size: ${(buffer.length / 1024).toFixed(1)} KB`);

  return filename;
}

async function testCWDFunctions() {
  console.log('\n🎤 Testing CWD functions...');

  // Import CWD functions
  const { checkWorkspaceHasConversations } = await import('../server/skills/tools/check-workspace-has-conversations.js');
  const { auditConversationDealCoverage } = await import('../server/skills/tools/audit-conversation-deal-coverage.js');

  // Test checkWorkspaceHasConversations
  console.log('\n   Testing checkWorkspaceHasConversations...');
  const hasConvResult = await checkWorkspaceHasConversations(testWorkspaceId);
  console.log(`   ✓ Has conversations: ${hasConvResult.has_conversations}`);
  console.log(`   ✓ Conversation count: ${hasConvResult.conversation_count}`);
  console.log(`   ✓ Sources: ${hasConvResult.sources.join(', ')}`);

  // Test auditConversationDealCoverage
  console.log('\n   Testing auditConversationDealCoverage...');
  const cwdResult = await auditConversationDealCoverage(testWorkspaceId, 90);
  console.log(`   ✓ Has conversation data: ${cwdResult.has_conversation_data}`);
  console.log(`   ✓ Total CWD: ${cwdResult.summary?.total_cwd || 0}`);
  console.log(`   ✓ High severity: ${cwdResult.summary?.by_severity.high || 0}`);
  console.log(`   ✓ Medium severity: ${cwdResult.summary?.by_severity.medium || 0}`);
  console.log(`   ✓ Low severity: ${cwdResult.summary?.by_severity.low || 0}`);

  if (cwdResult.top_examples && cwdResult.top_examples.length > 0) {
    console.log(`\n   📋 Top CWD Examples:`);
    cwdResult.top_examples.forEach((conv, idx) => {
      console.log(`      ${idx + 1}. ${conv.conversation_title} - ${conv.account_name} (${conv.severity})`);
    });
  }

  return { hasConvResult, cwdResult };
}

async function runE2ETest() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   E2E Test: Evidence System & Workbook Generation         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await cleanup();
    await createTestWorkspace();

    const accountIds = await insertMockAccounts();
    await insertMockContacts(accountIds);
    const dealIds = await insertMockDeals(accountIds);
    await insertMockConversations(accountIds, dealIds);
    await insertBusinessContext();

    const skillResult = await runPipelineHygieneSkill();

    if (!skillResult.evidence) {
      throw new Error('❌ Skill result missing evidence!');
    }

    const { passed, total } = verifyEvidence(skillResult.evidence);

    const workbookPath = await generateTestWorkbook(
      skillResult.evidence,
      skillResult.output?.hygiene_report || 'Test report'
    );

    const cwdTests = await testCWDFunctions();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     TEST SUMMARY                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`   Evidence Checks: ${passed}/${total} passed`);
    console.log(`   Workbook Generated: ${workbookPath}`);
    console.log(`   CWD Conversations Found: ${cwdTests.cwdResult.summary?.total_cwd || 0}`);
    console.log(`   Test Workspace: ${testWorkspaceId}`);

    if (passed === total) {
      console.log('\n   ✅ ALL TESTS PASSED');
    } else {
      console.log(`\n   ⚠️  ${total - passed} tests failed`);
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  } finally {
    // Uncomment to cleanup after test
    // await cleanup();
    // console.log('\n🧹 Cleaned up test data');
  }
}

// Run the test
runE2ETest()
  .then(() => {
    console.log('\n✨ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
  });
