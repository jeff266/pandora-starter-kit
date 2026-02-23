/**
 * Public Webhook Endpoints
 *
 * Publicly accessible webhook endpoints for third-party integrations.
 * Authentication via token embedded in URL path.
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '../utils/logger.js';
import { validateToken } from '../enrichment/webhook-token-manager.js';
import { processInboundWebhook, type InboundPayload } from '../enrichment/webhook-inbound.js';

const router = Router();
const logger = createLogger('Public Webhooks');

interface WebhookParams {
  workspaceId: string;
  token: string;
}

/**
 * Inbound enrichment webhook endpoint
 *
 * POST /webhooks/enrich/{workspace-id}/{token}
 *
 * Receives enrichment data from third-party tools (Clay, Zapier, Make, etc.)
 * Returns 207 Multi-Status for partial success
 */
router.post('/webhooks/enrich/:workspaceId/:token', async (req: Request<WebhookParams>, res: Response) => {
  const startTime = Date.now();
  const { workspaceId, token } = req.params;

  try {
    // Validate token
    const validatedWorkspaceId = await validateToken(token);

    if (!validatedWorkspaceId) {
      logger.warn('Invalid webhook token', {
        workspace_id: workspaceId,
        token_prefix: token.substring(0, 10),
      });
      res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      return;
    }

    // Ensure token matches workspace_id in path
    if (validatedWorkspaceId !== workspaceId) {
      logger.warn('Token workspace mismatch', {
        path_workspace_id: workspaceId,
        token_workspace_id: validatedWorkspaceId,
      });
      res.status(401).json({ error: 'Unauthorized: Token does not match workspace' });
      return;
    }

    // Check payload size (5MB limit per spec)
    const contentLength = parseInt(req.get('content-length') || '0');
    const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB

    if (contentLength > MAX_PAYLOAD_SIZE) {
      logger.warn('Payload too large', {
        workspace_id: workspaceId,
        content_length: contentLength,
      });
      res.status(413).json({
        error: 'Payload Too Large',
        message: 'Payload exceeds 5MB limit. Split your workflow into smaller batches.',
      });
      return;
    }

    // Validate Content-Type
    const contentType = req.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      logger.warn('Invalid content type', {
        workspace_id: workspaceId,
        content_type: contentType,
      });
      res.status(400).json({
        error: 'Bad Request',
        message: 'Content-Type must be application/json',
      });
      return;
    }

    // Parse payload
    const payload = req.body as InboundPayload;

    if (!payload) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Empty payload received. Ensure your workflow is sending data.',
      });
      return;
    }

    // Process inbound webhook
    const result = await processInboundWebhook(workspaceId, payload);

    const processingTime = Date.now() - startTime;

    logger.info('Inbound webhook processed', {
      workspace_id: workspaceId,
      batch_id: payload.pandora_batch_id,
      status: result.status,
      status_code: result.status_code,
      processing_time_ms: processingTime,
      received: result.records_received,
      matched: result.records_matched,
      failed: result.records_failed,
      duplicate_batch: result.duplicate_batch,
    });

    // Build response based on status
    if (result.status_code === 200) {
      // Full success or duplicate batch
      res.status(200).json({
        success: true,
        batch_id: payload.pandora_batch_id,
        records_received: result.records_received,
        records_matched: result.records_matched,
        records_failed: result.records_failed,
        duplicate_batch: result.duplicate_batch,
        processing_time_ms: processingTime,
      });
    } else if (result.status_code === 207) {
      // Partial success (Multi-Status)
      res.status(207).json({
        success: false,
        status: 'partial',
        batch_id: payload.pandora_batch_id,
        records_received: result.records_received,
        records_matched: result.records_matched,
        records_failed: result.records_failed,
        errors: result.errors,
        processing_time_ms: processingTime,
        message: 'Some records processed successfully, others failed. See errors for details.',
      });
    } else if (result.status_code === 400) {
      // Validation error
      res.status(400).json({
        error: 'Bad Request',
        message: 'Payload received but could not be parsed. Pandora expects JSON.',
        errors: result.errors,
      });
    } else if (result.status_code === 422) {
      // All records failed
      res.status(422).json({
        error: 'Unprocessable Entity',
        message: 'Records missing required identifier fields. domain or company_name must be present.',
        batch_id: payload.pandora_batch_id,
        records_received: result.records_received,
        records_failed: result.records_failed,
        errors: result.errors,
      });
    } else {
      // Unexpected status
      res.status(result.status_code).json({
        error: 'Processing Error',
        batch_id: payload.pandora_batch_id,
        errors: result.errors,
      });
    }
  } catch (error: any) {
    logger.error('Inbound webhook error', {
      workspace_id: workspaceId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An error occurred while processing your webhook. Please try again.',
    });
  }
});

/**
 * Health check endpoint for webhook service
 */
router.get('/webhooks/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'webhook-enrichment',
    timestamp: new Date().toISOString(),
  });
});

export default router;
