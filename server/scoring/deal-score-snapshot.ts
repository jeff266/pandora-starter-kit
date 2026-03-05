/**
 * Deal Score Snapshot
 *
 * REFACTORED 2026-03-04:
 * - Now reads health_score from lead_scores table (entity_type='deal')
 * - Previously read from deals.health_score column (deprecated)
 * - Continues to write snapshots to deal_score_snapshots table
 * - Used by Command Center for score history charts
 *
 * STATUS: Active (refactored to use unified scoring)
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DealScoreSnapshot');

function gradeFromScore(s: number): string {
  if (s >= 90) return 'A';
  if (s >= 75) return 'B';
  if (s >= 50) return 'C';
  if (s >= 25) return 'D';
  return 'F';
}

export async function runDealScoreSnapshots(
  workspaceId: string
): Promise<{ snapped: number; commentaryGenerated: number }> {
  // Query all open deals for the workspace
  const dealsResult = await query<{
    id: string;
    name: string;
    stage_normalized: string;
  }>(
    `SELECT id, name, stage_normalized
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won','closed_lost','closedwon','closedlost')`,
    [workspaceId]
  );

  const deals = dealsResult.rows;
  logger.info(`Processing ${deals.length} open deals`, { workspaceId });

  const dealIds = deals.map(d => d.id);

  // DEPRECATION NOTE: Read health scores from lead_scores table instead of deals.health_score
  const leadScoresResult = await query<{ entity_id: string; total_score: string }>(
    `SELECT entity_id, total_score
     FROM lead_scores
     WHERE workspace_id = $1 AND entity_type = 'deal' AND entity_id = ANY($2)`,
    [workspaceId, dealIds]
  );

  const healthScoreMap = new Map(
    leadScoresResult.rows.map(r => [r.entity_id, parseFloat(r.total_score)])
  );

  const [batchFindings, batchSnapshots] = await Promise.all([
    query<{ deal_id: string; severity: string; cnt: string }>(
      `SELECT deal_id, severity, COUNT(*) as cnt
       FROM findings
       WHERE workspace_id=$1 AND entity_id = ANY($2) AND entity_type='deal' AND status='active'
       GROUP BY deal_id, severity`,
      [workspaceId, dealIds]
    ),
    query<{ deal_id: string; active_score: string }>(
      `SELECT DISTINCT ON (deal_id) deal_id, active_score
       FROM deal_score_snapshots
       WHERE workspace_id = $1 AND deal_id = ANY($2)
       ORDER BY deal_id, snapshot_date DESC`,
      [workspaceId, dealIds]
    ),
  ]);

  const findingsMap = new Map<string, Array<{ severity: string; cnt: number }>>();
  for (const row of batchFindings.rows) {
    const list = findingsMap.get(row.deal_id) || [];
    list.push({ severity: row.severity, cnt: parseInt(row.cnt, 10) });
    findingsMap.set(row.deal_id, list);
  }

  const snapshotMap = new Map(
    batchSnapshots.rows.map(r => [r.deal_id, Number(r.active_score)])
  );

  let commentaryGenerated = 0;

  for (const deal of deals) {
    try {
      const penalties: Record<string, number> = { act: -25, watch: -10, notable: -3, info: -1 };
      let skillScore = 100;
      const dealFindings = findingsMap.get(deal.id) || [];
      for (const f of dealFindings) {
        const penalty = penalties[f.severity] ?? 0;
        skillScore += penalty * f.cnt;
      }
      skillScore = Math.max(0, skillScore);

      // Read health score from lead_scores table (written by Lead Scoring v1)
      const healthScoreVal = healthScoreMap.get(deal.id) ?? 100;
      const activeScore = Math.min(skillScore, healthScoreVal);
      const activeSource: 'skill' | 'health' = skillScore <= healthScoreVal ? 'skill' : 'health';
      const grade = gradeFromScore(activeScore);

      const prevScore = snapshotMap.get(deal.id);
      const scoreDelta: number | null = prevScore !== undefined
        ? activeScore - prevScore
        : null;

      // Generate LLM commentary when score_delta is significant
      let commentary: string | null = null;
      if (scoreDelta != null && Math.abs(scoreDelta) >= 10) {
        try {
          // Get top findings for context
          const topFindingsResult = await query<{ message: string }>(
            `SELECT message FROM findings
             WHERE workspace_id=$1 AND entity_id=$2 AND entity_type='deal' AND status='active'
             ORDER BY CASE severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END
             LIMIT 3`,
            [workspaceId, deal.id]
          );

          const findingsText = topFindingsResult.rows.length > 0
            ? topFindingsResult.rows.map(r => r.message).join('; ')
            : null;

          const prompt = `You are a sales analyst. In 1-2 sentences, explain the deal health for "${deal.name}" which scored ${activeScore}/100 (${grade}) this week. Score changed ${scoreDelta > 0 ? '+' : ''}${scoreDelta} points. ${findingsText ? 'Key issues: ' + findingsText : 'No active findings.'}. Be specific and actionable. Plain text only.`;

          const llmResponse = await callLLM(workspaceId, 'generate', {
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 120,
            temperature: 0.3,
          });

          commentary = llmResponse.content.trim() || null;
          if (commentary) commentaryGenerated++;
        } catch (err: any) {
          logger.warn(`Failed to generate commentary for deal ${deal.id}`, { error: err.message });
        }
      }

      // Upsert snapshot
      await query(
        `INSERT INTO deal_score_snapshots
           (workspace_id, deal_id, snapshot_date, health_score, skill_score, active_score, active_source, grade, score_delta, commentary)
         VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (workspace_id, deal_id, snapshot_date) DO UPDATE SET
           health_score=EXCLUDED.health_score,
           skill_score=EXCLUDED.skill_score,
           active_score=EXCLUDED.active_score,
           active_source=EXCLUDED.active_source,
           grade=EXCLUDED.grade,
           score_delta=EXCLUDED.score_delta,
           commentary=COALESCE(EXCLUDED.commentary, deal_score_snapshots.commentary)`,
        [
          workspaceId,
          deal.id,
          healthScoreVal,
          skillScore,
          activeScore,
          activeSource,
          grade,
          scoreDelta,
          commentary,
        ]
      );
    } catch (err: any) {
      logger.error(`Failed to snapshot deal ${deal.id}`, err);
    }
  }

  logger.info(`Completed: ${deals.length} snapped, ${commentaryGenerated} commentaries`, { workspaceId });
  return { snapped: deals.length, commentaryGenerated };
}
