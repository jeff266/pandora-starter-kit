/**
 * Workflow Rules API Routes
 * Manage workflow automation rules and pending actions queue
 */

import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { requirePermission } from '../middleware/permissions.js';
import { RuleEvaluator } from '../workflow/rule-evaluator.js';
import { ActionExecutor, type WorkflowRule } from '../workflow/action-executor.js';
import { executeActionApproval } from '../workflow/action-approver.js';

const router = Router();
const logger = createLogger('WorkflowRulesRoutes');

/**
 * GET /:workspaceId/workflow-rules
 * List all workflow rules for workspace
 */
router.get('/:workspaceId/workflow-rules',
  requirePermission('config.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params as Record<string, string>;

      const result = await query(
        `SELECT id, name, description, trigger_type, trigger_skill_id, trigger_finding_category,
                trigger_severity, condition_json, action_type, action_payload, execution_mode,
                scope, scope_filter, is_active, created_by, last_triggered_at, trigger_count,
                created_at, updated_at
         FROM workflow_rules
         WHERE workspace_id = $1
         ORDER BY created_at DESC`,
        [workspaceId]
      );

      res.json({ rules: result.rows });
    } catch (err) {
      logger.error('Failed to fetch workflow rules', err as Error);
      res.status(500).json({ error: 'Failed to fetch workflow rules' });
    }
  });

/**
 * POST /:workspaceId/workflow-rules
 * Create a new workflow rule
 */
router.post('/:workspaceId/workflow-rules',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params as Record<string, string>;
      const userId = (req as any).user?.user_id;
      const {
        name,
        description,
        trigger_type,
        trigger_skill_id,
        trigger_finding_category,
        trigger_severity,
        condition_json,
        action_type,
        action_payload,
        execution_mode,
        scope,
        scope_filter,
      } = req.body;

      // Validate required fields
      if (!name || !trigger_type || !action_type) {
        res.status(400).json({ error: 'Missing required fields: name, trigger_type, action_type' });
        return;
      }

      // Validate condition structure
      if (condition_json) {
        const evaluator = new RuleEvaluator();
        const validation = evaluator.validateCondition(condition_json);
        if (!validation.valid) {
          res.status(400).json({ error: `Invalid condition: ${validation.error}` });
          return;
        }
      }

      // Check workspace rule limit (max 50)
      const countResult = await query(
        `SELECT COUNT(*) as count FROM workflow_rules WHERE workspace_id = $1 AND is_active = true`,
        [workspaceId]
      );

      if (parseInt(countResult.rows[0].count) >= 50) {
        res.status(400).json({ error: 'Maximum 50 active rules per workspace' });
        return;
      }

      // Force queue mode for stage changes and amount updates
      let finalExecutionMode = execution_mode || 'queue';
      if (action_type === 'stage_change') {
        finalExecutionMode = 'queue';
      }
      if (action_type === 'crm_field_write' && action_payload?.field === 'amount') {
        finalExecutionMode = 'queue';
      }

      // Create rule
      const result = await query(
        `INSERT INTO workflow_rules
          (workspace_id, name, description, trigger_type, trigger_skill_id,
           trigger_finding_category, trigger_severity, condition_json, action_type,
           action_payload, execution_mode, scope, scope_filter, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          workspaceId,
          name,
          description || null,
          trigger_type,
          trigger_skill_id || null,
          trigger_finding_category || null,
          trigger_severity || null,
          condition_json || {},
          action_type,
          action_payload || {},
          finalExecutionMode,
          scope || 'all',
          scope_filter || {},
          userId || null,
        ]
      );

      logger.info('Workflow rule created', {
        workspace_id: workspaceId,
        rule_id: result.rows[0].id,
        name,
      });

      res.status(201).json({ rule: result.rows[0] });
    } catch (err) {
      logger.error('Failed to create workflow rule', err as Error);
      res.status(500).json({ error: 'Failed to create workflow rule' });
    }
  });

/**
 * GET /:workspaceId/workflow-rules/:ruleId
 * Get workflow rule detail
 */
router.get('/:workspaceId/workflow-rules/:ruleId',
  requirePermission('config.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, ruleId } = req.params as Record<string, string>;

      const result = await query(
        `SELECT * FROM workflow_rules WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, ruleId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }

      res.json({ rule: result.rows[0] });
    } catch (err) {
      logger.error('Failed to fetch workflow rule', err as Error);
      res.status(500).json({ error: 'Failed to fetch workflow rule' });
    }
  });

/**
 * PATCH /:workspaceId/workflow-rules/:ruleId
 * Update a workflow rule
 */
router.patch('/:workspaceId/workflow-rules/:ruleId',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, ruleId } = req.params as Record<string, string>;
      const updates = req.body;

      const allowedFields = [
        'name',
        'description',
        'trigger_skill_id',
        'trigger_finding_category',
        'trigger_severity',
        'condition_json',
        'action_payload',
        'execution_mode',
        'scope',
        'scope_filter',
        'is_active',
      ];

      const setClause: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          // Validate condition if being updated
          if (key === 'condition_json' && value) {
            const evaluator = new RuleEvaluator();
            const validation = evaluator.validateCondition(value as any);
            if (!validation.valid) {
              res.status(400).json({ error: `Invalid condition: ${validation.error}` });
              return;
            }
          }

          setClause.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setClause.length === 0) {
        res.status(400).json({ error: 'No valid fields to update' });
        return;
      }

      values.push(workspaceId, ruleId);

      const result = await query(
        `UPDATE workflow_rules
         SET ${setClause.join(', ')}
         WHERE workspace_id = $${paramIndex} AND id = $${paramIndex + 1}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }

      logger.info('Workflow rule updated', { workspace_id: workspaceId, rule_id: ruleId });
      res.json({ rule: result.rows[0] });
    } catch (err) {
      logger.error('Failed to update workflow rule', err as Error);
      res.status(500).json({ error: 'Failed to update workflow rule' });
    }
  });

/**
 * DELETE /:workspaceId/workflow-rules/:ruleId
 * Delete (soft delete) a workflow rule
 */
router.delete('/:workspaceId/workflow-rules/:ruleId',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, ruleId } = req.params as Record<string, string>;

      const result = await query(
        `UPDATE workflow_rules SET is_active = false WHERE workspace_id = $1 AND id = $2 RETURNING id`,
        [workspaceId, ruleId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }

      logger.info('Workflow rule deleted', { workspace_id: workspaceId, rule_id: ruleId });
      res.json({ success: true });
    } catch (err) {
      logger.error('Failed to delete workflow rule', err as Error);
      res.status(500).json({ error: 'Failed to delete workflow rule' });
    }
  });

/**
 * POST /:workspaceId/workflow-rules/:ruleId/run-now
 * Manually trigger a workflow rule
 */
router.post('/:workspaceId/workflow-rules/:ruleId/run-now',
  requirePermission('config.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, ruleId } = req.params as Record<string, string>;

      // TODO: Implement manual rule execution
      // This should evaluate the rule against current workspace state
      // and either execute immediately or queue actions

      res.json({ success: true, message: 'Manual rule execution not yet implemented' });
    } catch (err) {
      logger.error('Failed to run workflow rule', err as Error);
      res.status(500).json({ error: 'Failed to run workflow rule' });
    }
  });

/**
 * GET /:workspaceId/workflow-rules/:ruleId/history
 * Get execution history for a rule
 */
router.get('/:workspaceId/workflow-rules/:ruleId/history',
  requirePermission('config.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, ruleId } = req.params as Record<string, string>;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await query(
        `SELECT * FROM workflow_execution_log
         WHERE workspace_id = $1 AND workflow_rule_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [workspaceId, ruleId, limit]
      );

      res.json({ history: result.rows });
    } catch (err) {
      logger.error('Failed to fetch rule history', err as Error);
      res.status(500).json({ error: 'Failed to fetch rule history' });
    }
  });

/**
 * GET /:workspaceId/workflow-rules/pending
 * Get all pending actions waiting for approval
 */
router.get('/:workspaceId/workflow-rules/pending',
  requirePermission('data.deals_view' as any),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params as Record<string, string>;

      const result = await query(
        `SELECT a.*, wr.name as rule_name, d.name as deal_name
         FROM actions a
         LEFT JOIN workflow_rules wr ON a.workflow_rule_id = wr.id
         LEFT JOIN deals d ON a.target_deal_id = d.id
         WHERE a.workspace_id = $1
           AND a.approval_status = 'pending'
           AND a.execution_status = 'open'
         ORDER BY a.created_at DESC`,
        [workspaceId]
      );

      res.json({ pending_actions: result.rows });
    } catch (err) {
      logger.error('Failed to fetch pending actions', err as Error);
      res.status(500).json({ error: 'Failed to fetch pending actions' });
    }
  });

/**
 * POST /:workspaceId/workflow-rules/pending/:actionId/approve
 * Approve and execute a pending action
 */
router.post('/:workspaceId/workflow-rules/pending/:actionId/approve',
  requirePermission('config.edit' as any),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, actionId } = req.params as Record<string, string>;
      const userId = (req as any).user?.user_id;

      if (!userId) {
        res.status(401).json({ error: 'User ID required' });
        return;
      }

      const result = await executeActionApproval(workspaceId, actionId, userId);

      if (result.success) {
        if (result.blocked) {
          res.json({
            success: false,
            blocked: true,
            reason: result.block_reason,
          });
        } else {
          res.json({ success: true, executed: result.executed });
        }
      } else {
        res.status(result.error === 'Pending action not found or already processed' ? 404 : 500).json({
          error: result.error || 'Failed to approve action',
        });
      }
    } catch (err) {
      logger.error('Failed to approve action', err as Error);
      res.status(500).json({ error: 'Failed to approve action' });
    }
  });

/**
 * POST /:workspaceId/workflow-rules/pending/:actionId/reject
 * Reject a pending action
 */
router.post('/:workspaceId/workflow-rules/pending/:actionId/reject',
  requirePermission('config.edit' as any),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, actionId } = req.params as Record<string, string>;
      const userId = (req as any).user?.user_id;
      const { reason } = req.body;

      const result = await query(
        `UPDATE actions
         SET approval_status = 'rejected',
             execution_status = 'completed',
             rejection_reason = $1,
             rejected_by = $2,
             rejected_at = NOW()
         WHERE workspace_id = $3 AND id = $4 AND approval_status = 'pending'
         RETURNING id`,
        [reason || null, userId, workspaceId, actionId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Pending action not found' });
        return;
      }

      logger.info('Pending action rejected', {
        workspace_id: workspaceId,
        action_id: actionId,
        rejected_by: userId,
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Failed to reject action', err as Error);
      res.status(500).json({ error: 'Failed to reject action' });
    }
  });

/**
 * POST /:workspaceId/workflow-rules/pending/bulk-approve
 * Bulk approve multiple pending actions
 */
router.post('/:workspaceId/workflow-rules/pending/bulk-approve',
  requirePermission('config.edit' as any),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params as Record<string, string>;
      const userId = (req as any).user?.user_id;
      const { action_ids } = req.body;

      if (!Array.isArray(action_ids)) {
        res.status(400).json({ error: 'action_ids must be an array' });
        return;
      }

      if (action_ids.length > 100) {
        res.status(400).json({ error: 'Maximum 100 actions per bulk approval' });
        return;
      }

      let approved = 0;
      let failed = 0;

      for (const actionId of action_ids) {
        try {
          // Re-use the approve logic from single approve endpoint
          // (In production, this should be optimized with batch operations)
          const actionResult = await query(
            'SELECT * FROM actions WHERE workspace_id = $1 AND id = $2 AND approval_status = $\'pending\'',
            [workspaceId, actionId]
          );

          if (actionResult.rows.length > 0) {
            await query(
              `UPDATE actions SET approval_status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2`,
              [userId, actionId]
            );
            approved++;
          }
        } catch (error) {
          failed++;
        }
      }

      logger.info('Bulk action approval completed', {
        workspace_id: workspaceId,
        approved,
        failed,
        total: action_ids.length,
      });

      res.json({ success: true, approved, failed });
    } catch (err) {
      logger.error('Failed to bulk approve actions', err as Error);
      res.status(500).json({ error: 'Failed to bulk approve actions' });
    }
  });

export default router;
