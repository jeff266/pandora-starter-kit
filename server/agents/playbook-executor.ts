/**
 * Playbook Step Executor
 *
 * Dispatches playbook action steps to the appropriate CRM writer.
 * Each step has an action_type that maps to a specific handler.
 *
 * Supported action types:
 * - update_deal_stage: move a deal to a new pipeline stage
 * - create_follow_up_task: create a task associated with a deal
 * - update_contact_field: update a field on a contact record
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import {
  updateDeal as hsUpdateDeal,
  createTask as hsCreateTask,
  updateContactProperty as hsUpdateContact,
} from '../connectors/hubspot/hubspot-writer.js';
import {
  updateDeal as sfUpdateDeal,
  createTask as sfCreateTask,
  updateContactField as sfUpdateContactField,
} from '../connectors/salesforce/salesforce-writer.js';

const logger = createLogger('PlaybookExecutor');

export interface PlaybookStep {
  action_type: string;
  params: Record<string, any>;
}

export interface PlaybookStepResult {
  action_type: string;
  success: boolean;
  source_id: string | null;
  error?: string;
}

/**
 * Resolve which CRM a deal belongs to and get its external ID.
 */
async function resolveDealCRM(
  workspaceId: string,
  dealId: string
): Promise<{ source: string; externalId: string } | null> {
  const result = await query<{ source: string; source_id: string; external_id: string }>(
    `SELECT source, source_id, external_id FROM deals WHERE id = $1 AND workspace_id = $2`,
    [dealId, workspaceId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    source: row.source,
    externalId: row.source_id || row.external_id,
  };
}

/**
 * Resolve which CRM a contact belongs to and get its external ID.
 */
async function resolveContactCRM(
  workspaceId: string,
  contactId: string
): Promise<{ source: string; externalId: string } | null> {
  const result = await query<{ source: string; source_id: string; external_id: string }>(
    `SELECT source, source_id, external_id FROM contacts WHERE id = $1 AND workspace_id = $2`,
    [contactId, workspaceId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    source: row.source,
    externalId: row.source_id || row.external_id,
  };
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleUpdateDealStage(
  workspaceId: string,
  params: Record<string, any>,
  triggeredBy: string
): Promise<PlaybookStepResult> {
  const { deal_id, stage } = params;
  if (!deal_id || !stage) {
    return { action_type: 'update_deal_stage', success: false, source_id: null, error: 'Missing deal_id or stage' };
  }

  const crm = await resolveDealCRM(workspaceId, deal_id);
  if (!crm) {
    return { action_type: 'update_deal_stage', success: false, source_id: null, error: `Deal ${deal_id} not found` };
  }

  if (crm.source === 'hubspot') {
    const result = await hsUpdateDeal(workspaceId, crm.externalId, { dealstage: stage }, { pandoraId: deal_id, triggeredBy });
    return { action_type: 'update_deal_stage', ...result };
  } else if (crm.source === 'salesforce') {
    const result = await sfUpdateDeal(workspaceId, crm.externalId, { StageName: stage }, { pandoraId: deal_id, triggeredBy });
    return { action_type: 'update_deal_stage', ...result };
  }

  return { action_type: 'update_deal_stage', success: false, source_id: null, error: `Unsupported CRM source: ${crm.source}` };
}

async function handleCreateFollowUpTask(
  workspaceId: string,
  params: Record<string, any>,
  triggeredBy: string
): Promise<PlaybookStepResult> {
  const { deal_id, subject, body, due_date, owner_id, priority } = params;
  if (!subject) {
    return { action_type: 'create_follow_up_task', success: false, source_id: null, error: 'Missing subject' };
  }

  // If deal_id provided, resolve CRM; otherwise create in the workspace's primary CRM
  let source = params.crm_source;
  let dealExternalId: string | undefined;

  if (deal_id) {
    const crm = await resolveDealCRM(workspaceId, deal_id);
    if (!crm) {
      return { action_type: 'create_follow_up_task', success: false, source_id: null, error: `Deal ${deal_id} not found` };
    }
    source = crm.source;
    dealExternalId = crm.externalId;
  }

  if (source === 'hubspot') {
    const result = await hsCreateTask(workspaceId, {
      subject,
      body,
      dueDate: due_date,
      ownerId: owner_id,
      priority: priority?.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW' | undefined,
      associateDealId: dealExternalId,
    }, { pandoraId: deal_id, triggeredBy });
    return { action_type: 'create_follow_up_task', ...result };
  } else if (source === 'salesforce') {
    const result = await sfCreateTask(workspaceId, {
      subject,
      description: body,
      activityDate: due_date,
      ownerId: owner_id,
      priority: priority === 'high' ? 'High' : priority === 'low' ? 'Low' : 'Normal',
      whatId: dealExternalId,
    }, { pandoraId: deal_id, triggeredBy });
    return { action_type: 'create_follow_up_task', ...result };
  }

  return { action_type: 'create_follow_up_task', success: false, source_id: null, error: `Cannot determine CRM source. Provide deal_id or crm_source.` };
}

async function handleUpdateContactField(
  workspaceId: string,
  params: Record<string, any>,
  triggeredBy: string
): Promise<PlaybookStepResult> {
  const { contact_id, fields } = params;
  if (!contact_id || !fields || Object.keys(fields).length === 0) {
    return { action_type: 'update_contact_field', success: false, source_id: null, error: 'Missing contact_id or fields' };
  }

  const crm = await resolveContactCRM(workspaceId, contact_id);
  if (!crm) {
    return { action_type: 'update_contact_field', success: false, source_id: null, error: `Contact ${contact_id} not found` };
  }

  if (crm.source === 'hubspot') {
    const result = await hsUpdateContact(workspaceId, crm.externalId, fields, { pandoraId: contact_id, triggeredBy });
    return { action_type: 'update_contact_field', ...result };
  } else if (crm.source === 'salesforce') {
    const result = await sfUpdateContactField(workspaceId, crm.externalId, fields, { pandoraId: contact_id, triggeredBy });
    return { action_type: 'update_contact_field', ...result };
  }

  return { action_type: 'update_contact_field', success: false, source_id: null, error: `Unsupported CRM source: ${crm.source}` };
}

// ============================================================================
// Main Dispatcher
// ============================================================================

/**
 * Execute a single playbook step.
 * Routes to the appropriate handler based on action_type.
 */
export async function executePlaybookStep(
  workspaceId: string,
  step: PlaybookStep,
  triggeredBy: string = 'system'
): Promise<PlaybookStepResult> {
  logger.info('Executing playbook step', { workspaceId, actionType: step.action_type });

  switch (step.action_type) {
    case 'update_deal_stage':
      return handleUpdateDealStage(workspaceId, step.params, triggeredBy);

    case 'create_follow_up_task':
      return handleCreateFollowUpTask(workspaceId, step.params, triggeredBy);

    case 'update_contact_field':
      return handleUpdateContactField(workspaceId, step.params, triggeredBy);

    default:
      logger.warn('Unknown playbook action type', { actionType: step.action_type });
      return {
        action_type: step.action_type,
        success: false,
        source_id: null,
        error: `Unknown action type: ${step.action_type}`,
      };
  }
}

/**
 * Execute a sequence of playbook steps.
 * Stops on first failure unless continueOnError is true.
 */
export async function executePlaybook(
  workspaceId: string,
  steps: PlaybookStep[],
  opts?: { triggeredBy?: string; continueOnError?: boolean }
): Promise<PlaybookStepResult[]> {
  const results: PlaybookStepResult[] = [];
  const triggeredBy = opts?.triggeredBy ?? 'system';

  for (const step of steps) {
    const result = await executePlaybookStep(workspaceId, step, triggeredBy);
    results.push(result);

    if (!result.success && !opts?.continueOnError) {
      logger.warn('Playbook halted on failure', { actionType: step.action_type, error: result.error });
      break;
    }
  }

  return results;
}
