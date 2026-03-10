/**
 * Apply Data Visibility Scope to SQL Queries
 *
 * Reads dataScope from req (attached by workspace-context middleware)
 * and returns SQL filter fragments to enforce role-based access control.
 *
 * Usage:
 *   const scope = buildDealScopeFilter(req);
 *   const sql = `SELECT * FROM deals WHERE workspace_id = $1 ${scope.sql}`;
 *   const params = [workspaceId, ...scope.params];
 */

import { Request } from 'express';
import { normalizeEmail } from '../utils/email-normalization.js';

export interface ScopeFilter {
  /** SQL fragment to append to WHERE clause (e.g., "AND owner_email = $2") */
  sql: string;
  /** Parameter values to pass to query (in order) */
  params: any[];
}

/**
 * Build SQL filter for deals based on user's data visibility scope.
 *
 * Returns:
 * - dealsFilter: 'all' → no filter (admin sees everything)
 * - dealsFilter: 'own' → filter by owner_email = user.email
 * - dealsFilter: 'team' → filter by team members (future: when manager hierarchy exists)
 *
 * @param req - Express request with dataScope and user attached
 * @param paramOffset - Starting parameter index (e.g., if workspace_id is $1, pass 1)
 * @returns SQL fragment and params to append to query
 */
export function buildDealScopeFilter(req: Request, paramOffset: number = 1): ScopeFilter {
  const { dataScope, user } = req;

  // No scope attached (shouldn't happen with workspace middleware, but defensive)
  if (!dataScope || !user) {
    return { sql: '', params: [] };
  }

  // Admin: see everything
  if (dataScope.dealsFilter === 'all') {
    return { sql: '', params: [] };
  }

  // Rep/Viewer: see only own deals
  if (dataScope.dealsFilter === 'own') {
    const userEmail = normalizeEmail(user.email);
    if (!userEmail) {
      // User has no email? Fail closed - show nothing
      return { sql: 'AND 1=0', params: [] };
    }

    return {
      sql: `AND owner_email = $${paramOffset + 1}`,
      params: [userEmail],
    };
  }

  // Team filter not yet implemented
  // When manager hierarchy exists, query team members from sales_roster
  // and build: AND owner_email IN (...team_member_emails)
  if (dataScope.dealsFilter === 'team') {
    console.warn('[apply-data-scope] Team filter not yet implemented, falling back to no filter');
    return { sql: '', params: [] };
  }

  throw new Error(`Unknown dealsFilter: ${dataScope.dealsFilter}`);
}

/**
 * Build SQL filter for accounts based on user's data visibility scope.
 * Same logic as deals.
 */
export function buildAccountScopeFilter(req: Request, paramOffset: number = 1): ScopeFilter {
  const { dataScope, user } = req;

  if (!dataScope || !user) {
    return { sql: '', params: [] };
  }

  if (dataScope.dealsFilter === 'all') {
    return { sql: '', params: [] };
  }

  if (dataScope.dealsFilter === 'own') {
    const userEmail = normalizeEmail(user.email);
    if (!userEmail) {
      return { sql: 'AND 1=0', params: [] };
    }

    return {
      sql: `AND owner_email = $${paramOffset + 1}`,
      params: [userEmail],
    };
  }

  if (dataScope.dealsFilter === 'team') {
    console.warn('[apply-data-scope] Team filter not yet implemented, falling back to no filter');
    return { sql: '', params: [] };
  }

  throw new Error(`Unknown dealsFilter for accounts: ${dataScope.dealsFilter}`);
}

/**
 * Build SQL filter for contacts based on user's data visibility scope.
 *
 * Note: contacts.owner_email may be NULL (not yet populated from sync).
 * For now, we fall back to no filtering for contacts until the column is populated.
 */
export function buildContactScopeFilter(req: Request, paramOffset: number = 1): ScopeFilter {
  const { dataScope, user } = req;

  if (!dataScope || !user) {
    return { sql: '', params: [] };
  }

  if (dataScope.dealsFilter === 'all') {
    return { sql: '', params: [] };
  }

  if (dataScope.dealsFilter === 'own') {
    const userEmail = normalizeEmail(user.email);
    if (!userEmail) {
      return { sql: 'AND 1=0', params: [] };
    }

    // TODO: contacts.owner_email is currently NULL
    // When populated, uncomment this:
    // return {
    //   sql: `AND owner_email = $${paramOffset + 1}`,
    //   params: [userEmail],
    // };

    // For now: no filter (contacts not yet scoped)
    console.warn('[apply-data-scope] Contact scoping not yet enabled (owner_email NULL)');
    return { sql: '', params: [] };
  }

  if (dataScope.dealsFilter === 'team') {
    return { sql: '', params: [] };
  }

  throw new Error(`Unknown dealsFilter for contacts: ${dataScope.dealsFilter}`);
}

/**
 * Check if user has export permission
 */
export function canUserExport(req: Request): boolean {
  return req.dataScope?.canExport ?? false;
}
