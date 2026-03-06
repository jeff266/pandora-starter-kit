import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { goalService } from '../goals/goal-service.js';
import { getSkillRegistry } from '../skills/registry.js';
import { buildWorkspaceContextBlock } from '../context/workspace-memory.js';
import type { InvestigationPlan, InvestigationStep } from '../goals/types.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
});

const SKILL_OPERATOR_MAP: Record<string, { name: string; icon: string; color: string }> = {
  'pipeline-hygiene': { name: 'Data Steward', icon: '🧹', color: '#FBBF24' },
  'forecast-rollup': { name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8' },
  'pipeline-coverage': { name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE' },
  'deal-risk-review': { name: 'Deal Analyst', icon: '🔍', color: '#FB923C' },
  'rep-scorecard': { name: 'Performance Coach', icon: '🏆', color: '#34D399' },
  'single-thread-alert': { name: 'Risk Scout', icon: '⚠️', color: '#F87171' },
  'data-quality-audit': { name: 'Data Steward', icon: '🧹', color: '#FBBF24' },
  'weekly-recap': { name: 'Weekly Analyst', icon: '📅', color: '#60A5FA' },
  'pipeline-waterfall': { name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE' },
};

export function getOperatorMeta(skillId: string): { name: string; icon: string; color: string } {
  return SKILL_OPERATOR_MAP[skillId] || { name: 'Intelligence Analyst', icon: '🤖', color: '#A78BFA' };
}

function parseJsonFromResponse(text: string): any {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenceMatch ? fenceMatch[1] : text;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response');
  return JSON.parse(jsonMatch[0]);
}

export async function createInvestigationPlan(
  workspaceId: string,
  question: string,
  options?: {
    maxSteps?: number;
    goalIds?: string[];
    anchorFindings?: any[];
    preferCache?: boolean;
    primarySkill?: string;
  },
): Promise<InvestigationPlan> {
  // Fast path: skip LLM planning when a primary skill is already known and scope is narrow
  if (options?.primarySkill && (options?.maxSteps ?? 5) <= 2) {
    const meta = getOperatorMeta(options.primarySkill);
    return {
      id: randomUUID(),
      workspace_id: workspaceId,
      question,
      goal_context: [],
      steps: [
        {
          index: 0,
          operator_name: meta.name,
          skill_id: options.primarySkill,
          trigger: 'initial',
          status: 'pending',
          used_cache: false,
        } as InvestigationStep,
      ],
      current_step: 0,
      status: 'planning',
      max_steps: options?.maxSteps ?? 2,
      prefer_cache: options?.preferCache ?? true,
      total_tokens: 0,
    };
  }

  const [goals, recentFindingsResult, contextBlock] = await Promise.all([
    options?.goalIds
      ? Promise.all(options.goalIds.map((id) => goalService.getById(id)))
      : goalService.list(workspaceId, { is_active: true }),
    query<{ skill_id: string; category: string; message: string; times_flagged: number; trend: string }>(
      `SELECT skill_id, category, message, times_flagged, trend FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL
       ORDER BY severity ASC, created_at DESC LIMIT 15`,
      [workspaceId],
    ),
    buildWorkspaceContextBlock(workspaceId).catch(() => ''),
  ]);

  const registry = getSkillRegistry();
  const allSkills = registry.listAll();

  // Suppress built-ins that are overridden by a custom skill
  const overriddenSlugs = new Set(
    allSkills.filter(s => s.replacesSkillId).map(s => s.replacesSkillId!)
  );
  const skills = allSkills.filter(s => !overriddenSlugs.has(s.id));

  const goalsFiltered = goals.filter(Boolean);
  const recentFindings = recentFindingsResult.rows;

  const planPrompt = `${contextBlock ? contextBlock + '\n\n' : ''}You are planning an investigation to answer this question:
"${question}"

AVAILABLE SKILLS:
${skills.map((s) => {
  const base = `- ${s.id}: ${s.name} (${s.category})`;
  const desc = s.description?.trim();
  return desc ? `${base} — answers: "${desc}"` : base;
}).join('\n')}

ACTIVE GOALS:
${goalsFiltered.length > 0
  ? goalsFiltered.map((g) => `- ${(g as any).label}: $${(g as any).target_value} target (${(g as any).metric_type}, ${(g as any).period})`).join('\n')
  : 'No structured goals configured.'}

RECENT UNRESOLVED FINDINGS:
${recentFindings.length > 0
  ? recentFindings.map((f) => `- [${f.category}] ${f.message} (flagged ${f.times_flagged}x, ${f.trend || 'new'})`).join('\n')
  : 'No unresolved findings.'}

${options?.anchorFindings?.length
  ? `STARTING CONTEXT (already known):\n${options.anchorFindings.map((f) => `- ${f.message}`).join('\n')}`
  : ''}

Plan 2-4 investigation steps. Start with the broadest question and narrow based on what each step reveals.
The first skill should directly address the question. Subsequent skills investigate the "why" behind initial findings.

Respond ONLY with valid JSON in this exact format:
{
  "steps": [
    {
      "skill_id": "forecast-rollup",
      "reasoning": "Check overall forecast health to answer the question",
      "question_answered": "What is the current forecast landing range?",
      "potential_follow_ups": ["If behind, investigate pipeline generation"]
    }
  ]
}`;

  let steps: InvestigationStep[] = [];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      temperature: 0.3,
      messages: [{ role: 'user', content: planPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = parseJsonFromResponse(text);

    const validSkillIds = new Set(skills.map((s) => s.id));

    steps = (parsed.steps || [])
      .filter((s: any) => s.skill_id && validSkillIds.has(s.skill_id))
      .slice(0, options?.maxSteps || 4)
      .map((s: any, i: number) => {
        const meta = getOperatorMeta(s.skill_id);
        return {
          index: i,
          operator_name: meta.name,
          skill_id: s.skill_id,
          trigger: i === 0 ? 'initial' : 'follow_up',
          triggered_by: i > 0
            ? { step_index: i - 1, finding_type: 'planned', reasoning: s.reasoning }
            : undefined,
          status: 'pending',
          used_cache: false,
        } as InvestigationStep;
      });
  } catch (err) {
    console.error('[InvestigationPlanner] Planning failed, using fallback:', err);
    const fallbackMeta = getOperatorMeta('forecast-rollup');
    steps = [{
      index: 0,
      operator_name: fallbackMeta.name,
      skill_id: 'forecast-rollup',
      trigger: 'initial',
      status: 'pending',
      used_cache: false,
    }];
  }

  if (steps.length === 0) {
    const fallbackMeta = getOperatorMeta('pipeline-hygiene');
    steps = [{
      index: 0,
      operator_name: fallbackMeta.name,
      skill_id: 'pipeline-hygiene',
      trigger: 'initial',
      status: 'pending',
      used_cache: false,
    }];
  }

  return {
    id: randomUUID(),
    workspace_id: workspaceId,
    question,
    goal_context: goalsFiltered,
    steps,
    current_step: 0,
    status: 'planning',
    max_steps: options?.maxSteps || 4,
    prefer_cache: options?.preferCache ?? false,
    total_tokens: 0,
  };
}
