import { query, getClient } from '../db.js';
import { getContext } from '../context/index.js';
import { computeDealScores, computeConversationModifier, computeCompositeScore, type DealRow, type CompositeScoreResult } from './deal-scores.js';
import { computeContactEngagement, type ContactRow } from './contact-scores.js';
import { computeAccountHealth, type AccountRow } from './account-scores.js';
import { getDealRiskScore } from '../tools/deal-risk-score.js';

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
  // Fetch workspace score weights
  const weightsResult = await query<{
    weight_type: string;
    crm_weight: string;
    findings_weight: string;
    conversations_weight: string;
    active: boolean;
  }>(
    `SELECT weight_type, crm_weight, findings_weight, conversations_weight, active
     FROM workspace_score_weights
     WHERE workspace_id = $1 AND active = true`,
    [workspaceId]
  );

  const productionWeights = weightsResult.rows.find(r => r.weight_type === 'production');
  const experimentalWeights = weightsResult.rows.find(r => r.weight_type === 'experimental');

  const prodWeights = productionWeights
    ? {
        crm: parseFloat(productionWeights.crm_weight),
        findings: parseFloat(productionWeights.findings_weight),
        conversations: parseFloat(productionWeights.conversations_weight),
      }
    : { crm: 0.40, findings: 0.35, conversations: 0.25 }; // fallback defaults

  const expWeights = experimentalWeights
    ? {
        crm: parseFloat(experimentalWeights.crm_weight),
        findings: parseFloat(experimentalWeights.findings_weight),
        conversations: parseFloat(experimentalWeights.conversations_weight),
      }
    : null;

  // Query all deals (open and recently closed for outcome logging)
  const result = await query<DealRow & { stage_normalized?: string; name?: string }>(
    `SELECT id, amount, stage, stage_normalized, name, close_date, probability, days_in_stage,
            last_activity_date, created_at, pipeline, stage_changed_at
     FROM deals
     WHERE workspace_id = $1`,
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

      // Calculate days_in_stage: time since stage_changed_at (or created_at if never changed)
      const stageAnchor = (deal as any).stage_changed_at
        ? new Date((deal as any).stage_changed_at)
        : new Date(deal.created_at);
      const daysInStage = Math.floor((Date.now() - stageAnchor.getTime()) / (1000 * 60 * 60 * 24));

      // Get conversation sentiment modifier
      const conversationModifier = await computeConversationModifier(deal.id, workspaceId);
      const baseHealthScore = 100 - scores.dealRisk;
      const healthScore = Math.min(100, Math.max(0, Math.round((baseHealthScore + conversationModifier) * 100) / 100));

      // Get skill score from findings
      let skillScore: number | null = null;
      try {
        const riskResult = await getDealRiskScore(workspaceId, deal.id);
        skillScore = riskResult.score;
      } catch {
        // No findings yet, skill score remains null
      }

      // Normalize conversation modifier to 0-100 scale
      const conversationScore = conversationModifier !== 0
        ? Math.max(0, Math.min(100, 50 + conversationModifier * 2.5))
        : null;

      // Compute production composite score
      const productionComposite = computeCompositeScore(
        healthScore,
        skillScore,
        conversationScore,
        prodWeights
      );

      // Compute experimental score if workspace has active experimental weights
      let experimentalScore: number | null = null;
      if (expWeights) {
        const experimentalComposite = computeCompositeScore(
          healthScore,
          skillScore,
          conversationScore,
          expWeights
        );
        experimentalScore = experimentalComposite.score;
      }

      // Check if deal is closed - if so, log outcome
      const isClosed = ['closed_won', 'closed_lost', 'closedwon', 'closedlost'].includes(
        (deal.stage_normalized || deal.stage || '').toLowerCase().replace(/\s+/g, '')
      );

      if (isClosed) {
        const outcome = (deal.stage_normalized || deal.stage || '').toLowerCase().includes('won') ? 'won' : 'lost';
        const daysOpen = Math.floor((Date.now() - new Date(deal.created_at).getTime()) / (1000 * 60 * 60 * 24));

        // Insert outcome record (ignore if already exists)
        await client.query(
          `INSERT INTO deal_outcomes (
            workspace_id, deal_id, deal_name, outcome,
            crm_score, skill_score, conversation_score, composite_score,
            amount, days_open, stage_duration_days, closed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (workspace_id, deal_id) DO NOTHING`,
          [
            workspaceId,
            deal.id,
            deal.name || 'Untitled',
            outcome,
            healthScore,
            skillScore,
            conversationScore,
            productionComposite.score,
            deal.amount ? parseFloat(deal.amount) : null,
            daysOpen,
            daysInStage,
          ]
        );
      }

      // Update deal with scores
      await client.query(
        `UPDATE deals
         SET velocity_score = $2,
             deal_risk = $3,
             deal_risk_factors = $4,
             health_score = $5,
             days_in_stage = $6,
             conversation_modifier = $7,
             experimental_score = $8,
             updated_at = NOW()
         WHERE id = $1 AND workspace_id = $9`,
        [
          deal.id,
          scores.velocityScore,
          scores.dealRisk,
          JSON.stringify(scores.riskFactors),
          healthScore,
          daysInStage,
          conversationModifier,
          experimentalScore,
          workspaceId,
        ]
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
        `UPDATE contacts SET engagement_score = $2, updated_at = NOW() WHERE id = $1 AND workspace_id = $3`,
        [contact.id, score, workspaceId]
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
        `UPDATE accounts SET health_score = $2, updated_at = NOW() WHERE id = $1 AND workspace_id = $3`,
        [account.id, score, workspaceId]
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
