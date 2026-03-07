import { Router, type Request, type Response } from 'express';
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  deleteWebhookEndpoint,
  testWebhookEndpoint,
  testUrl,
  getEndpointDeliveries,
} from '../webhooks/service.js';

const router = Router();

/**
 * GET /:workspaceId/webhook-endpoints
 * List all registered webhook endpoints for the workspace. Never returns secrets.
 */
router.get('/:workspaceId/webhook-endpoints', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params as Record<string, string>;
  try {
    const endpoints = await listWebhookEndpoints(workspaceId);
    res.json(endpoints);
  } catch (err) {
    console.error('[webhook-endpoints] List error:', err);
    res.status(500).json({ error: 'Failed to list webhook endpoints' });
  }
});

/**
 * POST /:workspaceId/webhook-endpoints
 * Register a new endpoint. Returns the signing secret exactly once.
 */
router.post('/:workspaceId/webhook-endpoints', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params as Record<string, string>;
  const { url, eventTypes } = req.body as { url?: string; eventTypes?: string[] };

  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'Webhook URL must use HTTP or HTTPS' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Invalid webhook URL' });
    return;
  }

  try {
    const endpoint = await createWebhookEndpoint(workspaceId, { url, eventTypes });
    res.status(201).json(endpoint);
  } catch (err) {
    console.error('[webhook-endpoints] Create error:', err);
    res.status(500).json({ error: 'Failed to create webhook endpoint' });
  }
});

/**
 * DELETE /:workspaceId/webhook-endpoints/:endpointId
 * Remove a registered endpoint.
 */
router.delete('/:workspaceId/webhook-endpoints/:endpointId', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, endpointId } = req.params as Record<string, string>;
  try {
    const deleted = await deleteWebhookEndpoint(workspaceId, endpointId);
    if (!deleted) {
      res.status(404).json({ error: 'Endpoint not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error('[webhook-endpoints] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete webhook endpoint' });
  }
});

/**
 * POST /:workspaceId/webhook-endpoints/test-url
 * Fire test payloads to an arbitrary URL without registering it.
 * Generates an ephemeral signing secret (not stored).
 * If event_types is provided, sends one payload per type sequentially.
 * Otherwise sends a single generic webhook.test ping.
 */
router.post('/:workspaceId/webhook-endpoints/test-url', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params as Record<string, string>;
  const { url, event_types } = req.body as { url?: string; event_types?: string[] };

  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  try {
    const result = await testUrl(workspaceId, url, event_types);
    res.json(result);
  } catch (err: any) {
    if (err.status === 400) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error('[webhook-endpoints] Test URL error:', err);
    res.status(500).json({ error: 'Test delivery failed' });
  }
});

/**
 * POST /:workspaceId/webhook-endpoints/:endpointId/test
 * Send a single test delivery to verify reachability and HMAC signing.
 */
router.post('/:workspaceId/webhook-endpoints/:endpointId/test', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, endpointId } = req.params as Record<string, string>;
  const { event_type } = req.body as { event_type?: string };
  try {
    const result = await testWebhookEndpoint(workspaceId, endpointId, event_type);
    res.json(result);
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ error: 'Endpoint not found' });
      return;
    }
    console.error('[webhook-endpoints] Test error:', err);
    res.status(500).json({ error: 'Test delivery failed' });
  }
});

/**
 * GET /:workspaceId/webhook-endpoints/:endpointId/deliveries
 * Fetch delivery history for an endpoint. Query param: ?limit (max 100, default 20).
 */
router.get('/:workspaceId/webhook-endpoints/:endpointId/deliveries', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, endpointId } = req.params as Record<string, string>;
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
  try {
    const deliveries = await getEndpointDeliveries(workspaceId, endpointId, limit);
    res.json(deliveries);
  } catch (err) {
    console.error('[webhook-endpoints] Deliveries error:', err);
    res.status(500).json({ error: 'Failed to fetch deliveries' });
  }
});

export default router;
