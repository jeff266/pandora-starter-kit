import { query } from '../db.js';

/**
 * Returns the Monday of the given date's week
 */
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns Sunday of that week
 */
export function endOfWeek(monday: Date): Date {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 6);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function subDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function getQuarter(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

export function quarterStart(date: Date): Date {
  const q = getQuarter(date);
  return new Date(Date.UTC(date.getUTCFullYear(), (q - 1) * 3, 1));
}

export function quarterEnd(date: Date): Date {
  const q = getQuarter(date);
  const d = new Date(Date.UTC(date.getUTCFullYear(), q * 3, 0));
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function daysRemainingInQuarter(date: Date): number {
  const end = quarterEnd(date);
  const diff = end.getTime() - date.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export async function getWonLostStages(_workspaceId: string): Promise<string[]> {
  return ['closed_won', 'closed_lost'];
}

export async function getWonStages(_workspaceId: string): Promise<string[]> {
  return ['closed_won'];
}

export async function getLostStages(_workspaceId: string): Promise<string[]> {
  return ['closed_lost'];
}

export function buildOpenFilter(_wonLostStages: string[]): string {
  return `stage_normalized NOT IN ('closed_won', 'closed_lost')`;
}

export async function getOpenStageFilter(_workspaceId: string): Promise<string> {
  return buildOpenFilter([]);
}

export async function getCurrentQuota(workspaceId: string): Promise<{ period_start: string, period_end: string, target: number, pipeline_name?: string } | null> {
  const now = new Date().toISOString().split('T')[0];
  const result = await query<{ period_start: string, period_end: string, amount: string, pipeline_name: string | null }>(
    `SELECT period_start::text, period_end::text, amount::text, pipeline_name
     FROM targets
     WHERE workspace_id = $1 AND period_start <= $2 AND period_end >= $2 AND is_active = true
     ORDER BY period_start DESC LIMIT 1`,
    [workspaceId, now]
  );
  if (result.rows.length === 0) return null;
  return {
    period_start: result.rows[0].period_start,
    period_end: result.rows[0].period_end,
    target: parseFloat(result.rows[0].amount),
    pipeline_name: result.rows[0].pipeline_name || undefined,
  };
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export const formatCurrency = formatCompact;

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
