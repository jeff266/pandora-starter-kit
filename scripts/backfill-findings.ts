import { query } from '../server/db.js';
import pool from '../server/db.js';
import { extractFindings } from '../server/findings/extractor.js';

async function backfillFindings() {
  console.log('[Backfill] Starting findings backfill...');

  const { rows: runs } = await query(
    `SELECT id, run_id, workspace_id, skill_id, result, created_at
     FROM skill_runs
     WHERE status = 'completed'
       AND result IS NOT NULL
       AND jsonb_typeof(result) = 'object'
     ORDER BY created_at ASC`
  );

  console.log(`[Backfill] Found ${runs.length} completed skill runs to process`);

  let totalFindings = 0;
  let processedRuns = 0;
  let skippedRuns = 0;

  const skillCounts: Record<string, number> = {};

  for (const run of runs) {
    const skillRunId = run.run_id;
    const resultData = typeof run.result === 'string' ? JSON.parse(run.result) : run.result;

    try {
      const findings = extractFindings(run.skill_id, skillRunId, run.workspace_id, resultData);

      if (findings.length === 0) {
        skippedRuns++;
        continue;
      }

      await query(
        `UPDATE findings SET resolved_at = $3
         WHERE workspace_id = $1 AND skill_id = $2 AND resolved_at IS NULL`,
        [run.workspace_id, run.skill_id, run.created_at]
      );

      const values: any[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const f of findings) {
        placeholders.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );
        values.push(
          f.workspace_id, f.skill_run_id, f.skill_id, f.severity,
          f.category || null, f.message,
          f.deal_id || null, f.account_id || null, f.owner_email || null,
          JSON.stringify(f.metadata || {}),
          run.created_at,
          run.created_at
        );
      }

      if (placeholders.length > 0) {
        await query(
          `INSERT INTO findings (workspace_id, skill_run_id, skill_id, severity, category, message, deal_id, account_id, owner_email, metadata, found_at, created_at)
           VALUES ${placeholders.join(', ')}`,
          values
        );
      }

      totalFindings += findings.length;
      processedRuns++;
      skillCounts[run.skill_id] = (skillCounts[run.skill_id] || 0) + findings.length;

      if (processedRuns % 20 === 0) {
        console.log(`[Backfill] Processed ${processedRuns} runs, ${totalFindings} findings so far...`);
      }
    } catch (err) {
      console.error(`[Backfill] Error processing run ${skillRunId} (${run.skill_id}):`, err instanceof Error ? err.message : err);
    }
  }

  await query(
    `UPDATE findings SET resolved_at = NULL
     WHERE id IN (
       SELECT DISTINCT ON (workspace_id, skill_id) id
       FROM (
         SELECT f.id, f.workspace_id, f.skill_id, f.skill_run_id,
           sr.created_at as run_created_at
         FROM findings f
         JOIN skill_runs sr ON sr.run_id = f.skill_run_id OR sr.id = f.skill_run_id
         ORDER BY sr.created_at DESC
       ) sub
     )`
  );

  const { rows: latestRuns } = await query(
    `SELECT DISTINCT ON (workspace_id, skill_id) workspace_id, skill_id, run_id
     FROM skill_runs
     WHERE status = 'completed' AND result IS NOT NULL
     ORDER BY workspace_id, skill_id, created_at DESC`
  );

  for (const lr of latestRuns) {
    await query(
      `UPDATE findings SET resolved_at = NULL
       WHERE skill_run_id = $1 AND resolved_at IS NOT NULL`,
      [lr.run_id]
    );
  }

  console.log('\n[Backfill] Complete!');
  console.log(`  Runs processed: ${processedRuns}`);
  console.log(`  Runs skipped (no findings): ${skippedRuns}`);
  console.log(`  Total findings created: ${totalFindings}`);
  console.log('  By skill:');
  for (const [skill, count] of Object.entries(skillCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${skill}: ${count}`);
  }

  await pool.end();
}

backfillFindings().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
