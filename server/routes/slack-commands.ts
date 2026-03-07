import { Router } from 'express';
import type { Request, Response } from 'express';
import { verifySlackSignature } from '../connectors/slack/signature.js';
import { handleSlashCommand } from '../slack/slash-command.js';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  console.log('[slack-commands] Incoming slash command:', req.body?.command, req.body?.text?.slice(0, 50));

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
      console.error('[slack-commands] Handler error:', err);
    });
  });
});

export default router;
