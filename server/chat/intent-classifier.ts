import { callLLM } from '../utils/llm-router.js';

export interface ThreadReplyIntent {
  type: 'drill_down' | 'scope_filter' | 'add_context' | 'question' | 'action' | 'unknown';
  entity_type?: 'deal' | 'account' | 'rep';
  entity_name?: string;
  filter_type?: 'rep' | 'stage' | 'pipeline' | 'segment';
  filter_value?: string;
  context_text?: string;
  deal_name?: string;
  action_type?: 'snooze' | 'dismiss' | 'reviewed';
  target?: string;
}

export interface DirectQuestionRoute {
  type: 'data_query' | 'skill_trigger' | 'comparison' | 'explanation' | 'action_request' | 'unknown';
  entities?: string[];
  metrics?: string[];
  filters?: Record<string, string>;
  skill_id?: string;
  compare_a?: string;
  compare_b?: string;
  metric?: string;
  topic?: string;
  entity_name?: string;
  action_type?: string;
  target?: string;
}

export async function classifyThreadReply(
  workspaceId: string,
  message: string,
  skillId: string
): Promise<ThreadReplyIntent> {
  try {
    const response = await callLLM(workspaceId, 'classify', {
      systemPrompt: `You classify user replies to RevOps skill reports. Respond with ONLY valid JSON.`,
      messages: [{
        role: 'user',
        content: `The reply was made in a thread under a "${skillId}" report.

Classify the intent:
1. drill_down — user wants more detail on a specific deal, account, or rep
   Extract: entity_type (deal/account/rep), entity_name
2. scope_filter — user wants the analysis re-run with a filter
   Extract: filter_type (rep/stage/pipeline/segment), filter_value
3. add_context — user is adding information/context about a deal or situation
   Extract: deal_name (if mentioned), context_text
4. question — user is asking a question about the data or findings
5. action — user wants to take an action (snooze, dismiss, mark reviewed)
   Extract: action_type, target
6. unknown — cannot determine intent

User message: "${message}"

Respond with ONLY JSON: { "type": "...", ... }`,
      }],
      maxTokens: 200,
      temperature: 0,
      _tracking: {
        workspaceId,
        phase: 'chat',
        stepName: 'classify-thread-reply',
      },
    });

    return safeParseIntent<ThreadReplyIntent>(response.content, { type: 'unknown' });
  } catch (err) {
    console.error('[intent-classifier] Thread reply classification error:', err);
    return { type: 'unknown' };
  }
}

export async function classifyDirectQuestion(
  workspaceId: string,
  question: string,
  skillIds: string[],
  repNames: string[]
): Promise<DirectQuestionRoute> {
  try {
    const response = await callLLM(workspaceId, 'classify', {
      systemPrompt: `You route natural language questions to handlers in a RevOps analytics platform. Respond with ONLY valid JSON.`,
      messages: [{
        role: 'user',
        content: `Available skills: ${skillIds.join(', ')}
Known rep names: ${repNames.join(', ')}

Classify the question:
1. data_query — asking for specific data (pipeline numbers, deal counts, rep metrics)
   Extract: entities (deals/reps/accounts), metrics (pipeline/coverage/forecast), filters (rep, stage, date range)
2. skill_trigger — asking to run a specific analysis
   Extract: skill_id (best match from available skills)
3. comparison — asking to compare two things (time periods, reps, segments)
   Extract: compare_a, compare_b, metric
4. explanation — asking why something is the way it is
   Extract: topic, entity_name
5. action_request — asking to take an action
   Extract: action_type, target
6. unknown — cannot determine intent

Question: "${question}"

Respond with ONLY JSON: { "type": "...", ... }`,
      }],
      maxTokens: 300,
      temperature: 0,
      _tracking: {
        workspaceId,
        phase: 'chat',
        stepName: 'classify-direct-question',
      },
    });

    return safeParseIntent<DirectQuestionRoute>(response.content, { type: 'unknown' });
  } catch (err) {
    console.error('[intent-classifier] Direct question classification error:', err);
    return { type: 'unknown' };
  }
}

function safeParseIntent<T>(content: string, fallback: T): T {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return fallback;
  }
}
