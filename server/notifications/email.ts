/**
 * Email Service
 *
 * Sends transactional emails via Resend
 */

import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Pandora <notifications@pandora.app>';

let resend: Resend | null = null;

if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
  console.log('[email] Resend configured');
} else {
  console.warn('[email] RESEND_API_KEY not configured - emails will not be sent');
}

interface EmailResult {
  sent: boolean;
  error?: string;
}

/**
 * Send workspace invite email
 */
export async function sendWorkspaceInvite(params: {
  toEmail: string;
  toName: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}): Promise<EmailResult> {
  if (!resend) {
    console.warn('[email] Skipping invite email - Resend not configured');
    return { sent: false };
  }

  const { toEmail, toName, workspaceName, inviterName, role, acceptUrl } = params;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You've been invited to ${workspaceName}</h2>
      <p>Hi ${toName},</p>
      <p>${inviterName} has invited you to join <strong>${workspaceName}</strong> as a <strong>${role}</strong>.</p>
      <p>
        <a href="${acceptUrl}" style="display: inline-block; padding: 12px 24px; background: #0070f3; color: white; text-decoration: none; border-radius: 4px;">
          Accept Invitation
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">
        If you didn't expect this invitation, you can ignore this email.
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `Invitation to ${workspaceName}`,
      html,
    });

    console.log(`[email] Sent workspace invite to ${toEmail}`);
    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[email] Failed to send workspace invite:', error);
    return { sent: false, error };
  }
}

/**
 * Send invite request resolution email (approved/rejected)
 */
export async function sendInviteRequestResolved(params: {
  toEmail: string;
  toName: string;
  workspaceName: string;
  action: 'approved' | 'rejected';
  inviteeEmail: string;
  note?: string;
}): Promise<EmailResult> {
  if (!resend) {
    return { sent: false };
  }

  const { toEmail, toName, workspaceName, action, inviteeEmail, note } = params;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Invite Request ${action === 'approved' ? 'Approved' : 'Rejected'}</h2>
      <p>Hi ${toName},</p>
      <p>Your request to invite <strong>${inviteeEmail}</strong> to <strong>${workspaceName}</strong> has been <strong>${action}</strong>.</p>
      ${note ? `<p><strong>Note:</strong> ${note}</p>` : ''}
      ${action === 'approved' ? `<p>An invitation has been sent to ${inviteeEmail}.</p>` : ''}
    </div>
  `;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `Invite request ${action}`,
      html,
    });

    console.log(`[email] Sent invite request ${action} notification to ${toEmail}`);
    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[email] Failed to send invite request resolution:', error);
    return { sent: false, error };
  }
}

/**
 * Send agent review resolution email (approved/rejected)
 */
export async function sendAgentReviewResolved(params: {
  toEmail: string;
  toName: string;
  workspaceName: string;
  agentName: string;
  action: 'approved' | 'rejected';
  note?: string;
  agentUrl?: string;
}): Promise<EmailResult> {
  if (!resend) {
    return { sent: false };
  }

  const { toEmail, toName, workspaceName, agentName, action, note, agentUrl } = params;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Agent ${action === 'approved' ? 'Approved' : 'Rejected'}</h2>
      <p>Hi ${toName},</p>
      <p>Your agent <strong>${agentName}</strong> in <strong>${workspaceName}</strong> has been <strong>${action}</strong>.</p>
      ${note ? `<p><strong>Feedback:</strong> ${note}</p>` : ''}
      ${action === 'approved' && agentUrl ? `
        <p>
          <a href="${agentUrl}" style="display: inline-block; padding: 12px 24px; background: #0070f3; color: white; text-decoration: none; border-radius: 4px;">
            View Agent
          </a>
        </p>
      ` : ''}
    </div>
  `;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `Agent ${agentName} ${action}`,
      html,
    });

    console.log(`[email] Sent agent review ${action} notification to ${toEmail}`);
    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[email] Failed to send agent review resolution:', error);
    return { sent: false, error };
  }
}

/**
 * Send skill run request resolution email
 */
export async function sendSkillRunRequestResolved(params: {
  toEmail: string;
  toName: string;
  workspaceName: string;
  skillName: string;
  action: 'approved' | 'rejected';
}): Promise<EmailResult> {
  if (!resend) {
    return { sent: false };
  }

  const { toEmail, toName, workspaceName, skillName, action } = params;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Skill Run Request ${action === 'approved' ? 'Approved' : 'Rejected'}</h2>
      <p>Hi ${toName},</p>
      <p>Your request to run <strong>${skillName}</strong> in <strong>${workspaceName}</strong> has been <strong>${action}</strong>.</p>
      ${action === 'approved' ? '<p>The skill run has been queued and will execute shortly.</p>' : ''}
    </div>
  `;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `Skill run request ${action}`,
      html,
    });

    console.log(`[email] Sent skill run request ${action} notification to ${toEmail}`);
    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[email] Failed to send skill run request resolution:', error);
    return { sent: false, error };
  }
}

/**
 * Send invite request notification to admins
 */
export async function sendInviteRequestNotification(params: {
  toEmail: string;
  toName: string;
  workspaceName: string;
  requestorName: string;
  inviteeEmail: string;
  proposedRole: string;
  reviewUrl: string;
}): Promise<EmailResult> {
  if (!resend) {
    return { sent: false };
  }

  const { toEmail, toName, workspaceName, requestorName, inviteeEmail, proposedRole, reviewUrl } = params;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>New Invite Request</h2>
      <p>Hi ${toName},</p>
      <p><strong>${requestorName}</strong> has requested to invite <strong>${inviteeEmail}</strong> to <strong>${workspaceName}</strong> as a <strong>${proposedRole}</strong>.</p>
      <p>
        <a href="${reviewUrl}" style="display: inline-block; padding: 12px 24px; background: #0070f3; color: white; text-decoration: none; border-radius: 4px;">
          Review Request
        </a>
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `New invite request in ${workspaceName}`,
      html,
    });

    console.log(`[email] Sent invite request notification to ${toEmail}`);
    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[email] Failed to send invite request notification:', error);
    return { sent: false, error };
  }
}
