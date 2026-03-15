/**
 * /pandora Slack Slash Command
 *
 * Receives slash commands directed at /pandora and routes them through
 * the Ask Pandora agent loop via handleSlashCommand().
 *
 * Pattern: respond to Slack immediately (within 3s window) then post
 * the real answer asynchronously via response_url.
 *
 * Mounted at: /api/webhooks/slack/slash
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { verifySlackSignature } from '../connectors/slack/signature.js';
import { handleSlashCommand } from '../slack/slash-command.js';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const command = req.body?.command || '/pandora';
  const text = req.body?.text || '';
  const userId = req.body?.user_id || 'unknown';

  console.log(`[slack-slash] ${command} from user=${userId} text="${String(text).slice(0, 80)}"`);

  if (!verifySlackSignature(req)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  res.json({
    response_type: 'ephemeral',
    text: '✦ Pandora is thinking...',
  });

  setImmediate(() => {
    handleSlashCommand(req.body).catch((err: Error) => {
      console.error('[slack-slash] Handler error:', err);
    });
  });
});

export default router;
