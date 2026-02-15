import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM = 'Pandora <onboarding@resend.dev>';

export async function sendMagicLink(
  email: string,
  token: string,
  isNewUser: boolean
): Promise<void> {
  const baseUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}`;
  const magicUrl = `${baseUrl}/api/auth/verify?token=${token}`;

  const subject = isNewUser
    ? 'Welcome to Pandora — Verify your email'
    : 'Sign in to Pandora';

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 460px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #e8ecf4; font-size: 20px; margin-bottom: 8px;">
        ${isNewUser ? 'Welcome to Pandora' : 'Sign in to Pandora'}
      </h2>
      <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
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
      <p style="color: #5a6578; font-size: 12px; margin-top: 32px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  if (!resend) {
    console.log(`\n[Auth] Magic link for ${email}:\n${magicUrl}\n`);
    return;
  }

  await resend.emails.send({ from: FROM, to: email, subject, html });
}
