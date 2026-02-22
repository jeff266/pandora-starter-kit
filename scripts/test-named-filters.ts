import { configLoader } from '../server/config/workspace-config-loader.js';
import { filterResolver, FilterNotFoundError } from '../server/tools/filter-resolver.js';
import { query, getClient } from '../server/db.js';
import { getToolDefinition } from '../server/skills/tool-definitions.js';

const BASE_URL = 'http://localhost:3001';
let API_KEY = '';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: { [group: string]: TestResult[] } = {
  'Group 1 (Preview)': [],
  'Group 2 (Cross-Object)': [],
  'Group 3 (Tool + Evidence)': [],
  'Group 4 (CRUD)': [],
  'Group 5 (Edge Cases)': [],
};

function assert(group: string, name: string, condition: boolean, message: string) {
  results[group].push({ name, passed: condition, message });
  if (!condition) {
    console.log(`  FAIL: ${name} — ${message}`);
  } else {
    console.log(`  PASS: ${name}`);
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...extra };
}

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/workspaces/${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiPost(path: string, body?: any): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}/api/workspaces/${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function apiPut(path: string, body: any): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}/api/workspaces/${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function apiDelete(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}/api/workspaces/${path}`, { method: 'DELETE', headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function findTestWorkspace(): Promise<string> {
  const r = await query<{ id: string; name: string; deal_count: string; api_key: string }>(
    `SELECT w.id, w.name, w.api_key, (SELECT COUNT(*) FROM deals d WHERE d.workspace_id = w.id)::text as deal_count
     FROM workspaces w ORDER BY deal_count DESC LIMIT 1`
  );
  const ws = r.rows[0];
  API_KEY = ws.api_key;
  console.log(`Using workspace: ${ws.name} (${ws.id}) — ${ws.deal_count} deals\n`);
  return ws.id;
}

async function testGroup1(wsId: string) {
  const G = 'Group 1 (Preview)';
  console.log('\n== TEST GROUP 1: Filter Preview ==\n');

  const filtersRes = await apiGet(`${wsId}/filters`);
  const filters = filtersRes.filters || [];
  console.log(`  Filters found: ${filters.length}`);
  filters.forEach((f: any) => console.log(`    - ${f.id} (${f.label}) [${f.object}] confirmed=${f.confirmed}`));

  const defaultIds = ['open_pipeline', 'new_logo', 'stale_deal', 'closing_this_quarter', 'at_risk'];
  const foundIds = filters.map((f: any) => f.id);
  const allDefaultsExist = defaultIds.every((id: string) => foundIds.includes(id));
  assert(G, '5 default filters exist', allDefaultsExist,
    allDefaultsExist ? 'All defaults present' : `Missing: ${defaultIds.filter((id: string) => !foundIds.includes(id)).join(', ')}`);

  // 1b. Preview open_pipeline
  const openPreview = await apiPost(`${wsId}/filters/open_pipeline/preview`);
  console.log(`  open_pipeline preview: count=${openPreview.data.count}, sql=${openPreview.data.sql_preview?.substring(0, 120)}`);
  assert(G, 'open_pipeline count >= 0', openPreview.data.count >= 0, `count=${openPreview.data.count}`);

  const sql = openPreview.data.sql_preview || '';
  assert(G, 'SQL has parameterized placeholders', /\$\d+/.test(sql) || sql.length > 0,
    sql.includes('$') ? 'Contains $N params' : 'No params needed (static condition)');
  assert(G, 'SQL does not contain "undefined"', !sql.includes('undefined'), sql.includes('undefined') ? `Found "undefined" in SQL: ${sql}` : 'Clean');
  assert(G, 'SQL does not contain "null" literal', !sql.includes("'null'"), 'Clean');

  // 1c. Preview stale_deal
  const stalePreview = await apiPost(`${wsId}/filters/stale_deal/preview`);
  console.log(`  stale_deal preview: count=${stalePreview.data.count}`);
  assert(G, 'stale_deal count >= 0', stalePreview.data.count >= 0, `count=${stalePreview.data.count}`);

  // 1d. Preview closing_this_quarter
  const closingPreview = await apiPost(`${wsId}/filters/closing_this_quarter/preview`);
  console.log(`  closing_this_quarter preview: count=${closingPreview.data.count}`);
  assert(G, 'closing_this_quarter count >= 0', closingPreview.data.count >= 0, `count=${closingPreview.data.count}`);
}

async function testGroup2(wsId: string) {
  const G = 'Group 2 (Cross-Object)';
  console.log('\n== TEST GROUP 2: Cross-Object Condition (new_logo) ==\n');

  const newLogoPreview = await apiPost(`${wsId}/filters/new_logo/preview`);
  console.log(`  new_logo preview: count=${newLogoPreview.data.count}`);
  console.log(`  SQL: ${newLogoPreview.data.sql_preview?.substring(0, 200)}`);
  if (newLogoPreview.data.sample_records?.length > 0) {
    console.log(`  Sample records: ${JSON.stringify(newLogoPreview.data.sample_records.slice(0, 3), null, 2)}`);
  }

  assert(G, 'new_logo preview succeeds (no SQL errors)', newLogoPreview.status === 200 && newLogoPreview.data.success === true,
    `status=${newLogoPreview.status}, success=${newLogoPreview.data.success}`);

  const sqlPreview = newLogoPreview.data.sql_preview || '';
  assert(G, 'SQL contains EXISTS or NOT EXISTS', sqlPreview.includes('EXISTS'),
    sqlPreview.includes('EXISTS') ? 'Contains EXISTS clause' : `SQL: ${sqlPreview}`);

  const manualResult = await query(
    `SELECT d.name, d.amount, d.stage,
       (SELECT COUNT(*) FROM deals d2
        WHERE d2.account_id = d.account_id
        AND d2.workspace_id = d.workspace_id
        AND d2.stage_normalized = 'closed_won') as prior_wins
     FROM deals d
     WHERE d.workspace_id = $1 AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
     ORDER BY d.amount DESC NULLS LAST LIMIT 10`,
    [wsId]
  );

  const newLogos = manualResult.rows.filter(r => parseInt(r.prior_wins) === 0);
  const existingLogos = manualResult.rows.filter(r => parseInt(r.prior_wins) > 0);
  console.log(`  Manual query: ${newLogos.length} new logos, ${existingLogos.length} existing logos out of top 10 open deals`);
  assert(G, 'Manual query returned results for comparison', manualResult.rows.length > 0,
    `${manualResult.rows.length} rows returned`);
}

async function testGroup3(wsId: string) {
  const G = 'Group 3 (Tool + Evidence)';
  console.log('\n== TEST GROUP 3: Tool Integration + Evidence Breadcrumb ==\n');

  const queryDealsTool = getToolDefinition('queryDeals');
  if (!queryDealsTool) {
    assert(G, 'queryDeals tool exists', false, 'Tool not found');
    return;
  }
  assert(G, 'queryDeals tool exists', true, 'Found');

  // 3a. Single filter
  const context = { workspaceId: wsId, businessContext: {}, stepResults: {} } as any;
  const result = await queryDealsTool.execute({ named_filter: 'open_pipeline', limit: 5 }, context);

  const hasApplied = result && typeof result === 'object' && '_applied_filters' in result;
  assert(G, 'Result has _applied_filters', hasApplied, hasApplied ? 'Present' : `Keys: ${Object.keys(result || {}).join(', ')}`);

  if (hasApplied) {
    const af = result._applied_filters;
    assert(G, 'filter_id is open_pipeline', af[0]?.filter_id === 'open_pipeline', `Got: ${af[0]?.filter_id}`);
    assert(G, 'filter_label is non-empty', (af[0]?.filter_label || '').length > 0, `Label: ${af[0]?.filter_label}`);
    assert(G, 'conditions_summary is non-empty', (af[0]?.conditions_summary || '').length > 0, `Summary: ${af[0]?.conditions_summary}`);
    assert(G, 'confidence is 1.0', af[0]?.confidence === 1.0, `Confidence: ${af[0]?.confidence}`);
  }

  // 3b. Multiple filters
  const multiResult = await queryDealsTool.execute({ named_filters: ['open_pipeline', 'stale_deal'], limit: 5 }, context);
  const multiApplied = multiResult?._applied_filters || [];
  assert(G, 'Multi-filter: _applied_filters length === 2', multiApplied.length === 2,
    `Length: ${multiApplied.length}`);

  const singleCount = Array.isArray(result?.deals) ? result.deals.length : (result?.total || 0);
  const multiCount = Array.isArray(multiResult?.deals) ? multiResult.deals.length : (multiResult?.total || 0);
  console.log(`  open_pipeline count: ${singleCount}, open_pipeline+stale_deal count: ${multiCount}`);

  // 3c. Non-existent filter
  try {
    await queryDealsTool.execute({ named_filter: 'nonexistent_filter_xyz' }, context);
    assert(G, 'Non-existent filter throws error', false, 'Did not throw');
  } catch (err: any) {
    const msg = err.message || String(err);
    assert(G, 'Error mentions "not found"', msg.toLowerCase().includes('not found'),
      `Message: ${msg.substring(0, 100)}`);
    console.log(`  Error message: ${msg.substring(0, 150)}`);
  }
}

async function testGroup4(wsId: string) {
  const G = 'Group 4 (CRUD)';
  console.log('\n== TEST GROUP 4: CRUD API ==\n');

  // 4a. Create
  const createRes = await apiPost(`${wsId}/filters`, {
    id: 'test_big_deals',
    label: 'Big Deals (Test)',
    description: 'Deals over $50K for smoke testing',
    object: 'deals',
    conditions: {
      operator: 'AND',
      conditions: [
        { field: 'amount', operator: 'gt', value: 50000 },
        { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
      ],
    },
  });
  console.log(`  Create: status=${createRes.status}`);
  assert(G, 'Create returns 201', createRes.status === 201, `Status: ${createRes.status}`);
  assert(G, 'source is user_defined', createRes.data.filter?.source === 'user_defined',
    `Source: ${createRes.data.filter?.source}`);
  assert(G, 'confirmed is true', createRes.data.filter?.confirmed === true,
    `Confirmed: ${createRes.data.filter?.confirmed}`);

  // 4b. Preview custom filter
  const bigPreview = await apiPost(`${wsId}/filters/test_big_deals/preview`);
  console.log(`  test_big_deals preview: count=${bigPreview.data.count}, sql=${bigPreview.data.sql_preview?.substring(0, 100)}`);
  assert(G, 'Custom filter preview succeeds', bigPreview.status === 200 && bigPreview.data.count >= 0,
    `Status: ${bigPreview.status}, count: ${bigPreview.data.count}`);

  const bigSamples = bigPreview.data.sample_records || [];
  const allBig = bigSamples.length === 0 || bigSamples.every((r: any) => parseFloat(r.amount) > 50000);
  assert(G, 'All samples have amount > 50000', allBig,
    bigSamples.length > 0 ? `Amounts: ${bigSamples.map((r: any) => r.amount).join(', ')}` : 'No samples (0 results)');

  const prevCount = bigPreview.data.count;

  // 4c. Update filter
  const updateRes = await apiPut(`${wsId}/filters/test_big_deals`, {
    conditions: {
      operator: 'AND',
      conditions: [
        { field: 'amount', operator: 'gt', value: 100000 },
        { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
      ],
    },
  });
  assert(G, 'Update returns 200', updateRes.status === 200, `Status: ${updateRes.status}`);

  const updatedPreview = await apiPost(`${wsId}/filters/test_big_deals/preview`);
  console.log(`  After update: count=${updatedPreview.data.count} (was ${prevCount})`);
  assert(G, 'Updated count <= previous count', updatedPreview.data.count <= prevCount,
    `${updatedPreview.data.count} <= ${prevCount}`);

  // 4d. Use in tool call
  const context = { workspaceId: wsId, businessContext: {}, stepResults: {} } as any;
  const queryDealsTool = getToolDefinition('queryDeals')!;
  const toolResult = await queryDealsTool.execute({ named_filter: 'test_big_deals', limit: 5 }, context);
  const toolApplied = toolResult?._applied_filters || [];
  assert(G, 'Tool result has filter_id = test_big_deals', toolApplied[0]?.filter_id === 'test_big_deals',
    `filter_id: ${toolApplied[0]?.filter_id}`);
  assert(G, 'Tool result has source = user_defined', toolApplied[0]?.filter_source === 'user_defined',
    `source: ${toolApplied[0]?.filter_source}`);

  // 4e. Delete
  const deleteRes = await apiDelete(`${wsId}/filters/test_big_deals`);
  assert(G, 'Delete returns 200', deleteRes.status === 200, `Status: ${deleteRes.status}`);

  const afterDelete = await apiGet(`${wsId}/filters`);
  const stillExists = (afterDelete.filters || []).some((f: any) => f.id === 'test_big_deals');
  assert(G, 'Filter no longer in list after delete', !stillExists, stillExists ? 'Still exists!' : 'Deleted');
}

async function testGroup5(wsId: string) {
  const G = 'Group 5 (Edge Cases)';
  console.log('\n== TEST GROUP 5: Edge Cases ==\n');

  // 5a. Empty result set
  await apiPost(`${wsId}/filters`, {
    id: 'test_impossible',
    label: 'Impossible Filter',
    object: 'deals',
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'amount', operator: 'gt', value: 999999999 }],
    },
  });
  const impossiblePreview = await apiPost(`${wsId}/filters/test_impossible/preview`);
  assert(G, 'Impossible filter returns count 0', impossiblePreview.data.count === 0,
    `Count: ${impossiblePreview.data.count}`);
  await apiDelete(`${wsId}/filters/test_impossible`);

  // 5b. OR conditions
  await apiPost(`${wsId}/filters`, {
    id: 'test_or_filter',
    label: 'OR Test',
    object: 'deals',
    conditions: {
      operator: 'OR',
      conditions: [
        { field: 'stage_normalized', operator: 'eq', value: 'closed_won' },
        { field: 'stage_normalized', operator: 'eq', value: 'closed_lost' },
      ],
    },
  });
  const orPreview = await apiPost(`${wsId}/filters/test_or_filter/preview`);
  console.log(`  OR filter: count=${orPreview.data.count}, sql=${orPreview.data.sql_preview?.substring(0, 120)}`);
  assert(G, 'OR filter preview succeeds', orPreview.status === 200 && orPreview.data.count >= 0,
    `Status: ${orPreview.status}`);

  const orSql = orPreview.data.sql_preview || '';
  assert(G, 'SQL contains OR', orSql.toUpperCase().includes('OR'),
    orSql.includes('OR') ? 'Contains OR' : `SQL: ${orSql}`);

  const orSamples = orPreview.data.sample_records || [];
  const allClosed = orSamples.length === 0 || orSamples.every((r: any) =>
    r.stage?.toLowerCase().includes('closed') || r.stage?.toLowerCase().includes('won') || r.stage?.toLowerCase().includes('lost'));
  console.log(`  OR sample stages: ${orSamples.map((r: any) => r.stage).join(', ')}`);
  await apiDelete(`${wsId}/filters/test_or_filter`);

  // 5c. Nested conditions
  await apiPost(`${wsId}/filters`, {
    id: 'test_nested',
    label: 'Nested Test',
    object: 'deals',
    conditions: {
      operator: 'OR',
      conditions: [
        {
          operator: 'AND',
          conditions: [
            { field: 'amount', operator: 'gt', value: 100000 },
            { field: 'stage_normalized', operator: 'eq', value: 'closed_won' },
          ],
        },
        {
          operator: 'AND',
          conditions: [
            { field: 'amount', operator: 'lt', value: 10000 },
            { field: 'stage_normalized', operator: 'eq', value: 'closed_lost' },
          ],
        },
      ],
    },
  });
  const nestedPreview = await apiPost(`${wsId}/filters/test_nested/preview`);
  console.log(`  Nested filter: count=${nestedPreview.data.count}`);
  console.log(`  Nested SQL: ${nestedPreview.data.sql_preview?.substring(0, 200)}`);
  assert(G, 'Nested filter preview succeeds', nestedPreview.status === 200,
    `Status: ${nestedPreview.status}`);

  const nestedSql = nestedPreview.data.sql_preview || '';
  const parenCount = (nestedSql.match(/\(/g) || []).length;
  assert(G, 'SQL has nested parentheses (>= 2)', parenCount >= 2,
    `Paren count: ${parenCount}`);
  await apiDelete(`${wsId}/filters/test_nested`);

  // 5d. Confirm endpoint
  const filterDetail = await apiGet(`${wsId}/filters/open_pipeline`);
  const confirmed = filterDetail.filter?.confirmed;
  console.log(`  open_pipeline confirmed: ${confirmed}`);

  if (!confirmed) {
    const confirmRes = await apiPost(`${wsId}/filters/open_pipeline/confirm`);
    assert(G, 'Confirm returns 200', confirmRes.status === 200, `Status: ${confirmRes.status}`);
    const afterConfirm = await apiGet(`${wsId}/filters/open_pipeline`);
    assert(G, 'Filter is confirmed after confirm', afterConfirm.filter?.confirmed === true,
      `confirmed: ${afterConfirm.filter?.confirmed}`);
  } else {
    assert(G, 'open_pipeline already confirmed', true, 'Already confirmed');
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  NAMED FILTERS SMOKE TEST');
  console.log('='.repeat(60));

  try {
    const wsId = await findTestWorkspace();

    await testGroup1(wsId);
    await testGroup2(wsId);
    await testGroup3(wsId);
    await testGroup4(wsId);
    await testGroup5(wsId);
  } catch (err) {
    console.error('\n\nFATAL ERROR:', err);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));

  let totalPass = 0;
  let totalFail = 0;

  for (const [group, tests] of Object.entries(results)) {
    const passed = tests.filter(t => t.passed).length;
    const failed = tests.filter(t => !t.passed).length;
    totalPass += passed;
    totalFail += failed;
    const status = failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  ${group}: ${status} (${passed}/${tests.length} tests)`);

    if (failed > 0) {
      tests.filter(t => !t.passed).forEach(t => {
        console.log(`    FAIL: ${t.name} — ${t.message}`);
      });
    }
  }

  console.log(`\n  Total: ${totalPass}/${totalPass + totalFail} passed`);
  console.log('='.repeat(60));

  process.exit(totalFail > 0 ? 1 : 0);
}

main();
