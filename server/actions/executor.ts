/**
 * CRM Write-Back Execution Handler
 *
 * Routes action types to CRM write operations.
 * Handles: resolve credentials → map fields → execute write → create audit note → update action status.
 */

import type { Pool } from 'pg';
import { getCredentials } from '../connectors/adapters/credentials.js';
import { HubSpotClient } from '../connectors/hubspot/client.js';
import { SalesforceClient } from '../connectors/salesforce/client.js';
import { mapFieldsToHubSpot } from '../connectors/hubspot/field-map.js';
import { mapFieldsToSalesforce } from '../connectors/salesforce/field-map.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { query as dbQuery } from '../db.js';

import { judgeAction } from './judgment.js';

export interface ExecutionRequest {
  actionId: string;
  workspaceId: string;
  actor: string;         // user email or 'system'
  dryRun?: boolean;      // if true, validate but don't write
  bypassJudgment?: boolean; // if true, skip judgment (used for user-triggered execution)
}

export interface ExecutionResult {
  success: boolean;
  dry_run: boolean;
  operations: Array<{
    type: 'crm_update' | 'crm_note' | 'crm_task' | 'slack_notify';
    target: string;
    result: any;
    error?: string;
  }>;
  error?: string;
}

interface OperationPlan {
  type: string;
  target: string;
  payload: any;
}

/**
 * Execute an action: validate, perform CRM writes, create audit notes, update action status
 */
export async function executeAction(
  db: Pool,
  request: ExecutionRequest
): Promise<ExecutionResult> {
  const { actionId, workspaceId, actor, dryRun = false } = request;

  // 1. Load the action
  const actionResult = await db.query(
    `SELECT * FROM actions WHERE id = $1 AND workspace_id = $2`,
    [actionId, workspaceId]
  );

  if (actionResult.rows.length === 0) {
    return { success: false, dry_run: dryRun, operations: [], error: 'Action not found' };
  }

  const action = actionResult.rows[0];

  // 2. Judge the action if not bypassed
  if (!request.bypassJudgment && actor === 'system') {
    const judgment = await judgeAction({
      workspace_id: workspaceId,
      action_type: action.action_type,
      severity: action.severity,
      target: action.target_entity_name,
      record_count: action.execution_payload?.record_count,
      recommendation: action.summary,
      deal_context: action.context,
      recipient_name: action.execution_payload?.recipient_name,
    });

    if (judgment.mode !== 'autonomous') {
      return {
        success: false,
        dry_run: dryRun,
        operations: [],
        error: `Action requires ${judgment.mode}: ${judgment.reason}`,
      };
    }
  }

  // 3. Verify action is executable
  if (!['open', 'in_progress'].includes(action.execution_status)) {
    return {
      success: false,
      dry_run: dryRun,
      operations: [],
      error: `Action is ${action.execution_status}, not executable`,
    };
  }

  // 3. Resolve target deal and CRM source
  const deal = action.target_deal_id
    ? (await db.query(`SELECT * FROM deals WHERE id = $1`, [action.target_deal_id])).rows[0]
    : null;

  if (!deal && needsCRMWrite(action.action_type)) {
    return { success: false, dry_run: dryRun, operations: [], error: 'Target deal not found' };
  }

  const crmSource = deal?.source; // 'hubspot' or 'salesforce'
  const externalId = deal?.source_id || deal?.external_id;

  if (!externalId && needsCRMWrite(action.action_type)) {
    return {
      success: false,
      dry_run: dryRun,
      operations: [],
      error: 'Deal has no external CRM ID — cannot write back',
    };
  }

  // 4. Build operations list from execution_payload and action_type
  const operations = buildOperations(action, deal, crmSource, externalId);

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      operations: operations.map(op => ({ ...op, result: 'DRY RUN — would execute' })) as any,
    };
  }

  // 5. Execute each operation
  const results: ExecutionResult['operations'] = [];

  for (const op of operations) {
    try {
      const result = await executeOperation(db, workspaceId, op, crmSource);
      results.push({ ...op, result } as any);
    } catch (err) {
      results.push({ ...op, result: null, error: (err as Error).message } as any);
    }
  }

  const allSucceeded = results.every(r => !r.error);

  // 6. Update action status
  if (allSucceeded) {
    await db.query(`
      UPDATE actions SET
        execution_status = 'executed',
        executed_at = now(),
        executed_by = $3,
        execution_result = $4,
        updated_at = now()
      WHERE id = $1 AND workspace_id = $2
    `, [actionId, workspaceId, actor, JSON.stringify(results)]);
    import('../webhooks/action-events.js')
      .then(m => m.emitActionCompletedEvent(workspaceId, action, actor))
      .catch(() => {});
  } else {
    // Partial failure — log results but keep action open/in_progress
    await db.query(`
      UPDATE actions SET
        execution_result = $3,
        updated_at = now()
      WHERE id = $1 AND workspace_id = $2
    `, [actionId, workspaceId, JSON.stringify(results)]);
  }

  // 7. Audit log
  await db.query(`
    INSERT INTO action_audit_log
      (workspace_id, action_id, event_type, actor, from_status, to_status, details)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    workspaceId,
    actionId,
    allSucceeded ? 'executed' : 'execution_partial_failure',
    actor,
    action.execution_status,
    allSucceeded ? 'executed' : action.execution_status,
    JSON.stringify({ operations: results }),
  ]);

  return { success: allSucceeded, dry_run: false, operations: results };
}

/**
 * Determine if this action type requires CRM write operations
 */
function needsCRMWrite(actionType: string): boolean {
  return [
    'update_close_date',
    'close_stale_deal',
    'update_deal_stage',
    'clean_data',
    'update_forecast',
    're_engage_deal',
  ].includes(actionType);
}

/**
 * Build operation plan from action data
 */
function buildOperations(
  action: any,
  deal: any,
  crmSource: string,
  externalId: string
): OperationPlan[] {
  const ops: OperationPlan[] = [];
  const payload = action.execution_payload || {};

  // CRM field updates from execution_payload
  if (payload.crm_updates && Array.isArray(payload.crm_updates)) {
    const fieldUpdates: Record<string, any> = {};
    for (const update of payload.crm_updates) {
      fieldUpdates[update.field] = update.proposed_value;
    }

    if (Object.keys(fieldUpdates).length > 0) {
      ops.push({
        type: 'crm_update',
        target: `${crmSource}:${externalId}`,
        payload: { fields: fieldUpdates, crmSource, externalId },
      });
    }
  }

  // Action-type-specific operations
  switch (action.action_type) {
    case 'close_stale_deal':
      // If not already in the field updates, add stage change
      if (!payload.crm_updates?.some((u: any) => u.field === 'stage')) {
        ops.push({
          type: 'crm_update',
          target: `${crmSource}:${externalId}`,
          payload: {
            fields: { stage: 'closed_lost' },
            crmSource,
            externalId,
          },
        });
      }
      break;

    case 'assign_to_rep':
      // Log a CRM note on the deal record (PM tool integration is future work)
      if (externalId && crmSource) {
        const noteBody = [
          `Task: ${payload.task_title || action.title}`,
          payload.task_note ? `Note: ${payload.task_note}` : '',
          payload.assignee_email ? `Assigned to: ${payload.assignee_email}` : '',
          payload.due_date ? `Due: ${payload.due_date}` : '',
          '',
          `Source: Pandora concierge`,
          `Created: ${new Date().toISOString()}`,
        ].filter(Boolean).join('\n');

        ops.push({
          type: 'crm_note',
          target: `${crmSource}:${externalId}`,
          payload: {
            crmSource,
            externalId,
            title: `Pandora Task: ${payload.task_title || action.title}`,
            body: noteBody,
          },
        });
      }
      // If no CRM connection, the action record itself is the audit trail
      return ops;
  }

  if (action.action_type === 'notify_rep' || action.action_type === 'notify_manager') {
    ops.push({
      type: 'slack_notify',
      target: action.target_deal_id || action.target_account_id || 'unknown',
      payload: {
        workspaceId: action.workspace_id,
        ownerEmail: deal?.owner || action.execution_payload?.owner_email,
        targetUserId: action.execution_payload?.slack_user_id,
        title: action.title,
        summary: action.summary,
        severity: action.severity,
        dealName: deal?.name,
        dealAmount: deal?.amount,
        skillId: action.source_skill,
      },
    });
    return ops;
  }

  if (externalId && crmSource) {
    ops.push({
      type: 'crm_note',
      target: `${crmSource}:${externalId}`,
      payload: {
        crmSource,
        externalId,
        title: `Pandora Action: ${action.title}`,
        body: buildAuditNoteBody(action),
      },
    });
  }

  return ops;
}

/**
 * Execute a single operation (CRM update or note creation)
 */
async function executeOperation(
  db: Pool,
  workspaceId: string,
  op: OperationPlan,
  crmSource: string
): Promise<any> {
  // Get CRM client for this workspace
  const client = await getCRMClient(db, workspaceId, crmSource);

  switch (op.type) {
    case 'crm_update': {
      const { fields, externalId } = op.payload;

      if (crmSource === 'hubspot') {
        const mapped = mapFieldsToHubSpot(fields);
        return client.updateDeal(externalId, mapped);
      } else if (crmSource === 'salesforce') {
        const mapped = mapFieldsToSalesforce(fields);
        return client.updateOpportunity(externalId, mapped);
      }
      throw new Error(`Unsupported CRM source: ${crmSource}`);
    }

    case 'crm_note': {
      const { externalId, title, body } = op.payload;

      if (crmSource === 'hubspot') {
        return client.addDealNote(externalId, body);
      } else if (crmSource === 'salesforce') {
        return client.addOpportunityNote(externalId, title, body);
      }
      throw new Error(`Unsupported CRM source: ${crmSource}`);
    }

    case 'slack_notify': {
      const { workspaceId: wsId, ownerEmail, targetUserId, title, summary, severity, dealName, dealAmount, skillId } = op.payload;
      const slackClient = getSlackAppClient();

      let slackUserId = targetUserId;
      if (!slackUserId && ownerEmail) {
        const lookup = await slackClient.lookupUserByEmail(wsId, ownerEmail);
        if (lookup.ok && lookup.userId) {
          slackUserId = lookup.userId;
        } else {
          console.warn(`[executor] Could not find Slack user for email ${ownerEmail}: ${lookup.error}`);
        }
      }

      if (!slackUserId) {
        console.warn(`[executor] Skipping DM: no Slack user found for email ${ownerEmail || 'none'}`);
        return { skipped: true, reason: `No Slack user found for ${ownerEmail || 'unknown email'}` };
      }

      const severityIcon = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🔵';
      const amountStr = dealAmount ? ` • $${Number(dealAmount).toLocaleString()}` : '';

      const blocks: any[] = [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${severityIcon} Action Required`, emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${title}*${dealName ? `\n📋 Deal: *${dealName}*${amountStr}` : ''}`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: summary.slice(0, 2900) },
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `_From Pandora ${skillId || 'analysis'} • ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}_`,
          }],
        },
      ];

      const dmResult = await slackClient.sendDirectMessage(wsId, slackUserId, blocks, `${severityIcon} ${title}`);
      if (!dmResult.ok) {
        throw new Error(`DM failed: ${dmResult.error}`);
      }
      return { sent_to: slackUserId, channel: dmResult.channel, ts: dmResult.ts };
    }

    case 'crm_task': {
      const { externalId, title, body, dueDateMs } = op.payload;

      if (crmSource === 'hubspot') {
        return client.createDealTask(externalId, title, body ?? '', dueDateMs);
      } else if (crmSource === 'salesforce') {
        throw new Error('Salesforce task creation not yet supported');
      }
      throw new Error(`Unsupported CRM source: ${crmSource}`);
    }

    default:
      throw new Error(`Unknown operation type: ${op.type}`);
  }
}

/**
 * Build audit note body for CRM record
 */
function buildAuditNoteBody(action: any): string {
  const lines: string[] = [
    `Action: ${action.title}`,
    `Type: ${action.action_type}`,
    `Severity: ${action.severity}`,
    '',
  ];

  if (action.summary) {
    lines.push(action.summary, '');
  }

  if (action.recommended_steps?.length > 0) {
    lines.push('Recommended steps:');
    const steps = Array.isArray(action.recommended_steps)
      ? action.recommended_steps
      : [];
    steps.forEach((step: any, i: number) => {
      const text = typeof step === 'string' ? step : step.text || step;
      lines.push(`${i + 1}. ${text}`);
    });
    lines.push('');
  }

  const payload = action.execution_payload || {};
  if (payload.crm_updates?.length > 0) {
    lines.push('Changes applied:');
    for (const update of payload.crm_updates) {
      lines.push(
        `• ${update.field}: ${update.current_value || '(unknown)'} → ${update.proposed_value}`
      );
    }
    lines.push('');
  }

  lines.push(
    `Source: Pandora ${action.source_skill} skill`,
    `Executed: ${new Date().toISOString()}`,
    `Executed by: ${action.executed_by || 'system'}`,
  );

  return lines.join('\n');
}

/**
 * Get or create a CRM client for a workspace.
 * Handles credential loading and instantiation.
 */
async function getCRMClient(db: Pool, workspaceId: string, crmSource: string): Promise<any> {
  // Load connector credentials
  const connection = await getCredentials(workspaceId, crmSource);

  if (!connection) {
    throw new Error(`No ${crmSource} connector configured for workspace ${workspaceId}`);
  }

  const credentials = connection.credentials;

  if (connection.status === 'auth_expired') {
    throw new Error(`${crmSource} authorization has expired. Please reconnect.`);
  }

  if (crmSource === 'hubspot') {
    return new HubSpotClient(credentials.access_token || credentials.accessToken, workspaceId);
  } else if (crmSource === 'salesforce') {
    return new SalesforceClient({
      accessToken: credentials.access_token || credentials.accessToken,
      instanceUrl: credentials.instance_url || credentials.instanceUrl,
      apiVersion: 'v62.0',
    });
  }

  throw new Error(`Unsupported CRM source: ${crmSource}`);
}
