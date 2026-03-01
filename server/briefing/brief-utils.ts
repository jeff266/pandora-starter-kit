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

export async function getWonLostStages(workspaceId: string): Promise<string[]> {
  const result = await query<{ stage_name: string }>(
    'SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND (is_won = true OR is_lost = true)',
    [workspaceId]
  );
  return result.rows.map(r => r.stage_name);
}

export async function getWonStages(workspaceId: string): Promise<string[]> {
  const result = await query<{ stage_name: string }>(
    'SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_won = true',
    [workspaceId]
  );
  return result.rows.map(r => r.stage_name);
}

export async function getLostStages(workspaceId: string): Promise<string[]> {
  const result = await query<{ stage_name: string }>(
    'SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_lost = true',
    [workspaceId]
  );
  return result.rows.map(r => r.stage_name);
}

export function buildOpenFilter(wonLostStages: string[]): string {
  if (wonLostStages.length === 0) return 'TRUE';
  const escaped = wonLostStages.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
  return `stage NOT IN (${escaped})`;
}

export async function getOpenStageFilter(workspaceId: string): Promise<string> {
  const stages = await getWonLostStages(workspaceId);
  return buildOpenFilter(stages);
}

export async function getCurrentQuota(workspaceId: string): Promise<{ period_start: string, period_end: string, target: number } | null> {
  const now = new Date().toISOString().split('T')[0];
  const result = await query<{ period_start: string, period_end: string, target: string }>(
    `SELECT period_start::text, period_end::text, target::text
     FROM quota_periods
     WHERE workspace_id = $1 AND period_start <= $2 AND period_end >= $2
     LIMIT 1`,
    [workspaceId, now]
  );
  if (result.rows.length === 0) return null;
  return {
    period_start: result.rows[0].period_start,
    period_end: result.rows[0].period_end,
    target: parseFloat(result.rows[0].target)
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
