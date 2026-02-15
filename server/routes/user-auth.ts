import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { sendMagicLink, sendWaitlistEmail, isAllowedEmail } from '../services/email.js';

const router = Router();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    if (!checkRateLimit(email)) {
      res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
      return;
    }

    if (!isAllowedEmail(email)) {
      const name = (req.body.name || '').trim();
      await sendWaitlistEmail(email, name || undefined);
      res.json({ status: 'waitlisted', message: "You've been added to the waitlist. We'll be in touch!" });
      return;
    }

    const userResult = await query<{ id: string; name: string }>(
      'SELECT id, name FROM users WHERE email = $1',
      [email]
    );

    let isNewUser = false;

    if (userResult.rows.length === 0) {
      const name = (req.body.name || '').trim();
      if (!name) {
        res.json({ status: 'new_user', message: 'Please provide your name to create an account' });
        return;
      }
      await query(
        'INSERT INTO users (email, name, role) VALUES ($1, $2, $3)',
        [email, name, 'member']
      );
      isNewUser = true;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await query(
      'INSERT INTO magic_links (email, token, expires_at) VALUES ($1, $2, $3)',
      [email, tokenHash, expiresAt]
    );

    await sendMagicLink(email, token, isNewUser);

    res.json({ status: 'sent', message: 'Check your email for a sign-in link' });
  } catch (err) {
    console.error('[auth] Login error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to process login' });
  }
});

router.get('/verify', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`verify:${ip}`)) {
      res.status(429).json({ error: 'Too many verification attempts. Please try again later.' });
      return;
    }

    const tokenHash = hashToken(token);

    const linkResult = await query<{ id: string; email: string; used_at: Date | null; expires_at: Date }>(
      'SELECT id, email, used_at, expires_at FROM magic_links WHERE token = $1',
      [tokenHash]
    );

    if (linkResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired link' });
      return;
    }

    const link = linkResult.rows[0];
    if (link.used_at || new Date(link.expires_at) < new Date()) {
      res.status(401).json({ error: 'Invalid or expired link' });
      return;
    }

    await query('UPDATE magic_links SET used_at = now() WHERE id = $1', [link.id]);

    const userResult = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [link.email]
    );

    if (userResult.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const userId = userResult.rows[0].id;
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      'INSERT INTO user_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, sessionToken, sessionExpires]
    );

    const baseUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}`;
    res.redirect(`${baseUrl}/auth/callback?session=${sessionToken}`);
  } catch (err) {
    console.error('[auth] Verify error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to verify link' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const token = header.slice(7);
    await query('DELETE FROM user_sessions WHERE token = $1', [token]);
    res.json({ success: true });
  } catch (err) {
    console.error('[auth] Logout error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const token = header.slice(7);

    const sessionResult = await query<{ user_id: string }>(
      'SELECT user_id FROM user_sessions WHERE token = $1 AND expires_at > now()',
      [token]
    );

    if (sessionResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    const userId = sessionResult.rows[0].user_id;

    const userResult = await query<{ id: string; email: string; name: string; role: string }>(
      'SELECT id, email, name, role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const user = userResult.rows[0];

    const wsResult = await query<{
      id: string; name: string; slug: string; role: string;
      connector_count: string; deal_count: string; last_sync: string | null;
    }>(`
      SELECT
        w.id, w.name, w.slug,
        uw.role,
        (SELECT count(*) FROM connections cc
         WHERE cc.workspace_id = w.id AND cc.status = 'connected') as connector_count,
        (SELECT count(*) FROM deals d
         WHERE d.workspace_id = w.id AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')) as deal_count,
        (SELECT max(cc.last_sync_at) FROM connections cc
         WHERE cc.workspace_id = w.id) as last_sync
      FROM user_workspaces uw
      JOIN workspaces w ON w.id = uw.workspace_id
      WHERE uw.user_id = $1
      ORDER BY w.name
    `, [userId]);

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      workspaces: wsResult.rows.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        role: w.role,
        connector_count: parseInt(w.connector_count) || 0,
        deal_count: parseInt(w.deal_count) || 0,
        last_sync: w.last_sync,
      })),
    });
  } catch (err) {
    console.error('[auth] /me error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

router.post('/workspaces/join', async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const token = header.slice(7);

    const sessionResult = await query<{ user_id: string }>(
      'SELECT user_id FROM user_sessions WHERE token = $1 AND expires_at > now()',
      [token]
    );
    if (sessionResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
    const userId = sessionResult.rows[0].user_id;

    const apiKey = (req.body.api_key || '').trim();
    if (!apiKey) {
      res.status(400).json({ error: 'API key is required' });
      return;
    }

    const wsResult = await query<{ id: string; name: string; slug: string }>(
      'SELECT id, name, slug FROM workspaces WHERE api_key = $1',
      [apiKey]
    );
    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'No workspace found with that API key' });
      return;
    }

    const workspace = wsResult.rows[0];

    const existing = await query(
      'SELECT id FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2',
      [userId, workspace.id]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'You already have access to this workspace' });
      return;
    }

    const memberCount = await query<{ count: string }>(
      'SELECT count(*) FROM user_workspaces WHERE workspace_id = $1',
      [workspace.id]
    );
    const role = parseInt(memberCount.rows[0].count) === 0 ? 'admin' : 'member';

    await query(
      'INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, $3)',
      [userId, workspace.id, role]
    );

    res.json({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role,
    });
  } catch (err) {
    console.error('[auth] Join workspace error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to join workspace' });
  }
});

export default router;
