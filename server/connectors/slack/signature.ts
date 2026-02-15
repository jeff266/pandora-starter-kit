import crypto from 'crypto';
import type { Request } from 'express';

const SLACK_SIGNATURE_VERSION = 'v0';
const MAX_REQUEST_AGE_SECONDS = 300;

export function verifySlackSignature(req: Request): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[slack-sig] SLACK_SIGNING_SECRET not configured');
    return false;
  }

  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > MAX_REQUEST_AGE_SECONDS) {
    return false;
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.error('[slack-sig] rawBody not available on request — ensure raw body middleware is active');
    return false;
  }

  const sigBaseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(sigBaseString);
  const computedSignature = `${SLACK_SIGNATURE_VERSION}=${hmac.digest('hex')}`;

  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(signature)
  );
}
