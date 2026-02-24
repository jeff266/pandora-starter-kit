import { Router, Request, Response } from 'express';
import { Resend } from 'resend';
import pool from '../db.js';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

router.post('/', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
      await pool.query(
        `INSERT INTO waitlist (email, source, metadata)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [normalizedEmail, 'homepage', JSON.stringify({
          userAgent: req.headers['user-agent'],
          referrer: req.headers['referer'] || null,
          timestamp: new Date().toISOString(),
        })]
      );
    } catch (dbErr: any) {
      console.error('[Waitlist] DB error:', dbErr.message);
    }

    if (AUDIENCE_ID) {
      try {
        await resend.contacts.create({
          audienceId: AUDIENCE_ID,
          email: normalizedEmail,
          unsubscribed: false,
        });
      } catch (audienceErr: any) {
        console.error('[Waitlist] Resend audience error:', audienceErr.message);
      }
    }

    try {
      await resend.emails.send({
        from: 'Pandora <hello@pandoragtm.com>',
        to: normalizedEmail,
        subject: "Pandora Design Partner \u2014 next steps \uD83D\uDD2E",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <span style="font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #a78bfa, #22d3ee); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">pandora</span>
            </div>
            
            <h1 style="font-size: 22px; font-weight: 600; color: #1a1a2e; margin-bottom: 16px;">
              Thanks for your interest.
            </h1>
            
            <p style="font-size: 15px; color: #555; line-height: 1.65; margin-bottom: 24px;">
              I'm onboarding design partners in small batches to make sure every team gets hands-on setup and direct access to me throughout the process. I'll reach out personally to schedule your onboarding.
            </p>
            
            <p style="font-size: 15px; color: #555; line-height: 1.65; margin-bottom: 24px;">
              Pandora connects your CRM, conversation intelligence, and GTM tools to deliver pipeline analysis that would take a RevOps analyst days &mdash; in seconds. Your first automated pipeline health report lands in Slack within 10 minutes of connecting.
            </p>
            
            <div style="padding: 20px; background: #f8f8fc; border-radius: 10px; margin-bottom: 24px;">
              <p style="font-size: 13px; color: #888; margin: 0 0 8px 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">What design partners get:</p>
              <ul style="font-size: 14px; color: #555; line-height: 1.8; padding-left: 20px; margin: 0;">
                <li>White-glove onboarding with the founder</li>
                <li>Direct Slack channel for support + feedback</li>
                <li>Free access through the design partner period</li>
                <li>Your input directly shapes the roadmap</li>
              </ul>
            </div>
            
            <p style="font-size: 14px; color: #888; line-height: 1.6;">
              &mdash; Jeff Ignacio, Founder
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
            
            <p style="font-size: 11px; color: #bbb; text-align: center;">
              pandora &middot; revops intelligence
            </p>
          </div>
        `,
      });
    } catch (emailErr: any) {
      console.error('[Waitlist] Resend email error:', emailErr.message);
    }

    return res.json({ success: true, message: "Thanks \u2014 I'll reach out personally." });

  } catch (err) {
    console.error('[Waitlist] Unexpected error:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const adminKey = _req.headers['x-admin-key'];
    if (adminKey !== process.env.PANDORA_ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const result = await pool.query(
      `SELECT email, source, created_at, metadata 
       FROM waitlist 
       ORDER BY created_at DESC 
       LIMIT 100`
    );
    return res.json({ count: result.rows.length, entries: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
