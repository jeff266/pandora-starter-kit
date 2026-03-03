#!/usr/bin/env node
/**
 * Week 4: Investigation History - API Test Suite
 * Run: node test-week4-replit.js
 */

const http = require('http');

const BASE = 'http://localhost:3001';
const WORKSPACE_ID = process.env.WORKSPACE_ID || '4160191d-73bc-414b-97dd-5a1853190378';

let token = process.env.PANDORA_TEST_TOKEN || null;
let results = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(url, { method, headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function pass(name, note = '') {
  results.push({ name, ok: true, note });
  console.log(`  ✓ ${name}${note ? '  — ' + note : ''}`);
}

function fail(name, reason) {
  results.push({ name, ok: false, note: reason });
  console.log(`  ✗ ${name}  — ${reason}`);
}

async function timed(label, fn) {
  const t = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t;
    return { result, ms };
  } catch (err) {
    const ms = Date.now() - t;
    return { result: null, ms, err };
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function login() {
  if (token) {
    console.log('\nUsing provided session token.\n');
    return true;
  }
  console.log('\nAcquiring auth token...');
  const emails = ['jeff@pandora-revops.com', 'jeff@revopsimpact.us', 'admin@fronterahealth.com'];
  for (const email of emails) {
    const res = await request('POST', '/api/auth/login', { email, password: 'password' });
    if (res.status === 200 && res.data.token) {
      token = res.data.token;
      console.log(`  ✓ Logged in as ${email}\n`);
      return true;
    }
  }
  console.log(`  ! Could not login. Proceeding without auth — all tests will fail.\n`);
  return false;
}

const BASE_PATH = `/api/workspaces/${WORKSPACE_ID}`;

// ── Test 1: History List ──────────────────────────────────────────────────────

let firstCompletedRunId = null;

async function testHistoryList() {
  console.log('═══════════════════════════════════════════════');
  console.log('TEST 1: Investigation History List');
  console.log('═══════════════════════════════════════════════');

  // 1.1 Basic fetch
  const { result, ms } = await timed('1.1', () =>
    request('GET', `${BASE_PATH}/investigation/history?limit=10&offset=0`)
  );
  if (result?.status === 200 && Array.isArray(result.data.runs)) {
    const { runs, pagination } = result.data;
    pass('1.1 Fetch recent runs (limit 10)', `${runs.length} runs, total=${pagination.total}, ${ms}ms`);
    if (runs.length > 0) {
      const r = runs[0];
      console.log(`\n  Sample run:`);
      console.log(`    Run ID:    ${r.runId}`);
      console.log(`    Skill:     ${r.skillId}`);
      console.log(`    Status:    ${r.status}`);
      console.log(`    Completed: ${r.completedAt || 'N/A'}`);
      console.log(`    Duration:  ${r.durationMs ? r.durationMs + 'ms' : 'N/A'}`);
      console.log(`    Summary:   Total=${r.summary.totalRecords}, AtRisk=${r.summary.atRiskCount}, Critical=${r.summary.criticalCount}`);
      const completed = runs.find(r => r.status === 'completed' && r.runId);
      if (completed) firstCompletedRunId = completed.runId;
    }
  } else {
    fail('1.1 Fetch recent runs (limit 10)', `HTTP ${result?.status}`);
  }
  console.log();

  // 1.2 Filter by skill
  const { result: r2, ms: ms2 } = await timed('1.2', () =>
    request('GET', `${BASE_PATH}/investigation/history?skill_id=deal-risk-review&limit=5`)
  );
  if (r2?.status === 200) {
    pass('1.2 Filter by skill_id', `${r2.data.runs?.length ?? 0} runs for deal-risk-review, ${ms2}ms`);
  } else {
    fail('1.2 Filter by skill_id', `HTTP ${r2?.status}`);
  }

  // 1.3 Filter by status
  const { result: r3, ms: ms3 } = await timed('1.3', () =>
    request('GET', `${BASE_PATH}/investigation/history?status=completed&limit=5`)
  );
  if (r3?.status === 200) {
    pass('1.3 Filter by status=completed', `${r3.data.runs?.length ?? 0} runs, ${ms3}ms`);
  } else {
    fail('1.3 Filter by status', `HTTP ${r3?.status}`);
  }

  // 1.4 Pagination
  const { result: r4, ms: ms4 } = await timed('1.4', () =>
    request('GET', `${BASE_PATH}/investigation/history?limit=5&offset=5`)
  );
  if (r4?.status === 200) {
    pass('1.4 Pagination (offset=5)', `${r4.data.runs?.length ?? 0} runs returned, ${ms4}ms`);
  } else {
    fail('1.4 Pagination', `HTTP ${r4?.status}`);
  }

  // 1.5 Response time check
  if (ms < 500) pass('1.5 Response time', `${ms}ms < 500ms target`);
  else fail('1.5 Response time', `${ms}ms exceeds 500ms target`);
}

// ── Test 2: Timeline ──────────────────────────────────────────────────────────

async function testTimeline() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 2: Timeline / Trend Analysis');
  console.log('═══════════════════════════════════════════════');

  // 2.1 30-day timeline
  const { result, ms } = await timed('2.1', () =>
    request('GET', `${BASE_PATH}/investigation/timeline?skill_id=deal-risk-review&days=30`)
  );
  if (result?.status === 200) {
    const { points, summary } = result.data;
    pass('2.1 30-day timeline', `${points?.length ?? 0} points, trend=${summary?.trendDirection}, ${ms}ms`);
    console.log(`    Avg at risk: ${summary?.averageAtRisk}`);
  } else {
    fail('2.1 30-day timeline', `HTTP ${result?.status}`);
  }

  // 2.2 7-day timeline
  const { result: r2, ms: ms2 } = await timed('2.2', () =>
    request('GET', `${BASE_PATH}/investigation/timeline?skill_id=deal-risk-review&days=7`)
  );
  if (r2?.status === 200) {
    pass('2.2 7-day timeline', `${r2.data.points?.length ?? 0} points, ${ms2}ms`);
  } else {
    fail('2.2 7-day timeline', `HTTP ${r2?.status}`);
  }

  // 2.3 Missing skill_id → 400
  const { result: r3 } = await timed('2.3', () =>
    request('GET', `${BASE_PATH}/investigation/timeline`)
  );
  if (r3?.status === 400) {
    pass('2.3 Missing skill_id → 400', 'Error handling correct');
  } else {
    fail('2.3 Missing skill_id error handling', `Expected 400, got ${r3?.status}`);
  }

  // 2.4 Response time
  if (ms < 1000) pass('2.4 Timeline response time', `${ms}ms < 1s target`);
  else fail('2.4 Timeline response time', `${ms}ms exceeds 1s target`);
}

// ── Test 3: Deal Timeline ─────────────────────────────────────────────────────

async function testDealTimeline() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 3: Deal Timeline Tracking');
  console.log('═══════════════════════════════════════════════');

  const testDeals = ['ACES ABA', 'Beacon Services', 'Behavioral Framework'];

  for (const deal of testDeals) {
    const { result, ms } = await timed(deal, () =>
      request('GET', `${BASE_PATH}/investigation/deal-timeline/${encodeURIComponent(deal)}`)
    );
    if (result?.status === 200) {
      const { timeline, summary } = result.data;
      pass(`3.x Deal timeline: ${deal}`, `${timeline?.length ?? 0} appearances, recurring=${summary?.isRecurring}, ${ms}ms`);
      if (timeline?.length > 0) {
        console.log(`    First flagged: ${summary.firstFlagged}`);
        console.log(`    Days flagged:  ${summary.daysFlagged}`);
      }
    } else {
      fail(`3.x Deal timeline: ${deal}`, `HTTP ${result?.status}`);
    }
  }
}

// ── Test 4: Export ────────────────────────────────────────────────────────────

async function testExport() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 4: Export Functionality');
  console.log('═══════════════════════════════════════════════');

  if (!firstCompletedRunId) {
    console.log('  ! No completed run found — skipping export tests');
    results.push({ name: '4.x Export tests', ok: false, note: 'No completed run available' });
    return;
  }

  // 4.1 CSV export
  const { result: r1, ms: ms1 } = await timed('4.1', () =>
    request('POST', `${BASE_PATH}/investigation/export`, { runId: firstCompletedRunId, format: 'csv' })
  );
  if (r1?.status === 200 && r1.data.downloadUrl) {
    pass('4.1 CSV export initiated', `downloadId=${r1.data.downloadId}, ${ms1}ms`);

    // Download the file
    const { result: dl, ms: dlMs } = await timed('4.1d', () =>
      request('GET', r1.data.downloadUrl)
    );
    if (dl?.status === 200) {
      pass('4.1d CSV download', `${dlMs}ms`);
    } else {
      fail('4.1d CSV download', `HTTP ${dl?.status}`);
    }
  } else {
    fail('4.1 CSV export', `HTTP ${r1?.status}: ${JSON.stringify(r1?.data)}`);
  }

  // 4.2 XLSX export
  const { result: r2, ms: ms2 } = await timed('4.2', () =>
    request('POST', `${BASE_PATH}/investigation/export`, { runId: firstCompletedRunId, format: 'xlsx' })
  );
  if (r2?.status === 200 && r2.data.downloadUrl) {
    pass('4.2 XLSX export initiated', `${ms2}ms`);
  } else {
    fail('4.2 XLSX export', `HTTP ${r2?.status}: ${JSON.stringify(r2?.data)}`);
  }

  // 4.3 Missing runId → 400
  const { result: r3 } = await timed('4.3', () =>
    request('POST', `${BASE_PATH}/investigation/export`, { format: 'csv' })
  );
  if (r3?.status === 400) {
    pass('4.3 Missing runId → 400', 'Error handling correct');
  } else {
    fail('4.3 Missing runId error handling', `Expected 400, got ${r3?.status}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   Week 4: Investigation History — Test Suite   ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`\nWorkspace: ${WORKSPACE_ID}`);
  console.log(`Server:    ${BASE}\n`);

  await login();

  await testHistoryList();
  await testTimeline();
  await testDealTimeline();
  await testExport();

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const total = results.length;

  console.log('\n═══════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Passed: ${passed}/${total}`);
  if (failed > 0) {
    console.log(`  Failed: ${failed}/${total}`);
    results.filter(r => !r.ok).forEach(r => console.log(`    ✗ ${r.name}: ${r.note}`));
  }
  console.log(`\n  ${failed === 0 ? '✅ All tests passed!' : `⚠️  ${failed} test(s) need attention`}`);
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
