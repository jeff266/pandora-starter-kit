import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { sendMagicLink } from '../services/email.js';

const router = Router();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.status(400).json({ error: 'Workspace not resolved' });
      return;
    }

    const result = await query<{
      id: string; email: string; name: string; role: string; created_at: string;
    }>(`
      SELECT u.id, u.email, u.name, uw.role, uw.created_at
      FROM user_workspaces uw
      JOIN users u ON u.id = uw.user_id
      WHERE uw.workspace_id = $1
      ORDER BY
        CASE uw.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
        u.name
    `, [workspaceId]);

    res.json({ members: result.rows });
  } catch (err) {
    console.error('[members] List error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

router.post('/invite', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.status(400).json({ error: 'Workspace not resolved' });
      return;
    }

    if ((req as any).authMethod !== 'session') {
      res.status(403).json({ error: 'Member management requires user authentication' });
      return;
    }
    const inviterRole = (req as any).userWorkspaceRole;
    if (inviterRole !== 'admin') {
      res.status(403).json({ error: 'Only admins can invite members' });
      return;
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const role = req.body.role || 'member';
    const name = (req.body.name || '').trim();

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }
    if (!['admin', 'member', 'viewer'].includes(role)) {
      res.status(400).json({ error: 'Role must be admin, member, or viewer' });
      return;
    }

    let userResult = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    let isNewUser = false;
    if (userResult.rows.length === 0) {
      const userName = name || email.split('@')[0];
      userResult = await query<{ id: string }>(
        'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id',
        [email, userName, 'member']
      );
      isNewUser = true;
    }

    const userId = userResult.rows[0].id;

    const existing = await query(
      'SELECT id FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2',
      [userId, workspaceId]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'User already has access to this workspace' });
      return;
    }

    const inviterId = (req as any).user?.user_id || null;
    await query(
      'INSERT INTO user_workspaces (user_id, workspace_id, role, invited_by) VALUES ($1, $2, $3, $4)',
      [userId, workspaceId, role, inviterId]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await query(
      'INSERT INTO magic_links (email, token, expires_at) VALUES ($1, $2, $3)',
      [email, tokenHash, expiresAt]
    );
    await sendMagicLink(email, token, isNewUser);

    res.json({ user_id: userId, email, role });
  } catch (err) {
    console.error('[members] Invite error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to invite member' });
  }
});

router.patch('/:userId', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace?.id;
    const targetUserId = req.params.userId;

    if ((req as any).authMethod !== 'session') {
      res.status(403).json({ error: 'Member management requires user authentication' });
      return;
    }
    const role = (req as any).userWorkspaceRole;
    if (role !== 'admin') {
      res.status(403).json({ error: 'Only admins can change roles' });
      return;
    }

    const newRole = req.body.role;
    if (!['admin', 'member', 'viewer'].includes(newRole)) {
      res.status(400).json({ error: 'Role must be admin, member, or viewer' });
      return;
    }

    const current = await query<{ role: string }>(
      'SELECT role FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2',
      [targetUserId, workspaceId]
    );
    if (current.rows.length === 0) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    if (current.rows[0].role === 'admin' && newRole !== 'admin') {
      const adminCount = await query<{ count: string }>(
        "SELECT count(*) FROM user_workspaces WHERE workspace_id = $1 AND role = 'admin'",
        [workspaceId]
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        res.status(400).json({ error: 'Cannot demote the last admin' });
        return;
      }
    }

    await query(
      'UPDATE user_workspaces SET role = $1 WHERE user_id = $2 AND workspace_id = $3',
      [newRole, targetUserId, workspaceId]
    );

    res.json({ success: true, role: newRole });
  } catch (err) {
    console.error('[members] Update role error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

router.delete('/:userId', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace?.id;
    const targetUserId = req.params.userId;

    if ((req as any).authMethod !== 'session') {
      res.status(403).json({ error: 'Member management requires user authentication' });
      return;
    }
    const role = (req as any).userWorkspaceRole;
    if (role !== 'admin') {
      res.status(403).json({ error: 'Only admins can remove members' });
      return;
    }

    const current = await query<{ role: string }>(
      'SELECT role FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2',
      [targetUserId, workspaceId]
    );
    if (current.rows.length === 0) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    if (current.rows[0].role === 'admin') {
      const adminCount = await query<{ count: string }>(
        "SELECT count(*) FROM user_workspaces WHERE workspace_id = $1 AND role = 'admin'",
        [workspaceId]
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        res.status(400).json({ error: 'Cannot remove the last admin' });
        return;
      }
    }

    await query(
      'DELETE FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2',
      [targetUserId, workspaceId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[members] Remove error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

export default router;
