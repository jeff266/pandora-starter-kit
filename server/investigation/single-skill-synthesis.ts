import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

export async function getMostRecentSkillRun(
  workspaceId: string,
  skillId: string,
  maxAgeMinutes: number = 60,
): Promise<{ id: string; skill_id: string; output_text: string; result: any; output: any } | null> {
  const result = await query<{ id: string; skill_id: string; output_text: string; result: any; output: any }>(
    `SELECT id, skill_id, output_text, result, output
     FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
       AND started_at >= NOW() - INTERVAL '${maxAgeMinutes} minutes'
     ORDER BY started_at DESC
     LIMIT 1`,
    [workspaceId, skillId],
  );
  return result.rows[0] || null;
}

export async function synthesizeSingleSkill(
  workspaceId: string,
  question: string,
  skillRun: { skill_id: string; output_text?: string | null; result?: any; output?: any },
  options?: { goalContext?: boolean },
): Promise<{ text: string; tokens: number }> {
  let goalBlock = '';

  if (options?.goalContext) {
    try {
      const goals = await query(
        `SELECT g.label, g.target_value, gs.current_value, gs.attainment_pct,
                gs.trajectory, gs.days_remaining
         FROM goals g
         LEFT JOIN goal_snapshots gs ON gs.goal_id = g.id
           AND gs.snapshot_date = (SELECT MAX(snapshot_date) FROM goal_snapshots WHERE goal_id = g.id)
         WHERE g.workspace_id = $1 AND g.is_active = true AND g.level IN ('board', 'company')
         LIMIT 3`,
        [workspaceId],
      );

      if (goals.rows.length > 0) {
        goalBlock =
          `\nGOAL CONTEXT:\n` +
          goals.rows
            .map(
              (g: any) =>
                `- ${g.label}: ${g.current_value ?? '?'}/${g.target_value} (${g.attainment_pct ?? '?'}% attainment, ${g.trajectory ?? 'unknown'})`,
            )
            .join('\n') +
          '\n';
      }
    } catch {
      // Non-fatal — proceed without goal context
    }
  }

  const skillOutput =
    skillRun.output_text ||
    (typeof skillRun.output?.narrative === 'string' ? skillRun.output.narrative : null) ||
    (typeof skillRun.output === 'string' ? skillRun.output : null) ||
    (skillRun.result ? JSON.stringify(skillRun.result, null, 2).substring(0, 3000) : null) ||
    'No recent data available for this skill.';

  const systemPrompt = `You are Pandora, a RevOps intelligence assistant. Answer questions directly and concisely using the skill data provided. Be specific with numbers. Do not narrate an "investigation" — just answer the question.`;

  const userPrompt = `QUESTION: "${question}"
${goalBlock}
SKILL OUTPUT (${skillRun.skill_id}):
${skillOutput}

Answer the question in 2-4 sentences. Reference specific numbers. Frame against goal targets if goal context is provided. Do not mention investigation steps or add unsolicited action items.`;

  const response = await callLLM(workspaceId, 'generate', {
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 500,
    temperature: 0.3,
  });

  return {
    text: response.content,
    tokens: (response.usage?.input || 0) + (response.usage?.output || 0),
  };
}
