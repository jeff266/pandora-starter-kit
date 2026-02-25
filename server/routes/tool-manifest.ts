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
WHERE d.workspace_id = $1
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
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
WHERE a.workspace_id = $1
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
WHERE c.workspace_id = $1
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
WHERE c.workspace_id = $1
  AND c.is_internal = FALSE
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
WHERE dsh.workspace_id = $1
  AND dsh.changed_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY dsh.changed_at DESC
LIMIT 100`,
      source: 'query_tool',
      status: 'live',
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
      const sqlRepresentation = getComputeFunctionSQL(step.computeFn, skill.id);
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
WHERE d.workspace_id = $1
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
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
WHERE d.workspace_id = $1
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
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
WHERE d.workspace_id = $1
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
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
  const { workspaceId } = req.params;

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
