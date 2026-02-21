/**
 * Evidence Gathering Helper
 *
 * Reads the latest skill evidence for each skill in the agent's skill list.
 * Uses staleness thresholds to decide whether to read from cache or trigger a fresh run.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { getSkillRegistry } from '../skills/registry.js';
import type { SkillEvidence } from '../skills/types.js';

const logger = createLogger('EvidenceGatherer');

/**
 * Default staleness thresholds in hours per skill type
 */
const DEFAULT_STALENESS: Record<string, number> = {
  // Pipeline skills - refresh frequently
  'pipeline-hygiene': 12,
  'pipeline-coverage': 12,
  'deal-risk-review': 12,
  'single-thread-alert': 12,

  // Forecasting - refresh daily
  'forecast-rollup': 24,
  'monte-carlo-forecast': 24,

  // Performance - refresh weekly
  'rep-scorecard': 168,
  'team-performance': 168,

  // Intelligence - expensive, refresh less often
  'conversation-intelligence': 48,
  'icp-discovery': 72,

  // Config/audit - refresh weekly
  'data-quality-audit': 168,
  'workspace-config-audit': 168,
};

/**
 * Gather fresh evidence for all skills in the list.
 * Uses cache if evidence is fresh enough, otherwise triggers new run.
 */
export async function gatherFreshEvidence(
  skillIds: string[],
  workspaceId: string,
  maxStaleness?: Record<string, number>
): Promise<Record<string, SkillEvidence>> {
  logger.info('[EvidenceGatherer] Starting evidence gathering', {
    workspace_id: workspaceId,
    skill_count: skillIds.length,
    skills: skillIds,
  });

  const evidence: Record<string, SkillEvidence> = {};
  const stalenessStats = {
    cached: 0,
    fresh_run: 0,
    failed: 0,
  };

  for (const skillId of skillIds) {
    try {
      const latest = await getLatestSkillRun(skillId, workspaceId);
      const threshold = maxStaleness?.[skillId] || DEFAULT_STALENESS[skillId] || 24;
      const hoursOld = latest ? hoursSince(latest.completed_at) : Infinity;

      logger.info('[EvidenceGatherer] Checking staleness', {
        skill_id: skillId,
        hours_old: hoursOld,
        threshold_hours: threshold,
        status: latest?.status,
      });

      if (hoursOld <= threshold && latest?.status === 'completed' && latest?.output) {
        // Use cached evidence
        evidence[skillId] = latest.output;
        stalenessStats.cached++;
        logger.info('[EvidenceGatherer] Using cached evidence', {
          skill_id: skillId,
          age_hours: hoursOld,
        });
      } else {
        // Trigger fresh run
        logger.info('[EvidenceGatherer] Triggering fresh skill run', {
          skill_id: skillId,
          reason: hoursOld > threshold ? 'stale' : latest?.status !== 'completed' ? 'incomplete' : 'no_output',
        });

        const fresh = await runSkill(skillId, workspaceId);
        if (fresh?.output) {
          evidence[skillId] = fresh.output;
          stalenessStats.fresh_run++;
        } else {
          logger.error('[EvidenceGatherer] Fresh run failed or produced no output', { skill_id: skillId });
          stalenessStats.failed++;
        }
      }
    } catch (error) {
      logger.error('[EvidenceGatherer] Failed to gather evidence for skill', {
        skill_id: skillId,
        error: (error as Error).message,
      });
      stalenessStats.failed++;
    }
  }

  logger.info('[EvidenceGatherer] Evidence gathering complete', {
    workspace_id: workspaceId,
    total_skills: skillIds.length,
    cached: stalenessStats.cached,
    fresh_runs: stalenessStats.fresh_run,
    failed: stalenessStats.failed,
  });

  return evidence;
}

/**
 * Get the latest skill run for a given skill + workspace
 */
async function getLatestSkillRun(
  skillId: string,
  workspaceId: string
): Promise<{
  id: string;
  status: string;
  output: SkillEvidence | null;
  completed_at: string;
} | null> {
  const result = await query(
    `SELECT id, status, output, completed_at
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = $2
       AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 1`,
    [workspaceId, skillId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    id: result.rows[0].id,
    status: result.rows[0].status,
    output: result.rows[0].output,
    completed_at: result.rows[0].completed_at,
  };
}

/**
 * Trigger a fresh skill run
 */
async function runSkill(
  skillId: string,
  workspaceId: string
): Promise<{
  id: string;
  status: string;
  output: SkillEvidence | null;
} | null> {
  try {
    logger.info('[EvidenceGatherer] Executing skill', { skill_id: skillId, workspace_id: workspaceId });

    const registry = getSkillRegistry();
    const skillDef = registry.get(skillId);
    if (!skillDef) {
      logger.error('[EvidenceGatherer] Skill not found in registry', { skill_id: skillId });
      return null;
    }

    const runtime = getSkillRuntime();
    const result = await runtime.executeSkill(skillDef, workspaceId, {});

    logger.info('[EvidenceGatherer] Skill execution complete', {
      skill_id: skillId,
      status: result.status,
      has_output: !!result.output,
    });

    return {
      id: result.id,
      status: result.status,
      output: result.output || null,
    };
  } catch (error) {
    logger.error('[EvidenceGatherer] Skill execution failed', {
      skill_id: skillId,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Calculate hours since a timestamp
 */
function hoursSince(timestamp: string | Date): number {
  const then = new Date(timestamp).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60);
}
