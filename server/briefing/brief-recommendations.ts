import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { formatCompact } from './brief-utils.js';

export interface AccountabilityItem {
  id: string;
  entity_name: string;
  entity_type: 'deal' | 'rep' | null;
  recommendation_text: string;
  outcome_text: string;
  created_at: string;
  checked_in_at: string;
}

/**
 * Logs a recommendation to the accountability table.
 * De-duplicates: skips if the same entity already has a record from the last 7 days.
 */
export async function logBriefRecommendation(params: {
  workspaceId: string;
  source: 'brief' | 'chat';
  entityType: 'deal' | 'rep' | null;
  entityId?: string | null;
  entityName: string;
  recommendationText: string;
}): Promise<void> {
  const { workspaceId, source, entityType, entityId, entityName, recommendationText } = params;
  if (!entityName?.trim() || !recommendationText?.trim()) return;

  const existing = await query<{ id: string }>(
    `SELECT id FROM brief_recommendations
     WHERE workspace_id = $1
       AND entity_name ILIKE $2
       AND created_at >= NOW() - INTERVAL '7 days'
     LIMIT 1`,
    [workspaceId, entityName]
  );
  if (existing.rows.length > 0) return;

  await query(
    `INSERT INTO brief_recommendations
       (workspace_id, source, entity_type, entity_id, entity_name, recommendation_text, check_in_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '7 days')`,
    [workspaceId, source, entityType ?? null, entityId ?? null, entityName, recommendationText]
  );
}

/**
 * For each due check-in (check_in_at <= now, checked_in_at IS NULL), fetch the
 * current state of the referenced entity and generate a one-sentence outcome
 * statement. Marks checked_in_at and stores outcome_text.
 *
 * Called during brief assembly (7 AM cron) for monday_setup and friday_recap.
 */
export async function generateCheckInOutcomes(workspaceId: string): Promise<void> {
  const dueRows = await query<{
    id: string;
    entity_type: string | null;
    entity_id: string | null;
    entity_name: string;
    recommendation_text: string;
  }>(
    `SELECT id, entity_type, entity_id, entity_name, recommendation_text
     FROM brief_recommendations
     WHERE workspace_id = $1
       AND check_in_at <= NOW()
       AND checked_in_at IS NULL
     ORDER BY check_in_at ASC
     LIMIT 10`,
    [workspaceId]
  );
  if (dueRows.rows.length === 0) return;

  for (const row of dueRows.rows) {
    try {
      const entityState = await fetchEntityState(workspaceId, row.entity_type, row.entity_id, row.entity_name);
      const outcomeText = await generateOutcomeStatement(workspaceId, row.recommendation_text, row.entity_name, entityState);

      await query(
        `UPDATE brief_recommendations SET checked_in_at = NOW(), outcome_text = $1 WHERE id = $2`,
        [outcomeText, row.id]
      );
    } catch (err) {
      console.warn('[brief-recommendations] Check-in failed for', row.id, ':', (err as Error).message);
    }
  }
}

async function fetchEntityState(
  workspaceId: string,
  entityType: string | null,
  entityId: string | null,
  entityName: string
): Promise<string> {
  if (entityType === 'deal') {
    const dealRes = entityId
      ? await query<{ stage: string; amount: string; stage_normalized: string }>(
          `SELECT stage, COALESCE(amount, 0)::text as amount, COALESCE(stage_normalized,'') as stage_normalized
           FROM deals WHERE workspace_id = $1 AND id = $2::uuid LIMIT 1`,
          [workspaceId, entityId]
        )
      : await query<{ stage: string; amount: string; stage_normalized: string }>(
          `SELECT stage, COALESCE(amount, 0)::text as amount, COALESCE(stage_normalized,'') as stage_normalized
           FROM deals WHERE workspace_id = $1 AND name ILIKE $2 LIMIT 1`,
          [workspaceId, entityName]
        );
    const deal = dealRes.rows[0];
    if (!deal) return 'the deal could not be found (may have been removed or renamed)';
    const sn = deal.stage_normalized;
    if (sn === 'closed_won') return `the deal closed won at ${formatCompact(parseFloat(deal.amount))}`;
    if (sn === 'closed_lost') return `the deal closed lost`;
    return `the deal is now in ${deal.stage} at ${formatCompact(parseFloat(deal.amount))}`;
  }

  if (entityType === 'rep') {
    const repRes = await query<{ closed: string; pipeline: string }>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE stage_normalized = 'closed_won'), 0)::text as closed,
         COALESCE(SUM(amount) FILTER (WHERE stage_normalized NOT IN ('closed_won','closed_lost')), 0)::text as pipeline
       FROM deals WHERE workspace_id = $1 AND owner ILIKE $2`,
      [workspaceId, entityName]
    );
    const rep = repRes.rows[0];
    if (!rep) return 'rep data unavailable';
    return `the rep has ${formatCompact(parseFloat(rep.closed))} closed won and ${formatCompact(parseFloat(rep.pipeline))} in open pipeline`;
  }

  return 'no entity state available';
}

async function generateOutcomeStatement(
  workspaceId: string,
  recommendationText: string,
  entityName: string,
  entityState: string
): Promise<string> {
  const systemPrompt = `You are Pandora, a Chief of Staff AI for B2B sales leadership.
Write ONE sentence summarizing what was recommended and what happened since.

FORMAT: Start with "Last week:" then a brief paraphrase of the recommendation (5–10 words), then " — " then what happened.
EXAMPLE: "Last week: push BASS on the pilot discussion — the deal advanced to Negotiation ($84K, Q2 close)."
Rules: No markdown. No line breaks. Under 30 words total. Be specific with dollar amounts and stages.`;

  const userPrompt = `Recommendation: "${recommendationText}"
Entity: ${entityName}
What happened: ${entityState}

Write the one-sentence outcome now.`;

  try {
    const raw = await callLLM(workspaceId, 'lite', {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.2,
      maxTokens: 80,
      _tracking: { workspaceId, phase: 'briefing', stepName: 'generate-outcome-statement' },
    });
    const text = typeof raw === 'string' ? raw : (raw as any)?.content || '';
    const trimmed = text.trim().replace(/^["']|["']$/g, '');
    return trimmed.length > 10 ? trimmed : `Last week: ${recommendationText.slice(0, 60)} — ${entityState}.`;
  } catch {
    return `Last week: ${recommendationText.slice(0, 60)} — ${entityState}.`;
  }
}

/**
 * Returns the 2–3 most recently checked-in accountability items for the workspace.
 * Used by the concierge route to populate the "Since last week" section.
 */
export async function getRecentAccountabilityItems(
  workspaceId: string,
  limit = 3
): Promise<AccountabilityItem[]> {
  const res = await query<{
    id: string;
    entity_name: string;
    entity_type: string | null;
    recommendation_text: string;
    outcome_text: string;
    created_at: string;
    checked_in_at: string;
  }>(
    `SELECT id, entity_name, entity_type, recommendation_text, outcome_text,
            created_at::text, checked_in_at::text
     FROM brief_recommendations
     WHERE workspace_id = $1
       AND checked_in_at IS NOT NULL
       AND outcome_text IS NOT NULL
       AND created_at >= NOW() - INTERVAL '30 days'
     ORDER BY checked_in_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );

  return res.rows.map(r => ({
    id: r.id,
    entity_name: r.entity_name,
    entity_type: r.entity_type as 'deal' | 'rep' | null,
    recommendation_text: r.recommendation_text,
    outcome_text: r.outcome_text,
    created_at: r.created_at,
    checked_in_at: r.checked_in_at,
  }));
}
