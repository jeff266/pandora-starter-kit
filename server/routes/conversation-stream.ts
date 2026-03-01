import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { assembleBrief } from '../briefing/brief-assembler.js';
import { createInvestigationPlan, getOperatorMeta } from '../investigation/planner.js';
import { executeInvestigation } from '../investigation/executor.js';
import { classifyComplexity } from '../investigation/complexity-gate.js';
import { synthesizeSingleSkill, getMostRecentSkillRun } from '../investigation/single-skill-synthesis.js';
import { goalService } from '../goals/goal-service.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { getSkillRegistry } from '../skills/registry.js';
import type { InvestigationStep } from '../goals/types.js';

const router = Router();

const FALLBACK_OPERATORS = [
  { id: 'pipeline-coverage', name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE', task: 'Analyzing pipeline health and deal distribution' },
  { id: 'forecast-rollup', name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8', task: 'Building forecast model and confidence range' },
];

function sse(res: Response, event: object): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  if ((res as any).flush) (res as any).flush();
}

function resolveOperatorMeta(skillId: string): { name: string; icon: string; color: string } {
  return getOperatorMeta(skillId);
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
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // ── Classify complexity before any LLM call ──────────────────────────────
    const hasGoals = await goalService
      .list(workspaceId, { is_active: true })
      .then((g) => g.length > 0)
      .catch(() => false);

    const recentRunsResult = await query(
      `SELECT COUNT(*) as cnt FROM skill_runs WHERE workspace_id = $1 AND status = 'completed' AND started_at >= NOW() - INTERVAL '1 hour'`,
      [workspaceId],
    ).catch(() => ({ rows: [{ cnt: '0' }] }));

    const complexity = await classifyComplexity(message, {
      hasStructuredGoals: hasGoals,
      recentSkillRunCount: parseInt((recentRunsResult.rows[0] as any)?.cnt || '0'),
    });

    console.log(
      JSON.stringify({
        event: 'investigation_gate',
        workspace_id: workspaceId,
        message: message.substring(0, 100),
        tier: complexity.tier,
        primary_skill: complexity.primary_skill,
        max_skills: complexity.max_skills,
        reasoning: complexity.reasoning,
        timestamp: new Date().toISOString(),
      }),
    );

    // ── Tier 1: Lookup — single skill, cache-first, lightweight synthesis ────
    if (complexity.tier === 'lookup') {
      const primarySkill = complexity.primary_skill ?? 'forecast-rollup';
      const meta = resolveOperatorMeta(primarySkill);

      sse(res, {
        type: 'recruiting',
        agent_id: primarySkill,
        agent_name: meta.name,
        icon: meta.icon,
        color: meta.color,
        task: `Looking up ${complexity.reasoning}`,
      });

      sse(res, { type: 'agent_thinking', agent_id: primarySkill });

      let skillRun = await getMostRecentSkillRun(workspaceId, primarySkill, 120);

      if (!skillRun) {
        // Run the skill fresh
        try {
          const registry = getSkillRegistry();
          const skillDef = registry.get(primarySkill);
          if (skillDef) {
            const result = await getSkillRuntime().executeSkill(skillDef, workspaceId, {});
            skillRun = {
              id: result.runId,
              skill_id: primarySkill,
              output_text: result.output || '',
              result: result,
            };
          }
        } catch (skillErr) {
          console.error('[conversation-stream] Tier 1 skill execution failed:', skillErr);
        }
      }

      const preview = skillRun
        ? (skillRun.output_text || '').split('\n').find((l: string) => l.trim().length > 20)?.trim() ?? 'Analysis complete'
        : 'No recent data available';

      sse(res, { type: 'agent_found', agent_id: primarySkill, finding_preview: preview.substring(0, 100) });
      sse(res, {
        type: 'agent_done',
        agent_id: primarySkill,
        finding: { agent_id: primarySkill, agent_name: meta.name, summary: preview, severity: 'info' },
      });

      sse(res, { type: 'synthesis_start' });

      if (skillRun) {
        const synthesis = await synthesizeSingleSkill(workspaceId, message, skillRun, { goalContext: hasGoals });
        sse(res, { type: 'synthesis_chunk', text: synthesis.text });
        sse(res, { type: 'synthesis_done', full_text: synthesis.text });
      } else {
        const fallback = 'I don\'t have recent data for that — try running a skill scan first.';
        sse(res, { type: 'synthesis_chunk', text: fallback });
        sse(res, { type: 'synthesis_done', full_text: fallback });
      }
    }

    // ── Tier 2: Focused — 1-2 skills, cache preferred, no LLM planner call ─
    // ── Tier 3: Investigation — full chain, LLM planner, fresh OK ────────────
    else {
      const isFocused = complexity.tier === 'focused';
      const maxSteps = isFocused ? 2 : 4;
      const preferCache = isFocused;

      let plan;
      let usedFallback = false;

      try {
        plan = await createInvestigationPlan(workspaceId, message, {
          maxSteps,
          preferCache,
          primarySkill: complexity.primary_skill ?? undefined,
        });
      } catch (planErr) {
        console.error('[conversation-stream] Planning failed, using fallback:', planErr);
        usedFallback = true;
      }

      if (!plan || plan.steps.length === 0) {
        usedFallback = true;
      }

      if (usedFallback) {
        // Fallback: simple briefing-based response
        for (const op of FALLBACK_OPERATORS) {
          sse(res, { type: 'recruiting', agent_id: op.id, agent_name: op.name, icon: op.icon, color: op.color, task: op.task });
        }

        const briefItems = await assembleBrief(workspaceId, { maxItems: 4 });
        const findingContext = briefItems.length > 0
          ? briefItems.map((b) => `[${b.severity.toUpperCase()}] ${b.headline}`).join('\n')
          : 'No recent findings';

        for (const op of FALLBACK_OPERATORS) {
          sse(res, { type: 'agent_thinking', agent_id: op.id });
          const preview = briefItems.find((b) => b.operator_name === op.name)?.headline ?? briefItems[0]?.headline ?? `No findings from ${op.name}`;
          sse(res, { type: 'agent_found', agent_id: op.id, finding_preview: preview.substring(0, 80) });
          sse(res, {
            type: 'agent_done',
            agent_id: op.id,
            finding: { agent_id: op.id, agent_name: op.name, summary: preview, severity: briefItems[0]?.severity ?? 'info' },
          });
        }

        sse(res, { type: 'synthesis_start' });

        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        });

        const chatMessages = [
          ...(history as { role: string; content: string }[])
            .filter((m) => m.role && m.content)
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user' as const, content: message },
        ];

        const stream = anthropic.messages.stream({
          model: 'claude-sonnet-4-5',
          max_tokens: 512,
          system: `You are Pandora, a RevOps intelligence assistant. Answer concisely.\n\nRecent findings:\n${findingContext}\n\nRespond in 2-4 sentences. Be specific.`,
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
          sse(res, {
            type: 'evidence',
            cards: briefItems.slice(0, 3).map((b) => ({
              id: b.id, title: b.headline, severity: b.severity,
              operator_name: b.operator_name, operator_icon: b.operator_icon,
              operator_color: b.operator_color, body: b.body, skill_run_id: b.skill_run_id,
            })),
          });
        }
      } else {
        // Investigation path (Tier 2 or Tier 3)
        for (const step of plan!.steps) {
          const meta = resolveOperatorMeta(step.skill_id);
          sse(res, {
            type: 'recruiting',
            agent_id: step.skill_id,
            agent_name: step.operator_name ?? meta.name,
            icon: meta.icon,
            color: meta.color,
            task: step.question_answered ?? `Analyzing ${step.skill_id}`,
          });
        }

        const result = await executeInvestigation(plan!, {
          onStepStart: (step: InvestigationStep) => {
            sse(res, { type: 'agent_thinking', agent_id: step.skill_id });
          },
          onStepComplete: (step: InvestigationStep, findings: string[]) => {
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
              task: newStep.triggered_by?.reasoning ?? newStep.question_answered ?? 'Following up...',
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
          sse(res, {
            type: 'evidence',
            cards: recentFindings.rows.map((row: any) => ({
              id: row.id, title: row.headline, severity: row.severity,
              operator_name: row.operator_name, body: row.body, skill_run_id: row.skill_run_id,
            })),
          });
        }
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
