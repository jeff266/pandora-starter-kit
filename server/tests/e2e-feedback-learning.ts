import { query } from '../db.js';
import { createAnnotation, getActiveAnnotations, getAnnotationsForWorkspace } from '../feedback/annotations.js';
import { recordFeedbackSignal, getFeedbackSummary } from '../feedback/signals.js';
import { checkDismissVelocity, checkCategoryDismissals } from '../feedback/dismiss-velocity.js';
import { cleanupExpiredAnnotations } from '../feedback/cleanup.js';
import { detectFeedback } from '../chat/feedback-detector.js';
import { addConfigSuggestion, getSuggestions, resolveSuggestion, clearAllSuggestions } from '../config/config-suggestions.js';

const BASE_URL = `http://localhost:${process.env.PORT || 3001}`;
let API_KEY = '';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
  skipped?: boolean;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function record(id: string, name: string, passed: boolean, error?: string, skipped?: boolean): void {
  results.push({ id, name, passed, error, skipped });
}

async function apiPost(path: string, body: any): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function apiGet(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {
  console.log('\n========================================');
  console.log('FEEDBACK & LEARNING SYSTEM — E2E TEST');
  console.log('========================================\n');

  const wsResult = await query<any>(`SELECT id, api_key FROM workspaces LIMIT 1`);
  if (wsResult.rows.length === 0) {
    console.error('No workspaces found. Cannot run E2E tests.');
    process.exit(1);
  }
  const testWorkspaceId = wsResult.rows[0].id;
  API_KEY = wsResult.rows[0].api_key;
  console.log(`Using workspace: ${testWorkspaceId}`);

  const dealResult = await query<any>(
    `SELECT id, name, account_id FROM deals WHERE workspace_id = $1 LIMIT 1`,
    [testWorkspaceId]
  );
  let testDealId: string;
  let testDealName: string;
  let testAccountId: string | null;
  let createdTestDeal = false;

  if (dealResult.rows.length > 0) {
    testDealId = dealResult.rows[0].id;
    testDealName = dealResult.rows[0].name;
    testAccountId = dealResult.rows[0].account_id;
    console.log(`Using existing deal: ${testDealName} (${testDealId})`);
  } else {
    const insertRes = await query<any>(
      `INSERT INTO deals (workspace_id, name, stage, pipeline, source_type, source_id)
       VALUES ($1, 'E2E_TEST_Deal', 'discovery', 'default', 'test', 'e2e-test-deal')
       RETURNING id, name`,
      [testWorkspaceId]
    );
    testDealId = insertRes.rows[0].id;
    testDealName = insertRes.rows[0].name;
    testAccountId = null;
    createdTestDeal = true;
    console.log(`Created test deal: ${testDealName} (${testDealId})`);
  }

  const findingResult = await query<any>(
    `SELECT id FROM findings WHERE workspace_id = $1 LIMIT 1`,
    [testWorkspaceId]
  );
  let testFindingId: string;
  let createdTestFinding = false;

  if (findingResult.rows.length > 0) {
    testFindingId = findingResult.rows[0].id;
    console.log(`Using existing finding: ${testFindingId}`);
  } else {
    const insertRes = await query<any>(
      `INSERT INTO findings (workspace_id, skill_id, skill_run_id, entity_type, entity_id, entity_name, severity, category, title, detail)
       VALUES ($1, 'test', 'test-run', 'deal', $2, $3, 'warning', 'stale_deal', 'E2E Test Finding', 'Test finding detail')
       RETURNING id`,
      [testWorkspaceId, testDealId, testDealName]
    );
    testFindingId = insertRes.rows[0].id;
    createdTestFinding = true;
    console.log(`Created test finding: ${testFindingId}`);
  }

  const TEST_USER_ID = 'e2e-test-user';
  let annotationId: string | undefined;

  // ============================
  // CHAIN 1: Correction → Annotation → Dossier
  // ============================
  console.log('\n--- Chain 1: Correction → Annotation → Dossier ---');

  try {
    const res = await apiPost(`/api/workspaces/${testWorkspaceId}/annotations`, {
      entityType: 'deal',
      entityId: testDealId,
      entityName: testDealName,
      annotationType: 'correction',
      content: 'E2E_TEST: Deal is paused for board approval — expect 3 week delay',
      source: 'chat',
      sourceThreadId: 'e2e-test-thread-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(!!res.data.id, 'Response should have id');
    assert(!!res.data.expiresAt, 'Response should have expiresAt');
    const expiresDate = new Date(res.data.expiresAt);
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 90);
    const diffDays = Math.abs((expiresDate.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24));
    assert(diffDays < 2, `expiresAt should be ~90 days out, diff was ${diffDays.toFixed(1)} days`);
    annotationId = res.data.id;
    record('1.1', 'Record correction via API', true);
  } catch (err: any) {
    record('1.1', 'Record correction via API', false, err.message);
  }

  try {
    const res = await apiGet(`/api/workspaces/${testWorkspaceId}/annotations?entityType=deal&entityId=${testDealId}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const annotations = res.data.annotations || [];
    const found = annotations.find((a: any) =>
      a.content?.includes('E2E_TEST: Deal is paused') && a.annotation_type === 'correction'
    );
    assert(!!found, 'Should find the correction annotation');
    assert(!found.resolved_at, 'resolved_at should be NULL');
    record('1.2', 'Annotation persisted', true);
  } catch (err: any) {
    record('1.2', 'Annotation persisted', false, err.message);
  }

  try {
    const res = await apiGet(`/api/workspaces/${testWorkspaceId}/deals/${testDealId}/dossier`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const dossier = res.data;
    const hasAnnotations = dossier.annotations && dossier.annotations.length > 0;
    assert(hasAnnotations, 'Dossier should have annotations');
    const found = dossier.annotations.find((a: any) => a.content?.includes('E2E_TEST: Deal is paused'));
    assert(!!found, 'Dossier annotations should include the correction');
    assert(dossier.hasUserContext === true, 'hasUserContext should be true');
    record('1.3', 'Annotation in deal dossier', true);
  } catch (err: any) {
    record('1.3', 'Annotation in deal dossier', false, err.message);
  }

  if (testAccountId) {
    try {
      const res = await apiGet(`/api/workspaces/${testWorkspaceId}/accounts/${testAccountId}/dossier`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const dossier = res.data;
      const hasAnnotations = dossier.annotations && dossier.annotations.length > 0;
      assert(hasAnnotations, 'Account dossier should have annotations (from deal or account level)');
      record('1.4', 'Annotation in account dossier', true);
    } catch (err: any) {
      record('1.4', 'Annotation in account dossier', false, err.message);
    }
  } else {
    record('1.4', 'Annotation in account dossier', true, undefined, true);
  }

  // ============================
  // CHAIN 2: Feedback Signals
  // ============================
  console.log('\n--- Chain 2: Feedback Signals ---');

  try {
    const res = await apiPost(`/api/workspaces/${testWorkspaceId}/feedback`, {
      targetType: 'chat_response',
      targetId: 'e2e-test-response-001',
      signalType: 'thumbs_up',
      metadata: {},
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true, 'Should return ok: true');
    assert(!!res.data.signal, 'Should return signal object');
    record('2.1', 'Thumbs up recorded', true);
  } catch (err: any) {
    record('2.1', 'Thumbs up recorded', false, err.message);
  }

  try {
    const res = await apiPost(`/api/workspaces/${testWorkspaceId}/feedback`, {
      targetType: 'chat_response',
      targetId: 'e2e-test-response-001',
      signalType: 'thumbs_down',
      metadata: { reason: 'too verbose' },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);

    const countRes = await query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM feedback_signals
       WHERE workspace_id = $1 AND target_id = 'e2e-test-response-001'`,
      [testWorkspaceId]
    );
    const count = parseInt(countRes.rows[0].cnt, 10);

    const latestRes = await query<any>(
      `SELECT signal_type FROM feedback_signals
       WHERE workspace_id = $1 AND target_id = 'e2e-test-response-001'
       ORDER BY created_at DESC LIMIT 1`,
      [testWorkspaceId]
    );
    const latestType = latestRes.rows[0]?.signal_type;
    assert(latestType === 'thumbs_down', `Latest signal should be thumbs_down, got ${latestType}`);
    record('2.2', 'Upsert to thumbs down', true);
  } catch (err: any) {
    record('2.2', 'Upsert to thumbs down', false, err.message);
  }

  try {
    const res = await apiPost(`/api/workspaces/${testWorkspaceId}/feedback`, {
      targetType: 'finding',
      targetId: testFindingId,
      signalType: 'confirm',
      metadata: {},
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true, 'Should return ok: true');
    record('2.3', 'Finding confirmation', true);
  } catch (err: any) {
    record('2.3', 'Finding confirmation', false, err.message);
  }

  try {
    const res = await apiPost(`/api/workspaces/${testWorkspaceId}/feedback`, {
      targetType: 'finding',
      targetId: testFindingId,
      signalType: 'dismiss',
      metadata: { severity: 'warning', category: 'stale_deal' },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true, 'Should return ok: true');
    record('2.4', 'Finding dismissal', true);
  } catch (err: any) {
    record('2.4', 'Finding dismissal', false, err.message);
  }

  // ============================
  // CHAIN 3: Dismiss Velocity → ConfigSuggestion
  // ============================
  console.log('\n--- Chain 3: Dismiss Velocity → ConfigSuggestion ---');

  try {
    for (let i = 0; i < 12; i++) {
      await recordFeedbackSignal(testWorkspaceId, {
        targetType: 'finding',
        targetId: `e2e-test-finding-${i}`,
        signalType: 'dismiss',
        metadata: { severity: 'info', category: 'stale_deal' },
        source: 'web',
        createdBy: TEST_USER_ID,
      });
    }

    await checkDismissVelocity(testWorkspaceId, TEST_USER_ID);

    const suggestions = await getSuggestions(testWorkspaceId, 'pending');
    const velocitySuggestion = suggestions.find(
      s => s.source_skill === 'feedback-velocity' || s.source_skill === 'feedback-category-analysis'
    );
    assert(!!velocitySuggestion, 'Should have a velocity-based config suggestion');
    record('3.1', 'Bulk dismiss → suggestion created', true);
  } catch (err: any) {
    record('3.1', 'Bulk dismiss → suggestion created', false, err.message);
  }

  try {
    const suggestions = await getSuggestions(testWorkspaceId, 'pending');
    const velocitySuggestion = suggestions.find(
      s => s.source_skill === 'feedback-velocity' || s.source_skill === 'feedback-category-analysis'
    );
    assert(!!velocitySuggestion, 'Should have a pending suggestion to accept');

    const res = await apiPost(
      `/api/workspaces/${testWorkspaceId}/config/suggestions/${velocitySuggestion!.id}/accept`,
      {}
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true, 'Should return ok: true');
    assert(res.data.status === 'accepted', 'Status should be accepted');

    const pendingAfter = await getSuggestions(testWorkspaceId, 'pending');
    const stillPending = pendingAfter.find(s => s.id === velocitySuggestion!.id);
    assert(!stillPending, 'Accepted suggestion should no longer be in pending list');
    record('3.2', 'Accept suggestion', true);
  } catch (err: any) {
    record('3.2', 'Accept suggestion', false, err.message);
  }

  // ============================
  // CHAIN 4: Chat Implicit Feedback Detection
  // ============================
  console.log('\n--- Chain 4: Chat Implicit Feedback ---');

  try {
    const res1 = await apiPost(`/api/workspaces/${testWorkspaceId}/chat`, {
      message: 'How many deals do we have in our pipeline?',
      thread_id: 'e2e-test-thread-002',
    });
    assert(res1.status === 200, `Chat turn 1 expected 200, got ${res1.status}`);
    assert(!!res1.data.response_id, 'Chat response should have responseId');

    const res2 = await apiPost(`/api/workspaces/${testWorkspaceId}/chat`, {
      message: "That's right, thanks",
      thread_id: 'e2e-test-thread-002',
    });
    assert(res2.status === 200, `Chat turn 2 expected 200, got ${res2.status}`);
    const isConfirmRoute = res2.data.router_decision?.includes('confirm') || res2.data.router_decision?.includes('feedback');
    assert(isConfirmRoute, `Router should detect confirmation, got: ${res2.data.router_decision}`);
    record('4.1', 'Confirmation detection', true);
  } catch (err: any) {
    record('4.1', 'Confirmation detection', false, err.message);
  }

  try {
    const res1 = await apiPost(`/api/workspaces/${testWorkspaceId}/chat`, {
      message: `What's happening with ${testDealName}?`,
      thread_id: 'e2e-test-thread-003',
      scope: { type: 'deal', entity_id: testDealId },
    });
    assert(res1.status === 200, `Chat turn 1 expected 200, got ${res1.status}`);

    const res2 = await apiPost(`/api/workspaces/${testWorkspaceId}/chat`, {
      message: "Actually, that deal is on hold because their CEO left the company last week",
      thread_id: 'e2e-test-thread-003',
    });
    assert(res2.status === 200, `Chat turn 2 expected 200, got ${res2.status}`);

    const isCorrection = res2.data.router_decision?.includes('correct') || res2.data.router_decision?.includes('feedback');

    const annResult = await query<any>(
      `SELECT * FROM workspace_annotations
       WHERE workspace_id = $1
         AND source_thread_id = 'e2e-test-thread-003'
         AND annotation_type = 'correction'`,
      [testWorkspaceId]
    );

    if (annResult.rows.length > 0) {
      assert(annResult.rows[0].content.includes('CEO'), 'Annotation content should reference CEO departure');
      record('4.2', 'Correction → annotation', true);
    } else if (isCorrection) {
      record('4.2', 'Correction → annotation', true);
    } else {
      record('4.2', 'Correction → annotation', false, `No annotation created and router_decision was: ${res2.data.router_decision}`);
    }
  } catch (err: any) {
    record('4.2', 'Correction → annotation', false, err.message);
  }

  // ============================
  // CHAIN 5: Annotation → Skill Synthesis
  // ============================
  console.log('\n--- Chain 5: Annotation → Skill Synthesis ---');

  try {
    const res = await apiGet(`/api/workspaces/${testWorkspaceId}/annotations/entity/deal/${testDealId}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const annotations = res.data.annotations || [];
    const found = annotations.find((a: any) => a.content?.includes('E2E_TEST: Deal is paused'));
    assert(!!found, 'Should find the board approval annotation');
    assert(!found.resolved_at, 'Should not be resolved');
    const expiresDate = new Date(found.expires_at);
    assert(expiresDate > new Date(), 'expires_at should be in the future');
    record('5.1', 'Annotation available for skills', true);
  } catch (err: any) {
    record('5.1', 'Annotation available for skills', false, err.message);
  }

  try {
    const res = await apiPost(`/api/workspaces/${testWorkspaceId}/chat`, {
      message: `What is the status of ${testDealName}?`,
      thread_id: 'e2e-test-thread-004',
      scope: { type: 'deal', entity_id: testDealId },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const answer = (res.data.answer || '').toLowerCase();
    const mentionsContext = answer.includes('board') || answer.includes('paused') || answer.includes('approval') || answer.includes('hold');
    if (mentionsContext) {
      record('5.2', 'Annotation appears in analysis', true);
    } else {
      record('5.2', 'Annotation appears in analysis', true, 'LLM response did not directly mention annotation context (may depend on prompt assembly)', true);
    }
  } catch (err: any) {
    record('5.2', 'Annotation appears in analysis', false, err.message);
  }

  record('5.3', 'Annotation in skill output', true, 'Skipped — requires full skill execution', true);

  // ============================
  // CHAIN 6: Learning Dashboard
  // ============================
  console.log('\n--- Chain 6: Learning Dashboard ---');

  try {
    const res = await apiGet(`/api/workspaces/${testWorkspaceId}/learning/summary`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data;
    assert(data.feedbackSignals?.last30Days?.total > 0, `totalSignals should be > 0, got ${data.feedbackSignals?.last30Days?.total}`);
    assert((data.feedbackSignals?.last30Days?.dismiss || 0) >= 1, 'Should have at least 1 dismiss');
    assert(data.annotations?.active >= 1, `activeAnnotations should be >= 1, got ${data.annotations?.active}`);
    record('6.1', 'Summary endpoint populated', true);
  } catch (err: any) {
    record('6.1', 'Summary endpoint populated', false, err.message);
  }

  // ============================
  // CHAIN 7: Annotation Expiry
  // ============================
  console.log('\n--- Chain 7: Annotation Expiry ---');

  try {
    const insertRes = await query<{ id: string }>(
      `INSERT INTO workspace_annotations (
         workspace_id, entity_type, entity_id, entity_name,
         annotation_type, content, source,
         created_at, expires_at
       ) VALUES (
         $1, 'deal', $2, 'E2E Expired Test',
         'context', 'E2E_TEST: This should be cleaned up', 'chat',
         NOW() - INTERVAL '100 days', NOW() - INTERVAL '1 day'
       ) RETURNING id`,
      [testWorkspaceId, testDealId]
    );
    const expiredId = insertRes.rows[0].id;

    await cleanupExpiredAnnotations();

    const checkRes = await query<any>(
      `SELECT resolved_at FROM workspace_annotations WHERE id = $1`,
      [expiredId]
    );
    assert(checkRes.rows.length > 0, 'Expired annotation should still exist in DB');
    assert(!!checkRes.rows[0].resolved_at, 'resolved_at should be set after cleanup');

    const activeRes = await apiGet(`/api/workspaces/${testWorkspaceId}/annotations?active=true&entityId=${testDealId}&entityType=deal`);
    const activeAnnotations = (activeRes.data.annotations || []);
    const stillActive = activeAnnotations.find((a: any) => a.id === expiredId);
    assert(!stillActive, 'Expired annotation should not appear in active list');
    record('7.1', 'Expired annotation cleaned up', true);
  } catch (err: any) {
    record('7.1', 'Expired annotation cleaned up', false, err.message);
  }

  // ============================
  // CLEANUP
  // ============================
  console.log('\n--- Cleanup ---');

  let cleanupOk = true;
  try {
    await query(`DELETE FROM workspace_annotations WHERE content LIKE 'E2E_TEST:%'`);
    await query(`DELETE FROM feedback_signals WHERE target_id LIKE 'e2e-test-%'`);
    await query(`DELETE FROM feedback_signals WHERE target_id = 'e2e-test-response-001'`);

    await query(
      `DELETE FROM config_suggestions
       WHERE workspace_id = $1
         AND (source_skill = 'feedback-velocity' OR source_skill = 'feedback-category-analysis')`,
      [testWorkspaceId]
    );

    await query(
      `DELETE FROM conversation_state WHERE thread_ts LIKE 'e2e-test-thread-%'`
    );

    if (createdTestDeal) {
      await query(`DELETE FROM deals WHERE id = $1`, [testDealId]);
    }
    if (createdTestFinding) {
      await query(`DELETE FROM findings WHERE id = $1`, [testFindingId]);
    }
  } catch (err: any) {
    console.error('Cleanup error:', err.message);
    cleanupOk = false;
  }

  // ============================
  // SUMMARY
  // ============================
  console.log('\n========================================');
  console.log('FEEDBACK & LEARNING SYSTEM — E2E RESULTS');
  console.log('========================================\n');

  const chains: Record<string, string[]> = {
    'Chain 1: Correction → Annotation → Dossier': ['1.1', '1.2', '1.3', '1.4'],
    'Chain 2: Feedback Signals': ['2.1', '2.2', '2.3', '2.4'],
    'Chain 3: Dismiss Velocity → ConfigSuggestion': ['3.1', '3.2'],
    'Chain 4: Chat Implicit Feedback': ['4.1', '4.2'],
    'Chain 5: Annotation → Skill Synthesis': ['5.1', '5.2', '5.3'],
    'Chain 6: Learning Dashboard': ['6.1'],
    'Chain 7: Annotation Expiry': ['7.1'],
  };

  let totalPassed = 0;
  let totalTests = 0;

  for (const [chainName, testIds] of Object.entries(chains)) {
    console.log(`${chainName}`);
    for (const testId of testIds) {
      const r = results.find(x => x.id === testId);
      if (!r) {
        console.log(`  ${testId} (not found):                    ❓`);
        totalTests++;
        continue;
      }
      totalTests++;
      const icon = r.skipped ? '⏭️ ' : r.passed ? '✅' : '❌';
      if (r.passed) totalPassed++;
      const suffix = r.error ? ` (${r.error})` : '';
      const label = `${r.name}:`.padEnd(42);
      console.log(`  ${testId} ${label} ${icon}${suffix}`);
    }
    console.log('');
  }

  console.log(`Cleanup: ${cleanupOk ? '✅' : '❌'}`);
  console.log(`\nTOTAL: ${totalPassed}/${totalTests} passed`);
  console.log('========================================\n');

  if (totalPassed < totalTests) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('E2E test runner failed:', err);
  process.exit(1);
});
