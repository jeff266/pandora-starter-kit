/**
 * Skill Run Requests API
 *
 * Handles skill run request/approval workflow for users without direct run permission.
 * All routes mounted at /api/workspaces/:workspaceId/skill-run-requests
 */

import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { notificationService } from '../notifications/service.js';
import { sendSkillRunRequestResolved } from '../notifications/email.js';

const router = Router({ mergeParams: true });

/**
 * POST /
 * Request permission to run a skill
 */
router.post('/', requirePermission('skills.run_request'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { skillId, note } = req.body;

    // Validation
    if (!skillId || typeof skillId !== 'string' || skillId.trim().length === 0) {
      res.status(400).json({ error: 'Valid skillId is required' });
      return;
    }

    // Get user name for notifications
    const userResult = await query<{ name: string; email: string }>(`
      SELECT name, email FROM users WHERE id = $1
    `, [userId]);

    const userName = userResult.rows[0]?.name || 'A user';

    // Create request
    const requestResult = await query<{ id: string }>(`
      INSERT INTO skill_run_requests (
        workspace_id,
        requested_by,
        skill_id,
        note,
        status
      ) VALUES ($1, $2, $3, $4, 'pending')
      RETURNING id
    `, [workspaceId, userId, skillId, note || null]);

    const requestId = requestResult.rows[0].id;

    // Notify all admins
    await notificationService.createForAdmins(workspaceId, {
      type: 'skill_run_request',
      title: 'Skill run requested',
      body: `${userName} requested a run of ${skillId}`,
      actionUrl: `/workspaces/${workspaceId}/settings/requests`,
    });

    res.status(201).json({
      requestId,
      status: 'pending',
    });
  } catch (err) {
    console.error('[skill-run-requests] Error creating request:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to create skill run request' });
  }
});

/**
 * GET /
 * List skill run requests
 * Admins see all, non-admins see only their own
 */
router.get('/', requirePermission('skills.run_request'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is admin
    const isAdmin = req.userPermissions?.['skills.run_manual'] === true;

    // Build query based on permissions
    const whereClause = isAdmin
      ? 'WHERE srr.workspace_id = $1'
      : 'WHERE srr.workspace_id = $1 AND srr.requested_by = $2';

    const params = isAdmin ? [workspaceId] : [workspaceId, userId];

    const requestsResult = await query<{
      id: string;
      skill_id: string;
      note: string | null;
      status: string;
      requester_name: string;
      requester_email: string;
      created_at: string;
      resolved_at: string | null;
      resolved_by_name: string | null;
    }>(`
      SELECT
        srr.id,
        srr.skill_id,
        srr.note,
        srr.status,
        u.name as requester_name,
        u.email as requester_email,
        srr.created_at,
        srr.resolved_at,
        resolver.name as resolved_by_name
      FROM skill_run_requests srr
      JOIN users u ON u.id = srr.requested_by
      LEFT JOIN users resolver ON resolver.id = srr.resolved_by
      ${whereClause}
      ORDER BY
        CASE srr.status
          WHEN 'pending' THEN 1
          WHEN 'approved' THEN 2
          WHEN 'rejected' THEN 3
        END,
        srr.created_at DESC
    `, params);

    res.json({
      requests: requestsResult.rows.map(r => ({
        id: r.id,
        skillId: r.skill_id,
        note: r.note,
        status: r.status,
        requester: {
          name: r.requester_name,
          email: r.requester_email,
        },
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        resolvedBy: r.resolved_by_name,
      })),
    });
  } catch (err) {
    console.error('[skill-run-requests] Error listing requests:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list skill run requests' });
  }
});

/**
 * POST /:requestId/resolve
 * Approve or reject a skill run request
 * Only users with skills.run_manual permission can approve
 */
router.post('/:requestId/resolve', requirePermission('skills.run_manual'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const requestId = req.params.requestId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { action, note } = req.body;

    // Validation
    if (action !== 'approved' && action !== 'rejected') {
      res.status(400).json({ error: 'Action must be "approved" or "rejected"' });
      return;
    }

    // Get request
    const requestResult = await query<{
      id: string;
      workspace_id: string;
      requested_by: string;
      skill_id: string;
      status: string;
    }>(`
      SELECT id, workspace_id, requested_by, skill_id, status
      FROM skill_run_requests
      WHERE id = $1
    `, [requestId]);

    if (requestResult.rows.length === 0) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const request = requestResult.rows[0];

    // GUARD: Request must belong to this workspace
    if (request.workspace_id !== workspaceId) {
      res.status(403).json({ error: 'Request does not belong to this workspace' });
      return;
    }

    // GUARD: Request must be pending
    if (request.status !== 'pending') {
      res.status(409).json({ error: 'Request has already been resolved' });
      return;
    }

    // Update request status
    await query<Record<string, never>>(`
      UPDATE skill_run_requests
      SET
        status = $1,
        resolved_by = $2,
        resolved_at = NOW()
      WHERE id = $3
    `, [action, userId, requestId]);

    let skillRunId: string | null = null;

    // If approved, trigger the skill run
    if (action === 'approved') {
      // TODO: Implement skill run trigger
      // For now, just log that it would be triggered
      console.log(`[skill-run-requests] Would trigger skill run for ${request.skill_id} in workspace ${workspaceId}`);

      // In the future, this would call the skill execution mechanism:
      // const runResult = await triggerSkillRun(workspaceId, request.skill_id, userId);
      // skillRunId = runResult.id;
    }

    // Get requester details for notification
    const requesterResult = await query<{
      email: string;
      name: string;
    }>(`
      SELECT email, name FROM users WHERE id = $1
    `, [request.requested_by]);

    const requester = requesterResult.rows[0];

    // Get workspace name
    const workspaceResult = await query<{ name: string }>(`
      SELECT name FROM workspaces WHERE id = $1
    `, [workspaceId]);

    const workspaceName = workspaceResult.rows[0]?.name || 'Unknown Workspace';

    // Notify requester
    await notificationService.create({
      workspaceId,
      userId: request.requested_by,
      type: 'skill_run_request_resolved',
      title: `Skill run request ${action}`,
      body: `Your request to run ${request.skill_id} was ${action}${note ? `: ${note}` : ''}`,
    });

    // Send email notification
    await sendSkillRunRequestResolved({
      toEmail: requester.email,
      toName: requester.name,
      workspaceName,
      skillName: request.skill_id,
      action: action as 'approved' | 'rejected',
    });

    res.json({
      requestId,
      status: action,
      skillRunId,
    });
  } catch (err) {
    console.error('[skill-run-requests] Error resolving request:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to resolve skill run request' });
  }
});

export default router;
