import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { getAllWorkspaceMeter, rollupBillingPeriod, rollupAllWorkspaces } from '../billing/meter.js';

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

// GET /api/admin/billing?period=YYYY-MM
router.get('/billing', async (req: Request, res: Response) => {
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

// POST /api/admin/billing/rollup?period=YYYY-MM
router.post('/billing/rollup', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || currentPeriod();
    const result = await rollupAllWorkspaces(period);
    res.json({ status: 'ok', period, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/admin/billing/:workspaceId/invoice
router.post('/billing/:workspaceId/invoice', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
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
      [workspaceId, periodDate, invoice_reference || null, notes || null]
    );

    res.json({ status: 'invoiced', workspace_id: workspaceId, period });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/admin/billing/:workspaceId/paid
router.post('/billing/:workspaceId/paid', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const period = (req.query.period as string) || currentPeriod();
    const periodDate = periodToDate(period);

    await query(
      `UPDATE billing_meter SET invoice_status = 'paid', updated_at = NOW()
       WHERE workspace_id = $1 AND billing_period = $2`,
      [workspaceId, periodDate]
    );

    res.json({ status: 'paid', workspace_id: workspaceId, period });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/admin/billing/:workspaceId/waive
router.post('/billing/:workspaceId/waive', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const period = (req.query.period as string) || currentPeriod();
    const { notes } = req.body;
    const periodDate = periodToDate(period);

    await query(
      `UPDATE billing_meter SET
         invoice_status = 'waived',
         notes = COALESCE($3, notes),
         updated_at = NOW()
       WHERE workspace_id = $1 AND billing_period = $2`,
      [workspaceId, periodDate, notes || null]
    );

    res.json({ status: 'waived', workspace_id: workspaceId, period });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/admin/billing/:workspaceId/markup
router.post('/billing/:workspaceId/markup', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
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
      [workspaceId, periodDate, markup_multiplier]
    );

    res.json({ status: 'updated', workspace_id: workspaceId, markup_multiplier });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/admin/billing/export?period=YYYY-MM
router.get('/billing/export', async (req: Request, res: Response) => {
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

export default router;
