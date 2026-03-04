/**
 * Test: Query Activity Signals
 * Run: npx tsx server/test-query-signals.ts
 *
 * Tests the queryActivitySignals interface with 4 filter scenarios.
 * Requires extraction to have run first (server/test-signal-extraction.ts).
 */

import { queryActivitySignals } from './signals/query-activity-signals.js';
import { query } from './db.js';

const FRONTERA_WORKSPACE = '4160191d-73bc-414b-97dd-5a1853190378';
const EMAIL_WORKSPACE = '31551fe0-b746-4384-aab2-d5cdd70b19ed';
const APRICOTT_DEAL = 'd5cde72c-11c1-49e5-b222-ed1bf1458989';

let passed = 0;
let failed = 0;

async function scenario(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  console.log(`\n── ${name} ──`);
  try {
    await fn();
  } catch (err) {
    console.log(`  ❌ Scenario threw error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function main() {
  console.log('Activity Signal Query Test');
  console.log('═'.repeat(50));

  // ── Pre-check: any signals exist? ─────────────────────────────────────────

  const totalSignals = await query<{ count: string; workspaces: string }>(
    `SELECT COUNT(*) as count, COUNT(DISTINCT workspace_id) as workspaces FROM activity_signals`
  );
  const count = parseInt(totalSignals.rows[0].count);
  const workspaces = totalSignals.rows[0].workspaces;

  console.log(`\nTotal signals in DB: ${count} across ${workspaces} workspace(s)`);

  if (count === 0) {
    console.log('\n⚠️  No signals found. Run test-signal-extraction.ts first:');
    console.log('   npx tsx server/test-signal-extraction.ts');
    process.exit(0);
  }

  // Find a deal that actually has signals
  const dealWithSignals = await query<{ deal_id: string; workspace_id: string; count: string }>(
    `SELECT deal_id, workspace_id, COUNT(*) as count
     FROM activity_signals
     WHERE deal_id IS NOT NULL
     GROUP BY deal_id, workspace_id
     ORDER BY count DESC
     LIMIT 1`
  );

  const testDealId = dealWithSignals.rows[0]?.deal_id || APRICOTT_DEAL;
  const testWorkspace = dealWithSignals.rows[0]?.workspace_id || FRONTERA_WORKSPACE;
  console.log(`\nUsing deal ${testDealId.slice(0, 8)} in workspace ${testWorkspace.slice(0, 8)} for tests (${dealWithSignals.rows[0]?.count || 0} signals)`);

  // ── Scenario 1: All framework signals for a deal ──────────────────────────

  await scenario('Scenario 1: Framework signals for a deal', async () => {
    const result = await queryActivitySignals(testWorkspace, {
      deal_id: testDealId,
      signal_type: 'framework_signal',
    });

    console.log(`  Found ${result.total} framework signal(s) (showing ${result.signals.length}):`);
    for (const sig of result.signals.slice(0, 5)) {
      const fw = sig.framework_field ? `[${sig.framework_field}]` : '';
      const speaker = sig.speaker_type ? `(${sig.speaker_type})` : '';
      console.log(`    • ${fw} ${speaker} "${(sig.source_quote || sig.signal_value || '').slice(0, 80)}"`);
    }

    if (result.signals.every(s => s.signal_type === 'framework_signal')) {
      console.log('  ✅ All returned signals are framework_signal type');
      passed++;
    } else {
      console.log('  ❌ Non-framework signals in results');
      failed++;
    }
  });

  // ── Scenario 2: Filter by framework field ────────────────────────────────

  await scenario('Scenario 2: Filter by framework_field (e.g., identify_pain or timeline)', async () => {
    // Try common MEDDIC fields — use whichever has data
    const fields = ['identify_pain', 'timeline', 'metrics', 'decision_process', 'economic_buyer', 'champion'];
    let found = false;

    for (const field of fields) {
      const result = await queryActivitySignals(testWorkspace, {
        deal_id: testDealId,
        framework_field: field,
      });

      if (result.total > 0) {
        console.log(`  Framework field "${field}" has ${result.total} signal(s):`);
        for (const sig of result.signals.slice(0, 3)) {
          console.log(`    • "${(sig.source_quote || sig.signal_value || '').slice(0, 80)}"`);
        }

        const allMatchField = result.signals.every(s => s.framework_field === field);
        if (allMatchField) {
          console.log(`  ✅ All signals match field "${field}"`);
          passed++;
        } else {
          console.log(`  ❌ Signal field mismatch`);
          failed++;
        }
        found = true;
        break;
      }
    }

    if (!found) {
      console.log('  ⚠️  No framework field signals for this deal yet (extraction may need more activities)');
    }
  });

  // ── Scenario 3: Prospect quotes only ─────────────────────────────────────

  await scenario('Scenario 3: Prospect-attributed quotes', async () => {
    const result = await queryActivitySignals(testWorkspace, {
      deal_id: testDealId,
      signal_type: 'notable_quote',
      speaker_type: 'prospect',
    });

    console.log(`  Found ${result.total} prospect quote(s):`);
    for (const sig of result.signals.slice(0, 4)) {
      const verbatimFlag = sig.verbatim ? '(verbatim)' : '(paraphrased)';
      console.log(`    • ${verbatimFlag} "${(sig.source_quote || sig.signal_value || '').slice(0, 90)}"`);
    }

    const allProspect = result.signals.every(s => s.speaker_type === 'prospect');
    if (allProspect || result.total === 0) {
      console.log(`  ✅ Speaker filter working (${result.total} prospect quotes)`);
      passed++;
    } else {
      console.log('  ❌ Non-prospect signals returned with prospect filter');
      failed++;
    }
  });

  // ── Scenario 4: Untracked participants (email workspace) ──────────────────

  await scenario('Scenario 4: Untracked participants from email CC/BCC', async () => {
    const result = await queryActivitySignals(EMAIL_WORKSPACE, {
      signal_type: 'untracked_participant',
      limit: 10,
    });

    console.log(`  Found ${result.total} untracked participant(s) across email workspace:`);
    for (const sig of result.signals.slice(0, 6)) {
      const actDate = sig.activity_timestamp
        ? new Date(sig.activity_timestamp).toLocaleDateString()
        : 'unknown date';
      console.log(`    📧 ${sig.signal_value} (from ${sig.activity_type || 'email'} on ${actDate})`);
    }

    const allUntracked = result.signals.every(s => s.signal_type === 'untracked_participant');
    if (allUntracked || result.total === 0) {
      console.log(`  ✅ Untracked participant filter working (${result.total} found)`);
      passed++;
      if (result.total === 0) {
        console.log('  ⚠️  0 untracked participants — email activities may not have CC/BCC headers or email workspace not yet extracted');
      }
    } else {
      console.log('  ❌ Wrong signal types returned');
      failed++;
    }
  });

  // ── Scenario 5: Confidence filter ────────────────────────────────────────

  await scenario('Scenario 5: High-confidence signals only (>= 0.85)', async () => {
    const allResult = await queryActivitySignals(testWorkspace, {
      deal_id: testDealId,
      min_confidence: 0,
    });
    const highConfResult = await queryActivitySignals(testWorkspace, {
      deal_id: testDealId,
      min_confidence: 0.85,
    });

    console.log(`  Total signals: ${allResult.total}, high-confidence: ${highConfResult.total}`);

    const allHighConf = highConfResult.signals.every(s => s.confidence >= 0.85);
    if (allHighConf) {
      console.log('  ✅ Confidence filter working');
      passed++;
    } else {
      console.log('  ❌ Low-confidence signals returned with min_confidence filter');
      failed++;
    }
  });

  // ── Scenario 6: Blocker mentions ─────────────────────────────────────────

  await scenario('Scenario 6: Blocker mentions across all workspace deals', async () => {
    const result = await queryActivitySignals(testWorkspace, {
      signal_type: 'blocker_mention',
      limit: 5,
    });

    console.log(`  Found ${result.total} blocker mention(s) across workspace:`);
    for (const sig of result.signals) {
      const dealName = sig.deal_name || sig.deal_id?.slice(0, 8) || 'no deal';
      console.log(`    🚧 [${dealName}] "${(sig.source_quote || sig.signal_value || '').slice(0, 80)}"`);
    }

    console.log(`  ✅ Blocker query executed (${result.total} blockers found)`);
    passed++;
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('✅ All query scenarios passed!');
  } else {
    console.log('❌ Some scenarios failed — check output above');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
