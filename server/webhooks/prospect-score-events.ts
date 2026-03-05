/**
 * Prospect Score Event Emitter
 *
 * Emits prospect.scored webhook events after each scoring run.
 * Only fires for entities with significant score changes (|scoreChange| >= 5)
 * to avoid flooding endpoints on runs where CRM data barely shifted.
 */

import { query } from '../db.js';
import { deliverWithRetry, type WebhookEvent } from './delivery.js';
import crypto from 'node:crypto';

export interface ScoredEntity {
  entityType: 'deal' | 'contact';
  entityId: string;
  source: string;
  sourceId: string;
  sourceObject: string;
  email?: string;
  name?: string;

  totalScore: number;
  grade: string;
  fitScore: number;
  engagementScore: number;
  intentScore: number;
  timingScore: number;

  scoreMethod: string;
  scoreConfidence: number;
  scoreSummary: string;
  topPositiveFactor: string;
  topNegativeFactor: string;
  recommendedAction?: string;
  scoreFactors: unknown[];

  previousScore: number | null;
  scoreChange: number | null;
  scoredAt: string;
}

function buildProspectScoredEvent(
  entity: ScoredEntity,
  workspaceId: string,
  workspaceName: string
): WebhookEvent {
  return {
    event: 'prospect.scored',
    event_id: `evt_ps_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    workspace_id: workspaceId,
    api_version: '2026-03-01',
    data: {
      workspace_name: workspaceName,
      prospect: {
        pandora_id: entity.entityId,
        entity_type: entity.entityType,
        source: entity.source,
        source_object: entity.sourceObject,
        source_id: entity.sourceId,
        email: entity.email ?? null,
        name: entity.name ?? null,

        pandora_prospect_score: entity.totalScore,
        pandora_prospect_grade: entity.grade,
        pandora_fit_score: entity.fitScore,
        pandora_engagement_score: entity.engagementScore,
        pandora_intent_score: entity.intentScore,
        pandora_timing_score: entity.timingScore,

        pandora_score_method: entity.scoreMethod,
        pandora_score_confidence: entity.scoreConfidence,
        pandora_scored_at: entity.scoredAt,

        pandora_score_summary: entity.scoreSummary,
        pandora_top_positive_factor: entity.topPositiveFactor,
        pandora_top_negative_factor: entity.topNegativeFactor,
        pandora_recommended_action: entity.recommendedAction ?? null,
        pandora_score_factors: entity.scoreFactors,

        previous_score: entity.previousScore,
        score_change: entity.scoreChange,
      },
    },
  };
}

/**
 * Emit prospect.scored events for all entities with significant score changes.
 * Filter: |scoreChange| >= 5 (Option A — typically 50–200 events vs 5k+ total).
 * Fire-and-forget per endpoint — never blocks the scoring run.
 */
export async function emitProspectScoredEvents(
  workspaceId: string,
  scoredEntities: ScoredEntity[]
): Promise<{ emitted: number; endpoints: number; errors: number }> {

  const changed = scoredEntities.filter(
    e => e.scoreChange !== null && Math.abs(e.scoreChange) >= 5
  );

  if (changed.length === 0) {
    return { emitted: 0, endpoints: 0, errors: 0 };
  }

  const endpointResult = await query<{ id: string; url: string; secret: string }>(
    `SELECT id, url, secret
     FROM webhook_endpoints
     WHERE workspace_id = $1
       AND enabled = true
       AND (event_types IS NULL OR 'prospect.scored' = ANY(event_types))`,
    [workspaceId]
  );

  if (endpointResult.rows.length === 0) {
    return { emitted: 0, endpoints: 0, errors: 0 };
  }

  const wsResult = await query<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  const workspaceName = wsResult.rows[0]?.name ?? 'Unknown';

  let emitted = 0;

  for (const entity of changed) {
    const event = buildProspectScoredEvent(entity, workspaceId, workspaceName);
    for (const endpoint of endpointResult.rows) {
      deliverWithRetry(endpoint, event).catch(() => {});
    }
    emitted++;
  }

  return { emitted, endpoints: endpointResult.rows.length, errors: 0 };
}
