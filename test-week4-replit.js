/**
 * Week 4 Investigation History - Replit Test Script
 *
 * Tests all Week 4 endpoints:
 * - Investigation history list with filters
 * - Timeline/trend analysis
 * - Deal timeline tracking
 * - CSV/XLSX export
 * - Download serving
 *
 * Usage in Replit:
 * 1. Set WORKSPACE_ID environment variable
 * 2. Run: node test-week4-replit.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000/api';
const WORKSPACE_ID = process.env.WORKSPACE_ID || 'YOUR_WORKSPACE_ID_HERE';

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60) + '\n');
}

async function apiCall(method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  log(`${method} ${path}`, 'blue');

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      log(`✗ Failed: ${response.status}`, 'red');
      console.log(data);
      return null;
    }

    log(`✓ Success: ${response.status}`, 'green');
    return data;
  } catch (error) {
    log(`✗ Error: ${error.message}`, 'red');
    return null;
  }
}

// Test 1: Investigation History List
async function testHistoryList() {
  section('TEST 1: Investigation History List');

  // Basic query
  log('\n1.1 Fetch recent investigation runs (limit 10)', 'yellow');
  const history = await apiCall('GET', `/${WORKSPACE_ID}/investigation/history?limit=10&offset=0`);

  if (history) {
    console.log(`Total runs: ${history.pagination?.total || 0}`);
    console.log(`Returned: ${history.runs?.length || 0} runs`);

    if (history.runs && history.runs.length > 0) {
      const run = history.runs[0];
      console.log('\nSample run:');
      console.log(`  Run ID: ${run.runId}`);
      console.log(`  Skill: ${run.skillId}`);
      console.log(`  Status: ${run.status}`);
      console.log(`  Completed: ${run.completedAt}`);
      console.log(`  Duration: ${run.durationMs}ms`);
      console.log(`  Summary:`);
      console.log(`    Total Records: ${run.summary?.totalRecords || 0}`);
      console.log(`    At Risk: ${run.summary?.atRiskCount || 0}`);
      console.log(`    Critical: ${run.summary?.criticalCount || 0}`);
      console.log(`    Warning: ${run.summary?.warningCount || 0}`);
    }
  }

  // Filtered query
  log('\n1.2 Filter by skill: deal-risk-review', 'yellow');
  const filtered = await apiCall('GET', `/${WORKSPACE_ID}/investigation/history?skill_id=deal-risk-review&limit=5`);

  if (filtered) {
    console.log(`Filtered results: ${filtered.runs?.length || 0} runs`);
  }

  // Status filter
  log('\n1.3 Filter by status: completed', 'yellow');
  const statusFiltered = await apiCall('GET', `/${WORKSPACE_ID}/investigation/history?status=completed&limit=5`);

  if (statusFiltered) {
    console.log(`Completed runs: ${statusFiltered.runs?.length || 0}`);
  }

  // Pagination
  log('\n1.4 Test pagination (offset 10)', 'yellow');
  const paginated = await apiCall('GET', `/${WORKSPACE_ID}/investigation/history?limit=5&offset=10`);

  if (paginated) {
    console.log(`Pagination: offset ${paginated.pagination?.offset}, limit ${paginated.pagination?.limit}`);
  }
}

// Test 2: Timeline/Trend Analysis
async function testTimeline() {
  section('TEST 2: Timeline & Trend Analysis');

  log('\n2.1 Fetch 30-day timeline for deal-risk-review', 'yellow');
  const timeline = await apiCall('GET', `/${WORKSPACE_ID}/investigation/timeline?skill_id=deal-risk-review&days=30`);

  if (timeline) {
    console.log(`Skill: ${timeline.skillId}`);
    console.log(`Data points: ${timeline.points?.length || 0}`);
    console.log('\nSummary:');
    console.log(`  Total runs: ${timeline.summary?.totalRuns || 0}`);
    console.log(`  Average at-risk: ${timeline.summary?.averageAtRisk?.toFixed(1) || 0}`);
    console.log(`  Trend: ${timeline.summary?.trendDirection || 'N/A'}`);

    if (timeline.points && timeline.points.length > 0) {
      const point = timeline.points[timeline.points.length - 1];
      console.log('\nMost recent data point:');
      console.log(`  Timestamp: ${point.timestamp}`);
      console.log(`  At Risk: ${point.atRiskCount}`);
      console.log(`  Critical: ${point.criticalCount}`);
      console.log(`  Warning: ${point.warningCount}`);
      console.log(`  Healthy: ${point.healthyCount}`);
      console.log(`  Delta: +${point.deltaFromPrevious?.newAtRisk || 0} new, ${point.deltaFromPrevious?.improved || 0} improved`);
    }
  }

  log('\n2.2 Fetch 7-day timeline', 'yellow');
  const weekTimeline = await apiCall('GET', `/${WORKSPACE_ID}/investigation/timeline?skill_id=deal-risk-review&days=7`);

  if (weekTimeline) {
    console.log(`Week data points: ${weekTimeline.points?.length || 0}`);
  }
}

// Test 3: Deal Timeline
async function testDealTimeline() {
  section('TEST 3: Deal Timeline');

  // First, get a deal name from recent history
  const history = await apiCall('GET', `/${WORKSPACE_ID}/investigation/history?skill_id=deal-risk-review&limit=1`);

  let dealName = 'Sample Deal'; // fallback

  if (history?.runs?.[0]?.runId) {
    log('\n3.1 Fetch investigation results to find a deal', 'yellow');
    const results = await apiCall('GET', `/${WORKSPACE_ID}/investigation/results/${history.runs[0].runId}`);

    if (results?.evidence?.evaluated_records?.[0]?.entity_name) {
      dealName = results.evidence.evaluated_records[0].entity_name;
      console.log(`Found deal: ${dealName}`);
    }
  }

  log(`\n3.2 Fetch timeline for deal: ${dealName}`, 'yellow');
  const dealTimeline = await apiCall('GET', `/${WORKSPACE_ID}/investigation/deal-timeline/${encodeURIComponent(dealName)}`);

  if (dealTimeline) {
    console.log(`Deal: ${dealTimeline.dealName}`);
    console.log(`Timeline entries: ${dealTimeline.timeline?.length || 0}`);

    if (dealTimeline.summary) {
      console.log('\nSummary:');
      console.log(`  First flagged: ${dealTimeline.summary.firstFlagged || 'N/A'}`);
      console.log(`  Days flagged: ${dealTimeline.summary.daysFlagged || 0}`);
      console.log(`  Times appeared: ${dealTimeline.summary.timesAppeared || 0}`);
      console.log(`  Is recurring: ${dealTimeline.summary.isRecurring ? 'Yes' : 'No'}`);
    }

    if (dealTimeline.timeline && dealTimeline.timeline.length > 0) {
      console.log('\nRecent timeline entries:');
      dealTimeline.timeline.slice(0, 3).forEach((entry, i) => {
        console.log(`  ${i + 1}. ${entry.timestamp} - ${entry.severity} (${entry.severityChange})`);
        console.log(`     "${entry.finding}"`);
      });
    }
  }
}

// Test 4: Export Functionality
async function testExport() {
  section('TEST 4: Export Functionality');

  // Get a runId first
  const history = await apiCall('GET', `/${WORKSPACE_ID}/investigation/history?limit=1`);

  if (!history?.runs?.[0]?.runId) {
    log('No runs found to export', 'red');
    return;
  }

  const runId = history.runs[0].runId;
  console.log(`Using runId: ${runId}`);

  // Test CSV export
  log('\n4.1 Export as CSV', 'yellow');
  const csvExport = await apiCall('POST', `/${WORKSPACE_ID}/investigation/export`, {
    runId,
    format: 'csv',
  });

  if (csvExport) {
    console.log(`Download URL: ${csvExport.downloadUrl}`);
    console.log(`Filename: ${csvExport.filename}`);
    console.log(`Format: ${csvExport.format}`);

    // Test download
    log('\n4.2 Test CSV download', 'yellow');
    const downloadUrl = `${BASE_URL}${csvExport.downloadUrl}`;
    try {
      const response = await fetch(downloadUrl);
      if (response.ok) {
        const csvContent = await response.text();
        const lines = csvContent.split('\n');
        console.log(`CSV downloaded: ${csvContent.length} bytes`);
        console.log(`Rows: ${lines.length}`);
        console.log('First 3 lines:');
        lines.slice(0, 3).forEach(line => console.log(`  ${line}`));
      } else {
        log(`Download failed: ${response.status}`, 'red');
      }
    } catch (error) {
      log(`Download error: ${error.message}`, 'red');
    }
  }

  // Test XLSX export
  log('\n4.3 Export as XLSX', 'yellow');
  const xlsxExport = await apiCall('POST', `/${WORKSPACE_ID}/investigation/export`, {
    runId,
    format: 'xlsx',
  });

  if (xlsxExport) {
    console.log(`Download URL: ${xlsxExport.downloadUrl}`);
    console.log(`Filename: ${xlsxExport.filename}`);
    console.log(`Format: ${xlsxExport.format}`);

    // Test download
    log('\n4.4 Test XLSX download', 'yellow');
    const downloadUrl = `${BASE_URL}${xlsxExport.downloadUrl}`;
    try {
      const response = await fetch(downloadUrl);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        console.log(`XLSX downloaded: ${buffer.byteLength} bytes`);
        log('✓ XLSX file appears valid (binary data received)', 'green');
      } else {
        log(`Download failed: ${response.status}`, 'red');
      }
    } catch (error) {
      log(`Download error: ${error.message}`, 'red');
    }
  }
}

// Test 5: Error Handling
async function testErrorHandling() {
  section('TEST 5: Error Handling');

  log('\n5.1 Invalid skill_id', 'yellow');
  await apiCall('GET', `/${WORKSPACE_ID}/investigation/timeline?skill_id=invalid-skill&days=30`);

  log('\n5.2 Invalid days parameter (too large)', 'yellow');
  await apiCall('GET', `/${WORKSPACE_ID}/investigation/timeline?skill_id=deal-risk-review&days=999`);

  log('\n5.3 Invalid runId for export', 'yellow');
  await apiCall('POST', `/${WORKSPACE_ID}/investigation/export`, {
    runId: 'invalid-run-id',
    format: 'csv',
  });

  log('\n5.4 Invalid format for export', 'yellow');
  await apiCall('POST', `/${WORKSPACE_ID}/investigation/export`, {
    runId: 'some-id',
    format: 'pdf',
  });
}

// Run all tests
async function runAllTests() {
  console.clear();
  log('╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║     Week 4: Investigation History - Test Suite            ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');

  log(`\nBase URL: ${BASE_URL}`, 'blue');
  log(`Workspace ID: ${WORKSPACE_ID}`, 'blue');

  if (WORKSPACE_ID === 'YOUR_WORKSPACE_ID_HERE') {
    log('\n⚠️  WARNING: Please set WORKSPACE_ID environment variable', 'red');
    log('   export WORKSPACE_ID=your-workspace-id', 'yellow');
    log('   or set it in Replit Secrets\n', 'yellow');
    process.exit(1);
  }

  const startTime = Date.now();

  try {
    await testHistoryList();
    await testTimeline();
    await testDealTimeline();
    await testExport();
    await testErrorHandling();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    section('TEST SUMMARY');
    log(`✓ All tests completed in ${duration}s`, 'green');
    log('\nNext steps:', 'yellow');
    log('1. Open the frontend: http://localhost:5173/investigation/history', 'cyan');
    log('2. Test filters: skill, status, date range', 'cyan');
    log('3. Test timeline chart when skill is selected', 'cyan');
    log('4. Test table sorting by clicking column headers', 'cyan');
    log('5. Test pagination with Previous/Next buttons', 'cyan');
    log('6. Test export by clicking CSV/XLSX buttons', 'cyan');
    log('7. Test clicking rows to view investigation results', 'cyan');
    log('8. Test "View History" button from ProactiveBriefing', 'cyan');

  } catch (error) {
    log(`\n✗ Test suite failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
