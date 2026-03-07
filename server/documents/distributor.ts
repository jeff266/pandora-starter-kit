import pool from '../db.js';
import { AccumulatedDocument } from './types.js';
import { getSlackWebhook } from '../connectors/slack/client.js';
import { Resend } from 'resend';
import * as fs from 'fs';

export interface DistributionOptions {
  recipient?: string;
  subject?: string;
  body?: string;
  filename?: string;
  filepath?: string;
}

export async function distributeDocument(
  workspaceId: string,
  doc: AccumulatedDocument,
  channel: 'slack' | 'email' | 'drive' | 'download',
  options: DistributionOptions = {}
): Promise<{ success: boolean; error?: string }> {
  let status: 'sent' | 'failed' = 'failed';
  let error: string | undefined;

  try {
    if (channel === 'slack') {
      const webhookUrl = await getSlackWebhook(workspaceId);
      if (!webhookUrl) throw new Error('Slack not connected - webhook URL missing');

      const findings = doc.sections.flatMap(s => s.content)
        .filter(c => c.type === 'finding')
        .slice(0, 3);

      const slackBody = {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `📊 ${doc.templateType}: ${options.subject || 'New Analysis'}`, emoji: true }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: options.body || 'New document available for review.' }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Top Findings:*\n${findings.map(f => `• ${f.title}`).join('\n') || 'No major findings.'}`
            }
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: '_Sent from Pandora GTM Intelligence_' }]
          }
        ]
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackBody)
      });

      if (!res.ok) throw new Error(`Slack returned ${res.status}`);
      status = 'sent';

    } else if (channel === 'email') {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) throw new Error('RESEND_API_KEY not set');
      const resend = new Resend(apiKey);

      const recipient = options.recipient;
      if (!recipient) throw new Error('Recipient email is required for email distribution');

      const attachments = [];
      if (options.filepath && fs.existsSync(options.filepath)) {
        attachments.push({
          filename: options.filename || 'document.pdf',
          content: fs.readFileSync(options.filepath)
        });
      }

      await resend.emails.send({
        from: 'Pandora <onboarding@resend.dev>',
        to: recipient,
        subject: `[Pandora] ${options.subject || doc.templateType} · ${new Date().toLocaleDateString()}`,
        html: `<div style="font-family: sans-serif;">
          <h2>Executive Summary</h2>
          <p>${(options.body || 'Your requested document is attached.').replace(/\n/g, '<br>')}</p>
        </div>`,
        attachments
      });
      status = 'sent';

    } else if (channel === 'drive') {
      // Placeholder for existing Google Drive connector
      // Since ARCHITECTURE.md mentioned GDrive, assuming there's a service or we use the connector.
      // Based on session plan, we should use existing Google Drive connector.
      // For now, marking as failed as I need to find the actual GDrive service.
      throw new Error('Google Drive distribution not yet implemented in this environment');
    } else if (channel === 'download') {
      // Downloads are handled by frontend, but we record the intent
      status = 'sent';
    }

  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[Distributor] Failed to distribute via ${channel}:`, error);
  } finally {
    await pool.query(
      `INSERT INTO document_distributions (workspace_id, document_id, channel, recipient, status, error)
       VALUES (, , , , , )`,
      [workspaceId, doc.sessionId, channel, options.recipient, status, error]
    );
  }

  return { success: status === 'sent', error };
}
