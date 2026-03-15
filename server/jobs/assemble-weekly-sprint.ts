/**
 * Weekly Sprint Assembly
 * Runs Monday at 8:30 AM UTC, after all Monday skills complete.
 * Loads the monte-carlo action menu, matches items to standing hypotheses,
 * and upserts up to 7 sprint actions for the current week.
 */

import { query } from '../db.js';

function startOfWeekMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getUTCDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

// Map monte-carlo action types to hypothesis metric slugs
const ACTION_HYPOTHESIS_MAP: Record<string, string[]> = {
  're_engage_deal':    ['large_deal_win_rate', 'large_deal_cohort', 'conversion_rate'],
  'close_deal':        ['large_deal_win_rate', 'conversion_rate'],
  'generate_pipeline': ['pipeline_coverage_ratio', 'pipeline_coverage'],
  'improve_lever':     ['conversion_rate', 'smb_sales_cycle_days', 'cycle_length'],
};

function findParentHypothesis(actionType: string, hypotheses: any[]): any | null {
  const metrics = ACTION_HYPOTHESIS_MAP[actionType] ?? [];
  if (metrics.length === 0) return null;
  return hypotheses.find(h => metrics.includes(h.metric)) ?? null;
}

function isThresholdBreached(hyp: any): boolean {
  if (hyp.current_value == null || hyp.alert_threshold == null) return false;
  const cur = parseFloat(hyp.current_value);
  const threshold = parseFloat(hyp.alert_threshold);
  if (hyp.alert_direction === 'below') return cur < threshold;
  if (hyp.alert_direction === 'above') return cur > threshold;
  return false;
}

export async function assembleWeeklySprint(workspaceId: string): Promise<{ inserted: number; updated: number }> {
  const thisWeek = startOfWeekMonday(new Date());
  const weekStr = thisWeek.toISOString().split('T')[0];

  console.log(`[SprintAssembly] Assembling sprint for workspace=${workspaceId} week=${weekStr}`);

  // 1. Load active standing hypotheses
  const hypothesesResult = await query(
    `SELECT * FROM standing_hypotheses
     WHERE workspace_id = $1 AND status = 'active'
     ORDER BY
       CASE WHEN current_value IS NOT NULL AND alert_threshold IS NOT NULL
            AND ((alert_direction = 'below' AND current_value::numeric < alert_threshold::numeric)
              OR (alert_direction = 'above' AND current_value::numeric > alert_threshold::numeric))
            THEN 0 ELSE 1 END,
       created_at ASC`,
    [workspaceId]
  );
  const hypotheses = hypothesesResult.rows;

  // 2. Load latest monte-carlo skill run result
  const mcResult = await query(
    `SELECT result_data FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = 'monte-carlo-forecast'
       AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 1`,
    [workspaceId]
  );

  let inserted = 0;
  let updated = 0;

  if (mcResult.rows[0]?.result_data) {
    const resultData = mcResult.rows[0].result_data;
    const actionMenu: any[] = resultData?.allElseEqual?.actionMenu ?? resultData?.actionMenu ?? [];

    // 3. Upsert top-7 monte-carlo actions with sprint week + hypothesis link
    for (const action of actionMenu.slice(0, 7)) {
      const parentHypothesis = findParentHypothesis(action.actionType, hypotheses);
      const severity = action.rank <= 2 ? 'critical' : action.rank <= 5 ? 'warning' : 'notable';

      const upsert = await query(
        `INSERT INTO actions (
           workspace_id, title, action_type, severity,
           expected_value_delta, effort, sprint_week,
           hypothesis_id, state, source_skill, execution_status,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, 'pending', 'monte-carlo-forecast', 'open', now(), now())
         ON CONFLICT (workspace_id, title, sprint_week)
         DO UPDATE SET
           expected_value_delta = EXCLUDED.expected_value_delta,
           hypothesis_id = EXCLUDED.hypothesis_id,
           severity = EXCLUDED.severity,
           updated_at = now()
         RETURNING (xmax = 0) as was_inserted`,
        [
          workspaceId,
          action.label,
          action.actionType,
          severity,
          action.expectedValueIfDone ?? null,
          action.effort ?? 'this_week',
          weekStr,
          parentHypothesis?.id ?? null,
        ]
      );
      if (upsert.rows[0]?.was_inserted) inserted++;
      else updated++;
    }
  }

  // 4. Promote threshold-breached hypotheses as sprint alerts if not already present
  for (const hyp of hypotheses) {
    if (!isThresholdBreached(hyp)) continue;

    const title = `Hypothesis alert: ${hyp.metric} ${hyp.alert_direction === 'below' ? 'below' : 'above'} threshold`;
    const existing = await query(
      `SELECT id FROM actions WHERE workspace_id = $1 AND title = $2 AND sprint_week = $3::date LIMIT 1`,
      [workspaceId, title, weekStr]
    );
    if (existing.rows.length > 0) continue;

    await query(
      `INSERT INTO actions (
         workspace_id, title, action_type, severity,
         sprint_week, hypothesis_id, state, source_skill, execution_status,
         created_at, updated_at
       ) VALUES ($1, $2, 'hypothesis_alert', 'warning', $3::date, $4, 'pending', 'standing-hypotheses', 'open', now(), now())`,
      [workspaceId, title, weekStr, hyp.id]
    );
    inserted++;
  }

  console.log(`[SprintAssembly] Done: ${inserted} inserted, ${updated} updated for week=${weekStr}`);
  return { inserted, updated };
}
