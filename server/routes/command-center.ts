import { Router, Request, Response } from 'express';
import { assembleBrief } from '../briefing/brief-assembler.js';
import { createBriefSSEEmitter } from '../briefing/brief-sse-emitter.js';

const router = Router();

/**
 * SSE streaming endpoint for live brief assembly
 * Returns Server-Sent Events showing tool calls in real-time as the brief assembles
 */
router.post('/:workspaceId/assistant/brief/stream', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { force, brief_type } = req.body;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  const emitter = createBriefSSEEmitter(res);

  try {
    // Emit recruiting event to initialize the UI
    res.write(`data: ${JSON.stringify({
      type: 'recruiting',
      agent_id: 'brief-assembler',
      agent_name: 'Command Center',
      icon: '📊',
      color: '#7C6AE8',
      task: 'Assembling your brief'
    })}\n\n`);

    // Assemble the brief with SSE events
    const brief = await assembleBrief(workspaceId, {
      force,
      brief_type,
      emitter
    });

    // Emit final brief data
    res.write(`data: ${JSON.stringify({
      type: 'brief_ready',
      brief
    })}\n\n`);

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[command-center] Brief assembly failed:', err);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    })}\n\n`);
    res.end();
  }
});

export default router;
