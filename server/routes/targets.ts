import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { computeGap, getActiveTarget } from '../analysis/gap-calculator.js';

const router = Router();

// ============================================================================
// GET /:workspaceId/targets
// Returns all active targets for workspace
// ============================================================================

router.get('/:workspaceId/targets', requirePermission('data.deals_view'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;
  const { period_type, active_only } = req.query;

  try {
    let sql = 'SELECT * FROM targets WHERE workspace_id = $1';
    const params: any[] = [workspaceId];

    if (active_only === 'true') {
      sql += ' AND is_active = true';
    }

    if (period_type) {
      sql += ` AND period_type = $${params.length + 1}`;
      params.push(period_type);
    }

    sql += ' ORDER BY period_start DESC';

    const result = await query(sql, params);

    res.json({
      targets: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('[targets] Error listing targets:', err);
    res.status(500).json({ error: 'Failed to fetch targets' });
  }
});

// ============================================================================
// POST /:workspaceId/targets
// Create a new target (deactivates prior target for same period if exists)
// ============================================================================

router.post('/:workspaceId/targets', requirePermission('config.edit'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;
  const { metric, period_type, period_start, period_end, period_label, amount, notes, set_by } = req.body as {
    metric: string;
    period_type: string;
    period_start: string;
    period_end: string;
    period_label: string;
    amount: number;
    notes?: string;
    set_by?: string;
  };

  if (!metric || !period_type || !period_start || !period_end || !period_label || amount == null) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    // Check for existing active target for this period
    const existing = await query(
      `SELECT id FROM targets
       WHERE workspace_id = $1
         AND period_start = $2
         AND period_end = $3
         AND is_active = true`,
      [workspaceId, period_start, period_end]
    );

    const existingTargetId = existing.rows[0]?.id || null;
    let supersededTarget = false;

    // Deactivate existing target if found
    if (existingTargetId) {
      await query(
        `UPDATE targets SET is_active = false WHERE id = $1`,
        [existingTargetId]
      );
      supersededTarget = true;
    }

    // Insert new target
    const result = await query(
      `INSERT INTO targets (
        workspace_id, metric, period_type, period_start, period_end,
        period_label, amount, set_by, notes, is_active, supersedes_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
      RETURNING *`,
      [
        workspaceId,
        metric,
        period_type,
        period_start,
        period_end,
        period_label,
        amount,
        set_by || null,
        notes || null,
        existingTargetId,
      ]
    );

    res.json({
      target: result.rows[0],
      superseded: supersededTarget,
      superseded_id: existingTargetId,
    });
  } catch (err) {
    console.error('[targets] Error creating target:', err);
    res.status(500).json({ error: 'Failed to create target' });
  }
});

// ============================================================================
// PATCH /:workspaceId/targets/:targetId
// Update target amount or notes (creates revision)
// ============================================================================

router.patch('/:workspaceId/targets/:targetId', requirePermission('config.edit'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, targetId } = req.params;
  const { amount, notes, set_by } = req.body as { amount?: number; notes?: string; set_by?: string };

  if (amount == null && notes == null) {
    res.status(400).json({ error: 'Must provide amount or notes to update' });
    return;
  }

  try {
    // Load current target
    const current = await query(
      `SELECT * FROM targets WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, targetId]
    );

    if (current.rows.length === 0) {
      res.status(404).json({ error: 'Target not found' });
      return;
    }

    const currentTarget = current.rows[0];

    // Deactivate old target
    await query(`UPDATE targets SET is_active = false WHERE id = $1`, [targetId]);

    // Create new revision
    const result = await query(
      `INSERT INTO targets (
        workspace_id, metric, period_type, period_start, period_end, period_label,
        amount, set_by, notes, is_active, supersedes_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
      RETURNING *`,
      [
        workspaceId,
        currentTarget.metric,
        currentTarget.period_type,
        currentTarget.period_start,
        currentTarget.period_end,
        currentTarget.period_label,
        amount ?? currentTarget.amount,
        set_by || null,
        notes ?? currentTarget.notes,
        targetId,
      ]
    );

    res.json({
      target: result.rows[0],
      superseded_id: targetId,
    });
  } catch (err) {
    console.error('[targets] Error updating target:', err);
    res.status(500).json({ error: 'Failed to update target' });
  }
});

// ============================================================================
// GET /:workspaceId/targets/gap
// Returns GapCalculation for the active target
// ============================================================================

router.get('/:workspaceId/targets/gap', requirePermission('data.deals_view'), async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { period_start, period_end } = req.query;

  try {
    const target = await getActiveTarget(
      workspaceId,
      typeof period_start === 'string' ? period_start : undefined,
      typeof period_end === 'string' ? period_end : undefined
    );

    if (!target) {
      res.status(404).json({ error: 'No active target found for the specified period' });
      return;
    }

    const gap = await computeGap(workspaceId, target);
    res.json(gap);
  } catch (err) {
    console.error('[targets] Error computing gap:', err);
    res.status(500).json({ error: 'Failed to compute gap' });
  }
});

// ============================================================================
// GET /:workspaceId/quotas
// Returns all active quotas, grouped by period
// ============================================================================

router.get('/:workspaceId/quotas', requirePermission('data.deals_view'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;
  const { period_start } = req.query;

  try {
    let sql = 'SELECT * FROM quotas WHERE workspace_id = $1 AND is_active = true';
    const params: any[] = [workspaceId];

    if (period_start && typeof period_start === 'string') {
      sql += ` AND period_start = $${params.length + 1}`;
      params.push(period_start);
    }

    sql += ' ORDER BY period_start DESC, rep_email ASC';

    const result = await query(sql, params);

    res.json({
      quotas: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('[targets] Error listing quotas:', err);
    res.status(500).json({ error: 'Failed to fetch quotas' });
  }
});

// ============================================================================
// POST /:workspaceId/quotas/bulk
// Upsert multiple rep quotas (paste-from-spreadsheet flow)
// ============================================================================

router.post('/:workspaceId/quotas/bulk', requirePermission('config.edit'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;
  const { quotas, set_by } = req.body as {
    quotas: {
      rep_email: string;
      rep_name?: string;
      amount: number;
      period_type: string;
      period_start: string;
      period_end: string;
      period_label: string;
      metric: string;
    }[];
    set_by?: string;
  };

  if (!quotas || !Array.isArray(quotas) || quotas.length === 0) {
    res.status(400).json({ error: 'quotas array is required' });
    return;
  }

  try {
    const inserted = [];

    for (const quota of quotas) {
      if (!quota.rep_email || quota.amount == null || !quota.period_start || !quota.period_end) {
        continue; // skip invalid entries
      }

      // Deactivate existing quota for same rep + period
      await query(
        `UPDATE quotas
         SET is_active = false
         WHERE workspace_id = $1
           AND rep_email = $2
           AND period_start = $3
           AND period_end = $4
           AND is_active = true`,
        [workspaceId, quota.rep_email, quota.period_start, quota.period_end]
      );

      // Insert new quota
      const result = await query(
        `INSERT INTO quotas (
          workspace_id, rep_email, rep_name, amount, metric,
          period_type, period_start, period_end, period_label, set_by, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
        RETURNING *`,
        [
          workspaceId,
          quota.rep_email,
          quota.rep_name || null,
          quota.amount,
          quota.metric,
          quota.period_type,
          quota.period_start,
          quota.period_end,
          quota.period_label,
          set_by || null,
        ]
      );

      inserted.push(result.rows[0]);
    }

    res.json({
      quotas: inserted,
      total: inserted.length,
    });
  } catch (err) {
    console.error('[targets] Error bulk upserting quotas:', err);
    res.status(500).json({ error: 'Failed to upsert quotas' });
  }
});

// ============================================================================
// PATCH /:workspaceId/quotas/:quotaId
// Update single quota amount
// ============================================================================

router.patch('/:workspaceId/quotas/:quotaId', requirePermission('config.edit'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, quotaId } = req.params;
  const { amount, set_by } = req.body as { amount: number; set_by?: string };

  if (amount == null) {
    res.status(400).json({ error: 'amount is required' });
    return;
  }

  try {
    // Load current quota
    const current = await query(
      `SELECT * FROM quotas WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, quotaId]
    );

    if (current.rows.length === 0) {
      res.status(404).json({ error: 'Quota not found' });
      return;
    }

    const currentQuota = current.rows[0];

    // Deactivate old quota
    await query(`UPDATE quotas SET is_active = false WHERE id = $1`, [quotaId]);

    // Create new revision
    const result = await query(
      `INSERT INTO quotas (
        workspace_id, rep_email, rep_name, amount, metric,
        period_type, period_start, period_end, period_label,
        set_by, is_active, supersedes_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
      RETURNING *`,
      [
        workspaceId,
        currentQuota.rep_email,
        currentQuota.rep_name,
        amount,
        currentQuota.metric,
        currentQuota.period_type,
        currentQuota.period_start,
        currentQuota.period_end,
        currentQuota.period_label,
        set_by || null,
        quotaId,
      ]
    );

    res.json({
      quota: result.rows[0],
      superseded_id: quotaId,
    });
  } catch (err) {
    console.error('[targets] Error updating quota:', err);
    res.status(500).json({ error: 'Failed to update quota' });
  }
});

// ============================================================================
// GET /:workspaceId/targets/revenue-model
// Returns detected revenue model with confidence and signals
// ============================================================================

router.get('/:workspaceId/targets/revenue-model', requirePermission('data.deals_view'), async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;

  try {
    // Check workspace_config first
    const configResult = await query(
      `SELECT config_data FROM workspace_config WHERE workspace_id = $1`,
      [workspaceId]
    );

    const existingMetric = configResult.rows[0]?.config_data?.business_model?.revenue_metric;

    if (existingMetric) {
      res.json({
        detected_metric: existingMetric,
        confidence: 1.0,
        signals: ['User-configured revenue metric'],
        display_label: getMetricLabel(existingMetric),
      });
      return;
    }

    // Detect from deal data
    const detected = await detectRevenueModel(workspaceId);
    res.json(detected);
  } catch (err) {
    console.error('[targets] Error detecting revenue model:', err);
    res.status(500).json({ error: 'Failed to detect revenue model' });
  }
});

// ============================================================================
// PATCH /:workspaceId/targets/revenue-model
// Override detected revenue model
// ============================================================================

router.patch('/:workspaceId/targets/revenue-model', requirePermission('config.edit'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;
  const { metric } = req.body as { metric: string };

  if (!metric) {
    res.status(400).json({ error: 'metric is required' });
    return;
  }

  try {
    // Load existing config
    const configResult = await query(
      `SELECT config_data FROM workspace_config WHERE workspace_id = $1`,
      [workspaceId]
    );

    const configData = configResult.rows[0]?.config_data || {};
    configData.business_model = configData.business_model || {};
    configData.business_model.revenue_metric = metric;

    // Upsert config
    await query(
      `INSERT INTO workspace_config (workspace_id, config_data)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (workspace_id)
       DO UPDATE SET config_data = $2::jsonb`,
      [workspaceId, JSON.stringify(configData)]
    );

    res.json({
      metric,
      display_label: getMetricLabel(metric),
    });
  } catch (err) {
    console.error('[targets] Error updating revenue model:', err);
    res.status(500).json({ error: 'Failed to update revenue model' });
  }
});

// ============================================================================
// Helper: Detect revenue model from deal patterns
// ============================================================================

async function detectRevenueModel(workspaceId: string): Promise<{
  detected_metric: string;
  confidence: number;
  signals: string[];
  display_label: string;
}> {
  const signals: string[] = [];
  let metric = 'revenue';
  let confidence = 0.5;

  // Check deal names for ARR/subscription patterns
  const nameResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM deals
     WHERE workspace_id = $1
       AND (name ILIKE '%subscription%' OR name ILIKE '%annual%' OR name ILIKE '%renewal%')
     LIMIT 10`,
    [workspaceId]
  );
  const subscriptionDeals = Number(nameResult.rows[0]?.cnt || 0);

  if (subscriptionDeals > 0) {
    signals.push(`${subscriptionDeals} deal(s) with subscription/annual/renewal keywords`);
    metric = 'arr';
    confidence = 0.7;
  }

  // Check for recurring amount patterns (MRR signal)
  const mrrResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM deals
     WHERE workspace_id = $1
       AND amount > 0
       AND amount % 100 = 0
     LIMIT 10`,
    [workspaceId]
  );
  const roundAmounts = Number(mrrResult.rows[0]?.cnt || 0);

  if (roundAmounts > 5) {
    signals.push(`${roundAmounts} deals with round monthly-style amounts`);
    if (metric === 'arr') {
      // Keep ARR if already detected
    } else {
      metric = 'mrr';
      confidence = 0.6;
    }
  }

  // Default fallback
  if (signals.length === 0) {
    signals.push('No strong signals detected — defaulting to generic revenue');
  }

  return {
    detected_metric: metric,
    confidence,
    signals,
    display_label: getMetricLabel(metric),
  };
}

function getMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    arr: 'Annual Recurring Revenue (ARR)',
    mrr: 'Monthly Recurring Revenue (MRR)',
    revenue: 'Revenue',
    tcv: 'Total Contract Value (TCV)',
    acv: 'Annual Contract Value (ACV)',
    bookings: 'Bookings',
    gmv: 'Gross Merchandise Value (GMV)',
  };
  return labels[metric] || 'Revenue';
}

export default router;
