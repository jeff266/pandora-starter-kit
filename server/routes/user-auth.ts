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

    // Get user workspaces
    const wsResult = await query<{
      id: string;
      name: string;
      role_id: string;
      role_name: string;
      status: string;
    }>(`
      SELECT
        w.id,
        w.name,
        wm.role_id,
        wr.name as role_name,
        wm.status
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      JOIN workspace_roles wr ON wr.id = wm.role_id
      WHERE wm.user_id = $1
        AND wm.status IN ('active', 'pending')
      ORDER BY w.name
    `, [userId]);

    res.json({
      user: {
        id: userId,
        email: req.user.email,
        account_type: req.user.account_type,
      },
      workspaces: wsResult.rows.map(w => ({
        id: w.id,
        name: w.name,
        role: {
          id: w.role_id,
          name: w.role_name,
        },
        status: w.status,
      })),
    });
  } catch (err) {
    console.error('[auth] /me error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

export default router;
