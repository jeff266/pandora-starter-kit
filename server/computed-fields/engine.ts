import { query, getClient } from '../db.js';
import { getContext } from '../context/index.js';
import { computeDealScores, type DealRow } from './deal-scores.js';
import { computeContactEngagement, type ContactRow } from './contact-scores.js';
import { computeAccountHealth, type AccountRow } from './account-scores.js';

export interface ComputeResult {
  workspaceId: string;
  computedAt: string;
  deals: { processed: number; updated: number };
  contacts: { processed: number; updated: number };
  accounts: { processed: number; updated: number };
}

export async function computeFields(workspaceId: string): Promise<ComputeResult> {
  const context = await getContext(workspaceId);
  const goals = (context?.goals_and_targets ?? {}) as Record<string, unknown>;
  const businessModel = (context?.business_model ?? {}) as Record<string, unknown>;
  const thresholds = (goals.thresholds ?? {}) as Record<string, unknown>;

  const config = {
    staleDealDays: (thresholds.stale_deal_days as number) ?? 14,
    salesCycleDays: (businessModel.sales_cycle_days as number) ?? 90,
    avgDealSize: ((businessModel.acv_range as Record<string, unknown>)?.avg as number) ?? 50000,
    pipelineCoverageTarget: (goals.pipeline_coverage_target as number) ?? 3,
  };

  const [dealResult, contactResult, accountResult] = await Promise.all([
    computeDeals(workspaceId, config),
    computeContacts(workspaceId),
    computeAccounts(workspaceId),
  ]);

  return {
    workspaceId,
    computedAt: new Date().toISOString(),
    deals: dealResult,
    contacts: contactResult,
    accounts: accountResult,
  };
}

async function computeDeals(
  workspaceId: string,
  config: { staleDealDays: number; salesCycleDays: number; avgDealSize: number }
): Promise<{ processed: number; updated: number }> {
  const result = await query<DealRow>(
    `SELECT id, amount, stage, close_date, probability, days_in_stage,
            last_activity_date, created_at, pipeline
     FROM deals
     WHERE workspace_id = $1
       AND stage NOT IN ('closedwon', 'closedlost', 'closed won', 'closed lost')`,
    [workspaceId]
  );

  const deals = result.rows;
  if (deals.length === 0) return { processed: 0, updated: 0 };

  const activityCounts = await query<{ deal_id: string; activity_count: string; last_activity: string | null }>(
    `SELECT deal_id,
            COUNT(*)::text AS activity_count,
            MAX(timestamp)::text AS last_activity
     FROM activities
     WHERE workspace_id = $1 AND deal_id IS NOT NULL
     GROUP BY deal_id`,
    [workspaceId]
  );

  const activityMap = new Map(
    activityCounts.rows.map(r => [r.deal_id, {
      count: parseInt(r.activity_count, 10),
      lastActivity: r.last_activity ? new Date(r.last_activity) : null,
    }])
  );

  const client = await getClient();
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const deal of deals) {
      const activity = activityMap.get(deal.id);
      const scores = computeDealScores(deal, config, activity);

      await client.query(
        `UPDATE deals
         SET velocity_score = $2,
             deal_risk = $3,
             deal_risk_factors = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [deal.id, scores.velocityScore, scores.dealRisk, JSON.stringify(scores.riskFactors)]
      );
      updated++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { processed: deals.length, updated };
}

async function computeContacts(
  workspaceId: string
): Promise<{ processed: number; updated: number }> {
  const result = await query<ContactRow>(
    `SELECT id, last_activity_date, lifecycle_stage, created_at
     FROM contacts
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const contacts = result.rows;
  if (contacts.length === 0) return { processed: 0, updated: 0 };

  const activityCounts = await query<{
    contact_id: string;
    activity_count: string;
    last_activity: string | null;
    email_count: string;
    meeting_count: string;
    call_count: string;
  }>(
    `SELECT contact_id,
            COUNT(*)::text AS activity_count,
            MAX(timestamp)::text AS last_activity,
            COUNT(*) FILTER (WHERE activity_type = 'email')::text AS email_count,
            COUNT(*) FILTER (WHERE activity_type = 'meeting')::text AS meeting_count,
            COUNT(*) FILTER (WHERE activity_type = 'call')::text AS call_count
     FROM activities
     WHERE workspace_id = $1 AND contact_id IS NOT NULL
     GROUP BY contact_id`,
    [workspaceId]
  );

  const activityMap = new Map(
    activityCounts.rows.map(r => [r.contact_id, {
      total: parseInt(r.activity_count, 10),
      lastActivity: r.last_activity ? new Date(r.last_activity) : null,
      emails: parseInt(r.email_count, 10),
      meetings: parseInt(r.meeting_count, 10),
      calls: parseInt(r.call_count, 10),
    }])
  );

  const client = await getClient();
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const contact of contacts) {
      const activity = activityMap.get(contact.id);
      const score = computeContactEngagement(contact, activity);

      await client.query(
        `UPDATE contacts SET engagement_score = $2, updated_at = NOW() WHERE id = $1`,
        [contact.id, score]
      );
      updated++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { processed: contacts.length, updated };
}

async function computeAccounts(
  workspaceId: string
): Promise<{ processed: number; updated: number }> {
  const result = await query<AccountRow>(
    `SELECT id, open_deal_count, annual_revenue
     FROM accounts
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const accounts = result.rows;
  if (accounts.length === 0) return { processed: 0, updated: 0 };

  const accountMetrics = await query<{
    account_id: string;
    contact_count: string;
    avg_engagement: string;
    deal_count: string;
    total_deal_value: string;
    last_activity: string | null;
  }>(
    `SELECT
       a.id AS account_id,
       COALESCE(c.contact_count, 0)::text AS contact_count,
       COALESCE(c.avg_engagement, 0)::text AS avg_engagement,
       COALESCE(d.deal_count, 0)::text AS deal_count,
       COALESCE(d.total_deal_value, 0)::text AS total_deal_value,
       GREATEST(c.last_contact_activity, d.last_deal_activity)::text AS last_activity
     FROM accounts a
     LEFT JOIN (
       SELECT account_id,
              COUNT(*)::bigint AS contact_count,
              AVG(COALESCE(engagement_score, 0)) AS avg_engagement,
              MAX(last_activity_date) AS last_contact_activity
       FROM contacts WHERE workspace_id = $1
       GROUP BY account_id
     ) c ON c.account_id = a.id
     LEFT JOIN (
       SELECT account_id,
              COUNT(*)::bigint AS deal_count,
              SUM(COALESCE(amount, 0)) AS total_deal_value,
              MAX(last_activity_date) AS last_deal_activity
       FROM deals WHERE workspace_id = $1
       GROUP BY account_id
     ) d ON d.account_id = a.id
     WHERE a.workspace_id = $1`,
    [workspaceId]
  );

  const metricsMap = new Map(
    accountMetrics.rows.map(r => [r.account_id, {
      contactCount: parseInt(r.contact_count, 10),
      avgEngagement: parseFloat(r.avg_engagement),
      dealCount: parseInt(r.deal_count, 10),
      totalDealValue: parseFloat(r.total_deal_value),
      lastActivity: r.last_activity ? new Date(r.last_activity) : null,
    }])
  );

  const client = await getClient();
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const account of accounts) {
      const metrics = metricsMap.get(account.id);
      const score = computeAccountHealth(account, metrics);

      await client.query(
        `UPDATE accounts SET health_score = $2, updated_at = NOW() WHERE id = $1`,
        [account.id, score]
      );
      updated++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { processed: accounts.length, updated };
}
