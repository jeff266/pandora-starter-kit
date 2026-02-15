import { Router } from 'express';
import { verifySlackSignature } from '../connectors/slack/signature.js';

const router = Router();

router.post('/', async (req, res) => {
  const signingSecretConfigured = !!process.env.SLACK_SIGNING_SECRET;

  if (req.body.type === 'url_verification') {
    if (signingSecretConfigured && !verifySlackSignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    return res.json({ challenge: req.body.challenge });
  }

  if (!verifySlackSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.status(200).json({});

  const event = req.body.event;
  if (!event) return;

  if (
    event.type === 'message' &&
    event.thread_ts &&
    !event.bot_id &&
    event.subtype !== 'bot_message'
  ) {
    console.log(`[slack-events] Threaded reply in ${event.channel}: "${(event.text || '').slice(0, 80)}"`);
  }
});

export default router;
