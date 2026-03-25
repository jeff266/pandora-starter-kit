import { Router, Request, Response } from 'express';
import { getSkillRegistry } from '../skills/registry.js';
import { query } from '../db.js';

const router = Router();

export interface ToolManifestEntry {
  id: string;
  name: string;
  category: 'query' | 'analysis' | 'metric';
  description: string;
  sql: string; // the underlying SQL (read-only, for display)
  source: 'query_tool' | 'skill_compute';
  sourceSkillId?: string; // if from a skill, which one
  status: 'live' | 'disabled';
  schedule?: string; // cron expression if scheduled
  lastRunAt?: string; // from skill_runs table
  lastRunRows?: number;
  lastRunMs?: number;
  answers_questions?: string[];
  examples?: Array<{ query: string; params?: Record<string, any> }>;
}

/**
 * Get the tool manifest for a workspace.
 * This includes:
 * 1. Query layer tools (deals, accounts, contacts, etc.) with representative SQL
 * 2. Skill compute phases with their underlying SQL
 */
export async function getToolManifest(workspaceId: string): Promise<ToolManifestEntry[]> {
  const tools: ToolManifestEntry[] = [];

  // Part 1: Add query layer tools with representative SQL
  tools.push(...getQueryLayerTools());

  // Part 2: Add skill compute tools
  const skillTools = await getSkillComputeTools(workspaceId);
  tools.push(...skillTools);

  return tools;
}

/**
 * Get representative SQL for built-in query layer tools.
 * These are static representations showing what the tool does.
 */
function getQueryLayerTools(): ToolManifestEntry[] {
  return [
    {
      id: 'query_deals',
      name: 'Query Deals',
      category: 'query',
      description: 'Search and filter deals by stage, owner, amount, close date, and custom fields',
      sql: `SELECT
  d.id,
  d.name,
  d.amount,
  d.stage_normalized,
  d.close_date,
  d.owner,
  d.health_score,
  d.days_in_stage,
  a.name AS account_name
FROM deals d
LEFT JOIN accounts a ON d.account_id = a.id
WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')
ORDER BY d.close_date ASC
LIMIT 100`,
      source: 'query_tool',
      status: 'live',
    },
    {
      id: 'query_accounts',
      name: 'Query Accounts',
      category: 'query',
      description: 'Fetch account records with contacts, deals, and engagement history',
      sql: `SELECT
  a.id,
  a.name,
  a.domain,
  a.industry,
  a.employee_count,
  COUNT(DISTINCT d.id) AS open_deals_count,
  COUNT(DISTINCT c.id) AS contacts_count
FROM accounts a
LEFT JOIN deals d ON d.account_id = a.id
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
LEFT JOIN contacts c ON c.account_id = a.id
GROUP BY a.id
ORDER BY open_deals_count DESC
LIMIT 100`,
      source: 'query_tool',
      status: 'live',
    },
    {
      id: 'query_contacts',
      name: 'Query Contacts',
      category: 'query',
      description: 'Search contacts by name, email, role, and account association',
      sql: `SELECT
  c.id,
  c.email,
  c.first_name,
  c.last_name,
  c.title,
  c.seniority,
  a.name AS account_name
FROM contacts c
LEFT JOIN accounts a ON c.account_id = a.id
ORDER BY c.last_name ASC
LIMIT 100`,
      source: 'query_tool',
      status: 'live',
    },
    {
      id: 'query_conversations',
      name: 'Query Conversations',
      category: 'query',
      description: 'Search call recordings and meeting transcripts',
      sql: `SELECT
  c.id,
  c.title,
  c.call_date,
  c.duration_seconds,
  c.sentiment_score,
  a.name AS account_name,
  d.name AS deal_name
FROM conversations c
LEFT JOIN accounts a ON c.account_id = a.id
LEFT JOIN deals d ON c.deal_id = d.id
WHERE c.is_internal = FALSE
  AND c.call_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY c.call_date DESC
LIMIT 100`,
      source: 'query_tool',
      status: 'live',
    },
    {
      id: 'query_stage_history',
      name: 'Stage History',
      category: 'query',
      description: 'Track how deals moved through pipeline stages',
      sql: `SELECT
  dsh.id,
  dsh.deal_id,
  dsh.from_stage_normalized,
  dsh.to_stage_normalized,
  dsh.changed_at,
  d.name AS deal_name
FROM deal_stage_history dsh
JOIN deals d ON dsh.deal_id = d.id
WHERE dsh.changed_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY dsh.changed_at DESC
LIMIT 100`,
      source: 'query_tool',
      status: 'live',
    },
    {
      id: 'survival-curve-query',
      name: 'Win Rate Curve Analysis',
      category: 'analysis',
      description: 'Query historical win rate curves segmented by source, rep, deal size, or stage. Returns time-to-won survival curves showing how win probability changes over deal age. Use for questions about conversion rates, pipeline quality, and planning.',
      sql: `-- Kaplan-Meier survival curve: cumulative win probability over deal age
-- Segmented by: source | owner | size_band | stage_reached | pipeline | none
SELECT
  d.id AS deal_id,
  EXTRACT(EPOCH FROM (COALESCE(do2.closed_at, NOW()) - d.created_at)) / 86400 AS days_open,
  (d.stage_normalized = 'closed_won') AS is_won,
  d.amount,
  COALESCE(d.lead_source, d.source_data->>'original_source') AS lead_source,
  d.owner,
  d.pipeline
FROM deals d
LEFT JOIN deal_outcomes do2 ON do2.deal_id = d.id
WHERE d.workspace_id = $1
  AND d.created_at > NOW() - INTERVAL '24 months'
  AND d.amount IS NOT NULL AND d.amount > 0
ORDER BY days_open ASC`,
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'win rate', 'conversion rate', 'pipeline quality', 'how long does it take to close',
        'probability of winning', 'deal velocity', 'inbound vs outbound', 'win rate by source',
        'win rate by rep', 'what percentage of pipeline will close', 'survival curve',
      ],
      examples: [
        { query: 'What is our win rate by source?', params: { groupBy: 'source' } },
        { query: 'How does outbound pipeline convert compared to inbound?', params: { groupBy: 'source' } },
        { query: 'Which rep has the best conversion rate?', params: { groupBy: 'owner' } },
        { query: 'What percentage of Q2 pipeline will close this quarter?', params: { groupBy: 'none' } },
        { query: 'Do enterprise deals convert differently than mid-market?', params: { groupBy: 'size_band' } },
        { query: 'How long does it take deals to close?', params: { groupBy: 'none' } },
      ],
    },

    // ── Extended Ask Pandora tools ────────────────────────────────────────

    {
      id: 'query_prior_deals',
      name: 'Prior Deals (Account History)',
      category: 'query',
      description: 'Find closed deals (won or lost) for a given account. Used for second-attempt detection, Bull/Bear evidence, and "have we worked with this account before?" queries.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'prior deal', 'account history', 'worked with before', 'previous attempt',
        'second attempt', 'closed won', 'closed lost', 'past deal',
      ],
      examples: [
        { query: 'Have we worked with ABS Kids before?' },
        { query: 'Did we close a deal with Bright Health previously?' },
        { query: 'What was the outcome of our last attempt with this account?' },
      ],
      sql: `-- Prior closed deals for an account (fuzzy name match)
-- Used by deliberation engine for second-attempt context
SELECT
  d.id,
  d.name,
  d.amount,
  d.stage_normalized       AS outcome,
  d.close_date,
  COALESCE(d.owner_name, d.owner_email) AS owner_name,
  COALESCE(
    d.source_data->'properties'->>'closed_lost_reason',
    d.custom_fields->>'close_reason'
  ) AS loss_reason
FROM deals d
WHERE d.workspace_id = $1
  AND (d.name ILIKE '%:account_name%' OR d.account_name ILIKE '%:account_name%')
  AND d.stage_normalized IN ('closed_won', 'closed_lost')
  AND d.close_date > NOW() - INTERVAL '24 months'
  AND d.close_date IS NOT NULL
ORDER BY d.close_date DESC
LIMIT 10`,
    },

    {
      id: 'query_rep_performance',
      name: 'Rep Performance',
      category: 'analysis',
      description: 'Close rate, pipeline pace, avg cycle length, and deal size for a specific rep over a rolling window. Used for Bull/Bear Defense evidence and coaching context.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'rep performance', 'close rate', 'win rate by rep', 'how is doing',
        'pipeline pace', 'quota attainment', 'rep metrics', 'rep scorecard',
        'nate', 'sarah', 'who is behind',
      ],
      examples: [
        { query: 'How is Nate performing this quarter?' },
        { query: "What's the close rate for this rep?" },
        { query: 'How much pipeline has Sara created in the last 90 days?' },
      ],
      sql: `-- Rep performance: close rate, cycle length, pipeline pace
-- Rolling 12-month window, segmented by closed outcome
SELECT
  COALESCE(d.owner_name, d.owner_email)            AS rep_name,
  d.owner_email,
  COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')  AS deals_won,
  COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_lost') AS deals_lost,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')
    / NULLIF(COUNT(*), 0), 1
  )                                                 AS close_rate_pct,
  ROUND(AVG(
    EXTRACT(EPOCH FROM d.close_date - d.created_at) / 86400
  ) FILTER (WHERE d.stage_normalized = 'closed_won'), 0)     AS avg_cycle_days,
  ROUND(AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won'), 0) AS avg_deal_size
FROM deals d
WHERE d.workspace_id = $1
  AND LOWER(d.owner_email) = LOWER(:owner_email)
  AND d.stage_normalized IN ('closed_won', 'closed_lost')
  AND d.close_date > NOW() - INTERVAL '12 months'
  AND d.close_date IS NOT NULL
GROUP BY d.owner_name, d.owner_email`,
    },

    {
      id: 'query_deal_velocity',
      name: 'Deal Velocity',
      category: 'analysis',
      description: 'Time in each stage vs. workspace median — fast, normal, slow, or stalled. Uses stage history and median from completed deals in last 18 months.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'deal velocity', 'stalled', 'stage time', 'how long in stage',
        'moving at normal pace', 'slow deal', 'stuck', 'typical pace',
      ],
      examples: [
        { query: 'Is this deal stalled or moving at a normal pace?' },
        { query: 'How long has this deal been in Proposal?' },
        { query: 'Compare this deal to typical stage times' },
      ],
      sql: `-- Deal velocity: time in stage vs. workspace median
-- Medians computed from completed deals (closed won/lost) in last 18 months
WITH stage_medians AS (
  SELECT
    dsh.stage_name,
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM dsh.exited_at - dsh.entered_at) / 86400
    ) AS median_days
  FROM deal_stage_history dsh
  JOIN deals d ON d.id = dsh.deal_id
  WHERE d.workspace_id = $1
    AND dsh.exited_at IS NOT NULL
    AND d.stage_normalized IN ('closed_won', 'closed_lost')
    AND d.close_date > NOW() - INTERVAL '18 months'
  GROUP BY dsh.stage_name
  HAVING COUNT(*) >= 5
)
SELECT
  dsh.stage_name,
  ROUND(EXTRACT(EPOCH FROM COALESCE(dsh.exited_at, NOW()) - dsh.entered_at) / 86400) AS days_in_stage,
  ROUND(sm.median_days::numeric, 0)                 AS median_days,
  ROUND(
    EXTRACT(EPOCH FROM COALESCE(dsh.exited_at, NOW()) - dsh.entered_at) / 86400
    / NULLIF(sm.median_days, 0) * 100
  )                                                  AS pct_of_median
FROM deal_stage_history dsh
LEFT JOIN stage_medians sm ON sm.stage_name = dsh.stage_name
WHERE dsh.workspace_id = $1
  AND dsh.deal_id = :deal_id
ORDER BY dsh.entered_at ASC`,
    },

    {
      id: 'query_icp_fit',
      name: 'ICP Fit Score',
      category: 'analysis',
      description: 'How well a deal matches the workspace ICP profile. Pulls from lead-scoring skill if run; gracefully degrades to deal-size-vs-median comparison.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'icp', 'ideal customer', 'icp fit', 'good fit', 'target customer',
        'deal quality', 'does this account fit', 'our kind of deal',
      ],
      examples: [
        { query: 'Is this account a good fit for us?' },
        { query: 'Does this deal match our ICP?' },
        { query: 'How does this deal compare to our typical wins?' },
      ],
      sql: `-- ICP fit: from lead-scoring skill run result_data
-- Gracefully degrades to deal-size-vs-workspace-median if skill not run
SELECT
  sr.skill_id,
  sr.started_at,
  score_entry->>'deal_id'          AS deal_id,
  score_entry->>'icp_fit_score'    AS icp_fit_score,
  score_entry->>'icp_tier'         AS icp_tier
FROM skill_runs sr,
  LATERAL jsonb_array_elements(sr.result_data->'scores') AS score_entry
WHERE sr.workspace_id = $1
  AND sr.skill_id = 'lead-scoring'
  AND sr.status = 'completed'
  AND score_entry->>'deal_id' = :deal_id
ORDER BY sr.started_at DESC
LIMIT 1`,
    },

    {
      id: 'query_competitor_signals',
      name: 'Competitor Signals',
      category: 'analysis',
      description: 'Competitor mentions from call recordings and conversation signals. Returns mention context, sentiment, and recency — scoped to a deal or workspace-wide.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'competitor', 'competition', 'competitive', 'in the mix', 'evaluating',
        'head to head', 'against us', 'displacement', 'replacing', 'competitor mentions',
      ],
      examples: [
        { query: 'Are any competitors mentioned in recent calls?' },
        { query: 'Is CentralReach in the mix on this deal?' },
        { query: 'What competitive dynamics are we seeing this quarter?' },
      ],
      sql: `-- Competitor signals from conversation_signals
-- signal_type = 'competitor_mention', context capped at 150 chars
SELECT
  cs.signal_value             AS competitor,
  cs.signal_text              AS context,
  cs.created_at               AS mention_date,
  d.name                      AS deal_name,
  cs.deal_id
FROM conversation_signals cs
LEFT JOIN deals d ON d.id = cs.deal_id AND d.workspace_id = cs.workspace_id
WHERE cs.workspace_id = $1
  AND cs.signal_type = 'competitor_mention'
  AND cs.created_at > NOW() - INTERVAL '180 days'
ORDER BY cs.created_at DESC
LIMIT 50`,
    },

    {
      id: 'search_deals',
      name: 'Search Deals (Fuzzy)',
      category: 'query',
      description: 'Fuzzy name search across deal and account names. The navigation tool — resolves partial names ("the autism deal", "Butterfly") to deal IDs before running analysis.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'search deal', 'find deal', 'which deal', 'what deal', 'deal name',
        'deal lookup', 'find account', 'which account',
      ],
      examples: [
        { query: 'Find the ABS Kids deal' },
        { query: "What's the status of the autism services deal?" },
        { query: 'Show me the Butterfly account deal' },
      ],
      sql: `-- Fuzzy deal search by name or account name
-- Orders by name match quality then deal amount descending
SELECT
  d.id,
  d.name,
  d.amount,
  d.stage,
  COALESCE(d.owner_name, d.owner_email) AS owner_name,
  d.close_date,
  EXTRACT(EPOCH FROM NOW() - d.last_activity_at)::int / 86400 AS days_since_activity
FROM deals d
WHERE d.workspace_id = $1
  AND (d.name ILIKE '%:query%' OR d.account_name ILIKE '%:query%')
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
ORDER BY
  CASE WHEN LOWER(d.name) = LOWER(:query) THEN 0
       WHEN LOWER(d.name) LIKE LOWER(:query) THEN 1
       ELSE 2 END,
  d.amount DESC NULLS LAST
LIMIT 5`,
    },

    {
      id: 'query_calendar_context',
      name: 'Calendar Context',
      category: 'query',
      description: 'Calendar events linked to a deal\'s contacts — upcoming and recent meetings. Reveals next touchpoint, meeting cadence, and contacts with no scheduled time.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'calendar', 'meeting', 'scheduled', 'next call', 'upcoming', 'touchpoint',
        'when is the next meeting', 'do we have anything scheduled',
      ],
      examples: [
        { query: 'Do we have anything scheduled with this account?' },
        { query: 'When is the next touchpoint for this deal?' },
        { query: 'Which contacts have we not met with?' },
      ],
      sql: `-- Calendar events linked to deal contacts
-- Resolved via deal_contacts → contact email → calendar_events.attendees
SELECT
  ce.id,
  ce.title,
  ce.start_time,
  ce.end_time,
  EXTRACT(EPOCH FROM ce.end_time - ce.start_time)::int / 60 AS duration_minutes,
  ce.attendees,
  ce.status,
  CASE WHEN ce.start_time > NOW() THEN 'upcoming' ELSE 'past' END AS timing
FROM calendar_events ce
WHERE ce.workspace_id = $1
  AND $2::uuid = ANY(ce.resolved_deal_ids)
  AND ce.start_time >= NOW() - INTERVAL '30 days'
  AND ce.start_time <= NOW() + INTERVAL '60 days'
  AND ce.status != 'cancelled'
ORDER BY ce.start_time ASC
LIMIT 20`,
    },

    {
      id: 'query_hypothesis_history',
      name: 'Hypothesis History',
      category: 'analysis',
      description: 'Trend data for standing hypothesis metrics over time. Shows whether a metric is improving, declining, stable, or volatile — not just the current value.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'hypothesis', 'threshold', 'metric trend', 'improving', 'declining',
        'has been getting better', 'conversion rate trend', 'coverage trend',
        'standing hypothesis', 'breach streak',
      ],
      examples: [
        { query: 'Is our conversion rate trending toward or away from threshold?' },
        { query: 'Has pipeline coverage been improving over the last 12 weeks?' },
        { query: 'Which failure mode has been getting worse?' },
      ],
      sql: `-- Hypothesis weekly values and breach tracking
-- weekly_values is a JSONB array of { week_of, value } objects
SELECT
  h.metric,
  h.hypothesis,
  h.current_value,
  h.alert_threshold,
  h.alert_direction,
  CASE
    WHEN h.alert_direction = 'below' AND h.current_value < h.alert_threshold THEN TRUE
    WHEN h.alert_direction = 'above' AND h.current_value > h.alert_threshold THEN TRUE
    ELSE FALSE
  END AS is_breached,
  h.weekly_values,
  h.status,
  h.updated_at
FROM standing_hypotheses h
WHERE h.workspace_id = $1
  AND h.status = 'active'
  AND LOWER(h.metric) = LOWER(:metric)
ORDER BY h.created_at DESC
LIMIT 1`,
    },

    {
      id: 'get_pandora_capabilities',
      name: 'Pandora Capabilities',
      category: 'query',
      description: 'Returns what Pandora can do, what skills are registered, what data is connected, and example queries. The self-documentation and navigation tool.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'what can you do', 'capabilities', 'what skills', 'help', 'how do i use pandora',
        'getting started', 'available tools', 'what data', 'new here',
      ],
      examples: [
        { query: "What can you do?" },
        { query: "What skills are available?" },
        { query: "What data do you have access to?" },
        { query: "I'm new here, where do I start?" },
      ],
      sql: `-- Pandora capabilities: skill registry + connection status + recent insights
SELECT
  sr.skill_id,
  sr.status,
  MAX(sr.started_at)   AS last_run_at,
  COUNT(*)             AS total_runs
FROM skill_runs sr
WHERE sr.workspace_id = $1
  AND sr.status = 'completed'
GROUP BY sr.skill_id
ORDER BY MAX(sr.started_at) DESC`,
    },

    {
      id: 'query_quota_config',
      name: 'Quota Config Check',
      category: 'query',
      description: 'Check whether quota has been configured for this workspace. Returns quota_configured (boolean), the most recent active period target and dates, and active target count. Used as a readiness gate before computing attainment numbers.',
      source: 'query_tool',
      status: 'live',
      answers_questions: [
        'quota configured', 'has quota been set up', 'is there a quota', 'attainment',
        'quota readiness', 'targets configured',
      ],
      examples: [
        { query: "What's our attainment this quarter?" },
        { query: "How are we doing against quota?" },
        { query: "Has quota been uploaded?" },
      ],
      sql: `-- Quota config check: targets + quota_periods + rep_quotas
SELECT
  t.target_amount,
  t.period_start,
  t.period_end,
  t.label,
  t.is_active
FROM targets t
WHERE t.workspace_id = $1
  AND t.is_active = true
ORDER BY t.period_start DESC
LIMIT 1`,
    },
  ];
}

/**
 * Get skill-based tools by extracting compute phase SQL from registered skills.
 */
async function getSkillComputeTools(workspaceId: string): Promise<ToolManifestEntry[]> {
  const tools: ToolManifestEntry[] = [];
  const skillRegistry = getSkillRegistry();
  const skills = skillRegistry.getAll();

  for (const skill of skills) {
    // Look for compute-tier steps that contain SQL
    const computeSteps = skill.steps.filter((step) => step.tier === 'compute' && step.computeFn);

    for (const step of computeSteps) {
      // For MVP, we'll create a placeholder entry for compute functions
      // In a full implementation, we'd need to look up the actual SQL from the compute function
      // For now, we'll skip skills without explicit SQL in their definitions

      // Check if this is a well-known compute function we can represent
      const sqlRepresentation = getComputeFunctionSQL(step.computeFn!, skill.id!);
      if (!sqlRepresentation) continue;

      // Get last run data from skill_runs table
      const lastRun = await getSkillLastRun(workspaceId, skill.id);

      tools.push({
        id: `${skill.id}:${step.id}`,
        name: `${skill.name} - ${step.name}`,
        category: skill.category === 'pipeline' ? 'metric' : 'analysis',
        description: skill.description,
        sql: sqlRepresentation,
        source: 'skill_compute',
        sourceSkillId: skill.id,
        status: 'live',
        schedule: skill.schedule?.cron,
        lastRunAt: lastRun?.started_at,
        lastRunRows: undefined, // Not tracked at step level
        lastRunMs: lastRun?.duration_ms,
      });
    }
  }

  return tools;
}

/**
 * Get representative SQL for known compute functions.
 * For MVP, we return static SQL representations.
 * In production, this would dynamically generate SQL from workspace config.
 */
function getComputeFunctionSQL(computeFn: string, skillId: string): string | null {
  const sqlMap: Record<string, string> = {
    coverageByRep: `-- Pipeline Coverage by Rep
SELECT
  d.owner,
  SUM(d.amount) AS total_pipeline,
  COUNT(*) AS deal_count,
  q.quota_amount,
  ROUND(SUM(d.amount) / NULLIF(q.quota_amount, 0), 2) AS coverage_ratio
FROM deals d
LEFT JOIN quotas q ON q.owner = d.owner
  AND q.period = 'Q1 2026'
WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  AND d.close_date >= '2026-01-01'
  AND d.close_date < '2026-04-01'
GROUP BY d.owner, q.quota_amount
ORDER BY coverage_ratio ASC`,

    checkStaleDeals: `-- Stale Deal Detection
SELECT
  d.id,
  d.name,
  d.amount,
  d.stage_normalized,
  d.owner,
  d.days_in_stage,
  d.days_since_activity,
  a.name AS account_name
FROM deals d
LEFT JOIN accounts a ON d.account_id = a.id
WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  AND (d.days_in_stage > 30 OR d.days_since_activity > 14)
  AND d.amount > 10000
ORDER BY d.days_in_stage DESC, d.amount DESC
LIMIT 50`,

    checkPipelineHygiene: `-- Pipeline Hygiene Issues
SELECT
  d.id,
  d.name,
  d.amount,
  d.stage_normalized,
  d.close_date,
  d.owner,
  CASE
    WHEN d.close_date < CURRENT_DATE THEN 'past_due'
    WHEN d.amount IS NULL OR d.amount = 0 THEN 'missing_amount'
    WHEN d.close_date IS NULL THEN 'missing_close_date'
    WHEN d.probability = 0 THEN 'zero_probability'
    ELSE 'unknown'
  END AS issue_type
FROM deals d
WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  AND (
    d.close_date < CURRENT_DATE
    OR d.amount IS NULL
    OR d.amount = 0
    OR d.close_date IS NULL
  )
ORDER BY d.amount DESC NULLS LAST
LIMIT 100`,
  };

  return sqlMap[computeFn] || null;
}

/**
 * Get last run metadata for a skill from skill_runs table
 */
async function getSkillLastRun(
  workspaceId: string,
  skillId: string
): Promise<{ started_at: string; duration_ms: number } | null> {
  try {
    const result = await query<{ started_at: string; duration_ms: number }>(
      `SELECT started_at, duration_ms
       FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2
       ORDER BY started_at DESC
       LIMIT 1`,
      [workspaceId, skillId]
    );

    return result.rows[0] || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/workspaces/:workspaceId/tools/manifest
 */
router.get('/:workspaceId/tools/manifest', async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;

  try {
    const manifest = await getToolManifest(workspaceId);
    res.json(manifest);
  } catch (err) {
    console.error('[tool-manifest] Error building manifest:', err);
    res.status(500).json({
      error: 'Failed to build tool manifest',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
