/**
 * Tool Playground + Analytics Routes
 *
 * POST /:workspaceId/tools/:toolName/run  — run any tool from the UI (playground)
 * GET  /:workspaceId/tools/stats          — tool call analytics (last N days)
 */

import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { executeDataTool } from '../chat/data-tools.js';
import { getToolCallStats } from '../chat/tool-logger.js';

const router = Router();

// ─── POST /:workspaceId/tools/:toolName/run ───────────────────────────────────
// Runs a tool function directly against the workspace — used by the playground UI.

router.post('/:workspaceId/tools/:toolName/run', requirePermission('config.edit'), async (req, res) => {
  const { workspaceId, toolName } = req.params;
  const params: Record<string, any> = req.body || {};

  const start = Date.now();
  try {
    const result = await executeDataTool(workspaceId, toolName, params, 'playground');
    return res.json({
      tool_name: toolName,
      duration_ms: Date.now() - start,
      result,
    });
  } catch (err: any) {
    return res.status(400).json({
      tool_name: toolName,
      error: err.message || String(err),
      duration_ms: Date.now() - start,
    });
  }
});

// ─── GET /:workspaceId/tools/stats ────────────────────────────────────────────
// Returns per-tool usage stats for the last N days.

router.get('/:workspaceId/tools/stats', requirePermission('config.view'), async (req, res) => {
  const { workspaceId } = req.params;
  const calledBy = req.query.called_by as string | undefined;
  const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;

  try {
    const stats = await getToolCallStats(workspaceId, calledBy, days);
    return res.json({ stats, days, called_by: calledBy ?? 'all' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
