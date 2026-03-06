import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { getAllWorkspaceMeter, rollupBillingPeriod, rollupAllWorkspaces } from '../billing/meter.js';
import { requirePermission } from '../middleware/permissions.js';

const router = Router();

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function periodToDate(period: string): string {
  const parts = period.split('-');
  if (parts.length === 2) return `${period}-01`;
  return period;
}

// GET /:workspaceId/admin/billing?period=YYYY-MM
router.get('/:workspaceId/admin/billing', requirePermission('config.view'), async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || currentPeriod();
    const autoRollup = req.query.rollup !== 'false';

    if (autoRollup) {
      await rollupAllWorkspaces(period).catch(err =>
        console.warn('[BillingAdmin] Auto-rollup warning:', err.message)
      );
    }

    const rows = await getAllWorkspaceMeter(period);

    const summary = {
      period,
      total_workspaces: rows.length,
      total_pandora_cost: rows.reduce((s, r) => s + r.pandora_cost_usd, 0),
      total_customer_charge: rows.reduce((s, r) => s + r.customer_charge_usd, 0),
      total_byok_tokens: rows.reduce((s, r) => s + r.byok_input_tokens + r.byok_output_tokens, 0),
      total_calls: rows.reduce((s, r) => s + r.total_calls, 0),
      pending_count: rows.filter(r => r.invoice_status === 'pending').length,
      invoiced_count: rows.filter(r => r.invoice_status === 'invoiced').length,
      paid_count: rows.filter(r => r.invoice_status === 'paid').length,
    };

    res.json({ summary, rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[BillingAdmin] GET /billing error:', msg);
    res.status(500).json({ error: msg });
  }
});

// POST /:workspaceId/admin/billing/rollup?period=YYYY-MM
router.post('/:workspaceId/admin/billing/rollup', requirePermission('config.edit'), async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || currentPeriod();
    const result = await rollupAllWorkspaces(period);
    res.json({ status: 'ok', period, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /:workspaceId/admin/billing/export?period=YYYY-MM
router.get('/:workspaceId/admin/billing/export', requirePermission('config.view'), async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || currentPeriod();
    const rows = await getAllWorkspaceMeter(period);

    const headers = [
      'Workspace', 'Workspace ID', 'Period',
      'Pandora Input Tokens', 'Pandora Output Tokens', 'Pandora Cost (USD)',
      'BYOK Input Tokens', 'BYOK Output Tokens',
      'Markup', 'Customer Charge (USD)',
      'Total Calls', 'Invoice Status', 'Invoice Reference', 'Invoiced At', 'Notes',
    ];

    const csvRows = rows.map(r => [
      `"${(r.workspace_name || '').replace(/"/g, '""')}"`,
      r.workspace_id,
      r.billing_period,
      r.pandora_input_tokens,
      r.pandora_output_tokens,
      r.pandora_cost_usd.toFixed(6),
      r.byok_input_tokens,
      r.byok_output_tokens,
      r.markup_multiplier,
      r.customer_charge_usd.toFixed(6),
      r.total_calls,
      r.invoice_status,
      r.invoice_reference || '',
      r.invoiced_at ? new Date(r.invoiced_at).toISOString() : '',
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ].join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="billing-${period}.csv"`);
    res.send(csv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /:workspaceId/admin/billing/:billingWorkspaceId/invoice
router.post('/:workspaceId/admin/billing/:billingWorkspaceId/invoice', requirePermission('config.edit'), async (req: Request, res: Response) => {
  try {
    const { billingWorkspaceId } = req.params;
    const period = (req.query.period as string) || currentPeriod();
    const { invoice_reference, notes } = req.body;
    const periodDate = periodToDate(period);

    await query(
      `UPDATE billing_meter SET
         invoice_status = 'invoiced',
         invoice_reference = $3,
         invoiced_at = NOW(),
         notes = COALESCE($4, notes),
         updated_at = NOW()
       WHERE workspace_id = $1 AND billing_period = $2`,
      [billingWorkspaceId, periodDate, invoice_reference || null, notes || null]
    );

    res.json({ status: 'invoiced', workspace_id: billingWorkspaceId, period });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /:workspaceId/admin/billing/:billingWorkspaceId/paid
router.post('/:workspaceId/admin/billing/:billingWorkspaceId/paid', requirePermission('config.edit'), async (req: Request, res: Response) => {
  try {
    const { billingWorkspaceId } = req.params;
    const period = (req.query.period as string) || currentPeriod();
    const periodDate = periodToDate(period);

    await query(
      `UPDATE billing_meter SET invoice_status = 'paid', updated_at = NOW()
       WHERE workspace_id = $1 AND billing_period = $2`,
      [billingWorkspaceId, periodDate]
    );

    res.json({ status: 'paid', workspace_id: billingWorkspaceId, period });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /:workspaceId/admin/billing/:billingWorkspaceId/waive
router.post('/:workspaceId/admin/billing/:billingWorkspaceId/waive', requirePermission('config.edit'), async (req: Request, res: Response) => {
  try {
    const { billingWorkspaceId } = req.params;
    const period = (req.query.period as string) || currentPeriod();
    const { notes } = req.body;
    const periodDate = periodToDate(period);

    await query(
      `UPDATE billing_meter SET
         invoice_status = 'waived',
         notes = COALESCE($3, notes),
         updated_at = NOW()
       WHERE workspace_id = $1 AND billing_period = $2`,
      [billingWorkspaceId, periodDate, notes || null]
    );

    res.json({ status: 'waived', workspace_id: billingWorkspaceId, period });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /:workspaceId/admin/billing/:billingWorkspaceId/markup
router.post('/:workspaceId/admin/billing/:billingWorkspaceId/markup', requirePermission('config.edit'), async (req: Request, res: Response) => {
  try {
    const { billingWorkspaceId } = req.params;
    const period = (req.query.period as string) || currentPeriod();
    const { markup_multiplier } = req.body;
    const periodDate = periodToDate(period);

    if (typeof markup_multiplier !== 'number' || markup_multiplier < 1) {
      res.status(400).json({ error: 'markup_multiplier must be a number >= 1' });
      return;
    }

    await query(
      `UPDATE billing_meter SET markup_multiplier = $3, updated_at = NOW()
       WHERE workspace_id = $1 AND billing_period = $2`,
      [billingWorkspaceId, periodDate, markup_multiplier]
    );

    res.json({ status: 'updated', workspace_id: billingWorkspaceId, markup_multiplier });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
