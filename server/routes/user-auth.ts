/**
 * User Authentication API
 *
 * JWT-based authentication with access tokens (15 min) and refresh tokens (7 days).
 * All routes mounted at /api/auth
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from '../auth/tokens.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_COOKIE_NAME = 'pandora_refresh';
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/**
 * Helper to set refresh token cookie
 */
function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

/**
 * Helper to clear refresh token cookie
 */
function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
}

/**
 * POST /register
 * Create a new user account with email and password
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, name, password } = req.body;

    // Validation
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    // Check if email already exists
    const existingUser = await query<{ id: string }>(`
      SELECT id FROM users WHERE email = $1
    `, [normalizedEmail]);

    if (existingUser.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const userResult = await query<{
      id: string;
      email: string;
      name: string;
      account_type: string;
    }>(`
      INSERT INTO users (email, name, password_hash, account_type)
      VALUES ($1, $2, $3, 'standard')
      RETURNING id, email, name, account_type
    `, [normalizedEmail, name.trim(), passwordHash]);

    const user = userResult.rows[0];

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    // Store refresh token
    await storeRefreshToken(user.id, refreshToken.hash);

    // Set refresh token cookie
    setRefreshTokenCookie(res, refreshToken.raw);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        account_type: user.account_type,
      },
      accessToken,
    });
  } catch (err) {
    console.error('[auth] Registration error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

/**
 * POST /login
 * Authenticate user with email and password
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find user
    const userResult = await query<{
      id: string;
      email: string;
      name: string;
      account_type: string;
      password_hash: string;
    }>(`
      SELECT id, email, name, account_type, password_hash
      FROM users
      WHERE email = $1
    `, [normalizedEmail]);

    if (userResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = userResult.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Update last login
    await query<Record<string, never>>(`
      UPDATE users SET last_login_at = NOW() WHERE id = $1
    `, [user.id]);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    // Store refresh token
    await storeRefreshToken(user.id, refreshToken.hash);

    // Store session for workspace middleware compatibility
    await query<Record<string, never>>(`
      INSERT INTO user_sessions (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '24 hours')
      ON CONFLICT (token) DO UPDATE SET expires_at = NOW() + INTERVAL '24 hours'
    `, [user.id, accessToken]);

    // Set refresh token cookie
    setRefreshTokenCookie(res, refreshToken.raw);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        account_type: user.account_type,
      },
      accessToken,
    });
  } catch (err) {
    console.error('[auth] Login error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

/**
 * POST /refresh
 * Exchange refresh token for new access token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    // Read refresh token from cookie
    const refreshTokenRaw = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

    if (!refreshTokenRaw) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Session expired', code: 'NO_REFRESH_TOKEN' });
      return;
    }

    // Validate refresh token
    const tokenData = await validateRefreshToken(refreshTokenRaw);

    if (!tokenData) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Session expired', code: 'INVALID_REFRESH_TOKEN' });
      return;
    }

    // Load user from database
    const userResult = await query<{
      id: string;
      email: string;
      name: string;
      account_type: string;
    }>(`
      SELECT id, email, name, account_type
      FROM users
      WHERE id = $1
    `, [tokenData.userId]);

    if (userResult.rows.length === 0) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    const user = userResult.rows[0];

    // Generate new access token
    const accessToken = generateAccessToken(user);

    // Rotate refresh token (revoke old, generate new)
    await revokeRefreshToken(refreshTokenRaw);
    const newRefreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, newRefreshToken.hash);

    // Store session for workspace middleware compatibility
    await query<Record<string, never>>(`
      INSERT INTO user_sessions (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '24 hours')
      ON CONFLICT (token) DO UPDATE SET expires_at = NOW() + INTERVAL '24 hours'
    `, [user.id, accessToken]);

    // Set new refresh token cookie
    setRefreshTokenCookie(res, newRefreshToken.raw);

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        account_type: user.account_type,
      },
    });
  } catch (err) {
    console.error('[auth] Refresh error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

/**
 * POST /logout
 * Revoke current refresh token and clear cookie
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const refreshTokenRaw = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

    if (refreshTokenRaw) {
      await revokeRefreshToken(refreshTokenRaw);
    }

    clearRefreshTokenCookie(res);

    res.json({ success: true });
  } catch (err) {
    console.error('[auth] Logout error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * POST /logout-all
 * Revoke all refresh tokens for current user
 * Requires authentication
 */
router.post('/logout-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    await revokeAllUserTokens(userId);

    clearRefreshTokenCookie(res);

    res.json({ success: true });
  } catch (err) {
    console.error('[auth] Logout-all error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * POST /change-password
 * Change user's password
 * Requires authentication, revokes all tokens on success
 */
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || typeof currentPassword !== 'string') {
      res.status(400).json({ error: 'Current password is required' });
      return;
    }

    if (!newPassword || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'New password is required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    if (newPassword === currentPassword) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    // Load user
    const userResult = await query<{ id: string; password_hash: string }>(`
      SELECT id, password_hash FROM users WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Update password
    await query<Record<string, never>>(`
      UPDATE users
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
    `, [newPasswordHash, userId]);

    // Revoke all refresh tokens (forces re-login on all devices)
    await revokeAllUserTokens(userId);

    // Clear refresh token cookie
    clearRefreshTokenCookie(res);

    res.json({
      success: true,
      message: 'Password updated. Please sign in again.',
    });
  } catch (err) {
    console.error('[auth] Change password error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * PATCH /profile
 * Update user profile (name, avatar_url, anonymize_mode)
 * Requires authentication
 */
router.patch('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { name, avatar_url, anonymize_mode } = req.body;

    // Validation - at least one field required
    if (name === undefined && avatar_url === undefined && anonymize_mode === undefined) {
      res.status(400).json({ error: 'At least one field (name, avatar_url, or anonymize_mode) is required' });
      return;
    }

    // Validate name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Name must be a non-empty string' });
        return;
      }
      if (name.length > 100) {
        res.status(400).json({ error: 'Name must be 100 characters or less' });
        return;
      }
    }

    // Validate avatar_url if provided
    if (avatar_url !== undefined && avatar_url !== null) {
      if (typeof avatar_url !== 'string') {
        res.status(400).json({ error: 'Avatar URL must be a string' });
        return;
      }
      // Basic URL validation
      try {
        new URL(avatar_url);
      } catch {
        res.status(400).json({ error: 'Avatar URL must be a valid URL' });
        return;
      }
    }

    // Build update query for only provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }

    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(avatar_url);
    }

    if (anonymize_mode !== undefined) {
      if (typeof anonymize_mode !== 'boolean') {
        res.status(400).json({ error: 'anonymize_mode must be a boolean' });
        return;
      }
      updates.push(`anonymize_mode = $${paramIndex++}`);
      values.push(anonymize_mode);
    }

    updates.push('updated_at = NOW()');
    values.push(userId);

    const updateQuery = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, name, avatar_url, account_type, anonymize_mode
    `;

    const result = await query<{
      id: string;
      email: string;
      name: string;
      avatar_url: string | null;
      account_type: string;
      anonymize_mode: boolean;
    }>(updateQuery, values);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: result.rows[0],
    });
  } catch (err) {
    console.error('[auth] Update profile error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /me
 * Get current user info and workspaces
 * Requires authentication
 */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const userId = req.user.user_id;

    // Fetch full user data from database
    const userResult = await query<{
      id: string;
      email: string;
      name: string;
      account_type: string;
      anonymize_mode: boolean;
      avatar_url: string | null;
    }>(`
      SELECT id, email, name, account_type, anonymize_mode, avatar_url
      FROM users
      WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = userResult.rows[0];

    const wsResult = await query<{
      id: string;
      name: string;
      slug: string;
      role: string;
      connector_count: string;
      deal_count: string;
      last_sync: string | null;
    }>(`
      SELECT
        w.id,
        w.name,
        COALESCE(w.slug, '') as slug,
        uw.role,
        COALESCE(cr.cnt, 0) as connector_count,
        COALESCE(d.cnt, 0) as deal_count,
        sl.last_sync
      FROM user_workspaces uw
      JOIN workspaces w ON w.id = uw.workspace_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as cnt FROM connections WHERE workspace_id = w.id
      ) cr ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as cnt FROM deals WHERE workspace_id = w.id
      ) d ON true
      LEFT JOIN LATERAL (
        SELECT MAX(completed_at) as last_sync FROM sync_log WHERE workspace_id = w.id
      ) sl ON true
      WHERE uw.user_id = $1
      ORDER BY w.name
    `, [userId]);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        account_type: user.account_type,
        anonymize_mode: user.anonymize_mode,
        avatar_url: user.avatar_url,
      },
      workspaces: wsResult.rows.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        role: w.role,
        connector_count: Number(w.connector_count),
        deal_count: Number(w.deal_count),
        last_sync: w.last_sync || null,
      })),
    });
  } catch (err) {
    console.error('[auth] /me error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

/**
 * POST /workspaces/join
 * Join an existing workspace via API key
 */
router.post('/workspaces/join', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { api_key } = req.body;
    if (!api_key || typeof api_key !== 'string') {
      res.status(400).json({ error: 'API key is required' });
      return;
    }

    const wsResult = await query<{ id: string; name: string; slug: string }>(`
      SELECT id, name, COALESCE(slug, '') as slug FROM workspaces WHERE api_key = $1
    `, [api_key.trim()]);

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Invalid API key' });
      return;
    }

    const ws = wsResult.rows[0];

    const existing = await query<{ user_id: string }>(`
      SELECT user_id FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2
    `, [userId, ws.id]);

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Already a member of this workspace' });
      return;
    }

    await query<Record<string, never>>(`
      INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, 'member')
    `, [userId, ws.id]);

    const adminRole = await query<{ id: string }>(`
      SELECT id FROM workspace_roles WHERE workspace_id = $1 AND system_type = 'member' LIMIT 1
    `, [ws.id]);

    if (adminRole.rows.length > 0) {
      await query<Record<string, never>>(`
        INSERT INTO workspace_members (workspace_id, user_id, role_id, accepted_at, status)
        VALUES ($1, $2, $3, now(), 'active')
        ON CONFLICT (workspace_id, user_id) DO NOTHING
      `, [ws.id, userId, adminRole.rows[0].id]);
    }

    res.json({ id: ws.id, name: ws.name, slug: ws.slug, role: 'member' });
  } catch (err) {
    console.error('[auth] Join workspace error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to join workspace' });
  }
});

/**
 * POST /workspaces/create
 * Create a new workspace
 */
router.post('/workspaces/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Workspace name is required' });
      return;
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const crypto = await import('crypto');
    const apiKey = `pk_${crypto.randomBytes(24).toString('hex')}`;

    const wsResult = await query<{ id: string; name: string; slug: string }>(`
      INSERT INTO workspaces (name, slug, api_key)
      VALUES ($1, $2, $3)
      RETURNING id, name, slug
    `, [name.trim(), slug, apiKey]);

    const ws = wsResult.rows[0];

    await query<Record<string, never>>(`
      INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, 'admin')
    `, [userId, ws.id]);

    const roleInserts = [
      { name: 'Admin', desc: 'Full workspace access', type: 'admin' },
      { name: 'Member', desc: 'Standard workspace access', type: 'member' },
      { name: 'Viewer', desc: 'Read-only workspace access', type: 'viewer' },
    ];

    for (const r of roleInserts) {
      const roleResult = await query<{ id: string }>(`
        INSERT INTO workspace_roles (workspace_id, name, description, is_system, system_type, permissions)
        VALUES ($1, $2, $3, true, $4, '{}')
        RETURNING id
      `, [ws.id, r.name, r.desc, r.type]);

      if (r.type === 'admin') {
        await query<Record<string, never>>(`
          INSERT INTO workspace_members (workspace_id, user_id, role_id, accepted_at, status)
          VALUES ($1, $2, $3, now(), 'active')
          ON CONFLICT (workspace_id, user_id) DO NOTHING
        `, [ws.id, userId, roleResult.rows[0].id]);
      }
    }

    res.json({ id: ws.id, name: ws.name, slug: ws.slug, role: 'admin' });
  } catch (err) {
    console.error('[auth] Create workspace error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

export default router;
