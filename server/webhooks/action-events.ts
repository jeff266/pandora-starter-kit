/**
 * Action Webhook Event Emitters
 *
 * Emits three event types:
 *
 * action.created
 * --------------
 * Fires after a skill run (pipeline-hygiene, deal-risk-review, etc.) generates
 * recommended actions. Each action is a structured, AI-generated recommendation
 * tied to a specific deal or account — e.g. "Re-engage Acme Corp immediately",
 * "Schedule exec sponsor meeting", "Update close date to reflect true timing".
 * Useful for auto-creating CRM tasks, routing actions to specific reps, or
 * syncing into project-management tools.
 *
 * action.completed
 * ----------------
 * Fires when a rep or automation marks an action as executed (either manually
 * via the UI or via the CRM write-back engine). Closes the loop for downstream
 * rep-responsiveness tracking — e.g. measure time-to-action per rep or auto-
 * update a BI dashboard when a CRM field was actually written.
 *
 * action.expired
 * --------------
 * Fires (hourly batch) when an action passes its expires_at timestamp without
 * being executed or dismissed. Useful for escalation workflows — e.g. "AE
 * ignored a critical action for 7 days → notify their manager in Slack".
 */

import crypto from 'node:crypto';
import { query } from '../db.js';
import { deliverWithRetry, type WebhookEvent } from './delivery.js';

async function getActiveEndpoints(workspaceId: string, eventType: string) {
  const result = await query<{ id: string; url: string; secret: string }>(
    `SELECT id, url, secret
     FROM webhook_endpoints
     WHERE workspace_id = $1
       AND enabled = true
       AND (event_types IS NULL OR $2 = ANY(event_types))`,
    [workspaceId, eventType]
  );
  return result.rows;
}

async function getWorkspaceName(workspaceId: string): Promise<string> {
  const result = await query<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  return result.rows[0]?.name ?? 'Unknown';
}

/**
 * Emit action.created for all actions just inserted by a skill run.
 * Queries by source_run_id + source_skill to pick up the newly created rows
 * without modifying the insertExtractedActions return type.
 *
 * Example payload:
 * {
 *   "event": "action.created",
 *   "event_id": "evt_ac_c3d4e5...",
 *   "timestamp": "2026-03-05T07:05:15.000Z",
 *   "workspace_id": "4160191d-...",
 *   "api_version": "2026-03-01",
 *   "data": {
 *     "workspace_name": "Frontera Health",
 *     "action": {
 *       "id": "a1b2c3d4-...",
 *       "action_type": "re_engage_deal",
 *       "severity": "critical",
 *       "title": "Re-engage Frontera Health – Enterprise immediately",
 *       "summary": "No activity logged in 34 days. Deal is drifting.",
 *       "recommended_steps": [
 *         "Send a personal video message to the economic buyer",
 *         "Loop in your exec sponsor for a brief check-in"
 *       ],
 *       "target_deal_id": "d9e8f7a6-...",
 *       "target_entity_name": "Frontera Health – Enterprise",
 *       "owner_email": "alex@frontera.com",
 *       "impact_amount": 185000,
 *       "urgency_label": "34 days stale",
 *       "source_skill": "pipeline-hygiene",
 *       "expires_at": "2026-03-12T07:05:15.000Z"
 *     }
 *   }
 * }
 */
export async function emitActionCreatedEvents(
  workspaceId: string,
  skillId: string,
  runId: string
): Promise<void> {
  const actionsResult = await query<{
    id: string;
    action_type: string;
    severity: string;
    title: string;
    summary: string | null;
    recommended_steps: string | null;
    target_deal_id: string | null;
    target_account_id: string | null;
    target_entity_name: string | null;
    owner_email: string | null;
    impact_amount: number | null;
    urgency_label: string | null;
    source_skill: string;
    expires_at: string | null;
    created_at: string;
  }>(
    `SELECT id, action_type, severity, title, summary, recommended_steps,
            target_deal_id, target_account_id, target_entity_name,
            owner_email, impact_amount, urgency_label,
            source_skill, expires_at, created_at
     FROM actions
     WHERE workspace_id = $1
       AND source_run_id = $2
       AND source_skill = $3
       AND execution_status = 'open'`,
    [workspaceId, runId, skillId]
  );

  if (actionsResult.rows.length === 0) return;

  const endpoints = await getActiveEndpoints(workspaceId, 'action.created');
  if (endpoints.length === 0) return;

  const workspaceName = await getWorkspaceName(workspaceId);

  for (const action of actionsResult.rows) {
    const event: WebhookEvent = {
      event: 'action.created',
      event_id: `evt_ac_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      workspace_id: workspaceId,
      api_version: '2026-03-01',
      data: {
        workspace_name: workspaceName,
        action: {
          id: action.id,
          action_type: action.action_type,
          severity: action.severity,
          title: action.title,
          summary: action.summary,
          recommended_steps: action.recommended_steps
            ? JSON.parse(action.recommended_steps)
            : null,
          target_deal_id: action.target_deal_id,
          target_account_id: action.target_account_id,
          target_entity_name: action.target_entity_name,
          owner_email: action.owner_email,
          impact_amount: action.impact_amount,
          urgency_label: action.urgency_label,
          source_skill: action.source_skill,
          expires_at: action.expires_at,
          created_at: action.created_at,
        },
      },
    };
    for (const endpoint of endpoints) {
      deliverWithRetry(endpoint, event).catch(() => {});
    }
  }
}

/**
 * Emit action.completed when a rep or the CRM write-back engine marks an
 * action as executed. Called from executeAction in executor.ts after the
 * status UPDATE succeeds.
 *
 * Example payload:
 * {
 *   "event": "action.completed",
 *   "event_id": "evt_acp_d4e5f6...",
 *   "timestamp": "2026-03-05T14:22:08.000Z",
 *   "workspace_id": "4160191d-...",
 *   "api_version": "2026-03-01",
 *   "data": {
 *     "workspace_name": "Frontera Health",
 *     "action": {
 *       "id": "a1b2c3d4-...",
 *       "action_type": "re_engage_deal",
 *       "severity": "critical",
 *       "title": "Re-engage Frontera Health – Enterprise immediately",
 *       "target_deal_id": "d9e8f7a6-...",
 *       "target_entity_name": "Frontera Health – Enterprise",
 *       "owner_email": "alex@frontera.com",
 *       "impact_amount": 185000,
 *       "source_skill": "pipeline-hygiene",
 *       "executed_by": "alex@frontera.com",
 *       "executed_at": "2026-03-05T14:22:08.000Z"
 *     }
 *   }
 * }
 */
export async function emitActionCompletedEvent(
  workspaceId: string,
  action: Record<string, any>,
  actor: string
): Promise<void> {
  const endpoints = await getActiveEndpoints(workspaceId, 'action.completed');
  if (endpoints.length === 0) return;

  const workspaceName = await getWorkspaceName(workspaceId);
  const now = new Date().toISOString();

  const event: WebhookEvent = {
    event: 'action.completed',
    event_id: `evt_acp_${crypto.randomUUID()}`,
    timestamp: now,
    workspace_id: workspaceId,
    api_version: '2026-03-01',
    data: {
      workspace_name: workspaceName,
      action: {
        id: action.id,
        action_type: action.action_type,
        severity: action.severity,
        title: action.title,
        target_deal_id: action.target_deal_id ?? null,
        target_account_id: action.target_account_id ?? null,
        target_entity_name: action.target_entity_name ?? null,
        owner_email: action.owner_email ?? null,
        impact_amount: action.impact_amount ?? null,
        source_skill: action.source_skill,
        executed_by: actor,
        executed_at: now,
      },
    },
  };

  for (const endpoint of endpoints) {
    deliverWithRetry(endpoint, event).catch(() => {});
  }
}

/**
 * Emit action.expired for all actions that just crossed their expires_at
 * deadline. Called from the hourly expiry scheduler after the batch UPDATE.
 * Groups by workspace so we do one workspace-name lookup per workspace, not
 * one per expired row.
 *
 * Example payload:
 * {
 *   "event": "action.expired",
 *   "event_id": "evt_aex_e5f6a7...",
 *   "timestamp": "2026-03-05T06:00:00.000Z",
 *   "workspace_id": "4160191d-...",
 *   "api_version": "2026-03-01",
 *   "data": {
 *     "workspace_name": "Frontera Health",
 *     "action": {
 *       "id": "a1b2c3d4-...",
 *       "action_type": "re_engage_deal",
 *       "severity": "critical",
 *       "title": "Re-engage Frontera Health – Enterprise immediately",
 *       "target_deal_id": "d9e8f7a6-...",
 *       "target_entity_name": "Frontera Health – Enterprise",
 *       "owner_email": "alex@frontera.com",
 *       "source_skill": "pipeline-hygiene",
 *       "expired_at": "2026-03-05T06:00:00.000Z",
 *       "days_open": 7
 *     }
 *   }
 * }
 */
export async function emitActionExpiredEvents(
  expiredRows: { id: string; workspace_id: string }[]
): Promise<void> {
  if (expiredRows.length === 0) return;

  // Group by workspace
  const byWorkspace = new Map<string, string[]>();
  for (const row of expiredRows) {
    const ids = byWorkspace.get(row.workspace_id) ?? [];
    ids.push(row.id);
    byWorkspace.set(row.workspace_id, ids);
  }

  const now = new Date().toISOString();

  for (const [workspaceId, actionIds] of byWorkspace) {
    const endpoints = await getActiveEndpoints(workspaceId, 'action.expired');
    if (endpoints.length === 0) continue;

    const actionsResult = await query<{
      id: string;
      action_type: string;
      severity: string;
      title: string;
      target_deal_id: string | null;
      target_account_id: string | null;
      target_entity_name: string | null;
      owner_email: string | null;
      impact_amount: number | null;
      source_skill: string;
      created_at: string;
      expires_at: string | null;
    }>(
      `SELECT id, action_type, severity, title,
              target_deal_id, target_account_id, target_entity_name,
              owner_email, impact_amount, source_skill, created_at, expires_at
       FROM actions
       WHERE id = ANY($1) AND workspace_id = $2`,
      [actionIds, workspaceId]
    );

    if (actionsResult.rows.length === 0) continue;

    const workspaceName = await getWorkspaceName(workspaceId);

    for (const action of actionsResult.rows) {
      const daysOpen = action.created_at
        ? Math.floor(
            (new Date(now).getTime() - new Date(action.created_at).getTime()) /
            86_400_000
          )
        : null;

      const event: WebhookEvent = {
        event: 'action.expired',
        event_id: `evt_aex_${crypto.randomUUID()}`,
        timestamp: now,
        workspace_id: workspaceId,
        api_version: '2026-03-01',
        data: {
          workspace_name: workspaceName,
          action: {
            id: action.id,
            action_type: action.action_type,
            severity: action.severity,
            title: action.title,
            target_deal_id: action.target_deal_id ?? null,
            target_account_id: action.target_account_id ?? null,
            target_entity_name: action.target_entity_name ?? null,
            owner_email: action.owner_email ?? null,
            impact_amount: action.impact_amount ?? null,
            source_skill: action.source_skill,
            expired_at: now,
            days_open: daysOpen,
          },
        },
      };

      for (const endpoint of endpoints) {
        deliverWithRetry(endpoint, event).catch(() => {});
      }
    }
  }
}
