// Email Delivery for Reports using Resend

import { Resend } from 'resend';
import { ReportGeneration, ReportTemplate, SectionContent } from '../reports/types.js';
import { createLogger } from '../utils/logger.js';
import * as fs from 'fs';

const logger = createLogger('EmailDelivery');

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

export interface EmailDeliveryResult {
  success: boolean;
  message_id?: string;
  error?: string;
  recipients: string[];
}

export interface EmailDeliveryConfig {
  workspace_id: string;
  workspace_name: string;
  branding?: {
    company_name?: string;
    logo_url?: string;
    primary_color?: string;
    prepared_by?: string;
  };
}

export async function deliverReportByEmail(
  generation: ReportGeneration,
  template: ReportTemplate,
  config: EmailDeliveryConfig
): Promise<EmailDeliveryResult> {

  const recipients = template.recipients || [];
  if (recipients.length === 0) {
    return { success: true, recipients: [], message_id: 'no_recipients' };
  }

  // Build subject line
  const subject = buildSubject(template, generation);

  // Extract headline metrics and executive summary
  const headlineMetrics = extractHeadlineMetrics(generation.sections_content || []);
  const executiveSummary = extractExecutiveSummary(generation.sections_content || []);

  // Build viewer URL
  const viewerUrl = `${process.env.APP_URL || 'http://localhost:3000'}/workspace/${config.workspace_id}/reports/${template.id}/generations/${generation.id}`;

  // Build HTML email
  const html = buildReportEmail({
    report_name: template.name,
    summary: executiveSummary,
    headline_metrics: headlineMetrics,
    viewer_url: viewerUrl,
    branding: config.branding,
    generation_date: generation.created_at,
  });

  // Attach generated files
  const attachments: any[] = [];
  for (const [format, fileInfo] of Object.entries(generation.formats_generated || {})) {
    if (fileInfo.filepath && fs.existsSync(fileInfo.filepath)) {
      const buffer = fs.readFileSync(fileInfo.filepath);
      attachments.push({
        filename: `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.${format}`,
        content: buffer,
      });
    }
  }

  try {
    const result = await resend.emails.send({
      from: `${config.branding?.company_name || 'Pandora'} Reports <reports@${process.env.EMAIL_DOMAIN || 'notifications.pandora.app'}>`,
      to: recipients,
      subject,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    logger.info('Email delivered successfully', {
      generation_id: generation.id,
      message_id: result.data?.id,
      recipients: recipients.length,
    });

    return {
      success: true,
      message_id: result.data?.id,
      recipients,
    };
  } catch (error) {
    logger.error('Email delivery failed', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      recipients,
    };
  }
}

function buildSubject(template: ReportTemplate, generation: ReportGeneration): string {
  const date = new Date(generation.created_at);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Check if template has custom subject template
  const emailChannel = template.delivery_channels.find(c => c.type === 'email');
  if (emailChannel && emailChannel.type === 'email' && emailChannel.config.subject_template) {
    return emailChannel.config.subject_template
      .replace('{{report_name}}', template.name)
      .replace('{{date}}', dateStr);
  }

  return `${template.name} — ${dateStr}`;
}

function extractHeadlineMetrics(sections: SectionContent[]): { label: string; value: string; delta?: string; severity?: string }[] {
  const metrics: { label: string; value: string; delta?: string; severity?: string }[] = [];

  // Extract metrics from first few sections (The Number, What Moved, Deals Needing Attention)
  for (const section of sections.slice(0, 3)) {
    if (section.metrics) {
      for (const metric of section.metrics.slice(0, 2)) {
        metrics.push({
          label: metric.label,
          value: metric.value,
          delta: metric.delta ? `${metric.delta_direction === 'up' ? '↑' : metric.delta_direction === 'down' ? '↓' : ''} ${metric.delta}` : undefined,
          severity: metric.severity,
        });
      }
    }
  }

  return metrics.slice(0, 4); // Max 4 headline metrics
}

function extractExecutiveSummary(sections: SectionContent[]): string {
  // Look for actions-summary section
  const actionsSection = sections.find(s => s.section_id === 'actions-summary');
  if (actionsSection?.narrative) {
    // Take first 2-3 sentences
    const sentences = actionsSection.narrative.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.slice(0, 3).join('. ') + '.';
  }

  // Fallback: use first section's narrative
  const firstSection = sections[0];
  if (firstSection?.narrative) {
    const sentences = firstSection.narrative.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.slice(0, 2).join('. ') + '.';
  }

  return 'Your latest report is ready to view.';
}

interface EmailTemplateData {
  report_name: string;
  summary: string;
  headline_metrics: { label: string; value: string; delta?: string; severity?: string }[];
  viewer_url: string;
  branding?: {
    company_name?: string;
    logo_url?: string;
    primary_color?: string;
    prepared_by?: string;
  };
  generation_date: string;
}

function buildReportEmail(data: EmailTemplateData): string {
  const primaryColor = data.branding?.primary_color || '#2563EB';
  const companyName = data.branding?.company_name || 'Pandora';

  const date = new Date(data.generation_date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const metricCardsHtml = data.headline_metrics.map(metric => {
    const severityColors: Record<string, { bg: string; border: string; text: string }> = {
      critical: { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' },
      warning: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
      good: { bg: '#D1FAE5', border: '#16A34A', text: '#15803D' },
    };

    const colors = metric.severity ? severityColors[metric.severity] : { bg: '#F8FAFC', border: '#CBD5E1', text: '#1E293B' };

    return `
      <div style="flex: 1; min-width: 140px; background: ${colors.bg}; border-left: 4px solid ${colors.border}; border-radius: 8px; padding: 16px; margin: 8px;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; font-weight: 600; margin-bottom: 8px;">
          ${metric.label}
        </div>
        <div style="font-size: 24px; font-weight: 700; color: ${colors.text}; margin-bottom: 4px;">
          ${metric.value}
        </div>
        ${metric.delta ? `<div style="font-size: 13px; color: #64748B;">${metric.delta}</div>` : ''}
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.report_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #F1F5F9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F1F5F9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}DD 100%); padding: 32px 40px; text-align: center;">
              ${data.branding?.logo_url ? `<img src="${data.branding.logo_url}" alt="${companyName}" style="max-width: 160px; height: auto; margin-bottom: 16px;" />` : ''}
              <h1 style="margin: 0; color: #FFFFFF; font-size: 28px; font-weight: 700; line-height: 1.2;">
                ${data.report_name}
              </h1>
              <p style="margin: 12px 0 0; color: #FFFFFF; opacity: 0.9; font-size: 14px;">
                ${date}
              </p>
            </td>
          </tr>

          <!-- Headline Metrics -->
          ${data.headline_metrics.length > 0 ? `
          <tr>
            <td style="padding: 32px 40px 0;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1E293B;">
                Key Highlights
              </h2>
              <div style="display: flex; flex-wrap: wrap; margin: -8px;">
                ${metricCardsHtml}
              </div>
            </td>
          </tr>
          ` : ''}

          <!-- Executive Summary -->
          <tr>
            <td style="padding: 32px 40px;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1E293B;">
                Executive Summary
              </h2>
              <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #475569;">
                ${data.summary}
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 40px;">
              <a href="${data.viewer_url}" style="display: inline-block; background-color: ${primaryColor}; color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px ${primaryColor}40;">
                View Full Report →
              </a>
              <p style="margin: 16px 0 0; font-size: 13px; color: #94A3B8;">
                Or copy this link: <a href="${data.viewer_url}" style="color: ${primaryColor}; text-decoration: none;">${data.viewer_url}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F8FAFC; padding: 24px 40px; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0; font-size: 12px; color: #94A3B8; text-align: center;">
                ${data.branding?.prepared_by ? `Prepared by ${data.branding.prepared_by} • ` : ''}Powered by Pandora GTM Intelligence
              </p>
              <p style="margin: 8px 0 0; font-size: 11px; color: #CBD5E1; text-align: center;">
                This report was automatically generated on ${date}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
