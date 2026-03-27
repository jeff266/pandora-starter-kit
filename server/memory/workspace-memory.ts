import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

/**
 * Workspace Memory Service
 * 
 * Handles persistence and retrieval of cross-session findings,
 * strategic context, and recurring patterns.
 */

export interface WorkspaceMemory {
  id: string;
  workspace_id: string;
  memory_type: 'recurring_finding' | 'strategic_priority' | 'entity_context' | 'data_gap' | 'forecast_accuracy' | 'recommendation_outcome' | 'chat_insight';
  entity_type?: 'deal' | 'account' | 'rep' | 'contact' | 'workspace';
  entity_id?: string;
  entity_name?: string;
  period_start?: Date;
  period_end?: Date;
  period_label?: string;
  content: any;
  summary: string;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  source_skill_run_ids: string[];
  source_document_ids: string[];
  is_resolved: boolean;
  resolved_at?: Date;
  resolution_note?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Upserts recurring findings into workspace memory from a skill run.
 */
export async function writeMemoryFromSkillRun(
  workspaceId: string,
  skillId: string,
  runId: string,
  findings: any[]
) {
  for (const finding of findings) {
    const memoryType = 'recurring_finding';
    const entityType = finding.entity_type;
    const entityId = finding.entity_id;
    const summary = finding.message || finding.summary;
    const periodLabel = getCurrentPeriodLabel();

    // Upsert logic: if same workspace, type, entity, and period, increment occurrence
    await query(
      `INSERT INTO workspace_memory (
        workspace_id, memory_type, entity_type, entity_id, entity_name, 
        period_label, content, summary, source_skill_run_ids
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ARRAY[$9]::uuid[])
      ON CONFLICT (workspace_id, memory_type, entity_type, entity_id, period_label) 
      DO UPDATE SET
        occurrence_count = workspace_memory.occurrence_count + 1,
        last_seen_at = NOW(),
        source_skill_run_ids = array_append(workspace_memory.source_skill_run_ids, $9::uuid),
        content = $7,
        summary = $8,
        updated_at = NOW()
      WHERE workspace_memory.is_resolved = FALSE`,
      [
        workspaceId, memoryType, entityType, entityId, finding.entity_name,
        periodLabel, finding, summary, runId
      ]
    ).catch(err => {
      // If the unique constraint doesn't exist yet or fails, fallback to simple insert
      console.error('[workspace-memory] Upsert failed, falling back to insert:', err.message);
      return query(
        `INSERT INTO workspace_memory (
          workspace_id, memory_type, entity_type, entity_id, entity_name, 
          period_label, content, summary, source_skill_run_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ARRAY[$9]::uuid[])`,
        [workspaceId, memoryType, entityType, entityId, finding.entity_name, periodLabel, finding, summary, runId]
      );
    });
  }
}

/**
 * Upserts recurring findings from a brief assembly.
 */
export async function writeMemoryFromBriefAssembly(
  workspaceId: string,
  briefId: string,
  findings: any[]
) {
  for (const finding of findings) {
    const periodLabel = getCurrentPeriodLabel();
    await query(
      `INSERT INTO workspace_memory (
        workspace_id, memory_type, entity_type, entity_id, entity_name, 
        period_label, content, summary, source_document_ids
      )
      VALUES ($1, 'recurring_finding', $2, $3, $4, $5, $6, $7, ARRAY[$8]::uuid[])
      ON CONFLICT (workspace_id, memory_type, entity_type, entity_id, period_label)
      DO UPDATE SET
        occurrence_count = workspace_memory.occurrence_count + 1,
        last_seen_at = NOW(),
        source_document_ids = array_append(workspace_memory.source_document_ids, $8::uuid),
        updated_at = NOW()
      WHERE workspace_memory.is_resolved = FALSE`,
      [
        workspaceId, finding.entity_type, finding.entity_id, finding.entity_name,
        periodLabel, finding, finding.message || finding.summary, briefId
      ]
    ).catch(() => {
      return query(
        `INSERT INTO workspace_memory (
          workspace_id, memory_type, entity_type, entity_id, entity_name, 
          period_label, content, summary, source_document_ids
        )
        VALUES ($1, 'recurring_finding', $2, $3, $4, $5, $6, $7, ARRAY[$8]::uuid[])`,
        [workspaceId, finding.entity_type, finding.entity_id, finding.entity_name, periodLabel, finding, finding.message || finding.summary, briefId]
      );
    });
  }
}

/**
 * Returns relevant unresolved memories for a given scope.
 */
export async function getRelevantMemories(
  workspaceId: string,
  scope: { rep_email?: string; deal_id?: string; account_id?: string } = {},
  memoryTypes: string[] = ['recurring_finding', 'strategic_priority', 'chat_insight']
): Promise<WorkspaceMemory[]> {
  let sql = `
    SELECT * FROM workspace_memory 
    WHERE workspace_id = $1 
    AND is_resolved = FALSE
    AND memory_type = ANY($2)
  `;
  const params: any[] = [workspaceId, memoryTypes];

  if (scope.rep_email) {
    sql += ` AND (entity_type = 'rep' AND entity_id = $3 OR entity_id IS NULL)`;
    params.push(scope.rep_email);
  } else if (scope.deal_id) {
    sql += ` AND (entity_type = 'deal' AND entity_id = $3 OR entity_id IS NULL)`;
    params.push(scope.deal_id);
  } else if (scope.account_id) {
    sql += ` AND (entity_type = 'account' AND entity_id = $3 OR entity_id IS NULL)`;
    params.push(scope.account_id);
  }

  sql += ` ORDER BY occurrence_count DESC, last_seen_at DESC LIMIT 10`;

  const res = await query<WorkspaceMemory>(sql, params);
  return res.rows;
}

/**
 * Marks a memory as resolved.
 */
export async function resolveMemory(memoryId: string, resolutionNote?: string) {
  await query(
    `UPDATE workspace_memory 
     SET is_resolved = TRUE, resolved_at = NOW(), resolution_note = $2, updated_at = NOW()
     WHERE id = $1`,
    [memoryId, resolutionNote]
  );
}

/**
 * Builds a formatted text block of relevant memories for LLM prompt injection.
 */
export async function buildMemoryContextBlock(
  workspaceId: string,
  scope: { rep_email?: string; deal_id?: string; account_id?: string } = {}
): Promise<string> {
  const memories = await getRelevantMemories(workspaceId, scope);
  if (memories.length === 0) return '';

  const chatInsights = memories.filter(m => m.memory_type === 'chat_insight');
  const otherMemories = memories.filter(m => m.memory_type !== 'chat_insight');

  let block = `\n<workspace_memory>\n`;

  if (otherMemories.length > 0) {
    block += `The following recurring findings and strategic context have been observed across previous sessions and automated briefs:\n\n`;
    for (const m of otherMemories) {
      const entityInfo = m.entity_name ? ` (Entity: ${m.entity_name})` : '';
      block += `- ${m.summary}${entityInfo}\n`;
      block += `  Observed ${m.occurrence_count} times. Last seen: ${m.last_seen_at.toISOString().split('T')[0]}\n`;
    }
  }

  if (chatInsights.length > 0) {
    if (otherMemories.length > 0) block += `\n`;
    block += `Context from previous conversations with this user:\n\n`;
    for (const m of chatInsights) {
      const timesNote = m.occurrence_count > 1 ? ` (raised ${m.occurrence_count} times)` : '';
      block += `- ${m.summary}${timesNote}\n`;
      block += `  Last mentioned: ${m.last_seen_at.toISOString().split('T')[0]}\n`;
    }
    block += `\nWhen relevant, naturally reference these prior context points — e.g. "Last time we spoke, you mentioned..." or "You've flagged this concern ${chatInsights[0]?.occurrence_count ?? 1} times — here's what's changed."\n`;
  }

  block += `\nUse this context to connect new observations to existing patterns or check if a known risk has been addressed.\n`;
  block += `</workspace_memory>\n`;

  return block;
}

/**
 * Helper to get the current period label (e.g., "W10-2024" or "Q1-2024")
 */
export function getCurrentPeriodLabel(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  const week = Math.ceil(diff / oneWeek);
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  return `W${week}-Q${quarter}-${now.getFullYear()}`;
}

export function getCurrentPeriodStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  return new Date(now.setDate(diff));
}

export function getCurrentPeriodEnd(): Date {
  const start = getCurrentPeriodStart();
  return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
}

export interface ForecastAccuracyMemory {
  period_label: string;
  overall_accuracy: number;
  rep_accuracies: {
    rep_name: string;
    rep_email: string;
    accuracy: number;
    closed_won: number;
    committed: number;
  }[];
  most_reliable_rep?: string;
  least_reliable_rep?: string;
}

/**
 * Writes quarterly or partial YTD forecast accuracy to workspace memory.
 */
export async function writeQuarterlyForecastAccuracy(workspaceId: string, periodLabel: string) {
  // 1. Get closed won deals for the period
  // We approximate the period from the label or use current quarter
  const now = new Date();
  const qStart = new Date(now.getFullYear(), (Math.floor(now.getMonth() / 3)) * 3, 1);
  const qEnd = new Date(now.getFullYear(), (Math.floor(now.getMonth() / 3) + 1) * 3, 0);

  const [closedRes, forecastRes] = await Promise.all([
    query<{ owner: string; total: string }>(
      `SELECT owner, SUM(amount) as total 
       FROM deals 
       WHERE workspace_id = $1 
       AND stage_normalized = 'closed_won' 
       AND close_date >= $2 AND close_date <= $3
       GROUP BY owner`,
      [workspaceId, qStart.toISOString(), qEnd.toISOString()]
    ),
    query<{ result: any }>(
      `SELECT result FROM skill_runs 
       WHERE workspace_id = $1 
       AND skill_id = 'forecast-rollup' 
       AND status = 'completed' 
       ORDER BY started_at DESC LIMIT 1`,
      [workspaceId]
    )
  ]);

  const fResult = forecastRes.rows[0]?.result || {};
  const repCommits = fResult.rep_breakdown || {}; // Assuming forecast-rollup returns this

  const repAccuracies = closedRes.rows.map(r => {
    const committed = repCommits[r.owner]?.commit || 0;
    const closed = parseFloat(r.total || '0');
    const accuracy = committed > 0 ? (closed / committed) * 100 : 0;
    return {
      rep_name: r.owner,
      rep_email: r.owner,
      accuracy: Math.round(accuracy),
      closed_won: closed,
      committed: committed
    };
  }).filter(r => r.committed > 0);

  if (repAccuracies.length === 0) return;

  const totalCommitted = repAccuracies.reduce((sum, r) => sum + r.committed, 0);
  const totalClosed = repAccuracies.reduce((sum, r) => sum + r.closed_won, 0);
  const overallAccuracy = totalCommitted > 0 ? (totalClosed / totalCommitted) * 100 : 0;

  const sorted = [...repAccuracies].sort((a, b) => Math.abs(100 - a.accuracy) - Math.abs(100 - b.accuracy));
  const mostReliable = sorted[0]?.rep_name;
  const leastReliable = sorted[sorted.length - 1]?.rep_name;

  const content: ForecastAccuracyMemory = {
    period_label: periodLabel,
    overall_accuracy: Math.round(overallAccuracy),
    rep_accuracies: repAccuracies,
    most_reliable_rep: mostReliable,
    least_reliable_rep: leastReliable
  };

  await query(
    `INSERT INTO workspace_memory (
      workspace_id, memory_type, entity_type, period_label, content, summary
    )
    VALUES ($1, 'forecast_accuracy', 'workspace', $2, $3, $4)
    ON CONFLICT (workspace_id, memory_type, entity_type, entity_id, period_label)
    DO UPDATE SET content = $3, summary = $4, updated_at = NOW()`,
    [
      workspaceId, periodLabel, content,
      `Forecast accuracy for ${periodLabel}: ${Math.round(overallAccuracy)}%`
    ]
  );
}

/**
 * Returns formatted accuracy context for LLM/Brief.
 */
export async function getForecastAccuracyContext(workspaceId: string): Promise<string> {
  const res = await query<WorkspaceMemory>(
    `SELECT * FROM workspace_memory 
     WHERE workspace_id = $1 AND memory_type = 'forecast_accuracy' 
     ORDER BY created_at DESC LIMIT 3`,
    [workspaceId]
  );

  if (res.rows.length === 0) return '';

  return buildAccuracyContextString(res.rows);
}

export function buildAccuracyContextString(rows: WorkspaceMemory[]): string {
  let block = `<forecast_accuracy_history>\n`;
  const avgAcc = rows.reduce((sum, r) => sum + (r.content.overall_accuracy || 0), 0) / rows.length;
  
  block += `Over the last ${rows.length} periods, commit accuracy averaged ${Math.round(avgAcc)}%.\n`;
  
  for (const row of rows) {
    const c = row.content as ForecastAccuracyMemory;
    block += `- ${row.period_label}: ${c.overall_accuracy}% accuracy. `;
    if (c.most_reliable_rep) block += `Most reliable: ${c.most_reliable_rep}. `;
    if (c.least_reliable_rep) block += `Least reliable: ${c.least_reliable_rep}.`;
    block += `\n`;
  }
  
  block += `</forecast_accuracy_history>`;
  return block;
}

// ─── Chat Insight Extraction ───────────────────────────────────────────────────

export interface ChatInsight {
  summary: string;
  memory_type: 'chat_insight';
  insight_type: 'priority' | 'concern' | 'commitment' | 'recommendation';
  confidence: number;
}

const CHAT_INSIGHT_PROMPT = `You are a memory extraction assistant. Given a conversation between a revenue operations leader and an AI assistant (Pandora), extract durable insights that would be useful context in a future session.

Extract ONLY items that fall into these categories:
1. **User-stated priorities or concerns** — things the user flagged as important ("I want to focus on net-new only", "the EMEA team is my biggest concern")
2. **Commitments and intentions** — things the user said they would do ("we're going to push X deal", "I want to revisit this next week")
3. **Pandora recommendations** — substantive advice Pandora gave that was well-received by the user (not generic answers)

Rules:
- Return a JSON array of objects: [{ "summary": "...", "memory_type": "chat_insight", "insight_type": "priority"|"concern"|"commitment"|"recommendation", "confidence": 0.0-1.0 }]
- Each summary should be a clear, standalone sentence (30–120 chars) that makes sense without reading the conversation.
- Do NOT extract: greetings, generic questions, data lookups with no strategic context, or Pandora advice that the user ignored or pushed back on.
- Return an empty array [] if there are no meaningful insights to extract.
- Confidence: 0.9 = explicit user statement, 0.7 = strong implication, 0.5 = minor signal.
- Limit to the 5 most important insights.`;

/**
 * Extracts durable chat insights from a conversation history using an LLM pass.
 * Returns an empty list for short conversations or when no extractable insights exist.
 * Gracefully fails open (returns []) on any error.
 */
export async function extractChatInsights(
  workspaceId: string,
  messages: Array<{ role: string; content: string }>
): Promise<ChatInsight[]> {
  try {
    const userTurns = messages.filter(m => m.role === 'user');
    if (userTurns.length < 4) {
      return [];
    }

    const conversationText = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'USER' : 'PANDORA'}: ${m.content.slice(0, 500)}`)
      .join('\n\n');

    const response = await callLLM(workspaceId, 'extract', {
      systemPrompt: CHAT_INSIGHT_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extract insights from this conversation:\n\n${conversationText}\n\nReturn only a JSON array.`,
        },
      ],
      maxTokens: 800,
      temperature: 0.1,
      _tracking: {
        workspaceId,
        phase: 'memory',
        stepName: 'chat-insight-extraction',
      },
    });

    const raw = response.content.trim();
    const jsonStart = raw.indexOf('[');
    const jsonEnd = raw.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1) return [];

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: any) =>
          typeof item.summary === 'string' &&
          item.summary.length > 0 &&
          typeof item.confidence === 'number' &&
          item.confidence >= 0 &&
          item.confidence <= 1
      )
      .map((item: any): ChatInsight => ({
        summary: item.summary,
        memory_type: 'chat_insight',
        insight_type: ['priority', 'concern', 'commitment', 'recommendation'].includes(item.insight_type)
          ? item.insight_type
          : 'priority',
        confidence: Math.min(1, Math.max(0, item.confidence)),
      }));
  } catch (err) {
    console.warn('[workspace-memory] extractChatInsights failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Persists extracted chat insights as workspace_memory records.
 * If an unresolved chat_insight with a matching summary already exists,
 * increments occurrence_count instead of creating a duplicate.
 */
export async function writeChatInsights(
  workspaceId: string,
  insights: ChatInsight[]
): Promise<void> {
  for (const insight of insights) {
    try {
      const existing = await query<{ id: string; occurrence_count: number; summary: string }>(
        `SELECT id, occurrence_count, summary
         FROM workspace_memory
         WHERE workspace_id = $1
           AND memory_type = 'chat_insight'
           AND is_resolved = FALSE`,
        [workspaceId]
      );

      const lowerSummary = insight.summary.toLowerCase();
      const significantWords = lowerSummary.split(/\s+/).filter(w => w.length > 4);
      const duplicate = existing.rows.find(row => {
        const rowLower = row.summary.toLowerCase();
        const overlap = significantWords.filter(w => rowLower.includes(w)).length;
        return overlap / Math.max(significantWords.length, 1) >= 0.6;
      });

      if (duplicate) {
        await query(
          `UPDATE workspace_memory
           SET occurrence_count = occurrence_count + 1,
               last_seen_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [duplicate.id]
        );
      } else {
        await query(
          `INSERT INTO workspace_memory (
            workspace_id, memory_type, entity_type, content, summary
          )
          VALUES ($1, 'chat_insight', 'workspace', $2, $3)`,
          [
            workspaceId,
            { insight_type: insight.insight_type, confidence: insight.confidence },
            insight.summary,
          ]
        );
      }
    } catch (err) {
      console.warn('[workspace-memory] writeChatInsights row failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
  }
}
