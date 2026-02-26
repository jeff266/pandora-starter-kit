import { query, getClient } from '../db.js';
import { getContext } from '../context/index.js';
import { computeDealScores, computeConversationModifier, computeCompositeScore, computeInferredPhase, type DealRow, type CompositeScoreResult, type InferredPhase } from './deal-scores.js';
import { computeContactEngagement, type ContactRow } from './contact-scores.js';
import { computeAccountHealth, type AccountRow } from './account-scores.js';
import { getDealRiskScore, getBatchDealRiskScores } from '../tools/deal-risk-score.js';

/**
 * Check if CRM stage is equivalent to inferred phase
 * @param crmStage - Normalized CRM stage (e.g., 'negotiation', 'qualification')
 * @param inferredPhase - Inferred phase from keywords
 * @returns true if they represent the same buyer journey stage
 */
function stagesMatch(crmStage: string | null, inferredPhase: InferredPhase): boolean {
  if (!crmStage) return false;

  const normalized = crmStage.toLowerCase();

  // Equivalence map: CRM stages that map to inferred phases
  const STAGE_PHASE_MAP: Record<InferredPhase, string[]> = {
    pilot: ['pilot', 'proof of concept', 'trial', 'poc'],
    negotiation: ['negotiation', 'contract review', 'legal review', 'closing', 'proposal accepted'],
    decision: ['decision maker bought in', 'verbal commit', 'pending signature', 'commit'],
    evaluation: ['evaluation', 'demo', 'demo conducted', 'proposal reviewed', 'presentation'],
    discovery: ['discovery', 'qualification', 'qualified', 'new lead', 'prospecting'],
    stalled: ['on hold', 'paused', 'stalled'],
  };

  const equivalentStages = STAGE_PHASE_MAP[inferredPhase] || [];
  return equivalentStages.some(stage => normalized.includes(stage));
}

async function checkDealHasConversations(workspaceId: string, dealId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM conversations
      WHERE (deal_id = $1 OR account_id = (SELECT account_id FROM deals WHERE id = $1 AND workspace_id = $2))
        AND workspace_id = $2
        AND is_internal = FALSE
    ) AS exists`,
    [dealId, workspaceId]
  );
  return result.rows[0]?.exists ?? false;
}

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

  const conversationDeals = await query<{ deal_id: string }>(
    `SELECT DISTINCT d.id AS deal_id
     FROM deals d
     WHERE d.workspace_id = $1
       AND EXISTS (
         SELECT 1 FROM conversations cv
         WHERE (cv.deal_id = d.id OR cv.account_id = d.account_id)
           AND cv.workspace_id = $1
           AND cv.is_internal = FALSE
       )`,
    [workspaceId]
  );
  const dealsWithConversations = new Set(conversationDeals.rows.map(r => r.deal_id));

  const allDealIds = deals.map(d => d.id);
  const batchRiskScores = await getBatchDealRiskScores(workspaceId, allDealIds).catch(() => []);
  const riskScoreMap = new Map(batchRiskScores.map(r => [r.deal_id, r] as const));

  const hasAnySkillRuns = batchRiskScores.length > 0 && batchRiskScores[0].skills_evaluated.length > 0;

  const BATCH_SIZE = 50;
  const client = await getClient();
  let updated = 0;

  try {
    for (let i = 0; i < deals.length; i += BATCH_SIZE) {
      const batch = deals.slice(i, i + BATCH_SIZE);

      await client.query('BEGIN');
      try {
        for (const deal of batch) {
          const activity = activityMap.get(deal.id);
          const existingCloseDateSuspect = (deal as any).close_date_suspect === true;
          const scores = computeDealScores(deal, config, activity, existingCloseDateSuspect);

          const stageAnchor = (deal as any).stage_changed_at
            ? new Date((deal as any).stage_changed_at)
            : new Date(deal.created_at);
          const daysInStage = Math.floor((Date.now() - stageAnchor.getTime()) / (1000 * 60 * 60 * 24));

          const conversationModifierResult = await computeConversationModifier(deal.id, workspaceId);
          const conversationModifier = conversationModifierResult.modifier;
          const closeDateSuspect = conversationModifierResult.close_date_suspect;

          // Fetch conversations for phase inference (90-day window)
          const conversationsForPhase = await query<{ summary: string | null; title: string | null; transcript_text: string | null }>(
            `SELECT summary, title, transcript_text
             FROM conversations
             WHERE (deal_id = $1 OR account_id = (
               SELECT account_id FROM deals WHERE id = $1 AND workspace_id = $2
             ))
             AND workspace_id = $2
             AND call_date >= NOW() - INTERVAL '90 days'
             ORDER BY call_date DESC
             LIMIT 5`,
            [deal.id, workspaceId]
          );

          const conversationSummaries = conversationsForPhase.rows.map(r => {
            const text = r.summary
              ?? (r.transcript_text ? r.transcript_text.substring(0, 2000) : '');
            return (text + ' ' + (r.title ?? '')).trim();
          }).filter(s => s.length > 0);

          // Compute inferred phase
          const phaseResult = computeInferredPhase(conversationSummaries);

          // Compute phase divergence — skip for closed deals
          const dealStageNormalized = (deal as any).stage_normalized;
          const isClosedForPhase = ['closed_won', 'closed_lost', 'closedwon', 'closedlost'].includes(
            (dealStageNormalized || '').toLowerCase().replace(/\s+/g, '')
          );
          const phaseDivergence = phaseResult !== null &&
            phaseResult.confidence >= 0.6 &&
            !isClosedForPhase &&
            !stagesMatch(dealStageNormalized, phaseResult.phase);

          const baseHealthScore = 100 - scores.dealRisk;
          const healthScore = Math.min(100, Math.max(0, Math.round((baseHealthScore + conversationModifier) * 100) / 100));

          const riskResult = riskScoreMap.get(deal.id);
          let skillScore: number | null = null;
          if (riskResult) {
            if (riskResult.signals.length > 0 || hasAnySkillRuns) {
              skillScore = riskResult.score;
            }
          }

          const conversationScore = conversationModifier !== 0
            ? Math.max(0, Math.min(100, 50 + conversationModifier * 2.5))
            : null;

          const hasConversations = conversationModifierResult.signals.length > 0
            || dealsWithConversations.has(deal.id);

          const productionComposite = computeCompositeScore(
            healthScore,
            skillScore,
            conversationScore,
            prodWeights,
            hasConversations
          );

          let experimentalScore: number | null = null;
          if (expWeights) {
            const experimentalComposite = computeCompositeScore(
              healthScore,
              skillScore,
              conversationScore,
              expWeights,
              hasConversations
            );
            experimentalScore = experimentalComposite.score;
          }

          const isClosed = ['closed_won', 'closed_lost', 'closedwon', 'closedlost'].includes(
            (deal.stage_normalized || deal.stage || '').toLowerCase().replace(/\s+/g, '')
          );

          if (isClosed) {
            const outcome = (deal.stage_normalized || deal.stage || '').toLowerCase().includes('won') ? 'won' : 'lost';
            const daysOpen = Math.floor((Date.now() - new Date(deal.created_at).getTime()) / (1000 * 60 * 60 * 24));

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

          await client.query(
            `UPDATE deals
             SET velocity_score = $2,
                 deal_risk = $3,
                 deal_risk_factors = $4,
                 health_score = $5,
                 days_in_stage = $6,
                 conversation_modifier = $7,
                 close_date_suspect = $8,
                 experimental_score = $9,
                 composite_score = $10,
                 inferred_phase = $11,
                 phase_confidence = $12,
                 phase_signals = $13,
                 phase_inferred_at = NOW(),
                 phase_divergence = $14,
                 updated_at = NOW()
             WHERE id = $1 AND workspace_id = $15`,
            [
              deal.id,
              scores.velocityScore,
              scores.dealRisk,
              JSON.stringify(scores.riskFactors),
              healthScore,
              daysInStage,
              conversationModifier,
              closeDateSuspect,
              experimentalScore,
              productionComposite.score,
              isClosedForPhase ? null : (phaseResult?.phase ?? null),
              isClosedForPhase ? null : (phaseResult?.confidence ?? null),
              isClosedForPhase ? null : (phaseResult ? JSON.stringify(phaseResult.signals) : null),
              phaseDivergence,
              workspaceId,
            ]
          );
          updated++;
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      await new Promise(resolve => setImmediate(resolve));
    }
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

/**
 * Compute fields for a single deal (used for real-time updates, e.g., after conversation link)
 */
export async function computeFieldsForDeal(workspaceId: string, dealId: string): Promise<void> {
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
    : { crm: 0.40, findings: 0.35, conversations: 0.25 };

  const expWeights = experimentalWeights
    ? {
        crm: parseFloat(experimentalWeights.crm_weight),
        findings: parseFloat(experimentalWeights.findings_weight),
        conversations: parseFloat(experimentalWeights.conversations_weight),
      }
    : null;

  // Query the specific deal
  const dealResult = await query<DealRow & { stage_normalized?: string; name?: string }>(
    `SELECT id, amount, stage, stage_normalized, name, close_date, probability, days_in_stage,
            last_activity_date, created_at, pipeline, stage_changed_at, close_date_suspect
     FROM deals
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, dealId]
  );

  if (dealResult.rows.length === 0) return;
  const deal = dealResult.rows[0];

  // Get activity count for this deal
  const activityResult = await query<{ activity_count: string; last_activity: string | null }>(
    `SELECT COUNT(*)::text AS activity_count, MAX(timestamp)::text AS last_activity
     FROM activities
     WHERE workspace_id = $1 AND deal_id = $2`,
    [workspaceId, dealId]
  );

  const activity = activityResult.rows[0]
    ? {
        count: parseInt(activityResult.rows[0].activity_count, 10),
        lastActivity: activityResult.rows[0].last_activity ? new Date(activityResult.rows[0].last_activity) : null,
      }
    : undefined;

  const existingCloseDateSuspect = (deal as any).close_date_suspect === true;
  const scores = computeDealScores(deal, config, activity, existingCloseDateSuspect);

  const stageAnchor = (deal as any).stage_changed_at
    ? new Date((deal as any).stage_changed_at)
    : new Date(deal.created_at);
  const daysInStage = Math.floor((Date.now() - stageAnchor.getTime()) / (1000 * 60 * 60 * 24));

  const conversationModifierResult = await computeConversationModifier(deal.id, workspaceId);
  const conversationModifier = conversationModifierResult.modifier;
  const closeDateSuspect = conversationModifierResult.close_date_suspect;

  // Fetch conversations for phase inference (90-day window)
  const conversationsForPhase = await query<{ summary: string | null; title: string | null; transcript_text: string | null }>(
    `SELECT summary, title, transcript_text
     FROM conversations
     WHERE (deal_id = $1 OR account_id = (
       SELECT account_id FROM deals WHERE id = $1 AND workspace_id = $2
     ))
     AND workspace_id = $2
     AND call_date >= NOW() - INTERVAL '90 days'
     ORDER BY call_date DESC
     LIMIT 5`,
    [deal.id, workspaceId]
  );

  const conversationSummaries = conversationsForPhase.rows.map(r => {
    const text = r.summary
      ?? (r.transcript_text ? r.transcript_text.substring(0, 2000) : '');
    return (text + ' ' + (r.title ?? '')).trim();
  }).filter(s => s.length > 0);

  // Compute inferred phase
  const phaseResult = computeInferredPhase(conversationSummaries);

  // Compute phase divergence — skip for closed deals
  const dealStageNormalized = (deal as any).stage_normalized;
  const isClosedForPhase = ['closed_won', 'closed_lost', 'closedwon', 'closedlost'].includes(
    (dealStageNormalized || '').toLowerCase().replace(/\s+/g, '')
  );
  const phaseDivergence = phaseResult !== null &&
    phaseResult.confidence >= 0.6 &&
    !isClosedForPhase &&
    !stagesMatch(dealStageNormalized, phaseResult.phase);

  const baseHealthScore = 100 - scores.dealRisk;
  const healthScore = Math.min(100, Math.max(0, Math.round((baseHealthScore + conversationModifier) * 100) / 100));

  let skillScore: number | null = null;
  try {
    const riskResult = await getDealRiskScore(workspaceId, deal.id);
    skillScore = riskResult?.score ?? null;
  } catch {
    skillScore = null;
  }

  const conversationScore = conversationModifier !== 0
    ? Math.max(0, Math.min(100, 50 + conversationModifier * 2.5))
    : null;

  const hasConversations = conversationModifierResult.signals.length > 0
    || await checkDealHasConversations(workspaceId, deal.id);

  const productionComposite = computeCompositeScore(
    healthScore,
    skillScore,
    conversationScore,
    prodWeights,
    hasConversations
  );

  let experimentalScore: number | null = null;
  if (expWeights) {
    const experimentalComposite = computeCompositeScore(
      healthScore,
      skillScore,
      conversationScore,
      expWeights,
      hasConversations
    );
    experimentalScore = experimentalComposite.score;
  }

  const isClosed = ['closed_won', 'closed_lost', 'closedwon', 'closedlost'].includes(
    (deal.stage_normalized || deal.stage || '').toLowerCase().replace(/\s+/g, '')
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (isClosed) {
      const outcome = (deal.stage_normalized || deal.stage || '').toLowerCase().includes('won') ? 'won' : 'lost';
      const daysOpen = Math.floor((Date.now() - new Date(deal.created_at).getTime()) / (1000 * 60 * 60 * 24));

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

    await client.query(
      `UPDATE deals
       SET velocity_score = $2,
           deal_risk = $3,
           deal_risk_factors = $4,
           health_score = $5,
           days_in_stage = $6,
           conversation_modifier = $7,
           close_date_suspect = $8,
           experimental_score = $9,
           composite_score = $10,
           inferred_phase = $11,
           phase_confidence = $12,
           phase_signals = $13,
           phase_inferred_at = NOW(),
           phase_divergence = $14,
           updated_at = NOW()
       WHERE id = $1 AND workspace_id = $15`,
      [
        deal.id,
        scores.velocityScore,
        scores.dealRisk,
        JSON.stringify(scores.riskFactors),
        healthScore,
        daysInStage,
        conversationModifier,
        closeDateSuspect,
        experimentalScore,
        productionComposite.score,
        isClosedForPhase ? null : (phaseResult?.phase ?? null),
        isClosedForPhase ? null : (phaseResult?.confidence ?? null),
        isClosedForPhase ? null : (phaseResult ? JSON.stringify(phaseResult.signals) : null),
        phaseDivergence,
        workspaceId,
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
