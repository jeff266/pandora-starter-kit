/**
 * JWT Token Management
 *
 * Handles generation, verification, and storage of access tokens, refresh tokens, and invite tokens.
 * - Access tokens: Short-lived (15 min), stored in memory/cookies
 * - Refresh tokens: Long-lived (7 days), stored in database as hashed values
 * - Invite tokens: Short-lived (24 hours), signed JWTs for workspace invitations
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db.js';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || '';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const ACCESS_TOKEN_EXPIRES_IN = parseInt(process.env.ACCESS_TOKEN_EXPIRES_IN || '900', 10); // 15 minutes
const REFRESH_TOKEN_EXPIRES_IN = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || '604800', 10); // 7 days

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  console.error('[auth] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in environment');
}

interface JWTPayload {
  sub: string; // userId
  email: string;
  account_type: string;
  type: 'access' | 'invite';
  workspaceId?: string; // For invite tokens
  memberId?: string; // For invite tokens
}

interface UserData {
  id: string;
  email: string;
  account_type: string;
}

/**
 * Generate a short-lived access token (15 minutes)
 */
export function generateAccessToken(user: UserData): string {
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    account_type: user.account_type,
    type: 'access',
  };

  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

/**
 * Generate a cryptographically secure refresh token
 * Returns both the raw token (to send to client) and hash (to store in DB)
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(64).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * Verify and decode an access token
 * Returns payload or null (never throws)
 */
export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET) as JWTPayload;
    if (payload.type !== 'access') {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Store a refresh token in the database
 * - Expires in 7 days
 * - Rotates old tokens: delete expired tokens for this user
 * - Keeps max 5 tokens per user (delete oldest if exceeded)
 */
export async function storeRefreshToken(userId: string, hash: string): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN * 1000);

  // Clean up expired tokens for this user
  await query<Record<string, never>>(`
    DELETE FROM refresh_tokens
    WHERE user_id = $1 AND expires_at < NOW()
  `, [userId]);

  // Insert new token
  await query<Record<string, never>>(`
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
  `, [userId, hash, expiresAt]);

  // Keep max 5 refresh tokens per user (delete oldest)
  await query<Record<string, never>>(`
    DELETE FROM refresh_tokens
    WHERE user_id = $1
      AND id NOT IN (
        SELECT id FROM refresh_tokens
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5
      )
  `, [userId]);
}

/**
 * Validate a refresh token
 * - Hashes the raw token and looks up in database
 * - Returns userId if valid and not expired
 * - Updates last_used_at timestamp
 */
export async function validateRefreshToken(raw: string): Promise<{ userId: string } | null> {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  const result = await query<{ user_id: string; expires_at: string }>(`
    SELECT user_id, expires_at
    FROM refresh_tokens
    WHERE token_hash = $1
  `, [hash]);

  if (result.rows.length === 0) {
    return null;
  }

  const token = result.rows[0];

  // Check expiry
  if (new Date(token.expires_at) < new Date()) {
    // Delete expired token
    await query<Record<string, never>>(`
      DELETE FROM refresh_tokens WHERE token_hash = $1
    `, [hash]);
    return null;
  }

  // Update last_used_at
  await query<Record<string, never>>(`
    UPDATE refresh_tokens
    SET last_used_at = NOW()
    WHERE token_hash = $1
  `, [hash]);

  return { userId: token.user_id };
}

/**
 * Revoke a specific refresh token
 */
export async function revokeRefreshToken(raw: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  await query<Record<string, never>>(`
    DELETE FROM refresh_tokens
    WHERE token_hash = $1
  `, [hash]);
}

/**
 * Revoke all refresh tokens for a user
 * Used on password change, account suspension, or logout-all
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await query<Record<string, never>>(`
    DELETE FROM refresh_tokens
    WHERE user_id = $1
  `, [userId]);
}

/**
 * Generate a workspace invite token (24 hour expiry)
 * Used for email invite acceptance flow
 */
export function generateInviteToken(params: {
  workspaceId: string;
  memberId: string;
  email: string;
}): string {
  const payload: JWTPayload = {
    sub: params.memberId,
    email: params.email,
    account_type: 'standard', // Not used for invite tokens
    type: 'invite',
    workspaceId: params.workspaceId,
    memberId: params.memberId,
  };

  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: '24h',
  });
}

/**
 * Verify and decode an invite token
 * Returns payload or null
 */
export function verifyInviteToken(token: string): JWTPayload | null {
  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET) as JWTPayload;
    if (payload.type !== 'invite') {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}
