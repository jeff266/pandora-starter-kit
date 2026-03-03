import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { assembleBrief } from '../briefing/brief-assembler.js';
import { resolveFromBrief } from '../briefing/brief-resolver.js';
import { createInvestigationPlan, getOperatorMeta } from '../investigation/planner.js';
import { executeInvestigation } from '../investigation/executor.js';
import { classifyComplexity } from '../investigation/complexity-gate.js';
import { synthesizeSingleSkill, getMostRecentSkillRun } from '../investigation/single-skill-synthesis.js';
import { executeDataQuery } from '../investigation/data-query-executor.js';
import { goalService } from '../goals/goal-service.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { getSkillRegistry } from '../skills/registry.js';
import { createConversationState, getConversationState, appendMessage } from '../chat/conversation-state.js';
import { buildWorkspaceContextBlock } from '../context/workspace-memory.js';
import { getOrAssembleBrief, renderBriefContext, BRIEF_SYSTEM_PROMPT } from '../context/opening-brief.js';
import { runPandoraAgent } from '../chat/pandora-agent.js';
import type { InvestigationStep } from '../goals/types.js';

const router = Router();

const CHANNEL_ID = 'command_center';

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

async function persistExchange(
  workspaceId: string,
  threadId: string,
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  const now = new Date().toISOString();
  await appendMessage(workspaceId, CHANNEL_ID, threadId, { role: 'user', content: userMsg, timestamp: now }).catch(() => null);
  await appendMessage(workspaceId, CHANNEL_ID, threadId, { role: 'assistant', content: assistantMsg, timestamp: now }).catch(() => null);
}

// ── GET history ───────────────────────────────────────────────────────────────
router.get('/:workspaceId/conversation/history/:threadId', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, threadId } = req.params as { workspaceId: string; threadId: string };
  try {
    const state = await getConversationState(workspaceId, CHANNEL_ID, threadId);
    res.json({ thread_id: threadId, messages: state ? state.messages : [] });
  } catch (err) {
    res.json({ thread_id: threadId, messages: [] });
  }
});

// ── POST stream ───────────────────────────────────────────────────────────────
router.post('/:workspaceId/conversation/stream', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { message, thread_id } = req.body as { message: string; thread_id?: string };

  if (!message?.trim()) {
    res.status(400).json({ error: 'message required' });
    return;
  }

  // ── Resolve / create conversation thread ────────────────────────────────────
  const workingThreadId: string = thread_id || randomUUID();
  let history: { role: string; content: string }[] = [];

  try {
    if (thread_id) {
      const existing = await getConversationState(workspaceId, CHANNEL_ID, thread_id);
      if (existing) {
        history = existing.messages.map(m => ({ role: m.role, content: m.content }));
      }
      // Refresh TTL regardless
      await createConversationState(workspaceId, CHANNEL_ID, thread_id, 'command_center');
    } else {
      await createConversationState(workspaceId, CHANNEL_ID, workingThreadId, 'command_center');
    }
  } catch (stateErr) {
    console.error('[conversation-stream] state init error (non-fatal):', stateErr);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const userId = (req as any).user?.user_id as string | undefined;
  const contextBlock = await buildWorkspaceContextBlock(workspaceId, userId).catch(() => '');

  // ── Opening brief (new conversations only) ──────────────────────────────────
  // A new conversation has no thread_id in the request. We assemble a role-scoped
  // brief (cached 5 min) and prepend it to the user message so Claude synthesizes
  // the brief AND answers any question in a single pass.
  const isNewConversation = !thread_id;
  let briefContextBlock = '';
  let effectiveMessage = message;

  if (isNewConversation && userId) {
    try {
      const briefData = await getOrAssembleBrief(workspaceId, userId);
      briefContextBlock = renderBriefContext(briefData);
      effectiveMessage = briefContextBlock + '\n\n' + message;
    } catch (briefErr) {
      console.warn('[conversation-stream] Opening brief assembly failed (non-fatal):', briefErr);
    }
  }

  // Combined system context: workspace memory + optional brief instructions
  const fullContextBlock = briefContextBlock
    ? `${BRIEF_SYSTEM_PROMPT}\n\n${contextBlock}`
    : contextBlock;

  try {
    // ── Opening brief delivery (new conversation + brief assembled) ─────────
    // When a user opens a new conversation and we have a brief, skip normal
    // Tier routing and route directly through the Anthropic stream so Claude
    // has full token budget and unmodified synthesis instructions.
    if (isNewConversation && briefContextBlock && userId) {
      sse(res, { type: 'synthesis_start' });
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY });
      const systemForBrief = [
        BRIEF_SYSTEM_PROMPT,
        contextBlock,
      ].filter(Boolean).join('\n\n');
      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: systemForBrief,
        messages: [{ role: 'user', content: effectiveMessage }],
      });
      let fullBriefText = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
          fullBriefText += event.delta.text;
          sse(res, { type: 'synthesis_chunk', text: event.delta.text });
        }
      }
      const briefRespId = randomUUID();
      sse(res, { type: 'synthesis_done', full_text: fullBriefText, response_id: briefRespId });
      sse(res, {
        type: 'deliverable_options',
        options: [
          { id: 'slides', label: 'Slides', icon: '📊', sub: 'Board-ready deck' },
          { id: 'doc', label: 'Doc', icon: '📄', sub: 'Written briefing' },
          { id: 'slack', label: 'Slack', icon: '💬', sub: 'Team summary' },
          { id: 'email', label: 'Email', icon: '📧', sub: 'Executive update' },
        ],
      });
      await persistExchange(workspaceId, workingThreadId, message, fullBriefText);
      sse(res, { type: 'done', thread_id: workingThreadId });
      res.end();
      return;
    }

    // ── Brief resolver — cache-first, zero tokens ─────────────────────────────
    const briefAnswer = await resolveFromBrief(workspaceId, message).catch(() => null);
    if (briefAnswer) {
      const briefResponseId = randomUUID();
      console.log(JSON.stringify({ event: 'brief_resolver_hit', workspace_id: workspaceId, section: briefAnswer.section, tokens_used: 0, timestamp: new Date().toISOString() }));
      sse(res, { type: 'synthesis_start' });
      sse(res, { type: 'synthesis_chunk', text: briefAnswer.answer });
      sse(res, { type: 'synthesis_done', full_text: briefAnswer.answer, response_id: briefResponseId });
      sse(res, {
        type: 'deliverable_options',
        options: [
          { id: 'slides', label: 'Slides', icon: '📊', sub: 'Board-ready deck' },
          { id: 'doc', label: 'Doc', icon: '📄', sub: 'Written briefing' },
          { id: 'slack', label: 'Slack', icon: '💬', sub: 'Team summary' },
          { id: 'email', label: 'Email', icon: '📧', sub: 'Executive update' },
        ],
      });
      await persistExchange(workspaceId, workingThreadId, message, briefAnswer.answer);
      sse(res, { type: 'done', thread_id: workingThreadId });
      res.end();
      return;
    }

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

    let assistantResponse = '';

    // ── Tier 0: Direct data query — SQL only, no AI synthesis ───────────────
    if (complexity.tier === 'data_query') {
      const dataResult = await executeDataQuery(workspaceId, message).catch((err) => {
        console.error('[conversation-stream] Tier 0 query failed, falling through:', err.message);
        return null;
      });

      if (dataResult) {
        let responseText = '';

        if (dataResult.type === 'single_value') {
          responseText = `**${dataResult.title}**\n\n${dataResult.value}`;
          if (dataResult.subtitle) responseText += `\n${dataResult.subtitle}`;
        } else if (dataResult.type === 'table' && dataResult.columns && dataResult.rows) {
          responseText = `**${dataResult.title}**\n\n`;
          const cols = dataResult.columns;
          responseText += `| ${cols.join(' | ')} |\n`;
          responseText += `| ${cols.map(() => '---').join(' | ')} |\n`;
          for (const row of dataResult.rows) {
            responseText += `| ${cols.map((c) => String(row[c] ?? '—')).join(' | ')} |\n`;
          }
        } else if (dataResult.type === 'list' && dataResult.items) {
          responseText = `**${dataResult.title}**\n\n`;
          for (const item of dataResult.items) {
            responseText += `- **${item.label}**: ${item.value}${item.detail ? ` — ${item.detail}` : ''}\n`;
          }
        }

        if (dataResult.footnote) responseText += `\n_${dataResult.footnote}_`;
        responseText += `\n\n_(${dataResult.query_ms}ms)_`;

        const dataResponseId = randomUUID();
        sse(res, { type: 'synthesis_start' });
        sse(res, { type: 'synthesis_chunk', text: responseText });
        sse(res, { type: 'synthesis_done', full_text: responseText, response_id: dataResponseId });
        sse(res, {
          type: 'deliverable_options',
          options: [
            { id: 'slides', label: 'Slides', icon: '📊', sub: 'Board-ready deck' },
            { id: 'doc', label: 'Doc', icon: '📄', sub: 'Written briefing' },
            { id: 'slack', label: 'Slack', icon: '💬', sub: 'Team summary' },
            { id: 'email', label: 'Email', icon: '📧', sub: 'Executive update' },
          ],
        });
        await persistExchange(workspaceId, workingThreadId, message, responseText);
        sse(res, { type: 'done', thread_id: workingThreadId });
        res.end();
        return;
      }

      // Data query couldn't be parsed — fall through to Tier 1 logic
    }

    // ── Tier 1: Lookup — single skill, cache-first, lightweight synthesis ────
    if (complexity.tier === 'lookup' || complexity.tier === 'data_query') {
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
              output: result.output || null,
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
        const synthesis = await synthesizeSingleSkill(workspaceId, message, skillRun, { goalContext: hasGoals, contextBlock });
        assistantResponse = synthesis.text;
        const tier1ResponseId = randomUUID();
        sse(res, { type: 'synthesis_chunk', text: synthesis.text });
        sse(res, { type: 'synthesis_done', full_text: synthesis.text, response_id: tier1ResponseId });

        // Emit evidence cards from findings linked to this skill run
        const t1Findings = await query(
          `SELECT f.id, f.category AS headline, f.severity, f.skill_id AS operator_name, f.message AS body, f.skill_run_id
           FROM findings f
           WHERE f.workspace_id = $1 AND f.skill_run_id = $2 AND f.resolved_at IS NULL
           ORDER BY f.created_at DESC LIMIT 5`,
          [workspaceId, skillRun.id],
        ).catch(() => ({ rows: [] }));

        if (t1Findings.rows.length > 0) {
          sse(res, {
            type: 'evidence',
            cards: t1Findings.rows.map((row: any) => ({
              id: row.id, title: row.headline, severity: row.severity,
              operator_name: row.operator_name, body: row.body, skill_run_id: row.skill_run_id,
            })),
          });
        }
      } else {
        // No skill run found — fall through to the tool-calling agent for live data
        const pandoraT1 = await runPandoraAgent(
          workspaceId,
          message,
          (history as Array<{ role: string; content: string }>).map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))
        );
        assistantResponse = pandoraT1.answer;
        const tier1NoRunId = randomUUID();
        sse(res, { type: 'synthesis_chunk', text: pandoraT1.answer });
        sse(res, { type: 'synthesis_done', full_text: pandoraT1.answer, response_id: tier1NoRunId });
        if (pandoraT1.evidence.cited_records.length > 0) {
          const t1DealRecs = pandoraT1.evidence.cited_records.filter((r: any) => r.type === 'deal');
          if (t1DealRecs.length > 0) {
            const t1Total = t1DealRecs.reduce((s: number, r: any) => s + (Number(r.key_fields?.amount) || 0), 0);
            const fmtK = (n: number) => n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
            sse(res, {
              type: 'evidence',
              cards: [{
                id: `pandora-deals-${randomUUID().slice(0, 8)}`,
                title: `${t1DealRecs.length} deal${t1DealRecs.length !== 1 ? 's' : ''} · ${fmtK(t1Total)}`,
                severity: 'info',
                operator_name: 'Pandora',
                operator_icon: '✦',
                operator_color: '#48af9b',
                body: `Live query · ${t1DealRecs.length} records`,
                records: t1DealRecs.map((r: any) => ({
                  Name: r.name || '—',
                  Amount: r.key_fields?.amount != null ? `$${Number(r.key_fields.amount).toLocaleString()}` : '—',
                  Stage: r.key_fields?.stage || '—',
                  'Close Date': r.key_fields?.close_date || '—',
                })),
              }],
            });
          }
        }
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
        // Fallback: route to the tool-calling agent so live data is available
        for (const op of FALLBACK_OPERATORS) {
          sse(res, { type: 'recruiting', agent_id: op.id, agent_name: op.name, icon: op.icon, color: op.color, task: op.task });
          sse(res, { type: 'agent_thinking', agent_id: op.id });
          sse(res, { type: 'agent_found', agent_id: op.id, finding_preview: 'Pulling live data' });
          sse(res, { type: 'agent_done', agent_id: op.id, finding: { agent_id: op.id, agent_name: op.name, summary: 'Analysis complete', severity: 'info' } });
        }

        sse(res, { type: 'synthesis_start' });

        const pandoraFallback = await runPandoraAgent(
          workspaceId,
          message,
          (history as Array<{ role: string; content: string }>)
            .filter(m => m.role && m.content)
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        );
        assistantResponse = pandoraFallback.answer;
        const fallbackResponseId = randomUUID();
        sse(res, { type: 'synthesis_chunk', text: pandoraFallback.answer });
        sse(res, { type: 'synthesis_done', full_text: pandoraFallback.answer, response_id: fallbackResponseId });
        if (pandoraFallback.evidence.cited_records.length > 0) {
          const fbDealRecs = pandoraFallback.evidence.cited_records.filter((r: any) => r.type === 'deal');
          if (fbDealRecs.length > 0) {
            const fbTotal = fbDealRecs.reduce((s: number, r: any) => s + (Number(r.key_fields?.amount) || 0), 0);
            const fmtKfb = (n: number) => n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
            sse(res, {
              type: 'evidence',
              cards: [{
                id: `pandora-deals-${randomUUID().slice(0, 8)}`,
                title: `${fbDealRecs.length} deal${fbDealRecs.length !== 1 ? 's' : ''} · ${fmtKfb(fbTotal)}`,
                severity: 'info',
                operator_name: 'Pandora',
                operator_icon: '✦',
                operator_color: '#48af9b',
                body: `Live query · ${fbDealRecs.length} records`,
                records: fbDealRecs.map((r: any) => ({
                  Name: r.name || '—',
                  Amount: r.key_fields?.amount != null ? `$${Number(r.key_fields.amount).toLocaleString()}` : '—',
                  Stage: r.key_fields?.stage || '—',
                  'Close Date': r.key_fields?.close_date || '—',
                })),
              }],
            });
          }
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
        }, contextBlock || undefined);

        assistantResponse = result.synthesis;
        const investigationResponseId = randomUUID();
        sse(res, { type: 'synthesis_done', full_text: result.synthesis, response_id: investigationResponseId });

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

    await persistExchange(workspaceId, workingThreadId, message, assistantResponse);
    sse(res, { type: 'done', thread_id: workingThreadId });
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
