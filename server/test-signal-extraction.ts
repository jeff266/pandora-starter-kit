/**
 * Test: Activity Signal Extraction
 * Run: npx tsx server/test-signal-extraction.ts
 *
 * Runs DeepSeek extraction on 10 real activities and verifies signal output.
 * Cost estimate: ~10 activities × 400 tokens × $0.14/MTok ≈ $0.0006
 */

import { extractActivitySignals } from './signals/extract-activity-signals.js';
import { query } from './db.js';

const FRONTERA_WORKSPACE = '4160191d-73bc-414b-97dd-5a1853190378';
const EMAIL_WORKSPACE = '31551fe0-b746-4384-aab2-d5cdd70b19ed';

async function main() {
  console.log('Activity Signal Extraction Test');
  console.log('═'.repeat(50));
  console.log('Running DeepSeek extraction on 10 real activities...\n');

  // ── Pre-check: activity body coverage ─────────────────────────────────────

  const coverageResult = await query<{
    workspace_id: string;
    total: string;
    has_body: string;
    eligible: string;
  }>(
    `SELECT workspace_id,
            COUNT(*) as total,
            COUNT(body) as has_body,
            COUNT(CASE WHEN LENGTH(body) > 100 THEN 1 END) as eligible
     FROM activities
     GROUP BY workspace_id`
  );

  console.log('Activity body coverage across workspaces:');
  for (const row of coverageResult.rows) {
    const ws = row.workspace_id.slice(0, 8);
    console.log(`  ${ws}: ${row.total} total, ${row.has_body} with body, ${row.eligible} eligible (>100 chars)`);
  }

  // ── Pre-check: existing signals ───────────────────────────────────────────

  const existingResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM activity_signals`
  );
  const existingRuns = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM activity_signal_runs`
  );
  console.log(`\nExisting signals: ${existingResult.rows[0].count}`);
  console.log(`Existing runs: ${existingRuns.rows[0].count}`);

  // ── Run extraction on Frontera (notes/meetings) ───────────────────────────

  console.log('\n── Frontera workspace (notes/meetings) ──');
  console.log(`Extracting 5 activities from ${FRONTERA_WORKSPACE.slice(0, 8)}...`);

  const fronteraResult = await extractActivitySignals(FRONTERA_WORKSPACE, { limit: 5 });

  console.log(`  Processed:  ${fronteraResult.processed}`);
  console.log(`  Extracted:  ${fronteraResult.extracted} signals`);
  console.log(`  Skipped:    ${fronteraResult.skipped}`);
  console.log(`  Errors:     ${fronteraResult.errors.length}`);
  console.log(`  Duration:   ${fronteraResult.duration_ms}ms`);
  console.log(`  Tokens:     ${fronteraResult.tokens_used} (est. $${(fronteraResult.tokens_used * 0.00000021).toFixed(5)})`);

  if (fronteraResult.errors.length > 0) {
    console.log('  Error details:');
    fronteraResult.errors.forEach(e => console.log(`    - ${e}`));
  }

  // ── Run extraction on email workspace ─────────────────────────────────────

  console.log('\n── Email workspace (emails with headers) ──');
  console.log(`Extracting 5 activities from ${EMAIL_WORKSPACE.slice(0, 8)}...`);

  const emailResult = await extractActivitySignals(EMAIL_WORKSPACE, { limit: 5 });

  console.log(`  Processed:  ${emailResult.processed}`);
  console.log(`  Extracted:  ${emailResult.extracted} signals`);
  console.log(`  Skipped:    ${emailResult.skipped}`);
  console.log(`  Errors:     ${emailResult.errors.length}`);
  console.log(`  Duration:   ${emailResult.duration_ms}ms`);
  console.log(`  Tokens:     ${emailResult.tokens_used} (est. $${(emailResult.tokens_used * 0.00000021).toFixed(5)})`);

  if (emailResult.errors.length > 0) {
    console.log('  Error details:');
    emailResult.errors.forEach(e => console.log(`    - ${e}`));
  }

  // ── Show extracted signals ─────────────────────────────────────────────────

  console.log('\n── Sample extracted signals ──');

  const signalsResult = await query<{
    signal_type: string;
    framework_field: string | null;
    signal_value: string | null;
    source_quote: string | null;
    speaker_type: string;
    verbatim: boolean;
    confidence: number;
    extraction_method: string;
    activity_type: string;
  }>(
    `SELECT asig.signal_type, asig.framework_field, asig.signal_value,
            asig.source_quote, asig.speaker_type, asig.verbatim,
            asig.confidence, asig.extraction_method, a.activity_type
     FROM activity_signals asig
     JOIN activities a ON a.id = asig.activity_id
     ORDER BY asig.created_at DESC
     LIMIT 20`
  );

  if (signalsResult.rows.length === 0) {
    console.log('  ❌ No signals in DB — extraction may have failed');
  } else {
    console.log(`  ${signalsResult.rows.length} signals retrieved:\n`);

    const byType: Record<string, number> = {};
    for (const sig of signalsResult.rows) {
      byType[sig.signal_type] = (byType[sig.signal_type] || 0) + 1;
    }
    console.log('  Signal type distribution:');
    for (const [type, count] of Object.entries(byType)) {
      console.log(`    ${type}: ${count}`);
    }

    console.log('\n  Sample signals:');
    for (const sig of signalsResult.rows.slice(0, 8)) {
      const fw = sig.framework_field ? ` [${sig.framework_field}]` : '';
      const speaker = sig.speaker_type !== 'unknown' ? ` (${sig.speaker_type}${sig.verbatim ? ', verbatim' : ', paraphrased'})` : '';
      const conf = (sig.confidence * 100).toFixed(0);
      console.log(`    • [${sig.signal_type}${fw}] conf:${conf}%${speaker}`);
      if (sig.source_quote) {
        console.log(`      "${sig.source_quote.slice(0, 100)}${sig.source_quote.length > 100 ? '…' : ''}"`);
      }
    }
  }

  // ── Check for untracked participants (email workspace) ────────────────────

  const untrackedResult = await query<{ signal_value: string; source_quote: string }>(
    `SELECT signal_value, source_quote FROM activity_signals
     WHERE signal_type = 'untracked_participant'
     ORDER BY created_at DESC LIMIT 5`
  );

  console.log(`\n── Untracked participants detected: ${untrackedResult.rows.length} ──`);
  for (const row of untrackedResult.rows) {
    console.log(`  📧 ${row.signal_value} (${row.source_quote})`);
  }

  // ── Post-check: signal counts ─────────────────────────────────────────────

  const finalCount = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM activity_signals`
  );
  const finalRuns = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM activity_signal_runs`
  );

  console.log('\n── Final state ──');
  console.log(`  activity_signals rows:     ${finalCount.rows[0].count}`);
  console.log(`  activity_signal_runs rows: ${finalRuns.rows[0].count}`);

  const totalExtracted = fronteraResult.extracted + emailResult.extracted;
  const totalTokens = fronteraResult.tokens_used + emailResult.tokens_used;
  const totalCost = totalTokens * 0.00000021;

  console.log('\n── Summary ──');
  console.log(`  Total signals extracted: ${totalExtracted}`);
  console.log(`  Total tokens used:       ${totalTokens}`);
  console.log(`  Estimated cost:          $${totalCost.toFixed(5)}`);

  const ok = parseInt(finalCount.rows[0].count) > 0;
  if (ok) {
    console.log('\n✅ Extraction test passed — signals in database');
  } else {
    console.log('\n❌ Extraction test failed — no signals in database');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
