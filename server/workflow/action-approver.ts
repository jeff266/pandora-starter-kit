import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { ActionExecutor } from './action-executor.js';

const INTERNAL_ACTION_TYPES = [
  'update_data_dictionary',
  'update_workspace_knowledge',
  'confirm_metric_definition',
  'update_calibration',
] as const;

type InternalActionType = typeof INTERNAL_ACTION_TYPES[number];

export async function approveInternalAction(
  action: Record<string, any>,
  workspaceId: string
): Promise<{ success: boolean; message: string }> {
  const payload = typeof action.execution_payload === 'string'
    ? JSON.parse(action.execution_payload || '{}')
    : (action.execution_payload || {});

  switch (action.action_type as InternalActionType) {
    case 'update_data_dictionary': {
      const { term, definition, sql_definition, source, confidence } = payload;
      if (!term) return { success: false, message: 'Missing term in payload' };
      await query(
        `INSERT INTO data_dictionary
           (workspace_id, term, definition, sql_definition, source, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
         ON CONFLICT (workspace_id, term)
         DO UPDATE SET
           definition     = COALESCE(EXCLUDED.definition, data_dictionary.definition),
           sql_definition = COALESCE(EXCLUDED.sql_definition, data_dictionary.sql_definition),
           source         = EXCLUDED.source,
           is_active      = TRUE,
           updated_at     = NOW()`,
        [workspaceId, term, definition || null, sql_definition || null, source || 'computed']
      );
      return { success: true, message: `Updated "${term}" in Data Dictionary` };
    }

    case 'update_workspace_knowledge': {
      const { key, value, source, confidence } = payload;
      if (!key || !value) return { success: false, message: 'Missing key or value in payload' };
      await query(
        `INSERT INTO workspace_knowledge
           (workspace_id, key, value, source, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (workspace_id, key)
         DO UPDATE SET
           value        = EXCLUDED.value,
           confidence   = LEAST(workspace_knowledge.confidence + 0.05, 1.0),
           last_used_at = NOW(),
           used_count   = workspace_knowledge.used_count + 1`,
        [workspaceId, key, value, source || 'conversation', confidence ?? 0.7]
      );
      return { success: true, message: `Saved "${key}" to workspace knowledge` };
    }

    case 'confirm_metric_definition': {
      const { metric_key, value, unit, methodology, calibration_source } = payload;
      if (!metric_key) return { success: false, message: 'Missing metric_key in payload' };
      await query(
        `INSERT INTO metric_definitions
           (workspace_id, metric_key, label, unit, description, calibration_source,
            formula, confirmed, confirmed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, TRUE, NOW(), NOW())
         ON CONFLICT (workspace_id, metric_key)
         DO UPDATE SET
           unit               = COALESCE(EXCLUDED.unit, metric_definitions.unit),
           description        = COALESCE(EXCLUDED.description, metric_definitions.description),
           calibration_source = EXCLUDED.calibration_source,
           confirmed          = TRUE,
           confirmed_at       = NOW(),
           updated_at         = NOW()`,
        [
          workspaceId,
          metric_key,
          metric_key.replace(/_/g, ' '),
          unit || null,
          methodology || null,
          calibration_source || 'confirmed',
        ]
      );
      return { success: true, message: `Confirmed ${metric_key}${value != null ? `: ${value}` : ''}` };
    }

    case 'update_calibration': {
      const { dimension_key, filter_definition, description } = payload;
      if (!dimension_key) return { success: false, message: 'Missing dimension_key in payload' };
      await query(
        `UPDATE business_dimensions
         SET filter_definition = COALESCE($1::jsonb, filter_definition),
             description       = COALESCE($2, description),
             confirmed         = TRUE,
             updated_at        = NOW()
         WHERE workspace_id  = $3
           AND dimension_key = $4`,
        [
          filter_definition ? JSON.stringify(filter_definition) : null,
          description || null,
          workspaceId,
          dimension_key,
        ]
      );
      return { success: true, message: `Updated ${dimension_key} definition` };
    }

    default:
      return { success: false, message: 'Unknown internal action type' };
  }
}

const logger = createLogger('ActionApprover');

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
              wr.action_type as rule_action_type,
              wr.action_payload as rule_action_payload,
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
    const rawPayload = action.execution_payload;
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload || '{}')
      : (rawPayload || {});

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

    // Route internal action types before CRM executor
    if ((INTERNAL_ACTION_TYPES as readonly string[]).includes(action.action_type)) {
      const internalResult = await approveInternalAction(action, workspaceId);
      if (!internalResult.success) {
        await query(
          `UPDATE actions SET approval_status = 'failed', block_reason = $1, updated_at = NOW() WHERE id = $2`,
          [internalResult.message, actionId]
        );
        return { success: false, action_id: actionId, executed: false, error: internalResult.message };
      }
      await query(
        `UPDATE actions SET approval_status = 'approved', approved_at = NOW(), approved_by = $1, updated_at = NOW() WHERE id = $2`,
        [userId, actionId]
      );
      logger.info('Internal action approved', { workspace_id: workspaceId, action_id: actionId, action_type: action.action_type });
      return { success: true, action_id: actionId, executed: true };
    }

    // Execute action via ActionExecutor
    const executor = new ActionExecutor();
    const context: any = {
      deal: action.target_deal_id
        ? (await query(
            `SELECT *,
                    source_id AS crm_id,
                    source AS crm_type,
                    owner AS hubspot_owner_id
             FROM deals WHERE id = $1`,
            [action.target_deal_id]
          )).rows[0]
        : null,
      trigger: payload.context?.trigger,
      user_id: userId,
    };

    const rule: any = {
      id: action.workflow_rule_id,
      workspace_id: workspaceId,
      name: action.rule_name,
      action_type: action.rule_action_type || action.action_type,
      action_payload: payload.action_payload || action.rule_action_payload || {},
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
