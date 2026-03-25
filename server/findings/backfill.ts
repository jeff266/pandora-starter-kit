/**
 * Backfill Findings From Evidence Claims
 *
 * Converts evidence claims stored in skill_runs.output into findings rows
 * for workspaces where skills ran successfully but produced 0 findings
 * (typically because insertFindings was failing due to a missing column).
 *
 * Key difference from insertFindings: this does NOT resolve existing findings
 * before inserting. It is safe to call multiple times — it only processes
 * skill runs that have no findings linked to them.
 *
 * Severity mapping from evidence claim → finding:
 *   critical → act
 *   high     → watch
 *   medium   → notable
 *   low / *  → info
 */

import { query } from '../db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function claimSeverityToFinding(claimSeverity: string): string {
  switch ((claimSeverity || '').toLowerCase()) {
    case 'critical': return 'act';
    case 'high':     return 'watch';
    case 'medium':   return 'notable';
    default:         return 'info';
  }
}

interface EvidenceClaim {
  claim_id: string;
  claim_text: string;
  severity: string;
  entity_ids?: string[];
  entity_type?: string;
  metric_name?: string;
  metric_values?: number[];
  threshold_applied?: string;
}

interface BackfillFinding {
  workspace_id: string;
  skill_run_id: string;
  skill_id: string;
  severity: string;
  category: string;
  message: string;
  deal_id: string | null;
  metadata: Record<string, unknown>;
}

async function insertBackfillFindings(findings: BackfillFinding[]): Promise<number> {
  if (findings.length === 0) return 0;

  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < findings.length; i += BATCH_SIZE) {
    const batch = findings.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const f = batch[j];
      const base = j * 9;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb, NOW())`
      );
      values.push(
        f.workspace_id,
        f.skill_run_id,
        f.skill_id,
        f.severity,
        f.category,
        f.message,
        f.deal_id,
        null,
        JSON.stringify(f.metadata),
      );
    }

    const result = await query<{ id: string }>(
      `INSERT INTO findings
         (workspace_id, skill_run_id, skill_id, severity, category, message, deal_id, owner_email, metadata, found_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT DO NOTHING
       RETURNING id`,
      values,
    );
    inserted += result.rows.length;
  }

  return inserted;
}

/**
 * Backfill findings for a single workspace using evidence claims from skill_runs
 * where no findings currently exist for those skill_run_ids.
 */
export async function backfillFindingsFromEvidence(workspaceId: string): Promise<number> {
  const runsResult = await query<{
    run_id: string;
    skill_id: string;
    claims: EvidenceClaim[];
  }>(
    `SELECT sr.run_id, sr.skill_id,
            (sr.output->'evidence'->'claims') as claims
     FROM skill_runs sr
     WHERE sr.workspace_id = $1
       AND sr.status = 'completed'
       AND sr.output->'evidence'->'claims' IS NOT NULL
       AND jsonb_array_length(sr.output->'evidence'->'claims') > 0
       AND NOT EXISTS (
         SELECT 1 FROM findings f
         WHERE f.workspace_id = $1 AND f.skill_run_id = sr.run_id
       )
     ORDER BY sr.started_at ASC`,
    [workspaceId]
  );

  if (runsResult.rows.length === 0) return 0;

  let totalInserted = 0;

  for (const run of runsResult.rows) {
    const claims: EvidenceClaim[] = Array.isArray(run.claims) ? run.claims : [];
    const findings: BackfillFinding[] = [];

    for (const claim of claims) {
      if (!claim || !claim.claim_id) continue;

      const severity = claimSeverityToFinding(claim.severity);
      const entityIds = Array.isArray(claim.entity_ids) ? claim.entity_ids.filter(isUUID) : [];
      const metricValues = Array.isArray(claim.metric_values) ? claim.metric_values : [];
      const metricName = claim.metric_name || 'count';
      const threshold = claim.threshold_applied || '';

      if (entityIds.length > 0) {
        for (let i = 0; i < Math.min(entityIds.length, 50); i++) {
          const entityId = entityIds[i];
          const metricValue = metricValues[i] ?? null;
          const metricStr = metricValue != null ? ` (${metricName}: ${metricValue})` : '';

          findings.push({
            workspace_id: workspaceId,
            skill_run_id: run.run_id,
            skill_id: run.skill_id,
            severity,
            category: claim.claim_id,
            message: `${claim.claim_text}${metricStr}`.slice(0, 500),
            deal_id: (claim.entity_type === 'deal' || !claim.entity_type) ? entityId : null,
            metadata: {
              claim_id: claim.claim_id,
              threshold,
              metric_name: metricName,
              metric_value: metricValue,
              backfilled: true,
            },
          });
        }
      } else {
        findings.push({
          workspace_id: workspaceId,
          skill_run_id: run.run_id,
          skill_id: run.skill_id,
          severity,
          category: claim.claim_id,
          message: claim.claim_text.slice(0, 500),
          deal_id: null,
          metadata: {
            claim_id: claim.claim_id,
            threshold,
            backfilled: true,
          },
        });
      }
    }

    if (findings.length > 0) {
      try {
        const insertedCount = await insertBackfillFindings(findings);
        totalInserted += insertedCount;
        console.log(`[FindingsBackfill] Inserted ${insertedCount} findings from ${run.skill_id} run ${run.run_id.slice(0, 8)} for workspace ${workspaceId}`);
      } catch (err) {
        console.error(`[FindingsBackfill] Failed for run ${run.run_id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return totalInserted;
}

/**
 * Run backfill for all workspaces that have skill runs with evidence claims
 * but no corresponding findings (per-run gap detection — not just workspace-level
 * zero total). Called once at server startup.
 */
export async function runStartupFindingsBackfill(): Promise<void> {
  try {
    // Find distinct workspaces that have at least one skill run with claims
    // but no findings linked to that run (per-run gap, not workspace zero check)
    const result = await query<{ workspace_id: string; gap_run_count: string }>(
      `SELECT sr.workspace_id, COUNT(DISTINCT sr.run_id)::text as gap_run_count
       FROM skill_runs sr
       WHERE sr.status = 'completed'
         AND sr.output->'evidence'->'claims' IS NOT NULL
         AND jsonb_array_length(sr.output->'evidence'->'claims') > 0
         AND NOT EXISTS (
           SELECT 1 FROM findings f
           WHERE f.workspace_id = sr.workspace_id AND f.skill_run_id = sr.run_id
         )
       GROUP BY sr.workspace_id`
    );

    if (result.rows.length === 0) {
      console.log('[FindingsBackfill] No skill runs have findings gaps');
      return;
    }

    console.log(`[FindingsBackfill] Found ${result.rows.length} workspace(s) with per-run findings gaps — backfilling...`);

    for (const row of result.rows) {
      const inserted = await backfillFindingsFromEvidence(row.workspace_id);
      console.log(`[FindingsBackfill] Workspace ${row.workspace_id}: inserted ${inserted} findings from ${row.gap_run_count} gap run(s)`);
    }
  } catch (err) {
    console.error('[FindingsBackfill] Startup backfill failed:', err instanceof Error ? err.message : err);
  }
}
