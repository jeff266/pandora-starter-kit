import { query } from '../db.js';
import { logger } from '../logger.js';
import { ActionExecutor } from './action-executor.js';

export interface ActionApprovalResult {
  success: boolean;
  action_id: string;
  executed: boolean;
  blocked?: boolean;
  block_reason?: string;
  error?: string;
}

/**
 * Execute approval of a pending action.
 * This function re-checks threshold policy, executes the action via ActionExecutor,
 * and updates the action status in the database.
 *
 * Shared between route handler and Ask Pandora tool implementation.
 */
export async function executeActionApproval(
  workspaceId: string,
  actionId: string,
  userId: string
): Promise<ActionApprovalResult> {
  try {
    // Get action details with threshold settings
    const actionResult = await query(
      `SELECT a.*,
              wr.name as rule_name,
              wr.action_type,
              wr.action_payload,
              wr.execution_mode,
              d.name as deal_name,
              d.id as deal_id,
              was.action_threshold as current_threshold,
              was.protected_stages,
              was.protected_fields
       FROM actions a
       LEFT JOIN workflow_rules wr ON a.workflow_rule_id = wr.id
       LEFT JOIN deals d ON a.target_deal_id = d.id
       LEFT JOIN workspace_action_settings was ON was.workspace_id = a.workspace_id
       WHERE a.id = $1 AND a.workspace_id = $2 AND a.approval_status = 'pending'`,
      [actionId, workspaceId]
    );

    if (actionResult.rows.length === 0) {
      return {
        success: false,
        action_id: actionId,
        executed: false,
        error: 'Pending action not found or already processed',
      };
    }

    const action = actionResult.rows[0];
    const payload = JSON.parse(action.execution_payload || '{}');

    // Re-check threshold policy (may have changed since action was queued)
    const currentThreshold = action.current_threshold || 'medium';
    const protectedStages = action.protected_stages || [];
    const protectedFields = action.protected_fields || [];

    // Check if deal is in protected stage
    if (action.target_deal_id) {
      const dealResult = await query(
        `SELECT stage FROM deals WHERE id = $1`,
        [action.target_deal_id]
      );
      if (dealResult.rows.length > 0) {
        const dealStage = dealResult.rows[0].stage;
        if (protectedStages.includes(dealStage)) {
          await query(
            `UPDATE actions
             SET approval_status = 'blocked',
                 block_reason = 'Deal stage is protected',
                 updated_at = NOW()
             WHERE id = $1`,
            [actionId]
          );
          return {
            success: true,
            action_id: actionId,
            executed: false,
            blocked: true,
            block_reason: `Deal stage "${dealStage}" is protected - cannot execute`,
          };
        }
      }
    }

    // Check if field is protected (for field write actions)
    if (action.action_type === 'write_crm_field' && payload.field) {
      if (protectedFields.includes(payload.field)) {
        await query(
          `UPDATE actions
           SET approval_status = 'blocked',
               block_reason = 'Field is protected',
               updated_at = NOW()
           WHERE id = $1`,
          [actionId]
        );
        return {
          success: true,
          action_id: actionId,
          executed: false,
          blocked: true,
          block_reason: `Field "${payload.field}" is protected - cannot execute`,
        };
      }
    }

    // Execute action via ActionExecutor
    const executor = new ActionExecutor();
    const context: any = {
      deal: action.target_deal_id
        ? (await query('SELECT * FROM deals WHERE id = $1', [action.target_deal_id])).rows[0]
        : null,
      trigger: payload.context?.trigger,
      user_id: userId,
    };

    const rule: any = {
      id: action.workflow_rule_id,
      workspace_id: workspaceId,
      name: action.rule_name,
      action_type: action.action_type,
      action_payload: payload.action_payload || action.action_payload || {},
      execution_mode: action.execution_mode || 'auto',
    };

    const result = await executor.execute(rule, context);

    // Mark action as approved and executed
    await query(
      `UPDATE actions
       SET approval_status = 'approved',
           approved_at = NOW(),
           approved_by = $1,
           execution_result = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [userId, JSON.stringify(result), actionId]
    );

    logger.info('Action approved and executed', {
      workspace_id: workspaceId,
      action_id: actionId,
      action_type: action.action_type,
      approved_by: userId,
    });

    return {
      success: true,
      action_id: actionId,
      executed: true,
    };
  } catch (error: any) {
    logger.error('Failed to execute action approval', {
      workspace_id: workspaceId,
      action_id: actionId,
      error: error.message,
    });

    // Mark action as failed
    await query(
      `UPDATE actions
       SET approval_status = 'failed',
           block_reason = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [error.message, actionId]
    );

    return {
      success: false,
      action_id: actionId,
      executed: false,
      error: error.message,
    };
  }
}
