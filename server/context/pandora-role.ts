import { query } from '../db.js';

export type PandolaRole = 'cro' | 'manager' | 'ae' | 'revops' | 'admin' | null;

export type TargetType = 'individual' | 'company' | 'team' | 'board';

export interface PandoraVisibility {
  pandoraRole: PandolaRole;
  workspaceRole: string;
  visibleTypes: TargetType[];
  userId: string;
  userEmail: string | null;
}

export interface HeadlineTarget {
  amount: number;
  label: string;
  type: string;
  source: string;
}

/**
 * Look up a user's Pandora role and workspace access role for a given workspace.
 * Returns null pandoraRole if the user has no pandora_role set.
 */
export async function getPandoraRole(
  workspaceId: string,
  userId: string
): Promise<{ pandoraRole: PandolaRole; workspaceRole: string; userEmail: string | null }> {
  const result = await query<{
    pandora_role: string | null;
    role: string;
    email: string | null;
  }>(
    `SELECT wm.pandora_role, wm.role, u.email
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2
     LIMIT 1`,
    [workspaceId, userId]
  ).catch(() => ({ rows: [] as any[] }));

  if (result.rows.length === 0) {
    return { pandoraRole: null, workspaceRole: 'member', userEmail: null };
  }

  return {
    pandoraRole: (result.rows[0].pandora_role ?? null) as PandolaRole,
    workspaceRole: result.rows[0].role ?? 'member',
    userEmail: result.rows[0].email ?? null,
  };
}

/**
 * Determine which target types are visible to a user given their Pandora role
 * and workspace access role.
 *
 * Visibility matrix:
 *   CRO / RevOps / Admin → board, company, team, individual (all)
 *   Manager              → team (assigned to them), individual
 *   AE                   → individual (assigned to them)
 *   null + workspace admin → full visibility (default for unconfigured admins)
 *   null + other role    → company only (safe default)
 */
export function getVisibleTargetTypes(
  pandoraRole: PandolaRole,
  workspaceRole: string
): TargetType[] {
  if (pandoraRole === 'cro' || pandoraRole === 'revops' || pandoraRole === 'admin') {
    return ['board', 'company', 'team', 'individual'];
  }
  if (pandoraRole === 'manager') {
    return ['team', 'individual'];
  }
  if (pandoraRole === 'ae') {
    return ['individual'];
  }
  // No pandora_role set: admin workspace role → full visibility; others → company only
  if (workspaceRole === 'admin') {
    return ['board', 'company', 'team', 'individual'];
  }
  return ['company'];
}

/**
 * Build a SQL WHERE fragment to append to any query against the targets table.
 * Returns { sql, params } — params are the values to bind at position $startIdx onward.
 *
 * Always call this AFTER your existing WHERE conditions, appending with AND.
 */
export function getTargetWhereClause(
  pandoraRole: PandolaRole,
  workspaceRole: string,
  userId: string,
  userEmail: string | null,
  startIdx: number = 2
): { sql: string; params: any[] } {
  const visibleTypes = getVisibleTargetTypes(pandoraRole, workspaceRole);

  // Full visibility — no restriction beyond is_active
  if (visibleTypes.length === 4) {
    return { sql: '', params: [] };
  }

  if (pandoraRole === 'manager') {
    // Managers see: team targets assigned to them + all individual targets
    // Note: manager does NOT see company or board targets
    const params: any[] = [userId];
    let emailClause = 'FALSE';
    if (userEmail) {
      params.push(userEmail);
      emailClause = `assigned_to_email = $${startIdx + 1}`;
    }
    const sql = `AND (
      (target_type = 'team' AND (assigned_to_user_id = $${startIdx} OR ${emailClause}))
      OR target_type = 'individual'
    )`;
    return { sql, params };
  }

  if (pandoraRole === 'ae') {
    // AEs see individual targets assigned to them (by user_id or email).
    // TRANSITIONAL: assigned_to_user_id IS NULL allows AEs to see unassigned individual
    // targets while the admin is still setting up assignments. Once all individual targets
    // have explicit assignees, remove the IS NULL clause so AEs only see their own targets.
    const params: any[] = [userId];
    let emailClause = 'FALSE';
    if (userEmail) {
      params.push(userEmail);
      emailClause = `assigned_to_email = $${startIdx + 1}`;
    }
    const sql = `AND (
      target_type = 'individual'
      AND (assigned_to_user_id = $${startIdx} OR ${emailClause} OR assigned_to_user_id IS NULL)
    )`;
    return { sql, params };
  }

  // Default safe case: company only (null pandoraRole + non-admin workspace role)
  return {
    sql: `AND target_type = 'company'`,
    params: [],
  };
}

/**
 * Return the single canonical quota number for a user in a workspace.
 *
 * This is the one function all quota-reading paths should use instead of
 * reimplementing the filter+sum logic independently.
 *
 * Priority:
 *  1. Active target whose period covers today, filtered by user visibility
 *  2. All active targets regardless of date, filtered by user visibility
 *  3. Returns { amount: 0, ... } if nothing found — never throws
 */
export async function getHeadlineTarget(
  workspaceId: string,
  userId?: string
): Promise<HeadlineTarget> {
  try {
    let pandoraRole: PandolaRole = null;
    let workspaceRole = 'admin';
    let userEmail: string | null = null;

    if (userId) {
      const visibility = await getPandoraRole(workspaceId, userId);
      pandoraRole = visibility.pandoraRole;
      workspaceRole = visibility.workspaceRole;
      userEmail = visibility.userEmail;
    }

    const { sql: whereClause, params: extraParams } = userId
      ? getTargetWhereClause(pandoraRole, workspaceRole, userId, userEmail, 2)
      : { sql: '', params: [] };

    // Current-period targets (period covers today)
    let tResult = await query<{ amount: string; period_label: string; target_type: string }>(
      `SELECT COALESCE(SUM(amount), 0)::numeric as amount,
              STRING_AGG(DISTINCT COALESCE(period_label, ''), ', ') as period_label,
              STRING_AGG(DISTINCT target_type, ', ') as target_type
       FROM targets
       WHERE workspace_id = $1
         AND is_active = true
         AND period_start <= CURRENT_DATE
         AND period_end >= CURRENT_DATE
         ${whereClause}`,
      [workspaceId, ...extraParams]
    );

    let amount = Number(tResult.rows[0]?.amount ?? 0);
    let label = tResult.rows[0]?.period_label ?? '';
    let type = tResult.rows[0]?.target_type ?? 'company';

    if (amount > 0) {
      return { amount, label, type, source: 'targets_table_current_period' };
    }

    // Widen: all active targets (any date)
    tResult = await query<{ amount: string; period_label: string; target_type: string }>(
      `SELECT COALESCE(SUM(amount), 0)::numeric as amount,
              STRING_AGG(DISTINCT COALESCE(period_label, ''), ', ' ORDER BY 1) as period_label,
              STRING_AGG(DISTINCT target_type, ', ') as target_type
       FROM targets
       WHERE workspace_id = $1
         AND is_active = true
         ${whereClause}`,
      [workspaceId, ...extraParams]
    );

    amount = Number(tResult.rows[0]?.amount ?? 0);
    label = tResult.rows[0]?.period_label ?? '';
    type = tResult.rows[0]?.target_type ?? 'company';

    return {
      amount,
      label,
      type,
      source: amount > 0 ? 'targets_table_all_periods' : 'none',
    };
  } catch {
    return { amount: 0, label: '', type: 'company', source: 'error' };
  }
}
