import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ApolloCompany');

export async function backfillAccountsFromDealContacts(
  workspaceId: string,
  options: { closedDealsOnly?: boolean } = {}
): Promise<{
  accountsUpdated: number;
  industryUpdated: number;
  employeeCountUpdated: number;
  skipped: number;
}> {
  const { closedDealsOnly = true } = options;

  const closedDealFilter = closedDealsOnly
    ? `AND d.stage_normalized IN ('closed_won', 'closed_lost')`
    : '';

  const rows = await query<{
    account_id: string;
    account_name: string;
    apollo_industry: string | null;
    apollo_employees: string | null;
    apollo_org: any;
  }>(
    `SELECT DISTINCT ON (a.id)
       a.id as account_id,
       a.name as account_name,
       dc.apollo_data->'person'->'organization'->>'industry' as apollo_industry,
       dc.apollo_data->'person'->'organization'->>'estimated_num_employees' as apollo_employees,
       dc.apollo_data->'person'->'organization' as apollo_org
     FROM accounts a
     JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
     JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
     WHERE a.workspace_id = $1
       ${closedDealFilter}
       AND dc.apollo_data IS NOT NULL AND dc.apollo_data::text != '{}'
       AND dc.apollo_data->'person'->'organization' IS NOT NULL
     ORDER BY a.id, dc.enriched_at DESC NULLS LAST`,
    [workspaceId]
  );

  logger.info('Backfilling accounts from deal contact Apollo data', {
    workspaceId, candidateCount: rows.rows.length,
  });

  let accountsUpdated = 0;
  let industryUpdated = 0;
  let employeeCountUpdated = 0;
  let skipped = 0;

  for (const row of rows.rows) {
    const orgData = typeof row.apollo_org === 'string' ? JSON.parse(row.apollo_org) : row.apollo_org;
    if (!orgData) { skipped++; continue; }

    const industry = row.apollo_industry?.trim() || null;
    const employeeCount = row.apollo_employees ? parseInt(row.apollo_employees) : null;

    if (!industry && !employeeCount) { skipped++; continue; }

    const updates: string[] = [];
    const params: any[] = [row.account_id, workspaceId];

    if (industry) {
      params.push(industry);
      updates.push(`industry = $${params.length}`);
      industryUpdated++;
    }

    if (employeeCount && !isNaN(employeeCount)) {
      params.push(employeeCount);
      updates.push(`employee_count = $${params.length}`);
      employeeCountUpdated++;
    }

    params.push(JSON.stringify(orgData));
    updates.push(`apollo_data = $${params.length}`);
    updates.push(`apollo_enriched_at = NOW()`);
    updates.push(`updated_at = NOW()`);

    await query(
      `UPDATE accounts SET ${updates.join(', ')} WHERE id = $1 AND workspace_id = $2`,
      params
    );

    accountsUpdated++;
    logger.debug('Updated account from Apollo contact data', {
      accountId: row.account_id, name: row.account_name,
      industry, employeeCount,
    });
  }

  logger.info('Account backfill complete', {
    accountsUpdated, industryUpdated, employeeCountUpdated, skipped,
  });

  return { accountsUpdated, industryUpdated, employeeCountUpdated, skipped };
}

export async function enrichAccountsBatch(
  workspaceId: string,
  apiKey: string,
  options: {
    limit?: number;
    cacheDays?: number;
    closedDealsOnly?: boolean;
  } = {}
): Promise<{
  enrichedCount: number;
  cachedCount: number;
  failedCount: number;
  noDomainCount: number;
  updatedFields: { industryUpdated: number; employeeCountUpdated: number };
}> {
  const { closedDealsOnly = true } = options;

  const backfillResult = await backfillAccountsFromDealContacts(workspaceId, { closedDealsOnly });

  return {
    enrichedCount: backfillResult.accountsUpdated,
    cachedCount: 0,
    failedCount: backfillResult.skipped,
    noDomainCount: 0,
    updatedFields: {
      industryUpdated: backfillResult.industryUpdated,
      employeeCountUpdated: backfillResult.employeeCountUpdated,
    },
  };
}
