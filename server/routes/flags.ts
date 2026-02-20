/**
 * Flags Management API
 *
 * Handles workspace feature flags, capabilities, and experiments.
 * All routes mounted at /api/workspaces/:workspaceId/flags
 */

import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { query } from '../db.js';

const router = Router({ mergeParams: true });

interface FlagRow {
  key: string;
  value: boolean;
  flag_type: 'feature' | 'capability' | 'experiment';
  description: string | null;
  set_by: string | null;
  enabled_by_plan: boolean | null;
  plan_required: string | null;
  expires_at: string | null;
  updated_at: string;
}

/**
 * GET /
 * List all flags for workspace grouped by type
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const flagsResult = await query<FlagRow>(`
      SELECT
        key,
        value,
        flag_type,
        description,
        set_by,
        enabled_by_plan,
        plan_required,
        expires_at,
        updated_at
      FROM workspace_flags
      WHERE workspace_id = $1
      ORDER BY flag_type, key
    `, [workspaceId]);

    // Group flags by type
    const features: any[] = [];
    const capabilities: any[] = [];
    const experiments: any[] = [];

    for (const flag of flagsResult.rows) {
      const flagData: any = {
        key: flag.key,
        value: flag.value,
        description: flag.description,
        set_by: flag.set_by,
      };

      if (flag.flag_type === 'feature') {
        flagData.enabled_by_plan = flag.enabled_by_plan || false;
        flagData.plan_required = flag.plan_required;
        features.push(flagData);
      } else if (flag.flag_type === 'capability') {
        capabilities.push(flagData);
      } else if (flag.flag_type === 'experiment') {
        flagData.expires_at = flag.expires_at;
        experiments.push(flagData);
      }
    }

    res.json({
      features,
      capabilities,
      experiments,
    });
  } catch (err) {
    console.error('[flags] Error listing flags:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list flags' });
  }
});

/**
 * PATCH /:flagKey
 * Toggle a feature flag
 */
router.patch('/:flagKey', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const flagKey = req.params.flagKey as string;
    const { value } = req.body;

    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'Value must be a boolean' });
    }

    // Get current flag
    const flagResult = await query<FlagRow>(`
      SELECT
        key,
        value,
        flag_type,
        set_by,
        enabled_by_plan,
        plan_required
      FROM workspace_flags
      WHERE workspace_id = $1 AND key = $2
    `, [workspaceId, flagKey]);

    if (flagResult.rows.length === 0) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    const flag = flagResult.rows[0];

    // GUARD: Cannot toggle system-only flags unless platform_admin
    if (flag.set_by === 'pandora_staff' && req.user?.platform_role !== 'platform_admin') {
      return res.status(403).json({
        error: 'Cannot toggle system-only flags',
        flag: flagKey,
      });
    }

    // GUARD: Cannot enable feature flag if plan doesn't include it
    // Exception: platform_admin can override
    if (flag.flag_type === 'feature' && value === true) {
      if (!flag.enabled_by_plan && req.user?.platform_role !== 'platform_admin') {
        return res.status(403).json({
          error: 'Workspace plan does not include this feature',
          flag: flagKey,
          plan_required: flag.plan_required,
        });
      }
    }

    // Update flag
    const userId = req.user?.user_id || 'unknown';
    await query<Record<string, never>>(`
      UPDATE workspace_flags
      SET
        value = $1,
        set_by = $2,
        updated_at = NOW()
      WHERE workspace_id = $3 AND key = $4
    `, [value, userId, workspaceId, flagKey]);

    // Return updated flag
    res.json({
      key: flagKey,
      value,
      set_by: userId,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[flags] Error updating flag:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to update flag' });
  }
});

export default router;
