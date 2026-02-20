/**
 * Router API Endpoints
 *
 * Provides HTTP endpoints for:
 * - Request classification (POST /router/classify)
 * - Workspace state index (GET /state)
 * - Template readiness (GET /state/templates)
 * - Dimension discovery (POST /discovery/run, GET /discovery/latest)
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import rateLimit from 'express-rate-limit';
import { classifyRequest } from '../router/request-router.js';
import { dispatch } from '../router/dispatcher.js';
import { getWorkspaceState } from '../router/state-index.js';
import { runDimensionDiscovery } from '../discovery/discovery-engine.js';
import { query } from '../db.js';

const router = Router();

const routerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.params.workspaceId,
  message: { error: 'Router rate limit exceeded. Try again in a minute.' },
});

// ============================================================================
// Router Classification
// ============================================================================

router.post('/:workspaceId/router/classify', routerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { input, context } = req.body;

    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'input is required and must be a string' });
      return;
    }

    const decision = await classifyRequest(workspaceId, input, context);
    res.json(decision);
  } catch (err) {
    console.error('[Router] Classification error:', err);
    res.status(500).json({ error: 'Classification failed', details: (err as Error).message });
  }
});

// ============================================================================
// Router Dispatch (classify + execute)
// ============================================================================

router.post('/:workspaceId/router/dispatch', routerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { input, context } = req.body;

    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'input is required and must be a string' });
      return;
    }

    // Step 1: Classify
    const decision = await classifyRequest(workspaceId, input, context);

    // Step 2: Execute
    const result = await dispatch(decision, workspaceId);

    res.json({
      decision,
      result,
    });
  } catch (err) {
    console.error('[Router] Dispatch error:', err);
    res.status(500).json({ error: 'Dispatch failed', details: (err as Error).message });
  }
});

// ============================================================================
// Workspace State Index
// ============================================================================

router.get('/:workspaceId/state', routerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const state = await getWorkspaceState(workspaceId);
    res.json(state);
  } catch (err) {
    console.error('[State] Error building state index:', err);
    res.status(500).json({ error: 'Failed to build state index' });
  }
});

router.get('/:workspaceId/state/templates', routerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const state = await getWorkspaceState(workspaceId);
    res.json(state.template_readiness);
  } catch (err) {
    res.status(500).json({ error: 'Failed to build template readiness' });
  }
});

// ============================================================================
// Dimension Discovery
// ============================================================================

router.post('/:workspaceId/discovery/run', routerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { templateType, customDimensions } = req.body;

    const result = await runDimensionDiscovery({
      workspaceId,
      templateType,
      customDimensions,
    });

    // Persist the discovery result for caching / audit
    await query(`
      INSERT INTO discovery_results (workspace_id, template_type, result, discovered_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (workspace_id, template_type)
      DO UPDATE SET result = $3::jsonb, discovered_at = NOW()
    `, [workspaceId, templateType || 'sales_process_map', JSON.stringify(result)]);

    res.json(result);
  } catch (err) {
    console.error('[Discovery] Error:', err);
    res.status(500).json({ error: 'Discovery failed', details: (err as Error).message });
  }
});

router.get('/:workspaceId/discovery/latest', routerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { templateType = 'sales_process_map' } = req.query;

    const cached = await query(`
      SELECT result, discovered_at
      FROM discovery_results
      WHERE workspace_id = $1 AND template_type = $2
      ORDER BY discovered_at DESC LIMIT 1
    `, [workspaceId, templateType]);

    if (cached.rows.length === 0) {
      res.status(404).json({ error: 'No discovery results found. Run discovery first.' });
      return;
    }

    res.json({
      ...cached.rows[0].result,
      cached: true,
      cached_at: cached.rows[0].discovered_at,
    });
  } catch (err) {
    console.error('[Discovery] Error fetching latest:', err);
    res.status(500).json({ error: 'Failed to fetch discovery results' });
  }
});

export default router;
