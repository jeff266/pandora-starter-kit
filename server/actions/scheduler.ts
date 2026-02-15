/**
 * Action Expiry Scheduler
 *
 * Runs every hour to:
 * 1. Mark actions past expires_at as 'expired'
 * 2. Clean up old terminal actions (superseded/dismissed/expired) after 90 days
 */

import type { Pool } from 'pg';

export function startActionExpiryScheduler(db: Pool): void {
  console.log('[Action Scheduler] Starting action expiry scheduler (runs every hour)');

  // Run immediately on startup, then every hour
  runExpiryCheck(db);

  setInterval(async () => {
    await runExpiryCheck(db);
  }, 60 * 60 * 1000); // every hour
}

async function runExpiryCheck(db: Pool): Promise<void> {
  try {
    // Expire old open actions
    const expiredResult = await db.query(`
      UPDATE actions
      SET execution_status = 'expired',
          dismissed_reason = 'expired',
          updated_at = now()
      WHERE execution_status = 'open'
        AND expires_at < now()
      RETURNING id, workspace_id
    `);

    if (expiredResult.rows.length > 0) {
      console.log(`[Action Scheduler] Expired ${expiredResult.rows.length} actions`);

      // Audit log for each
      for (const row of expiredResult.rows) {
        await db.query(`
          INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, from_status, to_status)
          VALUES ($1, $2, 'expired', 'scheduler', 'open', 'expired')
        `, [row.workspace_id, row.id]);
      }
    }

    // Clean up ancient terminal actions (90+ days old)
    const cleanedResult = await db.query(`
      DELETE FROM actions
      WHERE execution_status IN ('expired', 'superseded', 'dismissed')
        AND updated_at < CURRENT_DATE - INTERVAL '90 days'
    `);

    if (cleanedResult.rowCount && cleanedResult.rowCount > 0) {
      console.log(`[Action Scheduler] Cleaned up ${cleanedResult.rowCount} old terminal actions`);
    }

  } catch (err) {
    console.error('[Action Scheduler] Error during expiry check:', err);
  }
}
