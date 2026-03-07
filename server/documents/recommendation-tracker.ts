import { query } from '../db.js';

export interface Recommendation {
  id?: string;
  workspace_id: string;
  session_id?: string;
  deal_id?: string;
  deal_name?: string;
  action: string;
  category?: 'deal_risk' | 'pipeline' | 'rep_coaching' | string;
  urgency?: 'today' | 'this_week' | 'next_week' | 'strategic';
  status: 'pending' | 'accepted' | 'dismissed' | 'actioned' | 'resolved';
  outcome?: 'closed_won' | 'closed_lost' | 'slipped' | 'timeout';
  was_actioned?: boolean;
  recommendation_correct?: boolean;
  resolved_at?: Date;
  created_at?: Date;
}

/**
 * Persists a recommendation to the database.
 */
export async function persistRecommendation(
  workspaceId: string,
  sessionId: string | null,
  rec: Partial<Recommendation>
): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO recommendations (
      workspace_id, session_id, deal_id, deal_name, action, category, urgency, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id`,
    [
      workspaceId,
      sessionId,
      rec.deal_id,
      rec.deal_name,
      rec.action,
      rec.category || 'general',
      rec.urgency || 'this_week',
      rec.status || 'pending'
    ]
  );
  return res.rows[0].id;
}

/**
 * Updates the status of a recommendation.
 */
export async function updateRecommendationStatus(id: string, status: Recommendation['status']): Promise<void> {
  await query(
    `UPDATE recommendations SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id]
  );
}

/**
 * Evaluates open recommendations against material changes (e.g. after sync).
 */
export async function evaluateRecommendationOutcomes(
  workspaceId: string,
  materialChanges: any[]
): Promise<void> {
  // Query open recommendations for this workspace
  const openRecsRes = await query<Recommendation>(
    `SELECT * FROM recommendations WHERE workspace_id = $1 AND status NOT IN ('resolved', 'dismissed')`,
    [workspaceId]
  );
  
  const openRecs = openRecsRes.rows;
  if (openRecs.length === 0) return;

  for (const rec of openRecs) {
    // Look for changes related to the deal in this recommendation
    const change = materialChanges.find(c => c.dealId === rec.deal_id);
    if (!change) continue;

    if (change.type === 'deal_closed_won') {
      await resolveRecommendation(rec.id!, 'closed_won', change);
    } else if (change.type === 'deal_closed_lost') {
      await resolveRecommendation(rec.id!, 'closed_lost', change);
    }
    // Add more outcome detection logic as needed
  }
}

/**
 * Resolves a recommendation with an outcome.
 */
export async function resolveRecommendation(id: string, outcome: Recommendation['outcome'], change: any): Promise<void> {
  const recRes = await query<Recommendation>(`SELECT * FROM recommendations WHERE id = $1`, [id]);
  if (recRes.rows.length === 0) return;
  const rec = recRes.rows[0];

  // For now, assume if it was accepted or actioned and reached a positive outcome, it was correct.
  const wasActioned = rec.status === 'actioned' || rec.status === 'accepted';
  const correct = outcome === 'closed_won';

  await query(
    `UPDATE recommendations 
     SET status = 'resolved', outcome = $1, was_actioned = $2, recommendation_correct = $3, resolved_at = NOW()
     WHERE id = $4`,
    [outcome, wasActioned, correct, id]
  );

  await writeRecommendationOutcomeMemory(rec, outcome!, wasActioned, correct);
}

/**
 * Writes the outcome of a recommendation to workspace memory.
 */
export async function writeRecommendationOutcomeMemory(
  rec: Recommendation,
  outcome: string,
  wasActioned: boolean,
  correct: boolean
): Promise<void> {
  const { query: dbQuery } = await import('../db.js');
  
  const summary = `Recommendation ${correct ? 'validated' : 'resolved'}: "${rec.action}" for ${rec.deal_name || 'deal'}. Outcome: ${outcome}. Actioned: ${wasActioned}.`;
  
  await dbQuery(
    `INSERT INTO workspace_memory (
      workspace_id, memory_type, entity_type, entity_id, entity_name, summary, content
    )
    VALUES ($1, 'recommendation_outcome', 'deal', $2, $3, $4, $5)`,
    [
      rec.workspace_id,
      rec.deal_id,
      rec.deal_name,
      summary,
      JSON.stringify({ recommendation_id: rec.id, outcome, was_actioned: wasActioned, correct })
    ]
  );
}

/**
 * Returns a summary of recent outcomes for briefing.
 */
export async function getOutcomeSummaryForBrief(workspaceId: string, sinceDate: Date): Promise<string[]> {
  const res = await query<{ action: string; deal_name: string; outcome: string; was_actioned: boolean }>(
    `SELECT action, deal_name, outcome, was_actioned 
     FROM recommendations 
     WHERE workspace_id = $1 AND resolved_at >= $2 AND status = 'resolved'`,
    [workspaceId, sinceDate]
  );

  return res.rows.map(r => {
    const icon = r.outcome === 'closed_won' ? '✓' : '✗';
    const actionStr = r.was_actioned ? 'was actioned' : 'was not actioned';
    return `${icon} ${r.action} for ${r.deal_name} — outcome: ${r.outcome.replace('_', ' ')}. Rec ${actionStr}.`;
  });
}
