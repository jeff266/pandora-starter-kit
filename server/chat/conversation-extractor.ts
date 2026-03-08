import { callLLM } from '../utils/llm-router.js';

export interface ConversationExtractionResult {
  suggested_name: string;
  goal: string;
  standing_questions: string[];
  detected_skills: string[];
  suggested_schedule: {
    cron: string;
    label: string;
  };
  suggested_delivery: {
    format: 'slack' | 'email' | 'command_center';
    channel?: string;
  };
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

interface ChatMessage {
  role: string;
  content: any;
  metadata?: Record<string, any>;
}

// ── Step 1: deterministic skill detection from tool call metadata ──
function detectSkills(messages: ChatMessage[]): string[] {
  const skills = new Set<string>();
  for (const m of messages) {
    if (m.metadata?.skill_id) skills.add(m.metadata.skill_id);
    if (m.metadata?.skills_used) {
      for (const s of m.metadata.skills_used) skills.add(s.skill_id || s);
    }
    if (m.metadata?.skill_evidence_used) {
      for (const s of m.metadata.skill_evidence_used) {
        if (s.skill_id) skills.add(s.skill_id);
      }
    }
  }
  return Array.from(skills);
}

// ── Step 2: DeepSeek extraction of goal + questions ──
async function extractGoalAndQuestions(
  messages: ChatMessage[],
  workspaceId: string
): Promise<{ goal: string; questions: string[] }> {
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n\n');

  if (!userMessages.trim()) {
    return { goal: 'Monitor revenue operations performance', questions: [] };
  }

  try {
    const result = await callLLM(workspaceId, 'extract', {
      messages: [
        {
          role: 'user',
          content: `You are analyzing a RevOps analyst's conversation with an AI assistant.

Extract:
1. goal: The single business goal motivating this conversation (1 sentence, max 120 chars)
2. questions: The 3-5 most substantive questions the user asked. Rephrase as recurring standing questions — things that should be answered every time this report runs, not just today.

User messages:
${userMessages.slice(0, 2000)}

Respond ONLY with JSON: { "goal": "...", "questions": ["...", "..."] }`,
        },
      ],
      maxTokens: 400,
      temperature: 0.2,
    });

    const text = result.content?.[0]?.text || result.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        goal: parsed.goal || 'Monitor revenue operations performance',
        questions: (parsed.questions || []).slice(0, 5),
      };
    }
  } catch (e) {
    console.error('[ConversationExtractor] LLM extraction failed:', e);
  }

  return { goal: 'Monitor revenue operations performance', questions: [] };
}

// ── Step 3: schedule heuristic ──
interface Schedule {
  cron: string;
  label: string;
}

function inferSchedule(messages: ChatMessage[]): Schedule {
  const text = messages
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join(' ')
    .toLowerCase();

  if (/daily|every day|each day|this morning/.test(text)) {
    return { cron: '0 7 * * 1-5', label: 'Every weekday at 7 AM' };
  }
  if (/monthly|end of month|month over month/.test(text)) {
    return { cron: '0 8 1 * *', label: '1st of every month at 8 AM' };
  }
  if (/quarterly|qbr|end of quarter/.test(text)) {
    return { cron: '', label: 'On demand' };
  }
  if (/forecast|monday morning|call prep/.test(text)) {
    return { cron: '0 7 * * 1', label: 'Every Monday at 7 AM' };
  }
  if (/weekly|this week|last week|week over week/.test(text)) {
    return { cron: '0 8 * * 1', label: 'Every Monday at 8 AM' };
  }
  // default
  return { cron: '0 8 * * 1', label: 'Every Monday at 8 AM' };
}

// ── Step 4: name generation ──
function generateName(goal: string, schedule: Schedule): string {
  const g = goal.toLowerCase();
  const isMonday = schedule.label.includes('Monday');
  const isWeekly = schedule.label.includes('Monday') || schedule.label.includes('Weekly');
  const isDaily = schedule.label.includes('weekday') || schedule.label.includes('Daily');
  const isMonthly = schedule.label.includes('month');
  const isOnDemand = schedule.label === 'On demand';

  const prefix = isMonday && !isDaily
    ? 'Monday'
    : isWeekly ? 'Weekly'
    : isDaily ? 'Daily'
    : isMonthly ? 'Monthly'
    : isOnDemand ? 'On-Demand'
    : 'Weekly';

  if (/pipeline.*health|health.*pipeline/.test(g)) return `${prefix} Pipeline Health`.slice(0, 40);
  if (/forecast/.test(g)) return `${prefix} Forecast Brief`.slice(0, 40);
  if (/rep.*perform|perform.*rep|scorecard/.test(g)) return `${prefix} Rep Scorecard`.slice(0, 40);
  if (/pipeline.*coverage|coverage.*pipeline/.test(g)) return `${prefix} Coverage Check`.slice(0, 40);
  if (/hygiene|data.*quality/.test(g)) return `${prefix} Hygiene Review`.slice(0, 40);
  if (/pipeline/.test(g)) return `${prefix} Pipeline Review`.slice(0, 40);
  if (/attainment|quota/.test(g)) return `${prefix} Quota Review`.slice(0, 40);
  if (/risk/.test(g)) return `${prefix} Risk Briefing`.slice(0, 40);

  // Fallback: take first 3 meaningful words from goal
  const words = goal.replace(/[^a-zA-Z ]/g, '').split(/\s+/).filter(w => w.length > 3).slice(0, 3);
  const suffix = words.length > 0 ? words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Briefing';
  return `${prefix} ${suffix}`.slice(0, 40);
}

// ── Step 5: delivery inference ──
function inferDelivery(messages: ChatMessage[]): ConversationExtractionResult['suggested_delivery'] {
  const text = messages
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join(' ')
    .toLowerCase();

  const slackChannelMatch = text.match(/#([a-z0-9_-]+)/);
  if (slackChannelMatch) {
    return { format: 'slack', channel: `#${slackChannelMatch[1]}` };
  }
  if (/email/.test(text)) return { format: 'email' };
  return { format: 'slack' };
}

// ── Step 6: confidence ──
function computeConfidence(
  messages: ChatMessage[],
  skills: string[]
): ConversationExtractionResult['confidence'] {
  const turns = messages.filter(m => m.role === 'user').length;
  if (turns >= 5 && skills.length >= 2) return 'high';
  if (turns >= 3 || skills.length >= 1) return 'medium';
  return 'low';
}

// ── Main export ──
export async function extractAgentFromConversation(
  messages: ChatMessage[],
  workspaceId: string
): Promise<ConversationExtractionResult> {
  const [detectedSkills, { goal, questions }, schedule] = await Promise.all([
    Promise.resolve(detectSkills(messages)),
    extractGoalAndQuestions(messages, workspaceId),
    Promise.resolve(inferSchedule(messages)),
  ]);

  const delivery = inferDelivery(messages);
  const confidence = computeConfidence(messages, detectedSkills);
  const suggested_name = generateName(goal, schedule);

  return {
    suggested_name,
    goal,
    standing_questions: questions,
    detected_skills: detectedSkills,
    suggested_schedule: schedule,
    suggested_delivery: delivery,
    confidence,
    reasoning: `Detected ${detectedSkills.length} skill(s), ${messages.filter(m => m.role === 'user').length} user turns. Schedule inferred from conversation content.`,
  };
}
