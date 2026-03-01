import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { assembleBrief } from '../briefing/brief-assembler.js';
import { createInvestigationPlan, getOperatorMeta } from '../investigation/planner.js';
import { executeInvestigation } from '../investigation/executor.js';
import type { InvestigationStep } from '../goals/types.js';

const router = Router();

const FALLBACK_OPERATORS = [
  { id: 'pipeline-state', name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE', task: 'Analyzing pipeline health and deal distribution' },
  { id: 'forecast-call-prep', name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8', task: 'Building forecast model and confidence range' },
];

const SKILL_OPERATOR_MAP: Record<string, { name: string; icon: string; color: string }> = {
  'pipeline-waterfall': { name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE' },
  'pipeline-hygiene': { name: 'Data Steward', icon: '🧹', color: '#FBBF24' },
  'forecast-rollup': { name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8' },
  'rep-scorecard': { name: 'Team Analyst', icon: '👥', color: '#34D399' },
  'deal-risk': { name: 'Deal Analyst', icon: '🔍', color: '#FB923C' },
  'conversation-intelligence': { name: 'Conversation Analyst', icon: '💬', color: '#A78BFA' },
  'account-scoring': { name: 'Account Analyst', icon: '🏢', color: '#60A5FA' },
};

function sse(res: Response, event: object): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function resolveOperatorMeta(skillId: string): { name: string; icon: string; color: string } {
  const direct = SKILL_OPERATOR_MAP[skillId];
  if (direct) return direct;
  const fromPlanner = getOperatorMeta(skillId);
  return fromPlanner;
}

router.post('/:workspaceId/conversation/stream', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { message, history = [] } = req.body as { message: string; history?: { role: string; content: string }[] };

  if (!message?.trim()) {
    res.status(400).json({ error: 'message required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let plan;
    let usedFallback = false;

    try {
      plan = await createInvestigationPlan(workspaceId, message, { maxSteps: 4 });
    } catch (planErr) {
      console.error('[conversation-stream] Planning failed, using fallback:', planErr);
      usedFallback = true;
    }

    if (!plan || plan.steps.length === 0) {
      usedFallback = true;
    }

    if (usedFallback) {
      for (const op of FALLBACK_OPERATORS) {
        sse(res, { type: 'recruiting', agent_id: op.id, agent_name: op.name, icon: op.icon, color: op.color, task: op.task });
      }
    } else {
      for (const step of plan!.steps) {
        const meta = resolveOperatorMeta(step.skill_id);
        sse(res, {
          type: 'recruiting',
          agent_id: step.skill_id,
          agent_name: step.operator_name ?? meta.name,
          icon: meta.icon,
          color: meta.color,
          task: step.question_answered,
        });
      }
    }

    if (usedFallback) {
      const briefItems = await assembleBrief(workspaceId, { maxItems: 4 });
      const findingContext = briefItems.length > 0
        ? briefItems.map(b => `[${b.severity.toUpperCase()}] ${b.headline}`).join('\n')
        : 'No recent findings';

      for (const op of FALLBACK_OPERATORS) {
        sse(res, { type: 'agent_thinking', agent_id: op.id });
        const preview = briefItems.find(b => b.operator_name === op.name)?.headline ?? briefItems[0]?.headline ?? `No findings from ${op.name}`;
        sse(res, { type: 'agent_found', agent_id: op.id, finding_preview: preview.substring(0, 80) });
        sse(res, {
          type: 'agent_done',
          agent_id: op.id,
          finding: {
            agent_id: op.id,
            agent_name: op.name,
            summary: preview,
            severity: briefItems[0]?.severity ?? 'info',
          },
        });
      }

      sse(res, { type: 'synthesis_start' });

      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      });

      const chatMessages = [
        ...(history as { role: string; content: string }[])
          .filter(m => m.role && m.content)
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: message },
      ];

      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 512,
        system: `You are Pandora, a RevOps intelligence assistant. Answer concisely and directly.\n\nRecent workspace findings:\n${findingContext}\n\nRespond in 2-4 sentences. Be specific to the data provided.`,
        messages: chatMessages,
      });

      let fullText = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
          fullText += event.delta.text;
          sse(res, { type: 'synthesis_chunk', text: event.delta.text });
        }
      }

      sse(res, { type: 'synthesis_done', full_text: fullText });

      if (briefItems.length > 0) {
        const evidenceCards = briefItems.slice(0, 3).map(b => ({
          id: b.id,
          title: b.headline,
          severity: b.severity,
          operator_name: b.operator_name,
          operator_icon: b.operator_icon,
          operator_color: b.operator_color,
          body: b.body,
          skill_run_id: b.skill_run_id,
        }));
        sse(res, { type: 'evidence', cards: evidenceCards });
      }
    } else {
      const stepFindings: Map<string, string[]> = new Map();

      const result = await executeInvestigation(plan!, {
        onStepStart: (step: InvestigationStep) => {
          sse(res, { type: 'agent_thinking', agent_id: step.skill_id });
        },
        onStepComplete: (step: InvestigationStep, findings: string[]) => {
          stepFindings.set(step.skill_id, findings);
          const preview = findings[0] ?? `Analysis complete for ${step.operator_name ?? step.skill_id}`;
          const meta = resolveOperatorMeta(step.skill_id);
          sse(res, { type: 'agent_found', agent_id: step.skill_id, finding_preview: preview.substring(0, 100) });
          sse(res, {
            type: 'agent_done',
            agent_id: step.skill_id,
            finding: {
              agent_id: step.skill_id,
              agent_name: step.operator_name ?? meta.name,
              summary: preview,
              severity: findings.length > 2 ? 'act' : 'watch',
            },
          });
        },
        onFollowUpDecided: (_fromStep: number, newStep: InvestigationStep) => {
          const meta = resolveOperatorMeta(newStep.skill_id);
          sse(res, {
            type: 'recruiting',
            agent_id: newStep.skill_id,
            agent_name: newStep.operator_name ?? meta.name,
            icon: meta.icon,
            color: meta.color,
            task: newStep.triggered_by?.reasoning ?? newStep.question_answered,
          });
        },
        onSynthesisStart: () => {
          sse(res, { type: 'synthesis_start' });
        },
        onSynthesisChunk: (text: string) => {
          sse(res, { type: 'synthesis_chunk', text });
        },
      });

      sse(res, { type: 'synthesis_done', full_text: result.synthesis });

      const recentFindings = await query(
        `SELECT f.id, f.category AS headline, f.severity, f.skill_id AS operator_name, f.message AS body, f.skill_run_id
         FROM findings f
         WHERE f.workspace_id = $1 AND f.resolved_at IS NULL
         ORDER BY f.created_at DESC LIMIT 3`,
        [workspaceId],
      ).catch(() => ({ rows: [] }));

      if (recentFindings.rows.length > 0) {
        const evidenceCards = recentFindings.rows.map((row: any) => ({
          id: row.id,
          title: row.headline,
          severity: row.severity,
          operator_name: row.operator_name,
          body: row.body,
          skill_run_id: row.skill_run_id,
        }));
        sse(res, { type: 'evidence', cards: evidenceCards });
      }
    }

    sse(res, {
      type: 'deliverable_options',
      options: [
        { id: 'slides', label: 'Slides', icon: '📊', sub: 'Board-ready deck' },
        { id: 'doc', label: 'Doc', icon: '📄', sub: 'Written briefing' },
        { id: 'slack', label: 'Slack', icon: '💬', sub: 'Team summary' },
        { id: 'email', label: 'Email', icon: '📧', sub: 'Executive update' },
      ],
    });

    sse(res, { type: 'done' });
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[conversation-stream] error:', msg);
    if (res.headersSent) {
      sse(res, { type: 'error', message: msg });
      res.end();
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
