// Slack Delivery for Reports

import { ReportGeneration, ReportTemplate, SectionContent } from '../reports/types.js';
import { createLogger } from '../utils/logger.js';
import * as fs from 'fs';

const logger = createLogger('SlackDelivery');

export interface SlackDeliveryResult {
  success: boolean;
  message_ts?: string;
  error?: string;
}

export interface SlackConfig {
  channel_id: string;
  channel_name?: string;
  include_inline?: boolean;
  include_files?: boolean;
}

export async function deliverReportToSlack(
  generation: ReportGeneration,
  template: ReportTemplate,
  workspaceId: string,
  branding: any,
  config: SlackConfig
): Promise<SlackDeliveryResult> {

  if (!config.channel_id) {
    return { success: false, error: 'No Slack channel configured' };
  }

  try {
    // Get Slack client from connector
    const slackClient = await getSlackClient(workspaceId);
    if (!slackClient) {
      return {
        success: false,
        error: 'Slack not connected. Reconnect in Settings → Connectors.',
      };
    }

    // Build Slack message blocks
    const blocks = buildSlackReportBlocks(generation, template, branding);
    const viewerUrl = `${process.env.APP_URL || 'http://localhost:3000'}/workspace/${workspaceId}/reports/${template.id}/generations/${generation.id}`;

    // Post main message
    const message = await slackClient.chat.postMessage({
      channel: config.channel_id,
      blocks,
      text: `${template.name} — ${new Date(generation.created_at).toLocaleDateString('en-US')}`,
      unfurl_links: false,
      unfurl_media: false,
    });

    logger.info('Posted Slack message', {
      generation_id: generation.id,
      channel: config.channel_id,
      message_ts: message.ts,
    });

    // Upload files as thread replies if enabled
    if (config.include_files !== false && message.ts) {
      for (const [format, fileInfo] of Object.entries(generation.formats_generated || {})) {
        if (!fileInfo.filepath || !fs.existsSync(fileInfo.filepath)) {
          continue;
        }

        try {
          await slackClient.files.uploadV2({
            channel_id: config.channel_id,
            thread_ts: message.ts,
            file: fileInfo.filepath,
            filename: `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.${format}`,
            title: `${template.name} (${format.toUpperCase()})`,
          });

          logger.info('Uploaded Slack file', { format, message_ts: message.ts });
        } catch (error) {
          logger.error(`Slack file upload failed for ${format}`, error instanceof Error ? error : undefined);
          // Don't fail the whole delivery if file upload fails
        }
      }
    }

    return { success: true, message_ts: message.ts };
  } catch (error) {
    logger.error('Slack delivery failed', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function buildSlackReportBlocks(
  generation: ReportGeneration,
  template: ReportTemplate,
  branding: any
): any[] {
  const date = new Date(generation.created_at).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const viewerUrl = `${process.env.APP_URL || 'http://localhost:3000'}/workspace/${generation.workspace_id}/reports/${template.id}/generations/${generation.id}`;

  const blocks: any[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: template.name,
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${date} • Generated in ${generation.generation_duration_ms}ms`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // Extract headline metrics
  const sections = generation.sections_content || [];
  const headlineMetrics: { label: string; value: string; delta?: string; severity?: string }[] = [];

  for (const section of sections.slice(0, 2)) {
    if (section.metrics) {
      for (const metric of section.metrics.slice(0, 2)) {
        headlineMetrics.push({
          label: metric.label,
          value: metric.value,
          delta: metric.delta,
          severity: metric.severity,
        });
      }
    }
  }

  // Metrics as fields
  if (headlineMetrics.length > 0) {
    const fields = headlineMetrics.map(m => ({
      type: 'mrkdwn',
      text: `*${m.label}*\n${getSeverityEmoji(m.severity)} ${m.value}${m.delta ? ` (${m.delta})` : ''}`,
    }));

    blocks.push({
      type: 'section',
      fields,
    });

    blocks.push({ type: 'divider' });
  }

  // Executive Summary
  const executiveSummary = extractExecutiveSummary(sections);
  if (executiveSummary) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Executive Summary*\n${executiveSummary}`,
      },
    });

    blocks.push({ type: 'divider' });
  }

  // CTA Button
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Full Report →',
          emoji: true,
        },
        url: viewerUrl,
        style: 'primary',
      },
    ],
  });

  // Footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${branding?.prepared_by ? `Prepared by ${branding.prepared_by} • ` : ''}Powered by Pandora`,
      },
    ],
  });

  return blocks;
}

function getSeverityEmoji(severity?: string): string {
  switch (severity) {
    case 'critical': return ':red_circle:';
    case 'warning': return ':large_orange_diamond:';
    case 'good': return ':large_green_circle:';
    default: return ':large_blue_circle:';
  }
}

function extractExecutiveSummary(sections: SectionContent[]): string | null {
  // Look for actions-summary section
  const actionsSection = sections.find(s => s.section_id === 'actions-summary');
  if (actionsSection?.narrative) {
    // Take first 2-3 sentences
    const sentences = actionsSection.narrative.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.slice(0, 2).join('. ') + '.';
  }

  // Fallback: use first section's narrative
  const firstSection = sections[0];
  if (firstSection?.narrative) {
    const sentences = firstSection.narrative.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.slice(0, 2).join('. ') + '.';
  }

  return null;
}

/**
 * Get Slack client from workspace connectors
 */
async function getSlackClient(workspaceId: string): Promise<any | null> {
  const { query } = await import('../db.js');
  const { WebClient } = await import('@slack/web-api');

  // Get connector config from database
  const result = await query(
    `SELECT id, credentials, config
     FROM connector_configs
     WHERE workspace_id = $1 AND connector_type = 'slack' AND status = 'active'
     LIMIT 1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    logger.info('No active Slack connector found', { workspaceId });
    return null;
  }

  const config = result.rows[0];

  // Extract bot token from credentials
  // Slack OAuth stores the token as either 'botToken' or 'accessToken'
  const token = config.credentials.botToken || config.credentials.bot_token || config.credentials.accessToken || config.credentials.access_token;

  if (!token) {
    logger.warn('Slack connector has no bot token', { workspaceId, connector_id: config.id });
    return null;
  }

  // Create Slack WebClient
  const client = new WebClient(token);

  logger.info('Created Slack client', { workspaceId, connector_id: config.id });
  return client;
}
