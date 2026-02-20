/**
 * Members Management API
 *
 * Handles workspace member invitations, role management, and access control.
 * All routes mounted at /api/workspaces/:workspaceId/members
 */

import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { createHash } from 'crypto';
import { query } from '../db.js';
import { ensureNotLastAdmin, validateRoleInWorkspace, isAdminRole } from '../permissions/guards.js';

const router = Router();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * GET /
 * List all workspace members and pending invites
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Get active and pending members
    const membersResult = await query<{
      id: string;
      user_id: string;
      name: string;
      email: string;
      avatar_url: string | null;
      role_id: string;
      role_name: string;
      invited_at: string;
      accepted_at: string | null;
      status: string;
      last_login_at: string | null;
    }>(`
      SELECT
        wm.id,
        wm.user_id,
        u.name,
        u.email,
        u.avatar_url,
        wm.role_id,
        wr.name as role_name,
        wm.invited_at,
        wm.accepted_at,
        wm.status,
        u.last_login_at
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      JOIN workspace_roles wr ON wr.id = wm.role_id
      WHERE wm.workspace_id = $1
        AND wm.status IN ('active', 'pending', 'suspended')
      ORDER BY wm.status, wm.invited_at DESC
    `, [workspaceId]);

    const members = membersResult.rows.map(m => ({
      id: m.id,
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      avatar_url: m.avatar_url,
      role: {
        id: m.role_id,
        name: m.role_name,
      },
      joined_at: m.accepted_at || m.invited_at,
      invited_at: m.invited_at,
      accepted_at: m.accepted_at,
      last_login_at: m.last_login_at,
      status: m.status,
    }));

    // Check if caller has invite permission to see pending invites
    const canSeeInvites = req.userPermissions?.['members.invite'] === true;

    res.json({
      members,
      can_manage_invites: canSeeInvites,
    });
  } catch (err) {
    console.error('[members] Error listing members:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

/**
 * POST /invite
 * Invite a new member to the workspace
 */
router.post('/invite', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { email, roleId, note } = req.body;

    // Validation
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!roleId || typeof roleId !== 'string') {
      return res.status(400).json({ error: 'Valid roleId is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate role exists in this workspace
    await validateRoleInWorkspace(roleId, workspaceId);

    // Check if user is already a member (active or pending)
    const existingMember = await query<{ id: string; status: string }>(`
      SELECT wm.id, wm.status
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1 AND u.email = $2
    `, [workspaceId, normalizedEmail]);

    if (existingMember.rows.length > 0) {
      const status = existingMember.rows[0].status;
      return res.status(409).json({
        error: `User is already ${status === 'pending' ? 'invited' : 'a member'} of this workspace`,
      });
    }

    // Find or create user
    let userId: string;
    const userResult = await query<{ id: string }>(`
      SELECT id FROM users WHERE email = $1
    `, [normalizedEmail]);

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      // Create placeholder user
      const newUserResult = await query<{ id: string }>(`
        INSERT INTO users (email, name, account_type)
        VALUES ($1, $2, 'standard')
        RETURNING id
      `, [normalizedEmail, normalizedEmail]);
      userId = newUserResult.rows[0].id;
    }

    // Create workspace_members row with status = 'pending'
    const invitedBy = req.user?.user_id;
    const memberResult = await query<{ id: string }>(`
      INSERT INTO workspace_members (
        workspace_id,
        user_id,
        role_id,
        invited_by,
        status
      ) VALUES ($1, $2, $3, $4, 'pending')
      RETURNING id
    `, [workspaceId, userId, roleId, invitedBy]);

    const memberId = memberResult.rows[0].id;

    // TODO: Trigger send_invite_email notification (queued — see Prompt 7)
    // TODO: Create in-app notification for the invited user

    res.status(201).json({
      memberId,
      email: normalizedEmail,
      status: 'pending',
      note: note || null,
    });
  } catch (err) {
    console.error('[members] Error inviting member:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.message.includes('Role not found')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to invite member' });
  }
});

/**
 * POST /invite-request
 * Request permission to invite a new member (for non-admin users)
 */
router.post('/invite-request', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { email, proposedRoleId, note } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!proposedRoleId || typeof proposedRoleId !== 'string') {
      return res.status(400).json({ error: 'Valid proposedRoleId is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate role exists
    await validateRoleInWorkspace(proposedRoleId, workspaceId);

    const requesterId = req.user?.user_id;
    if (!requesterId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Create invite request
    const requestResult = await query<{ id: string }>(`
      INSERT INTO member_invite_requests (
        workspace_id,
        requester_id,
        invite_email,
        suggested_role,
        request_reason,
        status
      ) VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING id
    `, [workspaceId, requesterId, normalizedEmail, proposedRoleId, note || null]);

    const requestId = requestResult.rows[0].id;

    // TODO: Trigger notification to all Admin members in this workspace

    res.status(201).json({
      requestId,
      status: 'pending',
    });
  } catch (err) {
    console.error('[members] Error creating invite request:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.message.includes('Role not found')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create invite request' });
  }
});

/**
 * GET /invite-requests
 * List pending invite requests
 */
router.get('/invite-requests', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const requestsResult = await query<{
      id: string;
      requester_name: string;
      requester_email: string;
      invite_email: string;
      suggested_role_id: string;
      suggested_role_name: string;
      request_reason: string | null;
      created_at: string;
    }>(`
      SELECT
        mir.id,
        u.name as requester_name,
        u.email as requester_email,
        mir.invite_email,
        mir.suggested_role as suggested_role_id,
        wr.name as suggested_role_name,
        mir.request_reason,
        mir.created_at
      FROM member_invite_requests mir
      JOIN users u ON u.id = mir.requester_id
      JOIN workspace_roles wr ON wr.id = mir.suggested_role
      WHERE mir.workspace_id = $1
        AND mir.status = 'pending'
      ORDER BY mir.created_at DESC
    `, [workspaceId]);

    res.json({
      requests: requestsResult.rows.map(r => ({
        id: r.id,
        requester: {
          name: r.requester_name,
          email: r.requester_email,
        },
        proposed_email: r.invite_email,
        proposed_role: {
          id: r.suggested_role_id,
          name: r.suggested_role_name,
        },
        note: r.request_reason,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[members] Error listing invite requests:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list invite requests' });
  }
});

/**
 * POST /invite-requests/:requestId/resolve
 * Approve or reject an invite request
 */
router.post('/invite-requests/:requestId/resolve', async (req: Request, res: Response) => {
  try {
    const { workspaceId, requestId } = req.params;
    const { action, note } = req.body;

    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
    }

    // Get the request
    const requestResult = await query<{
      id: string;
      requester_id: string;
      invite_email: string;
      suggested_role: string;
      status: string;
    }>(`
      SELECT id, requester_id, invite_email, suggested_role, status
      FROM member_invite_requests
      WHERE id = $1 AND workspace_id = $2
    `, [requestId, workspaceId]);

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invite request not found' });
    }

    const request = requestResult.rows[0];
    if (request.status !== 'pending') {
      return res.status(409).json({ error: 'Request has already been resolved' });
    }

    const resolvedBy = req.user?.user_id;
    let memberId: string | null = null;

    if (action === 'approve') {
      // Create the invite (same logic as POST /invite)
      const normalizedEmail = request.invite_email.trim().toLowerCase();

      // Find or create user
      let userId: string;
      const userResult = await query<{ id: string }>(`
        SELECT id FROM users WHERE email = $1
      `, [normalizedEmail]);

      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      } else {
        const newUserResult = await query<{ id: string }>(`
          INSERT INTO users (email, name, account_type)
          VALUES ($1, $2, 'standard')
          RETURNING id
        `, [normalizedEmail, normalizedEmail]);
        userId = newUserResult.rows[0].id;
      }

      // Create workspace_members row
      const memberResult = await query<{ id: string }>(`
        INSERT INTO workspace_members (
          workspace_id,
          user_id,
          role_id,
          invited_by,
          status
        ) VALUES ($1, $2, $3, $4, 'pending')
        RETURNING id
      `, [workspaceId, userId, request.suggested_role, resolvedBy]);

      memberId = memberResult.rows[0].id;

      // TODO: Trigger send_invite_email notification
    }

    // Update request status
    await query<Record<string, never>>(`
      UPDATE member_invite_requests
      SET status = $1,
          approved_by = $2,
          reviewed_at = NOW()
      WHERE id = $3
    `, [action === 'approve' ? 'approved' : 'rejected', resolvedBy, requestId]);

    // TODO: Notify requestor of outcome

    res.json({
      requestId,
      status: action === 'approve' ? 'approved' : 'rejected',
      memberId,
    });
  } catch (err) {
    console.error('[members] Error resolving invite request:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to resolve invite request' });
  }
});

/**
 * PATCH /:memberId/role
 * Change a member's role
 */
router.patch('/:memberId/role', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const memberId = req.params.memberId as string;
    const { roleId } = req.body;

    if (!roleId || typeof roleId !== 'string') {
      return res.status(400).json({ error: 'Valid roleId is required' });
    }

    // Validate role exists in this workspace
    await validateRoleInWorkspace(roleId, workspaceId);

    // Get current member info
    const memberResult = await query<{
      user_id: string;
      current_role_id: string;
      current_role_type: string;
      status: string;
    }>(`
      SELECT
        wm.user_id,
        wm.role_id as current_role_id,
        wr.system_type as current_role_type,
        wm.status
      FROM workspace_members wm
      JOIN workspace_roles wr ON wr.id = wm.role_id
      WHERE wm.id = $1 AND wm.workspace_id = $2
    `, [memberId, workspaceId]);

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const member = memberResult.rows[0];

    // Check if demoting from Admin to non-Admin
    const isCurrentlyAdmin = member.current_role_type === 'admin';
    const isNewRoleAdmin = await isAdminRole(roleId);

    if (isCurrentlyAdmin && !isNewRoleAdmin && member.status === 'active') {
      // Ensure this won't leave workspace with zero Admins
      await ensureNotLastAdmin(workspaceId, member.user_id);
    }

    // Update role
    await query<Record<string, never>>(`
      UPDATE workspace_members
      SET role_id = $1
      WHERE id = $2
    `, [roleId, memberId]);

    // Get new role name
    const newRoleResult = await query<{ name: string }>(`
      SELECT name FROM workspace_roles WHERE id = $1
    `, [roleId]);

    // TODO: Create notification for affected member

    res.json({
      memberId,
      newRole: {
        id: roleId,
        name: newRoleResult.rows[0]?.name,
      },
    });
  } catch (err) {
    console.error('[members] Error changing role:', err instanceof Error ? err.message : err);
    if (err instanceof Error && (err.message.includes('Role not found') || err.message.includes('last Admin'))) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to change role' });
  }
});

/**
 * PATCH /:memberId/status
 * Suspend or activate a member
 */
router.patch('/:memberId/status', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const memberId = req.params.memberId as string;
    const { status } = req.body;

    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'Status must be "active" or "suspended"' });
    }

    // Get member info
    const memberResult = await query<{
      user_id: string;
      role_type: string;
      current_status: string;
    }>(`
      SELECT
        wm.user_id,
        wr.system_type as role_type,
        wm.status as current_status
      FROM workspace_members wm
      JOIN workspace_roles wr ON wr.id = wm.role_id
      WHERE wm.id = $1 AND wm.workspace_id = $2
    `, [memberId, workspaceId]);

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const member = memberResult.rows[0];

    // If suspending an active Admin, ensure not last Admin
    if (status === 'suspended' && member.current_status === 'active' && member.role_type === 'admin') {
      await ensureNotLastAdmin(workspaceId, member.user_id);
    }

    // Update status
    await query<Record<string, never>>(`
      UPDATE workspace_members
      SET status = $1
      WHERE id = $2
    `, [status, memberId]);

    // TODO: Create notification for affected member if suspending

    res.json({
      memberId,
      status,
    });
  } catch (err) {
    console.error('[members] Error changing status:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.message.includes('last Admin')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to change status' });
  }
});

/**
 * DELETE /:memberId
 * Remove a member from the workspace
 */
router.delete('/:memberId', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const memberId = req.params.memberId as string;

    // Get member info
    const memberResult = await query<{
      user_id: string;
      role_type: string;
      status: string;
    }>(`
      SELECT
        wm.user_id,
        wr.system_type as role_type,
        wm.status
      FROM workspace_members wm
      JOIN workspace_roles wr ON wr.id = wm.role_id
      WHERE wm.id = $1 AND wm.workspace_id = $2
    `, [memberId, workspaceId]);

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const member = memberResult.rows[0];

    // If removing an active Admin, ensure not last Admin
    if (member.status === 'active' && member.role_type === 'admin') {
      await ensureNotLastAdmin(workspaceId, member.user_id);
    }

    // Delete the workspace_members row
    // Their agents, skill runs etc. remain — owner_id is preserved
    await query<Record<string, never>>(`
      DELETE FROM workspace_members
      WHERE id = $1
    `, [memberId]);

    res.json({ removed: true });
  } catch (err) {
    console.error('[members] Error removing member:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.message.includes('last Admin')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

/**
 * POST /accept-invite/:token
 * Accept a workspace invitation (public route)
 * TODO: Implement after invite token generation system is built (Prompt 8)
 */
router.post('/accept-invite/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    // TODO: Validate invite token
    // TODO: Set workspace_members.status = 'active', accepted_at = now()
    // TODO: If new user: redirect to account setup flow
    // TODO: If existing user: redirect to workspace

    res.status(501).json({ error: 'Invite token system not yet implemented (see Prompt 8)' });
  } catch (err) {
    console.error('[members] Error accepting invite:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
