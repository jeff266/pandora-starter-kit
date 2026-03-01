import { query } from '../db.js';
import { goalService } from './goal-service.js';
import type { GoalTrajectory } from './types.js';

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function classifyTrajectory(
  attainmentPct: number,
  daysElapsed: number,
  daysRemaining: number,
  actualRunRate: number,
  requiredRunRate: number,
): GoalTrajectory {
  if (attainmentPct >= 100) return 'ahead';

  const totalDays = daysElapsed + daysRemaining;
  const expectedPctAtThisPoint = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;

  if (attainmentPct >= expectedPctAtThisPoint * 0.95) return 'on_track';
  if (requiredRunRate > 0 && actualRunRate >= requiredRunRate * 0.7) return 'at_risk';
  if (requiredRunRate > 0 && actualRunRate >= requiredRunRate * 0.4) return 'behind';
  return 'critical';
}

export async function captureGoalSnapshots(workspaceId: string): Promise<number> {
  const goals = await goalService.list(workspaceId, { is_active: true });
  const today = new Date().toISOString().split('T')[0];
  let captured = 0;

  for (const goal of goals) {
    try {
      const existingSnap = await query(
        `SELECT id FROM goal_snapshots WHERE goal_id = $1 AND snapshot_date = $2`,
        [goal.id, today],
      );
      if (existingSnap.rows.length > 0) continue;

      const current = await goalService.computeCurrentValue(workspaceId, goal);
      const currentValue = current.current_value;

      const now = new Date();
      const periodStart = new Date(goal.period_start);
      const periodEnd = new Date(goal.period_end);
      const daysElapsed = Math.max(0, daysBetween(periodStart, now));
      const daysRemaining = Math.max(0, daysBetween(now, periodEnd));

      const gap = goal.target_value - currentValue;
      const attainmentPct =
        goal.target_value > 0 ? (currentValue / goal.target_value) * 100 : 0;

      const fourWeeksAgo = new Date(now);
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const priorSnaps = await query<{ current_value: string; snapshot_date: string }>(
        `SELECT current_value, snapshot_date FROM goal_snapshots
         WHERE goal_id = $1 AND snapshot_date >= $2
         ORDER BY snapshot_date ASC`,
        [goal.id, fourWeeksAgo.toISOString().split('T')[0]],
      );

      let actualRunRate = 0;
      if (priorSnaps.rows.length >= 2) {
        const oldest = priorSnaps.rows[0];
        const oldestVal = parseFloat(oldest.current_value);
        const weeksBetween =
          daysBetween(new Date(oldest.snapshot_date), now) / 7;
        actualRunRate =
          weeksBetween > 0 ? (currentValue - oldestVal) / weeksBetween : 0;
      }

      const weeksRemaining = daysRemaining / 7;
      const requiredRunRate =
        weeksRemaining > 0 ? gap / weeksRemaining : gap;
      const projectedLanding =
        currentValue + actualRunRate * weeksRemaining;

      const trajectory = classifyTrajectory(
        attainmentPct,
        daysElapsed,
        daysRemaining,
        actualRunRate,
        requiredRunRate,
      );

      const recentFindings = await query<{ message: string; severity: string }>(
        `SELECT message, severity FROM findings
         WHERE workspace_id = $1 AND severity IN ('act', 'watch') AND resolved_at IS NULL
         ORDER BY severity ASC, created_at DESC LIMIT 2`,
        [workspaceId],
      );

      const topRisk =
        recentFindings.rows.find((f) => f.severity === 'act')?.message || null;
      const topOpportunity =
        recentFindings.rows.find((f) => f.severity === 'watch')?.message || null;

      await query(
        `INSERT INTO goal_snapshots
           (goal_id, workspace_id, snapshot_date, current_value, attainment_pct, gap,
            required_run_rate, actual_run_rate, trajectory, projected_landing, days_remaining,
            top_risk, top_opportunity, computation_detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (goal_id, snapshot_date) DO NOTHING`,
        [
          goal.id,
          workspaceId,
          today,
          currentValue,
          Math.round(attainmentPct * 100) / 100,
          gap,
          Math.round(requiredRunRate),
          Math.round(actualRunRate),
          trajectory,
          Math.round(projectedLanding),
          daysRemaining,
          topRisk,
          topOpportunity,
          JSON.stringify(current.computation_detail),
        ],
      );

      captured++;
    } catch (err) {
      console.error(
        `[SnapshotEngine] Failed to capture snapshot for goal ${goal.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[SnapshotEngine] Captured ${captured} snapshots for workspace ${workspaceId}`);
  return captured;
}
