import { Resend } from 'resend';

const ALLOWED_EMAILS = new Set([
  'jeff@revopsimpact.us',
]);

const FROM_EMAIL = 'Pandora <onboarding@resend.dev>';

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not set');
  }
  return new Resend(apiKey);
}

export function isAllowedEmail(email: string): boolean {
  return ALLOWED_EMAILS.has(email.toLowerCase().trim());
}

export async function sendMagicLink(
  email: string,
  token: string,
  isNewUser: boolean
): Promise<{ sent: boolean; magicUrl: string }> {
  const baseUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}`;
  const magicUrl = `${baseUrl}/api/auth/verify?token=${token}`;

  const subject = isNewUser
    ? 'Welcome to Pandora — Verify your email'
    : 'Sign in to Pandora';

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 460px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 8px;">
        ${isNewUser ? 'Welcome to Pandora' : 'Sign in to Pandora'}
      </h2>
      <p style="color: #555; font-size: 14px; line-height: 1.6;">
        ${isNewUser
          ? 'Click the button below to verify your email and get started.'
          : 'Click the button below to sign in. This link expires in 15 minutes.'}
      </p>
      <a href="${magicUrl}"
         style="display: inline-block; background: #3b82f6; color: #fff;
                padding: 12px 28px; border-radius: 6px; font-size: 14px;
                font-weight: 600; text-decoration: none; margin: 24px 0;">
        ${isNewUser ? 'Verify Email' : 'Sign In'}
      </a>
      <p style="color: #999; font-size: 12px; margin-top: 32px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  try {
    const client = getResendClient();
    await client.emails.send({ from: FROM_EMAIL, to: email, subject, html });
    console.log(`[email] Magic link sent to ${email}`);
    return { sent: true, magicUrl };
  } catch (err) {
    console.log(`[email] Resend failed (${err instanceof Error ? err.message : err}), returning magic link for dev access`);
    return { sent: false, magicUrl };
  }
}

export async function sendWaitlistEmail(email: string, name?: string): Promise<void> {
  const subject = "You're on the Pandora waitlist";

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 460px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 8px;">
        ${name ? `Hey ${name}, you're` : "You're"} on the waitlist!
      </h2>
      <p style="color: #555; font-size: 14px; line-height: 1.6;">
        Thanks for your interest in Pandora. We're currently in private beta and 
        adding new users gradually.
      </p>
      <p style="color: #555; font-size: 14px; line-height: 1.6;">
        We'll reach out as soon as a spot opens up. In the meantime, sit tight — 
        we're building something great for RevOps teams.
      </p>
      <div style="margin-top: 24px; padding: 16px; background: #f0f4ff; border-radius: 8px;">
        <p style="color: #3b82f6; font-size: 13px; font-weight: 600; margin: 0;">
          Pandora — GTM Intelligence Platform
        </p>
        <p style="color: #777; font-size: 12px; margin: 4px 0 0 0;">
          AI-powered insights for Go-To-Market teams
        </p>
      </div>
    </div>
  `;

  try {
    const client = getResendClient();
    await client.emails.send({ from: FROM_EMAIL, to: email, subject, html });
    console.log(`[email] Waitlist email sent to ${email}`);
  } catch (err) {
    console.log(`[email] Failed to send waitlist email to ${email}:`, err instanceof Error ? err.message : err);
  }
}
