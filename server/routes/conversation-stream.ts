import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db.js';
import { assembleBrief } from '../briefing/brief-assembler.js';

const router = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
});

interface OperatorDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  skills: string[];
  task: string;
}

const OPERATORS: OperatorDef[] = [
  { id: 'pipeline-state', name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE', skills: ['Pipeline Waterfall', 'Stage Distribution'], task: 'Analyzing pipeline health and deal distribution' },
  { id: 'deal-risk-review', name: 'Deal Analyst', icon: '🔍', color: '#FB923C', skills: ['Deal Risk Scan', 'Single-thread Alert'], task: 'Reviewing deal risk signals and blockers' },
  { id: 'forecast-call-prep', name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8', skills: ['Forecast Rollup', 'Monte Carlo'], task: 'Building forecast model and confidence range' },
  { id: 'pipeline-hygiene', name: 'Data Steward', icon: '🧹', color: '#FBBF24', skills: ['Data Quality Audit', 'CRM Hygiene'], task: 'Checking data quality and missing fields' },
];

function selectOperators(message: string): OperatorDef[] {
  const lower = message.toLowerCase();
  if (lower.includes('forecast') || lower.includes('call') || lower.includes('predict')) {
    return [OPERATORS[0], OPERATORS[2]];
  }
  if (lower.includes('risk') || lower.includes('deal') || lower.includes('stuck') || lower.includes('stall')) {
    return [OPERATORS[1]];
  }
  if (lower.includes('data') || lower.includes('hygiene') || lower.includes('missing')) {
    return [OPERATORS[3]];
  }
  return [OPERATORS[0], OPERATORS[1], OPERATORS[2]];
}

function sse(res: Response, event: object): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    const selectedOps = selectOperators(message);

    for (let i = 0; i < selectedOps.length; i++) {
      const op = selectedOps[i];
      sse(res, { type: 'recruiting', agent_id: op.id, agent_name: op.name, icon: op.icon, color: op.color, skills: op.skills, task: op.task });
      if (i < selectedOps.length - 1) await sleep(300);
    }

    const briefItems = await assembleBrief(workspaceId, { maxItems: 4 });
    const findingContext = briefItems.length > 0
      ? briefItems.map(b => `[${b.severity.toUpperCase()}] ${b.headline}`).join('\n')
      : 'No recent findings';

    for (const op of selectedOps) {
      sse(res, { type: 'agent_thinking', agent_id: op.id });
      await sleep(400 + Math.random() * 300);

      const preview = briefItems.length > 0
        ? briefItems.find(b => b.operator_name === op.name)?.headline ?? briefItems[0].headline
        : `No specific findings from ${op.name}`;

      sse(res, { type: 'agent_found', agent_id: op.id, finding_preview: preview.substring(0, 80) });
      await sleep(200);

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

    const systemPrompt = `You are Pandora, a RevOps intelligence assistant. Answer concisely and directly. Use the findings context below.

Recent workspace findings:
${findingContext}

Respond in 2-4 sentences maximum. Be specific to the data provided.`;

    const chatMessages: Anthropic.MessageParam[] = [
      ...history.filter(m => m.role && m.content).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: systemPrompt,
      messages: chatMessages,
    });

    let fullText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        if (chunk) {
          fullText += chunk;
          sse(res, { type: 'synthesis_chunk', text: chunk });
        }
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
