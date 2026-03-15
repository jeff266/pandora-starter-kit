import { query } from '../db.js';

export interface DealStateAtDate {
  dealId: string;
  dealSourceId: string;
  snapshotDate: Date;
  stage: string | null;
  stageNormalized: string | null;
  forecastCategory: string | null;
  amount: number | null;
  closeDate: Date | null;
  wasOpenOnDate: boolean;
  wasInQuarter: boolean;
}

const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

export async function reconstructDealStateAtDate(
  workspaceId: string,
  dealIds: string[],
  snapshotDate: Date
): Promise<Map<string, DealStateAtDate>> {
  if (dealIds.length === 0) return new Map();

  const snap = snapshotDate.toISOString();

  const dealBaseResult = await query<{
    id: string;
    source_id: string;
    stage: string | null;
    stage_normalized: string | null;
    amount: number | null;
    close_date: string | null;
    created_at: string;
  }>(
    `SELECT id, source_id, stage, stage_normalized, amount, close_date, created_at
     FROM deals
     WHERE workspace_id = $1 AND id = ANY($2)`,
    [workspaceId, dealIds]
  );

  const baseMap = new Map(dealBaseResult.rows.map(r => [r.id, r]));

  const stageHistoryResult = await query<{
    deal_id: string;
    stage: string | null;
    stage_normalized: string | null;
    entered_at: string;
  }>(
    `SELECT deal_id, stage, stage_normalized, entered_at
     FROM deal_stage_history
     WHERE workspace_id = $1
       AND deal_id = ANY($2)
       AND entered_at <= $3
     ORDER BY entered_at DESC`,
    [workspaceId, dealIds, snap]
  );

  const stageAtDate = new Map<string, { stage: string | null; stageNormalized: string | null }>();
  for (const row of stageHistoryResult.rows) {
    if (!stageAtDate.has(row.deal_id)) {
      stageAtDate.set(row.deal_id, { stage: row.stage, stageNormalized: row.stage_normalized });
    }
  }

  const fieldHistoryResult = await query<{
    deal_id: string;
    field_name: string;
    to_value: string;
    changed_at: string;
  }>(
    `SELECT deal_id, field_name, to_value, changed_at
     FROM deal_field_history
     WHERE workspace_id = $1
       AND deal_id = ANY($2)
       AND changed_at <= $3
     ORDER BY changed_at DESC`,
    [workspaceId, dealIds, snap]
  );

  const fieldAtDate = new Map<string, Record<string, string>>();
  for (const row of fieldHistoryResult.rows) {
    if (!fieldAtDate.has(row.deal_id)) fieldAtDate.set(row.deal_id, {});
    const fields = fieldAtDate.get(row.deal_id)!;
    if (!fields[row.field_name]) fields[row.field_name] = row.to_value;
  }

  const result = new Map<string, DealStateAtDate>();

  for (const dealId of dealIds) {
    const base = baseMap.get(dealId);
    if (!base) continue;

    const stageInfo = stageAtDate.get(dealId);
    const fields = fieldAtDate.get(dealId) ?? {};

    const stageNormalized = stageInfo?.stageNormalized ?? base.stage_normalized;
    const stage = stageInfo?.stage ?? base.stage;

    const rawAmount = fields['amount'] ?? String(base.amount ?? '');
    const amount = rawAmount ? parseFloat(rawAmount) : null;

    const rawCloseDate = fields['closedate'] ?? base.close_date;
    const closeDate = rawCloseDate ? new Date(rawCloseDate) : null;

    const forecastCategory = fields['forecastcategory'] ?? null;

    const wasOpenOnDate = !CLOSED_STAGES.has(stageNormalized ?? '');
    const wasInQuarter = false;

    result.set(dealId, {
      dealId,
      dealSourceId: base.source_id,
      snapshotDate,
      stage,
      stageNormalized,
      forecastCategory,
      amount: isNaN(amount as number) ? null : amount,
      closeDate,
      wasOpenOnDate,
      wasInQuarter,
    });
  }

  return result;
}
