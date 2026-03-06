import { query } from '../db.js';

export interface BillingMeterRow {
  workspace_id: string;
  workspace_name?: string;
  workspace_slug?: string;
  billing_period: string;
  pandora_input_tokens: number;
  pandora_output_tokens: number;
  pandora_cost_usd: number;
  byok_input_tokens: number;
  byok_output_tokens: number;
  byok_cost_usd: number;
  total_calls: number;
  markup_multiplier: number;
  customer_charge_usd: number;
  invoice_status: string;
  invoice_reference: string | null;
  invoiced_at: string | null;
  notes: string | null;
}

function periodToDate(period: string): string {
  // Accept 'YYYY-MM' and return first day of month as ISO date
  const parts = period.split('-');
  if (parts.length === 2) return `${period}-01`;
  return period;
}

export async function rollupBillingPeriod(workspaceId: string, period: string): Promise<void> {
  const periodDate = periodToDate(period);
  const periodStart = new Date(periodDate);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const result = await query<{
    pandora_input: string;
    pandora_output: string;
    pandora_cost: string;
    byok_input: string;
    byok_output: string;
    byok_cost: string;
    total_calls: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN key_source = 'pandora' OR key_source IS NULL THEN input_tokens ELSE 0 END), 0)::text AS pandora_input,
       COALESCE(SUM(CASE WHEN key_source = 'pandora' OR key_source IS NULL THEN output_tokens ELSE 0 END), 0)::text AS pandora_output,
       COALESCE(SUM(CASE WHEN key_source = 'pandora' OR key_source IS NULL THEN estimated_cost_usd ELSE 0 END), 0)::text AS pandora_cost,
       COALESCE(SUM(CASE WHEN key_source = 'byok' THEN input_tokens ELSE 0 END), 0)::text AS byok_input,
       COALESCE(SUM(CASE WHEN key_source = 'byok' THEN output_tokens ELSE 0 END), 0)::text AS byok_output,
       COALESCE(SUM(CASE WHEN key_source = 'byok' THEN estimated_cost_usd ELSE 0 END), 0)::text AS byok_cost,
       COUNT(*)::text AS total_calls
     FROM token_usage
     WHERE workspace_id = $1
       AND created_at >= $2
       AND created_at < $3`,
    [workspaceId, periodStart.toISOString(), periodEnd.toISOString()]
  );

  const row = result.rows[0];
  if (!row) return;

  await query(
    `INSERT INTO billing_meter (
       workspace_id, billing_period,
       pandora_input_tokens, pandora_output_tokens, pandora_cost_usd,
       byok_input_tokens, byok_output_tokens, byok_cost_usd,
       total_calls, customer_charge_usd, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $5 * 2.5, NOW())
     ON CONFLICT (workspace_id, billing_period) DO UPDATE SET
       pandora_input_tokens = EXCLUDED.pandora_input_tokens,
       pandora_output_tokens = EXCLUDED.pandora_output_tokens,
       pandora_cost_usd = EXCLUDED.pandora_cost_usd,
       byok_input_tokens = EXCLUDED.byok_input_tokens,
       byok_output_tokens = EXCLUDED.byok_output_tokens,
       byok_cost_usd = EXCLUDED.byok_cost_usd,
       total_calls = EXCLUDED.total_calls,
       customer_charge_usd = EXCLUDED.pandora_cost_usd * billing_meter.markup_multiplier,
       updated_at = NOW()
     WHERE billing_meter.invoice_status = 'pending'`,
    [
      workspaceId,
      periodDate,
      parseInt(row.pandora_input),
      parseInt(row.pandora_output),
      parseFloat(row.pandora_cost),
      parseInt(row.byok_input),
      parseInt(row.byok_output),
      parseFloat(row.byok_cost),
      parseInt(row.total_calls),
    ]
  );
}

export async function rollupCurrentMonth(workspaceId: string): Promise<void> {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await rollupBillingPeriod(workspaceId, period);
}

export async function rollupAllWorkspaces(period: string): Promise<{ succeeded: number; failed: number }> {
  const workspacesResult = await query<{ id: string }>(
    `SELECT id FROM workspaces WHERE status = 'active' OR status IS NULL`
  );

  let succeeded = 0;
  let failed = 0;

  for (const ws of workspacesResult.rows) {
    try {
      await rollupBillingPeriod(ws.id, period);
      succeeded++;
    } catch (err) {
      console.error(`[BillingMeter] Failed to rollup workspace ${ws.id}:`, err);
      failed++;
    }
  }

  console.log(`[BillingMeter] Rollup complete for ${period}: ${succeeded} succeeded, ${failed} failed`);
  return { succeeded, failed };
}

export async function getAllWorkspaceMeter(period: string): Promise<BillingMeterRow[]> {
  const periodDate = periodToDate(period);

  const result = await query<any>(
    `SELECT
       bm.*,
       w.name AS workspace_name,
       w.slug AS workspace_slug
     FROM billing_meter bm
     JOIN workspaces w ON w.id = bm.workspace_id
     WHERE bm.billing_period = $1
     ORDER BY bm.customer_charge_usd DESC NULLS LAST`,
    [periodDate]
  );

  return result.rows.map(r => ({
    workspace_id: r.workspace_id,
    workspace_name: r.workspace_name,
    workspace_slug: r.workspace_slug,
    billing_period: r.billing_period,
    pandora_input_tokens: Number(r.pandora_input_tokens),
    pandora_output_tokens: Number(r.pandora_output_tokens),
    pandora_cost_usd: Number(r.pandora_cost_usd),
    byok_input_tokens: Number(r.byok_input_tokens),
    byok_output_tokens: Number(r.byok_output_tokens),
    byok_cost_usd: Number(r.byok_cost_usd),
    total_calls: Number(r.total_calls),
    markup_multiplier: Number(r.markup_multiplier),
    customer_charge_usd: Number(r.customer_charge_usd),
    invoice_status: r.invoice_status,
    invoice_reference: r.invoice_reference,
    invoiced_at: r.invoiced_at,
    notes: r.notes,
  }));
}
