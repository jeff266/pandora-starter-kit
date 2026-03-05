/**
 * Deal Webhook Event Emitters
 *
 * Emits two event types:
 *
 * deal.stage_changed
 * ------------------
 * Fires during CRM sync (HubSpot + Salesforce) whenever a deal moves from one
 * pipeline stage to another. Useful for downstream attribution tracking,
 * CRM task auto-creation, Slack deal-motion alerts, and revenue waterfall
 * analysis. Fires even on backwards movements (e.g. negotiation → proposal).
 *
 * deal.flagged
 * ------------
 * Fires after a skill run (pipeline-hygiene, single-thread-alert,
 * deal-risk-review, etc.) inserts findings with severity "act" or "watch"
 * against a specific deal. Lets external systems react to AI-identified risk
 * before the rep even opens Pandora — e.g. auto-create a CRM task, page the
 * AE's manager, or add the deal to a Clay enrichment sequence.
 *
 * Example payloads are at the bottom of each function.
 */

import crypto from 'node:crypto';
import { query } from '../db.js';
import { deliverWithRetry, type WebhookEvent } from './delivery.js';
import type { StageChange } from '../connectors/hubspot/stage-tracker.js';
import type { FindingRow } from '../findings/extractor.js';

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
 * Emit deal.stage_changed events for all stage transitions detected during
 * a CRM sync run. Called from both the HubSpot and Salesforce sync paths
 * after recordStageChanges succeeds.
 *
 * Example payload:
 * {
 *   "event": "deal.stage_changed",
 *   "event_id": "evt_dsc_a1b2c3...",
 *   "timestamp": "2026-03-05T10:30:00.000Z",
 *   "workspace_id": "4160191d-...",
 *   "api_version": "2026-03-01",
 *   "data": {
 *     "workspace_name": "Frontera Health",
 *     "deal": {
 *       "pandora_id": "d9e8f7a6-...",
 *       "name": "Frontera Health – Enterprise",
 *       "amount": 185000,
 *       "owner_email": "alex@frontera.com",
 *       "source": "hubspot",
 *       "source_id": "12345678",
 *       "from_stage": "Demo Scheduled",
 *       "from_stage_normalized": "demo",
 *       "to_stage": "Proposal Sent",
 *       "to_stage_normalized": "proposal",
 *       "changed_at": "2026-03-05T10:28:41.000Z"
 *     }
 *   }
 * }
 */
export async function emitDealStageChangedEvents(
  workspaceId: string,
  changes: StageChange[]
): Promise<void> {
  if (changes.length === 0) return;

  const endpoints = await getActiveEndpoints(workspaceId, 'deal.stage_changed');
  if (endpoints.length === 0) return;

  const dealIds = [...new Set(changes.map(c => c.dealId).filter(Boolean))];
  const dealResult = await query<{
    id: string;
    name: string;
    amount: number | null;
    owner: string | null;
    source: string;
  }>(
    `SELECT id, name, amount, owner, source FROM deals WHERE id = ANY($1)`,
    [dealIds]
  );
  const dealMap = new Map(dealResult.rows.map(d => [d.id, d]));
  const workspaceName = await getWorkspaceName(workspaceId);

  for (const change of changes) {
    const deal = dealMap.get(change.dealId);
    const event: WebhookEvent = {
      event: 'deal.stage_changed',
      event_id: `evt_dsc_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      workspace_id: workspaceId,
      api_version: '2026-03-01',
      data: {
        workspace_name: workspaceName,
        deal: {
          pandora_id: change.dealId,
          name: deal?.name ?? null,
          amount: deal?.amount ?? null,
          owner_email: deal?.owner ?? null,
          source: deal?.source ?? 'unknown',
          source_id: change.dealSourceId,
          from_stage: change.fromStage,
          from_stage_normalized: change.fromStageNormalized,
          to_stage: change.toStage,
          to_stage_normalized: change.toStageNormalized,
          changed_at: change.changedAt,
        },
      },
    };
    for (const endpoint of endpoints) {
      deliverWithRetry(endpoint, event).catch(() => {});
    }
  }
}

/**
 * Emit deal.flagged events after a skill run inserts findings.
 * Filters for findings with severity "act" or "watch" that are linked to a
 * specific deal. Severity "info" findings (e.g. data quality summaries without
 * a deal target) are excluded — those aren't actionable at the deal level.
 *
 * Example payload:
 * {
 *   "event": "deal.flagged",
 *   "event_id": "evt_df_b2c3d4...",
 *   "timestamp": "2026-03-05T07:05:12.000Z",
 *   "workspace_id": "4160191d-...",
 *   "api_version": "2026-03-01",
 *   "data": {
 *     "workspace_name": "Frontera Health",
 *     "finding": {
 *       "id": "f9e8d7c6-...",
 *       "deal_id": "d9e8f7a6-...",
 *       "deal_name": "Frontera Health – Enterprise",
 *       "category": "single_threaded",
 *       "severity": "act",
 *       "message": "Only 1 contact mapped — no economic buyer or champion identified",
 *       "source_skill": "single-thread-alert",
 *       "skill_run_id": "run_xyz...",
 *       "metadata": {
 *         "contact_count": 1,
 *         "roles_present": [],
 *         "risk_level": "critical"
 *       }
 *     }
 *   }
 * }
 */
export async function emitDealFlaggedEvents(
  workspaceId: string,
  findings: FindingRow[],
  skillId: string
): Promise<void> {
  const dealFindings = findings.filter(
    f => f.deal_id && (f.severity === 'act' || f.severity === 'watch')
  );
  if (dealFindings.length === 0) return;

  const endpoints = await getActiveEndpoints(workspaceId, 'deal.flagged');
  if (endpoints.length === 0) return;

  const dealIds = [...new Set(dealFindings.map(f => f.deal_id!))];
  const dealResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM deals WHERE id = ANY($1)`,
    [dealIds]
  );
  const dealMap = new Map(dealResult.rows.map(d => [d.id, d.name]));
  const workspaceName = await getWorkspaceName(workspaceId);

  for (const finding of dealFindings) {
    const event: WebhookEvent = {
      event: 'deal.flagged',
      event_id: `evt_df_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      workspace_id: workspaceId,
      api_version: '2026-03-01',
      data: {
        workspace_name: workspaceName,
        finding: {
          id: finding.id ?? null,
          deal_id: finding.deal_id,
          deal_name: dealMap.get(finding.deal_id!) ?? null,
          category: finding.category,
          severity: finding.severity,
          message: finding.message,
          source_skill: skillId,
          skill_run_id: finding.skill_run_id,
          owner_email: finding.owner_email ?? null,
          metadata: finding.metadata ?? {},
        },
      },
    };
    for (const endpoint of endpoints) {
      deliverWithRetry(endpoint, event).catch(() => {});
    }
  }
}
