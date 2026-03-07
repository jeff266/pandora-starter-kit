import { createHash } from 'node:crypto';
import { query } from '../db.js';
import { writeMemoryFromSkillRun } from '../memory/workspace-memory.js';

interface PersistenceFinding {
  id?: string;
  workspace_id: string;
  skill_id?: string;
  category: string;
  deal_id?: string;
  account_id?: string;
  owner_email?: string;
  metric_value?: number;
}

export function computeFingerprint(finding: PersistenceFinding): string {
  const entity =
    finding.deal_id ||
    finding.account_id ||
    finding.owner_email ||
    'workspace';

  const parts = [finding.workspace_id, finding.category, entity].filter(Boolean);
  return createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
}

export async function processFindingPersistence(
  workspaceId: string,
  skillRunId: string,
  skillId: string,
  insertedFindings: PersistenceFinding[],
): Promise<void> {
  if (!insertedFindings || insertedFindings.length === 0) return;

  const newFingerprints: string[] = [];

  for (const finding of insertedFindings) {
    if (!finding.id) continue;

    const fingerprint = computeFingerprint(finding);
    newFingerprints.push(fingerprint);

    try {
      const prior = await query<{
        id: string;
        times_flagged: number;
        escalation_level: number;
        first_flagged_at: string;
        value_when_first_flagged: any;
        prior_metric_value: number | null;
      }>(
        `SELECT id, times_flagged, escalation_level, first_flagged_at,
                value_when_first_flagged, metric_value as prior_metric_value
         FROM findings
         WHERE workspace_id = $1 AND fingerprint = $2 AND id != $3
         ORDER BY created_at DESC LIMIT 1`,
        [workspaceId, fingerprint, finding.id],
      );

      if (prior.rows.length > 0) {
        const prev = prior.rows[0];
        const timesFlagged = (prev.times_flagged || 1) + 1;

        let trend: 'improving' | 'stable' | 'worsening' = 'stable';
        if (
          finding.metric_value != null &&
          prev.prior_metric_value != null &&
          prev.prior_metric_value !== 0
        ) {
          const pctChange =
            (finding.metric_value - prev.prior_metric_value) / Math.abs(prev.prior_metric_value);
          if (pctChange > 0.05) trend = 'worsening';
          else if (pctChange < -0.1) trend = 'improving';
        }

        let escalationLevel = prev.escalation_level || 0;
        if (timesFlagged >= 4 && escalationLevel < 3) escalationLevel = 3;
        else if (timesFlagged >= 3 && escalationLevel < 2) escalationLevel = 2;
        else if (timesFlagged >= 2 && escalationLevel < 1) escalationLevel = 1;

        if (trend === 'worsening') {
          escalationLevel = Math.min(escalationLevel + 1, 3);
        }

        await query(
          `UPDATE findings SET
             fingerprint = $2,
             first_flagged_at = $3,
             times_flagged = $4,
             escalation_level = $5,
             previous_finding_id = $6,
             value_when_first_flagged = $7,
             value_current = $8,
             trend = $9
           WHERE id = $1`,
          [
            finding.id,
            fingerprint,
            prev.first_flagged_at,
            timesFlagged,
            escalationLevel,
            prev.id,
            prev.value_when_first_flagged ||
              JSON.stringify({ metric_value: prev.prior_metric_value }),
            JSON.stringify({ metric_value: finding.metric_value }),
            trend,
          ],
        );
      } else {
        await query(
          `UPDATE findings SET
             fingerprint = $2,
             first_flagged_at = NOW(),
             times_flagged = 1,
             escalation_level = 0,
             trend = 'new'
           WHERE id = $1`,
          [finding.id, fingerprint],
        );
      }
    } catch (err) {
      console.error(
        `[Persistence] Failed to process finding ${finding.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (newFingerprints.length > 0) {
    try {
      await query(
        `UPDATE findings SET
           resolved_at = NOW(),
           trend = 'improving'
         WHERE workspace_id = $1
           AND skill_id = $2
           AND fingerprint IS NOT NULL
           AND fingerprint NOT IN (SELECT unnest($3::text[]))
           AND resolved_at IS NULL
           AND created_at >= NOW() - INTERVAL '7 days'`,
        [workspaceId, skillId, newFingerprints],
      );
    } catch (err) {
      console.error(
        `[Persistence] Auto-resolve failed for skill ${skillId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Write to workspace memory for recurring patterns
  if (insertedFindings.length > 0) {
    writeMemoryFromSkillRun(workspaceId, skillId, skillRunId, insertedFindings).catch(err => {
      console.error('[Persistence] Failed to write to workspace memory:', err.message);
    });
  }
}
