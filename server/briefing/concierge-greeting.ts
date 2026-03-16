import { query } from '../db.js';
import type { PandolaRole } from '../context/pandora-role.js';

interface GreetingCtx {
  timeGreeting: string;
  dayContext: 'Monday' | 'Friday' | null;
  quarterLabel: string;
  weekOfQuarter: number;
  totalWeeks: number;
  daysRemaining: number;
  quarterUrgency: 'early' | 'mid' | 'late' | 'closing';
  attainmentPct: number | null;
  closedWonValue: number | null;
  quota: number | null;
  pendingActions: number;
  criticalActions: number;
  alertCount: number;
}

function fmt(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function adminGreeting(ctx: GreetingCtx): string {
  const lines: string[] = [];

  if (ctx.quarterUrgency === 'closing') {
    lines.push(`${ctx.timeGreeting}. ${ctx.quarterLabel} closes in ${ctx.daysRemaining} days.`);
  } else if (ctx.dayContext === 'Monday') {
    lines.push(`${ctx.timeGreeting}. Week ${ctx.weekOfQuarter} of ${ctx.totalWeeks} in ${ctx.quarterLabel}.`);
  } else {
    lines.push(`${ctx.timeGreeting}. ${ctx.quarterLabel}, week ${ctx.weekOfQuarter}.`);
  }

  if (ctx.attainmentPct !== null && ctx.closedWonValue !== null && ctx.quota !== null) {
    if (ctx.attainmentPct >= 100) {
      lines.push(
        `${ctx.quarterLabel} is won at ${Math.round(ctx.attainmentPct)}% — ` +
        `${fmt(ctx.closedWonValue)} closed against target.`
      );
    } else if (ctx.attainmentPct >= 75) {
      const gap = ctx.quota - ctx.closedWonValue;
      lines.push(
        `Attainment is at ${Math.round(ctx.attainmentPct)}%. ${fmt(gap)} remaining to close.`
      );
    } else if (ctx.quarterUrgency === 'closing') {
      const gap = ctx.quota - ctx.closedWonValue;
      lines.push(
        `${fmt(gap)} to close in ${ctx.daysRemaining} days. ` +
        `The sprint has ${ctx.criticalActions} critical ${ctx.criticalActions === 1 ? 'action' : 'actions'}.`
      );
    }
  }

  if (ctx.alertCount > 0 && ctx.quarterUrgency !== 'early') {
    lines.push(
      `${ctx.alertCount} hypothesis ${ctx.alertCount === 1 ? 'threshold has' : 'thresholds have'} tripped this week.`
    );
  } else if (ctx.pendingActions > 0 && ctx.dayContext === 'Monday') {
    lines.push(
      `${ctx.pendingActions} sprint ${ctx.pendingActions === 1 ? 'action' : 'actions'} queued for the week.`
    );
  }

  return lines.join(' ').replace(/ — /g, '. ');
}

function repGreeting(ctx: GreetingCtx): string {
  const lines: string[] = [];

  lines.push(
    ctx.quarterUrgency === 'closing'
      ? `${ctx.timeGreeting}. ${ctx.daysRemaining} days left in ${ctx.quarterLabel}.`
      : `${ctx.timeGreeting}. Week ${ctx.weekOfQuarter} of ${ctx.totalWeeks}.`
  );

  if (ctx.attainmentPct !== null) {
    lines.push(`You are at ${Math.round(ctx.attainmentPct)}% of target.`);
  }

  if (ctx.pendingActions > 0) {
    lines.push(
      `${ctx.pendingActions} ${ctx.pendingActions === 1 ? 'action' : 'actions'} in your sprint this week.`
    );
  }

  return lines.join(' ').replace(/ — /g, '. ');
}

export async function buildConciergeGreeting(
  workspaceId: string,
  pandoraRole: PandolaRole | null,
  briefData: { temporal: Record<string, unknown> | null; targets: Record<string, unknown> | null }
): Promise<string> {
  const now = new Date();
  const hour = now.getUTCHours();
  const utcDay = now.getUTCDay();

  const timeGreeting =
    hour < 12 ? 'Good morning' :
    hour < 17 ? 'Good afternoon' :
    'Good evening';

  const dayContext: 'Monday' | 'Friday' | null =
    utcDay === 1 ? 'Monday' :
    utcDay === 5 ? 'Friday' :
    null;

  const temporal = briefData.temporal ?? {};
  const weekOfQuarter = Number(temporal.weekOfQuarter ?? 1);
  const daysRemaining = Number(temporal.daysRemainingInQuarter ?? 90);
  const fiscalQuarter = String(temporal.fiscalQuarter ?? 'Q1');
  const calendarYear = now.getFullYear();
  const quarterLabel = `${fiscalQuarter} ${calendarYear}`;
  const totalWeeks = 13;

  const quarterUrgency: GreetingCtx['quarterUrgency'] =
    weekOfQuarter <= 3 ? 'early' :
    weekOfQuarter <= 8 ? 'mid' :
    daysRemaining <= 14 ? 'closing' :
    'late';

  const targets = briefData.targets ?? {};
  const attainmentPct = targets.pctAttained != null ? Number(targets.pctAttained) : null;
  const closedWonValue = targets.closedWonValue != null ? Number(targets.closedWonValue) : null;
  const headline = targets.headline as { amount?: number } | null | undefined;
  const quota = headline?.amount != null ? Number(headline.amount) : null;

  const [sprintResult, hypoResult] = await Promise.all([
    query<{ total: string; critical: string }>(
      `SELECT
         COUNT(*)::text as total,
         COUNT(*) FILTER (WHERE severity = 'critical')::text as critical
       FROM actions
       WHERE workspace_id = $1
         AND sprint_week = date_trunc('week', NOW())
         AND state = 'pending'`,
      [workspaceId]
    ).catch(() => null),
    query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM standing_hypotheses
       WHERE workspace_id = $1
         AND status = 'active'
         AND (
           (alert_direction = 'below' AND current_value < alert_threshold)
           OR (alert_direction = 'above' AND current_value > alert_threshold)
         )`,
      [workspaceId]
    ).catch(() => null),
  ]);

  const pendingActions = parseInt(sprintResult?.rows[0]?.total ?? '0', 10);
  const criticalActions = parseInt(sprintResult?.rows[0]?.critical ?? '0', 10);
  const alertCount = parseInt(hypoResult?.rows[0]?.count ?? '0', 10);

  const ctx: GreetingCtx = {
    timeGreeting, dayContext, quarterLabel,
    weekOfQuarter, totalWeeks, daysRemaining, quarterUrgency,
    attainmentPct, closedWonValue, quota,
    pendingActions, criticalActions, alertCount,
  };

  return pandoraRole === 'ae' ? repGreeting(ctx) : adminGreeting(ctx);
}
