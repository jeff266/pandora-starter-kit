/**
 * Authentication Middleware
 *
 * Provides requireAuth and optionalAuth middleware for route protection.
 * - requireAuth: Enforces authentication, returns 401 if no valid token
 * - optionalAuth: Attaches user if token present, continues if not
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './tokens.js';

/**
 * Require authentication middleware
 * Returns 401 if no valid access token
 * Attaches req.user = { user_id, email, account_type } if valid
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Try Authorization header first (Bearer token)
  let token: string | null = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Fallback to cookie (for web clients)
  if (!token && req.cookies?.pandora_access) {
    token = req.cookies.pandora_access;
  }

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      code: 'NO_TOKEN',
    });
    return;
  }

  // Verify token
  const payload = verifyAccessToken(token);

  if (!payload) {
    res.status(401).json({
      error: 'Unauthorized',
      code: 'TOKEN_EXPIRED',
    });
    return;
  }

  // Attach user to request
  req.user = {
    user_id: payload.sub,
    email: payload.email,
    account_type: payload.account_type,
  };

  next();
}

/**
 * Optional authentication middleware
 * Attaches req.user if token is present and valid
 * Continues with req.user = null if no token or invalid token
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  // Try Authorization header first
  let token: string | null = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Fallback to cookie
  if (!token && req.cookies?.pandora_access) {
    token = req.cookies.pandora_access;
  }

  if (!token) {
    req.user = null;
    next();
    return;
  }

  // Verify token
  const payload = verifyAccessToken(token);

  if (payload) {
    req.user = {
      user_id: payload.sub,
      email: payload.email,
      account_type: payload.account_type,
    };
  } else {
    req.user = null;
  }

  next();
}
