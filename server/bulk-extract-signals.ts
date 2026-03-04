/**
 * Bulk Activity Signal Extraction
 * Run: npx tsx server/bulk-extract-signals.ts
 *
 * Extracts signals from all active-deal activities that haven't been processed yet.
 * Runs workspace by workspace with progress logging every 100 activities.
 *
 * Estimated scope: ~3,000-4,000 activities across 3 workspaces
 * Estimated cost:  ~$0.80 at 1,200 tokens avg × $0.21/MTok blended DeepSeek rate
 * Estimated time:  15-25 minutes
 */

import { query } from './db.js';
import { extractActivitySignals } from './signals/extract-activity-signals.js';

const BATCH_SIZE = 100; // Activities per extractActivitySignals call
const LOG_INTERVAL = 100;

interface WorkspaceProgress {
  workspaceId: string;
  label: string;
  total: number;
  processed: number;
  extracted: number;
  skipped: number;
  errors: string[];
  tokens: number;
  startedAt: number;
}

async function getActiveWorkspaces(): Promise<Array<{ workspace_id: string; label: string; count: number }>> {
  const result = await query<{ workspace_id: string; count: string }>(
    `SELECT workspace_id, COUNT(*) as count
     FROM activities
     WHERE body IS NOT NULL
       AND LENGTH(body) > 30
       AND id NOT IN (SELECT activity_id FROM activity_signal_runs)
     GROUP BY workspace_id
     ORDER BY count DESC`
  );

  const workspaceNames: Record<string, string> = {
    '4160191d-73bc-414b-97dd-5a1853190378': 'Frontera',
    '31551fe0-b746-4384-aab2-d5cdd70b19ed': 'Email/Imubit',
    '11111111-1111-1111-1111-111111111111': 'Demo',
  };

  return result.rows.map(r => ({
    workspace_id: r.workspace_id,
    label: workspaceNames[r.workspace_id] || r.workspace_id.slice(0, 8),
    count: parseInt(r.count),
  }));
}

async function processWorkspace(
  workspaceId: string,
  label: string,
  totalCount: number,
  allProgress: WorkspaceProgress[]
): Promise<WorkspaceProgress> {
  const progress: WorkspaceProgress = {
    workspaceId,
    label,
    total: totalCount,
    processed: 0,
    extracted: 0,
    skipped: 0,
    errors: [],
    tokens: 0,
    startedAt: Date.now(),
  };
  allProgress.push(progress);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Workspace: ${label} (${workspaceId.slice(0, 8)})`);
  console.log(`Pending: ${totalCount} unprocessed active-deal activities`);
  console.log(`${'─'.repeat(60)}`);

  let remaining = totalCount;
  let batchNum = 0;

  while (remaining > 0) {
    const batchLimit = Math.min(BATCH_SIZE, remaining);
    batchNum++;

    const result = await extractActivitySignals(workspaceId, { limit: batchLimit });

    progress.processed += result.processed;
    progress.extracted += result.extracted;
    progress.skipped += result.skipped;
    progress.tokens += result.tokens_used;
    progress.errors.push(...result.errors);

    remaining = Math.max(0, remaining - result.processed);

    // If extractActivitySignals returned fewer than batchLimit processed,
    // it ran out of unprocessed activities (some may already be done)
    if (result.processed < batchLimit || result.processed === 0) {
      remaining = 0;
    }

    // Progress log every LOG_INTERVAL activities
    if (progress.processed % LOG_INTERVAL < batchLimit || remaining === 0) {
      const elapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(0);
      const cost = (progress.tokens * 0.00000021).toFixed(4);
      const pct = Math.round((progress.processed / totalCount) * 100);
      console.log(
        `  [${pct}%] ${progress.processed}/${totalCount} processed | ` +
        `${progress.extracted} signals | ${progress.skipped} skipped | ` +
        `${progress.tokens.toLocaleString()} tokens ($${cost}) | ${elapsed}s`
      );

      if (progress.errors.length > 0) {
        const newErrors = progress.errors.slice(-3);
        newErrors.forEach(e => console.log(`    ⚠ ${e.slice(0, 100)}`));
      }
    }

    if (remaining <= 0) break;

    // Small pause between big batches to avoid overloading the LLM API
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const totalElapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(1);
  const cost = (progress.tokens * 0.00000021).toFixed(4);

  console.log(`${'─'.repeat(60)}`);
  console.log(`Done: ${progress.extracted} signals from ${progress.processed} activities`);
  console.log(`Cost: $${cost} | Time: ${totalElapsed}s | Errors: ${progress.errors.length}`);

  return progress;
}

async function printFinalSummary(allProgress: WorkspaceProgress[]): Promise<void> {
  const totalSignals = await query<{ count: string }>(`SELECT COUNT(*) as count FROM activity_signals`);
  const totalRuns = await query<{ count: string }>(`SELECT COUNT(*) as count FROM activity_signal_runs`);

  const signalBreakdown = await query<{ signal_type: string; count: string }>(
    `SELECT signal_type, COUNT(*) as count FROM activity_signals GROUP BY signal_type ORDER BY count DESC`
  );

  console.log(`\n${'═'.repeat(60)}`);
  console.log('BULK EXTRACTION COMPLETE');
  console.log(`${'═'.repeat(60)}`);

  let totalExtracted = 0;
  let totalTokens = 0;
  let totalErrors = 0;

  for (const ws of allProgress) {
    const elapsed = ((Date.now() - ws.startedAt) / 1000).toFixed(1);
    const cost = (ws.tokens * 0.00000021).toFixed(4);
    console.log(`\n  ${ws.label}:`);
    console.log(`    Processed: ${ws.processed} | Signals: ${ws.extracted} | Skipped: ${ws.skipped}`);
    console.log(`    Tokens: ${ws.tokens.toLocaleString()} | Cost: $${cost} | Time: ${elapsed}s`);
    if (ws.errors.length > 0) console.log(`    Errors: ${ws.errors.length}`);
    totalExtracted += ws.extracted;
    totalTokens += ws.tokens;
    totalErrors += ws.errors.length;
  }

  const totalCost = (totalTokens * 0.00000021).toFixed(4);
  console.log(`\n  TOTAL:`);
  console.log(`    Signals extracted: ${totalExtracted}`);
  console.log(`    Tokens used:       ${totalTokens.toLocaleString()}`);
  console.log(`    Estimated cost:    $${totalCost}`);
  console.log(`    Errors:            ${totalErrors}`);

  console.log(`\n  Database state:`);
  console.log(`    activity_signals rows:     ${totalSignals.rows[0].count}`);
  console.log(`    activity_signal_runs rows: ${totalRuns.rows[0].count}`);

  if (signalBreakdown.rows.length > 0) {
    console.log(`\n  Signal type breakdown:`);
    for (const row of signalBreakdown.rows) {
      console.log(`    ${row.signal_type}: ${row.count}`);
    }
  }
}

async function main() {
  console.log('Pandora — Bulk Activity Signal Extraction');
  console.log('═'.repeat(60));

  const workspaces = await getActiveWorkspaces();

  if (workspaces.length === 0) {
    console.log('\n✅ Nothing to process — all active-deal activities are already extracted.');
    process.exit(0);
  }

  const totalActivities = workspaces.reduce((sum, w) => sum + w.count, 0);
  const estimatedTokens = totalActivities * 1200;
  const estimatedCost = (estimatedTokens * 0.00000021).toFixed(2);
  const estimatedMinutes = Math.ceil((totalActivities * 3) / 60);

  console.log(`\nScope:`);
  workspaces.forEach(w => console.log(`  ${w.label}: ${w.count} activities`));
  console.log(`  Total: ${totalActivities} activities`);
  console.log(`\nEstimates (rough):`);
  console.log(`  Tokens: ~${estimatedTokens.toLocaleString()}`);
  console.log(`  Cost:   ~$${estimatedCost}`);
  console.log(`  Time:   ~${estimatedMinutes} minutes`);
  console.log(`\nStarting in 3 seconds... (Ctrl+C to cancel)`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  const startTime = Date.now();
  const allProgress: WorkspaceProgress[] = [];

  for (const workspace of workspaces) {
    await processWorkspace(workspace.workspace_id, workspace.label, workspace.count, allProgress);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nTotal wall time: ${totalElapsed} minutes`);

  await printFinalSummary(allProgress);
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Bulk extraction failed:', err);
  process.exit(1);
});
