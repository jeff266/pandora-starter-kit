/**
 * /pandora Slack Slash Command — Stub
 *
 * Receives slash commands directed at /pandora.
 * Currently responds with a coming-soon ephemeral message.
 *
 * TODO: Route to Ask Pandora agent loop
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

router.post('/', (req: Request, res: Response): void => {
  const command = req.body?.command || '/pandora';
  const text = req.body?.text || '';
  const userId = req.body?.user_id || 'unknown';

  console.log(`[slack-slash] ${command} from user=${userId} text="${text.slice(0, 80)}"`);

  res.json({
    response_type: 'ephemeral',
    text: 'Ask Pandora is coming to Slack soon. For now, open Concierge to chat.',
  });
});

export default router;
