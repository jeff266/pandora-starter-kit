import { query } from '../server/db.js';

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const FRONTERA_WS = '4160191d-73bc-414b-97dd-5a1853190378';

async function request(method: string, path: string, body?: any): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url);
  if (method !== 'GET') {
    const r = await fetch(url, opts);
    return { status: r.status, body: await r.json() };
  }
  return { status: res.status, body: await res.json() };
}

async function testEnrichmentStatus() {
  console.log('\n=== TEST: Enrichment Status ===');
  const { status, body } = await request('GET', `/api/workspaces/${FRONTERA_WS}/enrichment/status`);
  console.log(`Status: ${status}`);
  console.log('Config:', JSON.stringify(body.config, null, 2));
  console.log('Stats:', JSON.stringify(body.stats, null, 2));
  return status === 200;
}

async function testEnrichmentConfig() {
  console.log('\n=== TEST: Enrichment Config GET ===');
  const { status, body } = await request('GET', `/api/workspaces/${FRONTERA_WS}/config/enrichment`);
  console.log(`Status: ${status}`);
  console.log('Config:', JSON.stringify(body, null, 2));
  return status === 200;
}

async function testBuyingCommittee() {
  console.log('\n=== TEST: Buying Committee ===');
  const dealResult = await query(`
    SELECT d.id, d.name FROM deals d
    JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1 AND d.stage_normalized IN ('closed_won', 'closed_lost')
    GROUP BY d.id, d.name
    ORDER BY COUNT(dc.id) DESC
    LIMIT 1
  `, [FRONTERA_WS]);

  if (dealResult.rows.length === 0) {
    console.log('No deals with contacts found, skipping');
    return true;
  }

  const deal = dealResult.rows[0];
  console.log(`Testing deal: "${deal.name}" (${deal.id})`);

  const { status, body } = await request('GET', `/api/workspaces/${FRONTERA_WS}/deals/${deal.id}/buying-committee`);
  console.log(`Status: ${status}`);
  console.log(`Contacts: ${body.contacts?.length || 0}`);
  if (body.contacts?.length > 0) {
    console.log('Sample contact:', JSON.stringify(body.contacts[0], null, 2));
  }
  console.log('Account signals:', body.account_signals ? 'present' : 'none');
  return status === 200;
}

async function testContactRoleResolution() {
  console.log('\n=== TEST: Contact Role Resolution (dry run) ===');
  const dealResult = await query(`
    SELECT d.id, d.name, COUNT(dc.id) as contact_count
    FROM deals d
    JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1 AND d.stage_normalized = 'closed_won'
    GROUP BY d.id, d.name
    HAVING COUNT(dc.id) >= 3
    ORDER BY COUNT(dc.id) DESC
    LIMIT 1
  `, [FRONTERA_WS]);

  if (dealResult.rows.length === 0) {
    console.log('No closed_won deals with 3+ contacts found');
    return true;
  }

  const deal = dealResult.rows[0];
  console.log(`Deal: "${deal.name}" with ${deal.contact_count} contacts`);

  const contacts = await query(`
    SELECT dc.id, COALESCE(TRIM(CONCAT(c.first_name, ' ', c.last_name)), '') as name,
           c.email, c.title, dc.buying_role, dc.role_source, dc.role_confidence
    FROM deal_contacts dc
    JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
    WHERE dc.deal_id = $1 AND dc.workspace_id = $2
    ORDER BY dc.role_confidence DESC NULLS LAST
    LIMIT 10
  `, [deal.id, FRONTERA_WS]);

  console.log(`\nCurrent roles for deal "${deal.name}":`);
  for (const c of contacts.rows) {
    console.log(`  ${c.name || 'Unknown'} (${c.title || 'no title'}) → ${c.buying_role || 'unresolved'} [${c.role_source || 'none'}, conf: ${c.role_confidence || 0}]`);
  }

  return true;
}

async function testSingleDealEnrichment() {
  console.log('\n=== TEST: Single Deal Enrichment (role resolution only) ===');

  const dealResult = await query(`
    SELECT d.id, d.name FROM deals d
    JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1 AND d.stage_normalized = 'closed_won'
    GROUP BY d.id, d.name
    HAVING COUNT(dc.id) >= 2
    ORDER BY d.close_date DESC
    LIMIT 1
  `, [FRONTERA_WS]);

  if (dealResult.rows.length === 0) {
    console.log('No suitable deal found');
    return true;
  }

  const deal = dealResult.rows[0];
  console.log(`Enriching: "${deal.name}" (${deal.id})`);

  const res = await fetch(`${BASE_URL}/api/workspaces/${FRONTERA_WS}/enrichment/deal/${deal.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const body = await res.json();
  console.log(`Status: ${res.status}`);
  if (res.status === 200) {
    console.log(`Outcome: ${body.outcome}`);
    console.log(`Roles resolved: ${body.contactResolution?.rolesResolved}/${body.contactResolution?.contactCount}`);
    console.log(`Role summary:`, body.contactResolution?.rolesSummary);
    console.log(`Apollo: ${body.apolloEnrichment?.enrichedCount} enriched, ${body.apolloEnrichment?.cachedCount} cached`);
    console.log(`Signals: ${body.accountSignals?.signalCount} (score: ${body.accountSignals?.signalScore})`);
    console.log(`Duration: ${body.durationMs}ms`);
  } else {
    console.log('Error:', body.error);
  }

  return res.status === 200;
}

async function testDataSummary() {
  console.log('\n=== DATA SUMMARY ===');

  const summary = await query(`
    SELECT 
      (SELECT COUNT(*) FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won') as won,
      (SELECT COUNT(*) FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_lost') as lost,
      (SELECT COUNT(DISTINCT deal_id) FROM deal_contacts WHERE workspace_id = $1) as deals_with_contacts,
      (SELECT COUNT(*) FROM deal_contacts WHERE workspace_id = $1 AND buying_role IS NOT NULL) as roles_assigned,
      (SELECT COUNT(*) FROM deal_contacts WHERE workspace_id = $1 AND apollo_data IS NOT NULL) as apollo_enriched,
      (SELECT COUNT(*) FROM account_signals WHERE workspace_id = $1 AND signals != '[]'::jsonb) as accounts_with_signals
  `, [FRONTERA_WS]);

  const s = summary.rows[0];
  console.log(`Closed Won: ${s.won}`);
  console.log(`Closed Lost: ${s.lost}`);
  console.log(`Deals with contacts: ${s.deals_with_contacts}`);
  console.log(`Roles assigned: ${s.roles_assigned}`);
  console.log(`Apollo enriched: ${s.apollo_enriched}`);
  console.log(`Accounts with signals: ${s.accounts_with_signals}`);
  return true;
}

async function main() {
  console.log('🔬 Pandora Enrichment Pipeline Integration Test');
  console.log('================================================');
  console.log(`Workspace: Frontera Health (${FRONTERA_WS})`);

  const tests = [
    { name: 'Data Summary', fn: testDataSummary },
    { name: 'Enrichment Config', fn: testEnrichmentConfig },
    { name: 'Enrichment Status', fn: testEnrichmentStatus },
    { name: 'Contact Role Resolution', fn: testContactRoleResolution },
    { name: 'Buying Committee', fn: testBuyingCommittee },
    { name: 'Single Deal Enrichment', fn: testSingleDealEnrichment },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
        console.log(`\n✅ ${test.name}: PASSED`);
      } else {
        failed++;
        console.log(`\n❌ ${test.name}: FAILED`);
      }
    } catch (err: any) {
      failed++;
      console.log(`\n❌ ${test.name}: ERROR - ${err.message}`);
    }
  }

  console.log('\n================================================');
  console.log(`Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
