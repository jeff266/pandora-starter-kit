/**
 * Retry Failed Signal Extractions
 * Run: npx tsx server/retry-failed-signals.ts
 *
 * Re-processes activities that failed with "DeepSeek returned invalid JSON"
 * by clearing their failed run records and extracting again with the fixed code.
 *
 * Fixes applied:
 *   - parsed.signals null guard (was: Cannot read properties of undefined 'filter')
 *   - maxTokens bumped from 1200 → 2000 (prevents JSON truncation)
 */

import { query } from './db.js';
import { extractActivitySignals } from './signals/extract-activity-signals.js';

const BATCH_SIZE = 100;
const TARGET_ERROR = 'DeepSeek returned invalid JSON';

async function main() {
  console.log('Pandora — Retry Failed Signal Extractions');
  console.log('═'.repeat(60));

  // Count failures by workspace
  const failures = await query<{ workspace_id: string; count: string }>(
    `SELECT workspace_id, COUNT(*) as count
     FROM activity_signal_runs
     WHERE status = 'failed' AND skip_reason LIKE $1
     GROUP BY workspace_id
     ORDER BY count DESC`,
    [`%${TARGET_ERROR}%`]
  );

  if (failures.rows.length === 0) {
    console.log('\n✅ No failed extractions to retry.');
    process.exit(0);
  }

  const total = failures.rows.reduce((sum, r) => sum + parseInt(r.count), 0);
  const workspaceNames: Record<string, string> = {
    '4160191d-73bc-414b-97dd-5a1853190378': 'Frontera',
    '31551fe0-b746-4384-aab2-d5cdd70b19ed': 'Email/Imubit',
    '11111111-1111-1111-1111-111111111111': 'Demo',
  };

  console.log(`\nFailed activities to retry (JSON errors):`);
  failures.rows.forEach(r => {
    const name = workspaceNames[r.workspace_id] || r.workspace_id.slice(0, 8);
    console.log(`  ${name}: ${r.count}`);
  });
  console.log(`  Total: ${total}`);
  console.log(`\nStarting retry in 2 seconds...`);
  await new Promise(resolve => setTimeout(resolve, 2000));

  let totalExtracted = 0;
  let totalTokens = 0;
  let totalErrors = 0;

  for (const row of failures.rows) {
    const workspaceId = row.workspace_id;
    const name = workspaceNames[workspaceId] || workspaceId.slice(0, 8);
    const count = parseInt(row.count);

    console.log(`\n── ${name} (${count} failed activities) ──`);

    // Clear failed runs so extractActivitySignals will pick them up again
    const cleared = await query(
      `DELETE FROM activity_signal_runs
       WHERE workspace_id = $1
         AND status = 'failed'
         AND skip_reason LIKE $2`,
      [workspaceId, `%${TARGET_ERROR}%`]
    );
    console.log(`  Cleared ${cleared.rowCount} failed run records`);

    let remaining = count;
    let batchNum = 0;
    const startedAt = Date.now();
    let batchExtracted = 0;
    let batchTokens = 0;
    let batchErrors = 0;

    while (remaining > 0) {
      const batchLimit = Math.min(BATCH_SIZE, remaining);
      batchNum++;

      const result = await extractActivitySignals(workspaceId, { limit: batchLimit });

      batchExtracted += result.extracted;
      batchTokens += result.tokens_used;
      batchErrors += result.errors.length;
      remaining -= result.processed;

      if (result.processed < batchLimit || result.processed === 0) {
        remaining = 0;
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      const cost = (batchTokens * 0.00000021).toFixed(4);
      console.log(`  Batch ${batchNum}: ${result.extracted} signals | ${result.skipped} skipped | ${result.errors.length} errors | ${elapsed}s | $${cost}`);

      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach(e => console.log(`    ⚠ ${e.slice(0, 100)}`));
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const cost = (batchTokens * 0.00000021).toFixed(4);
    console.log(`  Done: ${batchExtracted} signals | $${cost} | ${totalElapsed}s`);

    totalExtracted += batchExtracted;
    totalTokens += batchTokens;
    totalErrors += batchErrors;
  }

  // Final summary
  const finalSigs = await query<{ count: string; workspace_id: string }>(
    `SELECT workspace_id, COUNT(*) as count FROM activity_signals GROUP BY workspace_id ORDER BY count DESC`
  );
  const finalFailed = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM activity_signal_runs WHERE status = 'failed'`
  );

  console.log(`\n${'═'.repeat(60)}`);
  console.log('RETRY COMPLETE');
  console.log(`  Signals extracted: ${totalExtracted}`);
  console.log(`  Tokens used:       ${totalTokens.toLocaleString()}`);
  console.log(`  Est. cost:         $${(totalTokens * 0.00000021).toFixed(4)}`);
  console.log(`  Errors:            ${totalErrors}`);
  console.log(`  Failed remaining:  ${finalFailed.rows[0].count}`);
  console.log(`\nSignals by workspace:`);
  finalSigs.rows.forEach(r => {
    const name = workspaceNames[r.workspace_id] || r.workspace_id.slice(0, 8);
    console.log(`  ${name}: ${r.count}`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Retry failed:', err);
  process.exit(1);
});
