/**
 * Auth Cleanup Jobs
 *
 * Nightly cleanup of expired refresh tokens
 */

import { query } from '../db.js';

/**
 * Clean up expired refresh tokens
 * Runs nightly at 3:00 AM UTC
 */
export async function cleanupExpiredRefreshTokens(): Promise<void> {
  try {
    const result = await query<{ id: string }>(`
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW()
      RETURNING id
    `);

    const deleted = result.rows.length;

    if (deleted > 0) {
      console.log(`[Auth Cleanup] Deleted ${deleted} expired refresh token(s)`);
    }
  } catch (err) {
    console.error('[Auth Cleanup] Error cleaning up refresh tokens:', err instanceof Error ? err.message : err);
  }
}
