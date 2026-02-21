// Report Delivery Orchestration
// Coordinates multi-channel delivery with parallel execution and failure handling

import { ReportGeneration, ReportTemplate, DeliveryChannel } from './types.js';
import { deliverReportByEmail, EmailDeliveryConfig } from '../delivery/email-delivery.js';
import { deliverReportToGDrive } from '../delivery/gdrive-delivery.js';
import { deliverReportToSlack } from '../delivery/slack-delivery.js';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ReportDelivery');

export interface DeliveryResult {
  success: boolean;
  message_id?: string;
  error?: string;
  file_links?: { format: string; url: string }[];
  message_ts?: string;
}

export interface WorkspaceConfig {
  workspace_id: string;
  workspace_name: string;
  branding?: any;
}

/**
 * Deliver report to all configured channels in parallel
 * Uses Promise.allSettled so one failed channel doesn't block others
 */
export async function deliverReport(
  generation: ReportGeneration,
  template: ReportTemplate,
  config: WorkspaceConfig
): Promise<Record<string, DeliveryResult>> {

  const results: Record<string, DeliveryResult> = {};

  // Create delivery promises for each channel
  const deliveryPromises = template.delivery_channels.map(async (channel) => {
    const channelType = channel.type;

    try {
      switch (channel.type) {
        case 'email': {
          const emailConfig: EmailDeliveryConfig = {
            workspace_id: config.workspace_id,
            workspace_name: config.workspace_name,
            branding: template.branding_override || config.branding,
          };
          results.email = await deliverReportByEmail(generation, template, emailConfig);
          break;
        }

        case 'google_drive': {
          results.google_drive = await deliverReportToGDrive(
            generation,
            template,
            config.workspace_id,
            channel.config
          );
          break;
        }

        case 'slack': {
          results.slack = await deliverReportToSlack(
            generation,
            template,
            config.workspace_id,
            config.branding,
            channel.config
          );
          break;
        }

        case 'download_only': {
          // No delivery needed - files are already generated
          results.download = { success: true };
          break;
        }

        default:
          logger.warn('Unknown delivery channel type', { type: channelType });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results[channel.type] = { success: false, error: errorMessage };
      logger.error(`Delivery failed for ${channel.type}`, error instanceof Error ? error : undefined);
    }
  });

  // Wait for all deliveries to complete (or fail)
  await Promise.allSettled(deliveryPromises);

  // Update generation with delivery results
  await query(
    `UPDATE report_generations
     SET delivery_status = $1
     WHERE id = $2`,
    [JSON.stringify(results), generation.id]
  );

  // Check if any critical channels failed
  const criticalFailures = Object.entries(results)
    .filter(([channel, result]) => !result.success && channel === 'email')
    .map(([channel]) => channel);

  if (criticalFailures.length > 0) {
    logger.warn('Critical delivery channels failed', {
      generation_id: generation.id,
      failed_channels: criticalFailures,
    });

    // Retry email delivery once after 5 minutes if it failed
    if (criticalFailures.includes('email')) {
      setTimeout(async () => {
        await retryEmailDelivery(generation, template, config);
      }, 5 * 60 * 1000);
    }
  }

  logger.info('Report delivery complete', {
    generation_id: generation.id,
    results: Object.entries(results).map(([channel, result]) => ({
      channel,
      success: result.success,
    })),
  });

  return results;
}

/**
 * Retry email delivery once if initial delivery failed
 */
async function retryEmailDelivery(
  generation: ReportGeneration,
  template: ReportTemplate,
  config: WorkspaceConfig
): Promise<void> {
  try {
    logger.info('Retrying email delivery', { generation_id: generation.id });

    const emailConfig: EmailDeliveryConfig = {
      workspace_id: config.workspace_id,
      workspace_name: config.workspace_name,
      branding: template.branding_override || config.branding,
    };

    const result = await deliverReportByEmail(generation, template, emailConfig);

    // Update delivery status with retry result
    const currentStatus = await query<{ delivery_status: any }>(
      `SELECT delivery_status FROM report_generations WHERE id = $1`,
      [generation.id]
    );

    const deliveryStatus = currentStatus.rows[0]?.delivery_status || {};
    deliveryStatus.email = result;
    deliveryStatus.email_retry = true;

    await query(
      `UPDATE report_generations
       SET delivery_status = $1
       WHERE id = $2`,
      [JSON.stringify(deliveryStatus), generation.id]
    );

    if (result.success) {
      logger.info('Email delivery retry succeeded', { generation_id: generation.id });
    } else {
      logger.error(`Email delivery retry failed for generation ${generation.id}: ${result.error}`);
    }
  } catch (error) {
    logger.error('Email delivery retry error', error instanceof Error ? error : undefined);
  }
}

/**
 * Send fallback email notification when other channels fail
 */
export async function sendFallbackEmailNotification(
  generation: ReportGeneration,
  template: ReportTemplate,
  config: WorkspaceConfig,
  failedChannel: string
): Promise<void> {
  // Check if email delivery is configured
  const hasEmailDelivery = template.delivery_channels.some(c => c.type === 'email');
  if (!hasEmailDelivery || !template.recipients || template.recipients.length === 0) {
    return;
  }

  // Only send fallback for critical channel failures
  if (failedChannel !== 'google_drive' && failedChannel !== 'slack') {
    return;
  }

  try {
    const emailConfig: EmailDeliveryConfig = {
      workspace_id: config.workspace_id,
      workspace_name: config.workspace_name,
      branding: template.branding_override || config.branding,
    };

    await deliverReportByEmail(generation, template, emailConfig);

    logger.info('Fallback email sent for failed channel', {
      generation_id: generation.id,
      failed_channel: failedChannel,
    });
  } catch (error) {
    logger.error('Fallback email failed', error instanceof Error ? error : undefined);
  }
}
