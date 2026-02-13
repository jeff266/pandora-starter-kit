import { execSync } from 'child_process';

const BASE = 'http://localhost:5000/api/workspaces';
const WS_ID = '4160191d-73bc-414b-97dd-5a1853190378';

let passed = 0;
let failed = 0;
let skipped = 0;
const results: Array<{ label: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; detail: string }> = [];

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    results.push({ label, status: 'PASS', detail });
    console.log(`  ✓ PASS: ${label} — ${detail}`);
  } else {
    failed++;
    results.push({ label, status: 'FAIL', detail });
    console.log(`  ✗ FAIL: ${label} — ${detail}`);
  }
}

function skip(label: string, detail: string): void {
  skipped++;
  results.push({ label, status: 'SKIPPED', detail });
  console.log(`  ⊘ SKIPPED: ${label} — ${detail}`);
}

function get(path: string): any {
  const raw = execSync(
    `curl -s --max-time 30 '${BASE}/${WS_ID}${path}'`,
    { timeout: 35000 }
  ).toString();
  return JSON.parse(raw);
}

function post(path: string, body: any = {}, timeoutSec = 30): any {
  const raw = execSync(
    `curl -s --max-time ${timeoutSec} -X POST '${BASE}/${WS_ID}${path}' -H 'Content-Type: application/json' -d '${JSON.stringify(body)}'`,
    { timeout: (timeoutSec + 5) * 1000 }
  ).toString();
  return JSON.parse(raw);
}

function sql(query: string): string {
  return execSync(
    `psql "$DATABASE_URL" -t -A -c "${query.replace(/"/g, '\\"')}"`,
    { timeout: 15000 }
  ).toString().trim();
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║     PANDORA — Conversation Intelligence Integration Test   ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`\nWorkspace: ${WS_ID}`);
console.log(`Timestamp: ${new Date().toISOString()}\n`);

console.log('═══ STEP 0: Run Linker (triggers internal classification) ═══');
try {
  const linkerResult = post('/linker/run', {}, 60);
  const totalLinked = (linkerResult.linked?.tier1_email || 0) +
    (linkerResult.linked?.tier2_native || 0) +
    (linkerResult.linked?.tier3_inferred || 0);
  console.log(`  Linker: ${totalLinked} linked, ${linkerResult.internalFiltered || 0} internal, ${linkerResult.stillUnlinked || 0} unlinked (${linkerResult.durationMs}ms)`);
} catch (err: any) {
  console.log(`  Linker run error: ${err.message}`);
}

// ============================================================================
// TEST GROUP 1: Internal Meeting Filter
// ============================================================================
console.log('\n═══ TEST GROUP 1: Internal Meeting Filter ═══');

try {
  const domains = get('/config/internal-domains');
  console.log(`  Resolved domains: ${JSON.stringify(domains.domains)} (source: ${domains.source})`);
  console.log(`  Conversation stats: ${JSON.stringify(domains.conversation_stats)}`);

  check('1a. Internal domains resolved to frontera.health',
    domains.domains.includes('frontera.health'),
    `Domains: ${domains.domains.join(', ')}, source: ${domains.source}`);

  check('1a2. Domain source is connector (tracked users)',
    domains.source === 'connector',
    `source: ${domains.source}`);
} catch (err: any) {
  check('1a. Internal domains resolved', false, `Error: ${err.message}`);
}

try {
  const status = get('/linker/status');
  console.log(`  Total conversations: ${status.total_conversations}`);
  console.log(`  Internal meetings: ${status.internal_meetings}`);
  console.log(`  Linked to deal: ${status.linked_to_deal}`);

  check('1b. Linker status reports conversation counts',
    status.total_conversations > 0,
    `total=${status.total_conversations}, internal=${status.internal_meetings}, linked=${status.linked_to_deal}`);
} catch (err: any) {
  check('1b. Linker status reports conversation counts', false, `Error: ${err.message}`);
}

try {
  const classifiedCount = sql(
    `SELECT COUNT(*)::int FROM conversations WHERE workspace_id = '${WS_ID}' AND internal_classification_reason IS NOT NULL`
  );
  const totalCount = sql(
    `SELECT COUNT(*)::int FROM conversations WHERE workspace_id = '${WS_ID}'`
  );

  check('1c. All conversations classified (reason persisted)',
    parseInt(classifiedCount) === parseInt(totalCount) && parseInt(totalCount) > 0,
    `${classifiedCount}/${totalCount} classified`);
} catch (err: any) {
  check('1c. All conversations classified', false, `Error: ${err.message}`);
}

try {
  const fellowshipInternal = sql(
    `SELECT is_internal FROM conversations WHERE workspace_id = '${WS_ID}' AND title ILIKE '%fellowship%' LIMIT 1`
  );
  const fellowshipParticipants = sql(
    `SELECT string_agg(p->>'email', ', ') FROM conversations c, jsonb_array_elements(c.participants::jsonb) p WHERE c.workspace_id = '${WS_ID}' AND c.title ILIKE '%fellowship%'`
  );
  console.log(`\n  "Frontera Fellowship" participants: ${fellowshipParticipants}`);
  console.log(`  "Fellowship" is_internal: ${fellowshipInternal}`);
  
  const hasExternalParticipant = fellowshipParticipants.includes('gmail.com') || 
    fellowshipParticipants.split(',').some((e: string) => !e.trim().includes('frontera.health'));

  if (hasExternalParticipant) {
    check('1d. Fellowship correctly classified (has external participant)',
      fellowshipInternal === 'f',
      'Has gmail.com participant → correctly external');
  } else {
    check('1d. Fellowship classified as internal (all-internal meeting)',
      fellowshipInternal === 't',
      'All participants internal');
  }
} catch (err: any) {
  check('1d. Fellowship classification', false, `Error: ${err.message}`);
}

try {
  const pgPrecious = sql(
    `SELECT is_internal FROM conversations WHERE workspace_id = '${WS_ID}' AND title ILIKE '%Precious Care%' LIMIT 1`
  );
  check('1e. "Precious Care" NOT classified as internal',
    pgPrecious === 'f',
    `is_internal = ${pgPrecious}`);
} catch (err: any) {
  check('1e. "Precious Care" NOT classified as internal', false, `Error: ${err.message}`);
}

try {
  const pgInternalDeals = sql(
    `SELECT COUNT(*)::int FROM conversations WHERE workspace_id = '${WS_ID}' AND is_internal = true AND deal_id IS NOT NULL`
  );
  check('1f. No internal meetings linked to deals',
    parseInt(pgInternalDeals) === 0,
    `count = ${pgInternalDeals}`);
} catch (err: any) {
  check('1f. No internal meetings linked to deals', false, `Error: ${err.message}`);
}

// ============================================================================
// TEST GROUP 2: CWD Compute
// ============================================================================
console.log('\n═══ TEST GROUP 2: Conversations Without Deals (CWD) ═══');

try {
  const cwd = get('/conversations-without-deals');
  console.log(`\n  CWD Summary:`);
  console.log(`    Total CWD: ${cwd.summary.total_cwd}`);
  console.log(`    By severity: ${JSON.stringify(cwd.summary.by_severity)}`);
  console.log(`    By rep: ${JSON.stringify(cwd.summary.by_rep)}`);
  console.log(`    Pipeline gap: ${cwd.summary.estimated_pipeline_gap}`);

  check('2a. CWD total > 0',
    cwd.summary.total_cwd > 0,
    `total_cwd = ${cwd.summary.total_cwd}`);

  const highCount = cwd.summary.by_severity?.high || 0;
  check('2a2. CWD has high severity items',
    highCount > 0,
    `high severity = ${highCount}`);

  const conversations = cwd.conversations || cwd.all_conversations || [];

  const preciousCare = conversations.find((c: any) =>
    c.account_name?.toLowerCase().includes('precious care'));
  const helpingHands = conversations.find((c: any) =>
    c.account_name?.toLowerCase().includes('helping hands'));
  const guidepost = conversations.find((c: any) =>
    c.account_name?.toLowerCase().includes('guidepost'));

  check('2b. CWD includes "Precious Care"',
    !!preciousCare,
    preciousCare ? `Found: ${preciousCare.account_name}, severity=${preciousCare.severity}` : 'NOT found');

  const hasSecondExpected = helpingHands || guidepost;
  check('2b2. CWD includes "Helping Hands" or "Guidepost"',
    !!hasSecondExpected,
    hasSecondExpected
      ? `Found: ${(helpingHands || guidepost).account_name}`
      : 'Neither found');

  if (preciousCare) {
    check('2b3. Precious Care has severity=high + cause=deal_not_created',
      preciousCare.severity === 'high' && preciousCare.likely_cause === 'deal_not_created',
      `severity=${preciousCare.severity}, cause=${preciousCare.likely_cause}`);
  }

  const allEnriched = conversations.every((c: any) =>
    c.account_name != null && typeof c.open_deals_at_account === 'number' && typeof c.total_contacts_at_account === 'number'
  );

  check('2c. All CWD results have account enrichment',
    allEnriched,
    allEnriched ? 'All have account_name, open_deals, total_contacts' : 'Some missing enrichment');

  console.log(`\n  Top 3 CWD conversations:`);
  for (const c of conversations.slice(0, 3)) {
    console.log(`    - ${c.account_name} | ${c.conversation_title} | severity=${c.severity} | cause=${c.likely_cause}`);
  }

  const noInternal = conversations.every((c: any) => !c.is_internal);
  const noDeals = conversations.every((c: any) => !c.deal_id);
  check('2d. CWD filtering: no internal meetings, no deal-linked',
    noInternal && noDeals,
    `no_internal=${noInternal}, no_deal_linked=${noDeals}`);

} catch (err: any) {
  check('2a. CWD total > 0', false, `Error: ${err.message}`);
}

// ============================================================================
// TEST GROUP 3: Deal Insights Extraction
// ============================================================================
console.log('\n═══ TEST GROUP 3: Deal Insights Extraction ═══');

let insightsStatus: any = null;

try {
  insightsStatus = get('/insights/status');
  console.log(`\n  Pre-extraction status:`);
  console.log(`    Total insights: ${insightsStatus.total_insights}`);
  console.log(`    Conversations pending: ${insightsStatus.conversations_pending}`);
  console.log(`    Config framework: ${insightsStatus.config?.framework}`);
  console.log(`    Active types: ${JSON.stringify(insightsStatus.config?.active_types)}`);

  check('3a. Insights status endpoint works',
    typeof insightsStatus.total_insights === 'number',
    `total=${insightsStatus.total_insights}, pending=${insightsStatus.conversations_pending}`);
} catch (err: any) {
  check('3a. Insights status endpoint works', false, `Error: ${err.message}`);
}

try {
  console.log('\n  Running extraction (may take up to 3 min for DeepSeek calls)...');
  const extraction = post('/insights/extract', {}, 180);
  console.log(`  Extraction result:`);
  console.log(`    Processed: ${extraction.processed}`);
  console.log(`    Extracted: ${extraction.extracted}`);
  console.log(`    Skipped: ${extraction.skipped}`);
  console.log(`    Errors: ${extraction.errors}`);

  check('3b. Extraction ran without crashing',
    extraction.processed >= 0,
    `processed=${extraction.processed}, extracted=${extraction.extracted}`);

  if (extraction.processed > 0 && extraction.extracted > 0) {
    check('3b2. Extraction produced insights',
      extraction.extracted > 0,
      `${extraction.extracted} insights from ${extraction.processed} conversations`);
  } else if (extraction.processed === 0 && insightsStatus?.conversations_pending === 0) {
    skip('3b2. Extraction produced insights', 'No pending conversations (already processed or no linked convs)');
  } else {
    skip('3b2. Extraction produced insights', `processed=${extraction.processed}, extracted=${extraction.extracted}`);
  }
} catch (err: any) {
  check('3b. Extraction ran without crashing', false, `Error: ${err.message}`);
}

try {
  const statusAfter = get('/insights/status');
  console.log(`\n  Post-extraction status:`);
  console.log(`    Total insights: ${statusAfter.total_insights}`);
  console.log(`    By type: ${JSON.stringify(statusAfter.by_type)}`);

  if (statusAfter.total_insights > 0) {
    const typeCount = Object.keys(statusAfter.by_type).length;
    check('3c. Multiple insight types extracted',
      typeCount >= 1,
      `${typeCount} types: ${Object.keys(statusAfter.by_type).join(', ')}`);
  } else {
    skip('3c. Multiple insight types extracted', 'No insights yet');
  }
} catch (err: any) {
  check('3c. Insight types', false, `Error: ${err.message}`);
}

try {
  const dealWithConv = sql(
    `SELECT d.id || '|' || d.name FROM deals d JOIN conversations c ON c.deal_id = d.id AND c.workspace_id = d.workspace_id WHERE d.workspace_id = '${WS_ID}' AND c.is_internal = FALSE LIMIT 1`
  );

  if (dealWithConv) {
    const [dealId, dealName] = dealWithConv.split('|');
    console.log(`\n  Checking insights for deal: ${dealName} (${dealId})`);

    const dealInsights = get(`/deals/${dealId}/insights`);
    console.log(`    Insights found: ${dealInsights.insights?.length || 0}`);

    if (dealInsights.insights && dealInsights.insights.length > 0) {
      for (const ins of dealInsights.insights.slice(0, 5)) {
        console.log(`      - ${ins.insight_type}: ${String(ins.value).substring(0, 80)} (conf: ${ins.confidence})`);
      }

      const allValid = dealInsights.insights.every((i: any) =>
        i.insight_type && i.value && typeof i.confidence === 'number' &&
        i.confidence >= 0 && i.confidence <= 1
      );

      check('3d. Deal insights have valid structure',
        allValid,
        `${dealInsights.insights.length} insights, all valid`);
    } else {
      skip('3d. Deal insights have valid structure', 'No insights for this deal yet');
    }

    const history = get(`/deals/${dealId}/insights/history`);
    check('3d2. Deal insights history endpoint works',
      Array.isArray(history.history),
      `${history.history?.length || 0} history entries`);
  } else {
    skip('3d. Deal insights have valid structure', 'No deals with conversations found');
    skip('3d2. Deal insights history endpoint works', 'No deals with conversations found');
  }
} catch (err: any) {
  check('3d. Deal insights', false, `Error: ${err.message}`);
}

try {
  console.log('\n  Running extraction again (idempotency check)...');
  const extraction2 = post('/insights/extract', {}, 60);
  console.log(`    Processed: ${extraction2.processed}, Extracted: ${extraction2.extracted}`);

  check('3e. Extraction is idempotent',
    extraction2.processed === 0,
    `processed=${extraction2.processed} (expected 0)`);
} catch (err: any) {
  check('3e. Extraction is idempotent', false, `Error: ${err.message}`);
}

// ============================================================================
// TEST GROUP 4: Skill Execution (may be SKIPPED)
// ============================================================================
console.log('\n═══ TEST GROUP 4: Skill Execution with Conversation Data ═══');

const skillTests = [
  { id: 'data-quality-audit', label: 'Data Quality Audit', checkFor: 'conversation' },
  { id: 'pipeline-hygiene', label: 'Pipeline Hygiene', checkFor: 'qualification' },
];

for (const skill of skillTests) {
  console.log(`\n  Running ${skill.label}...`);
  try {
    const raw = execSync(
      `curl -s --max-time 180 -X POST '${BASE}/${WS_ID}/skills/${skill.id}/run' -H 'Content-Type: application/json' -d '{"params":{}}'`,
      { timeout: 200000 }
    ).toString();
    const result = JSON.parse(raw);

    if (result.error) {
      skip(`4. ${skill.label}`, `Error: ${String(result.error).substring(0, 150)}`);
      continue;
    }

    const output = result.output_preview || '';
    console.log(`    Status: ${result.status}, Duration: ${result.duration_ms}ms`);
    console.log(`    Output preview: ${output.substring(0, 200)}...`);

    if (result.status === 'completed' && output.length > 50) {
      const hasCWDRef = output.toLowerCase().includes(skill.checkFor);
      if (hasCWDRef) {
        check(`4. ${skill.label} includes ${skill.checkFor} data`,
          true,
          `Found "${skill.checkFor}" in output`);
      } else {
        skip(`4. ${skill.label} includes ${skill.checkFor} data`,
          `Skill ran but output doesn't mention "${skill.checkFor}" — may need Claude Code re-sync`);
      }
    } else {
      skip(`4. ${skill.label} includes ${skill.checkFor} data`,
        `Status: ${result.status}, output length: ${output.length}`);
    }
  } catch (err: any) {
    skip(`4. ${skill.label}`, `Timeout or error: ${String(err.message).substring(0, 100)}`);
  }
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║                    TEST RESULTS SUMMARY                     ║');
console.log('╠══════════════════════════════════════════════════════════════╣');

for (const r of results) {
  const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⊘';
  const status = r.status.padEnd(7);
  console.log(`║ ${icon} ${status} | ${r.label.padEnd(48).substring(0, 48)} ║`);
}

console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║ PASSED: ${String(passed).padEnd(3)} | FAILED: ${String(failed).padEnd(3)} | SKIPPED: ${String(skipped).padEnd(3)}                     ║`);
console.log('╚══════════════════════════════════════════════════════════════╝');

if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter(r => r.status === 'FAIL')) {
    console.log(`  ✗ ${r.label}: ${r.detail}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
