/**
 * Action Judgment Layer
 *
 * Determines the execution mode for actions:
 * - autonomous: execute immediately (low risk, high confidence)
 * - approval: user must confirm (standard risk)
 * - escalate: user must decide between scenarios (high risk/complexity)
 */

export type ActionExecutionMode = 'autonomous' | 'approval' | 'escalate';

export interface ActionJudgment {
  mode: ActionExecutionMode;
  reason: string;
  approvalPrompt?: string;
  escalationReason?: string;
}

export interface ActionInput {
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  target?: string;
  record_count?: number;
  field?: string;
  duration_days?: number;
}

/**
 * Judge an action based on type, severity, and context
 */
export function judgeAction(action: ActionInput): ActionJudgment {
  const { action_type, severity } = action;

  // 1. Escalation Rules (High Risk/Strategic)
  if (
    action_type === 'ops_territory_planning' ||
    action_type === 'ops_gtm_strategy' ||
    (action_type === 'escalate_deal' && severity === 'critical')
  ) {
    return {
      mode: 'escalate',
      reason: 'Strategic impact requires human trade-off analysis',
      escalationReason: `This ${action_type.replace(/_/g, ' ')} affects organizational structure or strategy.`,
    };
  }

  // 2. Approval Rules (Standard CRM Writes / Communication)
  // Most rep-facing actions that modify CRM or send messages should be approved
  const requiresApproval = [
    're_engage_deal',
    'close_stale_deal',
    'update_close_date',
    'update_deal_stage',
    'notify_rep',
    'notify_manager',
    'ops_process_fix',
    'ops_system_config',
  ].includes(action_type);

  if (requiresApproval || severity === 'critical') {
    return {
      mode: 'approval',
      reason: severity === 'critical' ? 'Critical severity requires verification' : 'CRM write-back or notification requires approval',
      approvalPrompt: `Confirm ${action_type.replace(/_/g, ' ')}?`,
    };
  }

  // 3. Autonomous Rules (Low Risk / Data Cleanup)
  // Simple data cleanup or info-level tasks
  if (
    action_type === 'ops_data_cleanup' ||
    (action_type === 'clean_data' && severity !== 'critical') ||
    severity === 'info'
  ) {
    return {
      mode: 'autonomous',
      reason: 'Low-risk data maintenance',
    };
  }

  // Default to approval for safety
  return {
    mode: 'approval',
    reason: 'Defaulting to approval for safety',
    approvalPrompt: 'Please review and approve this action.',
  };
}
