import { query } from '../db.js';

export interface DealSnapshot {
  id: string;
  source_id: string;
  name: string;
  stage: string | null;
  stage_normalized: string | null;
  amount: number | null;
  owner_name: string | null;
}

export interface StageChangeDetail {
  dealName: string;
  from: string | null;
  to: string | null;
  type: 'changed' | 'new' | 'removed';
}

export interface StageChangeResult {
  stageChanges: number;
  newDeals: number;
  removedDeals: number;
  amountChanges: number;
  changeDetails: StageChangeDetail[];
}

export interface DeduplicationInfo {
  strategy: 'external_id' | 'name_match' | 'none';
  existingRecords: number;
  matchingRecords: number;
  newRecords: number;
  deletedIfReplace: number;
  recommendation: 'replace' | 'merge';
  reason: string;
}

export async function captureCurrentDealState(workspaceId: string): Promise<Map<string, DealSnapshot>> {
  const result = await query<DealSnapshot>(
    `SELECT id, source_id, name, stage, stage_normalized, amount, owner as owner_name
     FROM deals
     WHERE workspace_id = $1 AND source = 'csv_import'`,
    [workspaceId]
  );

  const snapshotMap = new Map<string, DealSnapshot>();
  for (const row of result.rows) {
    if (row.source_id) {
      snapshotMap.set(row.source_id, row);
    }
  }
  return snapshotMap;
}

export async function diffAndWriteStageHistory(
  workspaceId: string,
  batchId: string,
  previousState: Map<string, DealSnapshot>
): Promise<StageChangeResult> {
  if (previousState.size === 0) {
    return { stageChanges: 0, newDeals: 0, removedDeals: 0, amountChanges: 0, changeDetails: [] };
  }

  const currentDeals = await query<DealSnapshot>(
    `SELECT id, source_id, name, stage, stage_normalized, amount, owner as owner_name
     FROM deals
     WHERE workspace_id = $1 AND source = 'csv_import'`,
    [workspaceId]
  );

  const newSourceIds = new Set<string>();
  let stageChanges = 0;
  let newDeals = 0;
  let removedDeals = 0;
  let amountChanges = 0;
  const changeDetails: StageChangeDetail[] = [];

  for (const deal of currentDeals.rows) {
    if (!deal.source_id) continue;
    newSourceIds.add(deal.source_id);

    const old = previousState.get(deal.source_id);
    if (old) {
      if (old.stage !== deal.stage) {
        stageChanges++;
        changeDetails.push({
          dealName: deal.name,
          from: old.stage,
          to: deal.stage,
          type: 'changed',
        });

        // Close previous stage entry
        await query(
          `UPDATE deal_stage_history
           SET exited_at = NOW()
           WHERE workspace_id = $1 AND deal_id = $2 AND stage = $3 AND exited_at IS NULL`,
          [workspaceId, deal.id, old.stage]
        );
        // Insert new stage entry
        await query(
          `INSERT INTO deal_stage_history
             (id, workspace_id, deal_id, stage, stage_normalized, entered_at, source)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), 'file_import_diff')`,
          [workspaceId, deal.id, deal.stage, deal.stage_normalized]
        );
      }

      if (old.amount !== deal.amount) {
        amountChanges++;
      }
    } else {
      newDeals++;
      changeDetails.push({
        dealName: deal.name,
        from: null,
        to: deal.stage,
        type: 'new',
      });

      await query(
        `INSERT INTO deal_stage_history
           (id, workspace_id, deal_id, stage, stage_normalized, entered_at, source)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), 'file_import_new')`,
        [workspaceId, deal.id, deal.stage, deal.stage_normalized]
      );
    }
  }

  for (const [sourceId, old] of previousState) {
    if (!newSourceIds.has(sourceId)) {
      removedDeals++;
      changeDetails.push({
        dealName: old.name,
        from: old.stage,
        to: 'removed_from_export',
        type: 'removed',
      });
    }
  }

  return { stageChanges, newDeals, removedDeals, amountChanges, changeDetails };
}

export async function computeDeduplication(
  workspaceId: string,
  entityType: 'deal' | 'contact' | 'account',
  rows: any[][],
  headers: string[],
  mapping: Record<string, any>
): Promise<DeduplicationInfo> {
  const table = entityType === 'deal' ? 'deals' : entityType === 'contact' ? 'contacts' : 'accounts';

  const existingResult = await query<{ id: string; source_id: string; name: string }>(
    `SELECT id, source_id, ${entityType === 'contact' ? "CONCAT(first_name, ' ', last_name)" : 'name'} as name
     FROM ${table}
     WHERE workspace_id = $1 AND source = 'csv_import'`,
    [workspaceId]
  );

  const existingRecords = existingResult.rows.length;
  if (existingRecords === 0) {
    return {
      strategy: 'none',
      existingRecords: 0,
      matchingRecords: 0,
      newRecords: rows.length,
      deletedIfReplace: 0,
      recommendation: 'replace',
      reason: 'No existing imported records — first import',
    };
  }

  const existingSourceIds = new Set(existingResult.rows.map(r => r.source_id));
  const existingNames = new Set(existingResult.rows.map(r => r.name?.toLowerCase().trim()).filter(Boolean));

  const externalIdIdx = mapping['external_id']?.columnIndex ?? mapping['external_id']?.column_index;
  const nameField = entityType === 'contact' ? 'email' : 'name';
  const nameIdx = mapping[nameField]?.columnIndex ?? mapping[nameField]?.column_index;

  let matchingByExternalId = 0;
  let matchingByName = 0;
  let hasExternalIds = 0;

  for (const row of rows) {
    const extId = externalIdIdx !== undefined && externalIdIdx !== null ? String(row[externalIdIdx] || '').trim() : '';
    if (extId) {
      hasExternalIds++;
      if (existingSourceIds.has(extId)) {
        matchingByExternalId++;
      }
    }

    if (nameIdx !== undefined && nameIdx !== null) {
      const name = String(row[nameIdx] || '').toLowerCase().trim();
      if (name && existingNames.has(name)) {
        matchingByName++;
      }
    }
  }

  const useExternalId = hasExternalIds > rows.length * 0.8;
  const matchingRecords = useExternalId ? matchingByExternalId : matchingByName;
  const newRecords = rows.length - matchingRecords;
  const strategy: 'external_id' | 'name_match' | 'none' = useExternalId ? 'external_id' : (matchingByName > 0 ? 'name_match' : 'none');

  let recommendation: 'replace' | 'merge' = 'replace';
  let reason = '';

  if (useExternalId && matchingByExternalId > existingRecords * 0.5) {
    recommendation = 'merge';
    reason = `${matchingByExternalId} of ${rows.length} rows match existing records by ID — merge preserves unmatched records`;
  }

  const sizeRatio = rows.length / existingRecords;
  if (sizeRatio >= 0.8 && sizeRatio <= 1.2) {
    recommendation = 'replace';
    reason = `File has ${rows.length} rows vs ${existingRecords} existing — similar size suggests a full export`;
  } else if (sizeRatio < 0.5) {
    recommendation = 'merge';
    reason = `File has ${rows.length} rows vs ${existingRecords} existing — this looks like a partial export`;
  }

  if (!reason) {
    reason = recommendation === 'replace'
      ? `Recommended replacing all ${existingRecords} records with the ${rows.length} from this file`
      : `Recommended merging ${matchingRecords} matching records and inserting ${newRecords} new ones`;
  }

  return {
    strategy,
    existingRecords,
    matchingRecords,
    newRecords,
    deletedIfReplace: existingRecords,
    recommendation,
    reason,
  };
}
