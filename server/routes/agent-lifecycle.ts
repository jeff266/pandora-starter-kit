/**
 * Agent Lifecycle API
 *
 * Handles agent status transitions: draft → pending_review → published → archived
 * All routes are workspace-scoped under /api/workspaces/:workspaceId/agents
 */

import { Router, Request, Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';

const router = Router();

interface AgentRow {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  owner_id: string | null;
  submitted_for_review_at: string | null;
  reviewed_by: string | null;
  archived_at: string | null;
  recoverable_until: string | null;
}

/**
 * POST /:agentId/submit-for-review
 * Submit draft agent for Admin review
 */
router.post('/:agentId/submit-for-review', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const agentId = req.params.agentId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get agent
    const agentResult = await query<AgentRow>(`
      SELECT id, workspace_id, name, status, owner_id
      FROM agents
      WHERE id = $1 AND workspace_id = $2
    `, [agentId, workspaceId]);

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    // GUARD: Agent must be in 'draft' status
    if (agent.status !== 'draft') {
      return res.status(400).json({
        error: 'Agent must be in draft status to submit for review',
        current_status: agent.status,
      });
    }

    // GUARD: Only agent owner or Admin can submit
    const isOwner = agent.owner_id === userId;
    const isAdmin = req.userPermissions?.['agents.publish'] === true;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: 'Only agent owner or Admin can submit for review',
      });
    }

    // Update status
    await query<Record<string, never>>(`
      UPDATE agents
      SET
        status = 'pending_review',
        submitted_for_review_at = NOW()
      WHERE id = $1
    `, [agentId]);

    // TODO: Notify all Admin members in workspace (in-app + email)
    // This would be implemented in Prompt 7 (notifications system)

    res.json({
      agentId,
      status: 'pending_review',
      submitted_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[agent-lifecycle] Error submitting for review:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to submit agent for review' });
  }
});

/**
 * POST /:agentId/review
 * Approve or reject agent in pending_review status
 */
router.post('/:agentId/review', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const agentId = req.params.agentId as string;
    const { action, note } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Validation
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({
        error: 'Action must be "approve" or "reject"',
      });
    }

    // Get agent
    const agentResult = await query<AgentRow>(`
      SELECT id, workspace_id, name, status, owner_id
      FROM agents
      WHERE id = $1 AND workspace_id = $2
    `, [agentId, workspaceId]);

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    // GUARD: Agent must be in 'pending_review' status
    if (agent.status !== 'pending_review') {
      return res.status(400).json({
        error: 'Agent must be in pending_review status',
        current_status: agent.status,
      });
    }

    // Update status based on action
    const newStatus = action === 'approve' ? 'published' : 'draft';

    await query<Record<string, never>>(`
      UPDATE agents
      SET
        status = $1,
        reviewed_by = $2
      WHERE id = $3
    `, [newStatus, userId, agentId]);

    // TODO: Notify agent owner of outcome (in-app + email)
    // This would be implemented in Prompt 7 (notifications system)

    res.json({
      agentId,
      status: newStatus,
      action,
      note: note || null,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[agent-lifecycle] Error reviewing agent:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to review agent' });
  }
});

/**
 * POST /:agentId/archive
 * Archive an agent (soft delete with 90-day recovery window)
 */
router.post('/:agentId/archive', requireAnyPermission('agents.delete_own', 'agents.delete_any'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const agentId = req.params.agentId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get agent
    const agentResult = await query<AgentRow>(`
      SELECT id, workspace_id, name, status, owner_id
      FROM agents
      WHERE id = $1 AND workspace_id = $2
    `, [agentId, workspaceId]);

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    // Check: if only delete_own → verify agent owner_id === req.user.id
    const hasDeleteAny = req.userPermissions?.['agents.delete_any'] === true;
    const hasDeleteOwn = req.userPermissions?.['agents.delete_own'] === true;

    if (hasDeleteOwn && !hasDeleteAny) {
      // Only has delete_own permission, must be owner
      if (agent.owner_id !== userId) {
        return res.status(403).json({
          error: 'You can only archive agents you own',
        });
      }
    }

    // Calculate recoverable_until (90 days from now)
    const recoverableUntil = new Date();
    recoverableUntil.setDate(recoverableUntil.getDate() + 90);

    // Update agent
    await query<Record<string, never>>(`
      UPDATE agents
      SET
        status = 'archived',
        archived_at = NOW(),
        recoverable_until = $1
      WHERE id = $2
    `, [recoverableUntil, agentId]);

    res.json({
      agentId,
      status: 'archived',
      archived_at: new Date().toISOString(),
      recoverable_until: recoverableUntil.toISOString(),
    });
  } catch (err) {
    console.error('[agent-lifecycle] Error archiving agent:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to archive agent' });
  }
});

/**
 * POST /:agentId/recover
 * Recover an archived agent (if within 90-day window)
 */
router.post('/:agentId/recover', requireAnyPermission('agents.edit_own', 'agents.edit_any'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const agentId = req.params.agentId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get agent
    const agentResult = await query<AgentRow>(`
      SELECT id, workspace_id, name, status, owner_id, recoverable_until
      FROM agents
      WHERE id = $1 AND workspace_id = $2
    `, [agentId, workspaceId]);

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    // GUARD: Agent must be in 'archived' status
    if (agent.status !== 'archived') {
      return res.status(400).json({
        error: 'Agent must be archived to recover',
        current_status: agent.status,
      });
    }

    // GUARD: recoverable_until must be > now()
    if (!agent.recoverable_until || new Date(agent.recoverable_until) < new Date()) {
      return res.status(410).json({
        error: 'Agent recovery window has expired',
        recoverable_until: agent.recoverable_until,
      });
    }

    // Check ownership (same as archive)
    const hasEditAny = req.userPermissions?.['agents.edit_any'] === true;
    const hasEditOwn = req.userPermissions?.['agents.edit_own'] === true;

    if (hasEditOwn && !hasEditAny) {
      // Only has edit_own permission, must be owner
      if (agent.owner_id !== userId) {
        return res.status(403).json({
          error: 'You can only recover agents you own',
        });
      }
    }

    // Update agent
    await query<Record<string, never>>(`
      UPDATE agents
      SET
        status = 'published',
        archived_at = NULL,
        recoverable_until = NULL
      WHERE id = $1
    `, [agentId]);

    res.json({
      agentId,
      status: 'published',
      recovered_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[agent-lifecycle] Error recovering agent:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to recover agent' });
  }
});

export default router;
