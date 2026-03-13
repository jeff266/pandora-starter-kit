/**
 * Query Scope
 *
 * Resolves all per-request context dimensions — fiscal quarter bounds, user
 * role, ownership filter, pipeline scope — in a single parallel call at the
 * start of every skill/agent run.  Every tool receives this via
 * `context.queryScope` and reads from it instead of independently calling
 * getPandoraRole, computing quarter math, or guessing pipeline names.
 *
 * Rule: resolve once at the boundary, consume everywhere.
 */

import { configLoader } from '../config/workspace-config-loader.js';
import { getPandoraRole, type PandolaRole } from './pandora-role.js';
import { query } from '../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CalendarEventSummary {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  attendee_names: string[];
  attendee_emails: string[];
  meet_link: string | null;
  resolved_deal_ids: string[];
  deal_names?: string[];  // populated if resolved_deal_ids is non-empty
}

export interface QueryScope {
  fiscalYearStartMonth: number;
  currentFiscalQuarter: number;
  currentFiscalYear: number;

  quarterStart: Date;
  quarterEnd: Date;
  previousQuarterStart: Date;
  previousQuarterEnd: Date;

  userRole: PandolaRole;
  workspaceRole: string;
  userEmail: string | null;

  ownerLiteral: string;

  forecastedPipelines: string[];

  // Calendar context (optional - only populated if calendar is connected)
  todaysMeetings?: CalendarEventSummary[];
  thisWeekMeetings?: CalendarEventSummary[];
  upcomingMeetingsByDeal?: Record<string, CalendarEventSummary[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fiscal quarter math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the start and end of the fiscal quarter that contains `date`.
 *
 * fiscalStartMonth is 1-based (1 = January, 4 = April, 7 = July, etc.).
 * When fiscalStartMonth = 1 the result is identical to calendar quarters.
 */
export function getFiscalQuarterBounds(
  date: Date,
  fiscalStartMonth: number = 1,
): { start: Date; end: Date } {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  const fiscalOffset = ((month - fiscalStartMonth + 12) % 12);
  const quarterStartFiscalOffset = Math.floor(fiscalOffset / 3) * 3;
  const quarterStartCalMonth = ((quarterStartFiscalOffset + fiscalStartMonth - 1) % 12) + 1;

  const startYear = quarterStartCalMonth > month ? year - 1 : year;
  const start = new Date(startYear, quarterStartCalMonth - 1, 1);
  const end = new Date(startYear, quarterStartCalMonth - 1 + 3, 0, 23, 59, 59);
  return { start, end };
}

/**
 * Return the 1-based fiscal quarter number (1–4) for a given date.
 */
export function getFiscalQuarterNumber(date: Date, fiscalStartMonth: number = 1): number {
  const month = date.getMonth() + 1;
  const fiscalOffset = ((month - fiscalStartMonth + 12) % 12);
  return Math.floor(fiscalOffset / 3) + 1;
}

/**
 * Return the fiscal year number for a given date.
 * Fiscal year is named after the calendar year in which it ENDS.
 * e.g. with February start: March 2026 → FY2027 (ends Jan 2027).
 * With January start fiscal year = calendar year.
 */
export function getFiscalYear(date: Date, fiscalStartMonth: number = 1): number {
  if (fiscalStartMonth === 1) return date.getFullYear();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return month >= fiscalStartMonth ? year + 1 : year;
}

/**
 * Return the bounds of the fiscal quarter immediately preceding the given
 * quarter bounds.
 */
function previousQuarterBounds(
  current: { start: Date; end: Date },
  fiscalStartMonth: number,
): { start: Date; end: Date } {
  const prevDate = new Date(current.start.getTime() - 24 * 60 * 60 * 1000);
  return getFiscalQuarterBounds(prevDate, fiscalStartMonth);
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a QueryScope for a workspace/user pair.
 *
 * Resolves workspace config (fiscal year, pipelines) and user role in
 * parallel, then derives all SQL fragments.  Never throws — falls back to
 * safe defaults so tools always have a valid scope.
 */
export async function buildQueryScope(
  workspaceId: string,
  userId?: string,
): Promise<QueryScope> {
  const now = new Date();

  const [config, roleInfo] = await Promise.all([
    configLoader.getConfig(workspaceId).catch(() => null),
    userId ? getPandoraRole(workspaceId, userId).catch(() => null) : Promise.resolve(null),
  ]);

  const fiscalYearStartMonth: number =
    config?.cadence?.fiscal_year_start_month ?? 1;

  const forecastedPipelines: string[] =
    (config as any)?.forecasted_pipelines ?? [];

  const current = getFiscalQuarterBounds(now, fiscalYearStartMonth);
  const previous = previousQuarterBounds(current, fiscalYearStartMonth);

  const currentFiscalQuarter = getFiscalQuarterNumber(now, fiscalYearStartMonth);
  const currentFiscalYear = getFiscalYear(now, fiscalYearStartMonth);

  const userRole: PandolaRole = roleInfo?.pandoraRole ?? null;
  const workspaceRole: string = roleInfo?.workspaceRole ?? 'member';
  const userEmail: string | null = roleInfo?.userEmail ?? null;

  let ownerLiteral = '';
  if (userRole === 'ae' && userEmail) {
    const escaped = userEmail.replace(/'/g, "''");
    ownerLiteral = ` AND owner_email = '${escaped}'`;
  }

  // Fetch today's meetings (non-blocking - if calendar not connected, skip)
  const calendarResult = await query(
    `SELECT ce.id, ce.title, ce.start_time, ce.end_time,
            ce.attendees, ce.meet_link, ce.resolved_deal_ids,
            array_agg(d.name) FILTER (WHERE d.name IS NOT NULL) as deal_names
     FROM calendar_events ce
     LEFT JOIN deals d ON d.id = ANY(ce.resolved_deal_ids) AND d.workspace_id = ce.workspace_id
     WHERE ce.workspace_id = $1
       AND ce.start_time::date = CURRENT_DATE
       AND ce.status != 'cancelled'
     GROUP BY ce.id, ce.title, ce.start_time, ce.end_time,
              ce.attendees, ce.meet_link, ce.resolved_deal_ids
     ORDER BY ce.start_time ASC`,
    [workspaceId]
  ).catch(() => ({ rows: [] }));

  // Map to CalendarEventSummary[]
  const todaysMeetings: CalendarEventSummary[] = calendarResult.rows.map(row => ({
    id: row.id,
    title: row.title,
    start_time: row.start_time.toISOString(),
    end_time: row.end_time.toISOString(),
    attendee_names: (row.attendees || []).map((a: any) => a.displayName || a.email).filter(Boolean),
    attendee_emails: (row.attendees || []).map((a: any) => a.email).filter(Boolean),
    meet_link: row.meet_link,
    resolved_deal_ids: row.resolved_deal_ids || [],
    deal_names: row.deal_names || [],
  }));

  return {
    fiscalYearStartMonth,
    currentFiscalQuarter,
    currentFiscalYear,
    quarterStart: current.start,
    quarterEnd: current.end,
    previousQuarterStart: previous.start,
    previousQuarterEnd: previous.end,
    userRole,
    workspaceRole,
    userEmail,
    ownerLiteral,
    forecastedPipelines,
    ...(todaysMeetings.length > 0 && { todaysMeetings }),
  };
}
