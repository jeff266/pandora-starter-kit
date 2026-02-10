/**
 * Webhook Handler for n8n Integration
 *
 * Exposes endpoints that n8n (or any external orchestrator) can call to:
 * - Trigger skill execution
 * - Receive event notifications
 * - Check skill run status
 *
 * This is how Pandora integrates with external workflow automation.
 */

import type { Request, Response } from 'express';
import { getSkillRegistry } from './registry.js';
import { getSkillRuntime } from './runtime.js';
import type { SkillResult } from './types.js';
import { query } from '../db.js';

/**
 * POST /api/webhooks/skills/:skillId/trigger
 *
 * Trigger skill execution from external workflow tool
 *
 * Body:
 * {
 *   workspaceId: string,
 *   params?: any,
 *   callbackUrl?: string  // Optional: POST results here when done
 * }
 *
 * Response:
 * {
 *   runId: string,
 *   status: 'queued' | 'running'
 * }
 */
export async function handleSkillTrigger(req: Request, res: Response): Promise<void> {
  try {
    const { skillId } = req.params;
    const { workspaceId, params, callbackUrl } = req.body;

    if (!skillId) {
      res.status(400).json({ error: 'Missing skillId' });
      return;
    }

    if (!workspaceId) {
      res.status(400).json({ error: 'Missing workspaceId' });
      return;
    }

    // Validate skill exists
    const registry = getSkillRegistry();
    const skill = registry.get(skillId);

    if (!skill) {
      res.status(404).json({ error: `Skill not found: ${skillId}` });
      return;
    }

    // Validate workspace exists
    const workspaceResult = await query(
      'SELECT id FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: `Workspace not found: ${workspaceId}` });
      return;
    }

    console.log(`[Webhook] Triggering skill ${skillId} for workspace ${workspaceId}`);

    // Execute skill (async - don't wait)
    const runtime = getSkillRuntime();
    executeSkillAsync(skill, workspaceId, params, callbackUrl, runtime);

    // Return immediately
    res.status(202).json({
      status: 'queued',
      message: `Skill ${skillId} queued for execution`,
    });
  } catch (error) {
    console.error('[Webhook] Error triggering skill:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

/**
 * Execute skill asynchronously and optionally callback
 */
async function executeSkillAsync(
  skill: any,
  workspaceId: string,
  params: any,
  callbackUrl: string | undefined,
  runtime: any
): Promise<void> {
  try {
    const result: SkillResult = await runtime.executeSkill(skill, workspaceId, params);

    console.log(`[Webhook] Skill ${skill.id} completed with status: ${result.status}`);

    // If callback URL provided, POST results
    if (callbackUrl) {
      try {
        await fetch(callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(result),
        });
        console.log(`[Webhook] Posted results to callback URL: ${callbackUrl}`);
      } catch (error) {
        console.error('[Webhook] Failed to post to callback URL:', error);
      }
    }
  } catch (error) {
    console.error(`[Webhook] Skill ${skill.id} execution failed:`, error);
  }
}

/**
 * POST /api/webhooks/events
 *
 * Receive event notifications from Pandora or external systems
 *
 * Body:
 * {
 *   event: 'sync_completed' | 'deal_stage_changed' | 'new_conversation',
 *   workspaceId: string,
 *   data: any
 * }
 *
 * Response:
 * {
 *   skillsTriggered: string[]
 * }
 */
export async function handleEvent(req: Request, res: Response): Promise<void> {
  try {
    const { event, workspaceId, data } = req.body;

    if (!event || !workspaceId) {
      res.status(400).json({ error: 'Missing event or workspaceId' });
      return;
    }

    console.log(`[Webhook] Received event: ${event} for workspace ${workspaceId}`);

    // Find skills with matching trigger
    const registry = getSkillRegistry();
    const allSkills = registry.listAll();
    const matchingSkills = allSkills.filter(skill =>
      skill.schedule?.trigger && matchesTrigger(skill.schedule.trigger, event)
    );

    console.log(`[Webhook] Found ${matchingSkills.length} skills matching trigger`);

    // Trigger matching skills
    const runtime = getSkillRuntime();
    const triggeredSkillIds: string[] = [];

    for (const skillSummary of matchingSkills) {
      const skill = registry.get(skillSummary.id);
      if (skill) {
        executeSkillAsync(skill, workspaceId, data, undefined, runtime);
        triggeredSkillIds.push(skill.id);
      }
    }

    res.status(200).json({
      skillsTriggered: triggeredSkillIds,
    });
  } catch (error) {
    console.error('[Webhook] Error handling event:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

/**
 * GET /api/webhooks/skills/:skillId/runs/:runId
 *
 * Get skill run status and results
 *
 * Response:
 * {
 *   runId: string,
 *   skillId: string,
 *   workspaceId: string,
 *   status: string,
 *   output: any,
 *   started_at: string,
 *   completed_at: string
 * }
 */
export async function handleGetSkillRun(req: Request, res: Response): Promise<void> {
  try {
    const { skillId, runId } = req.params;

    if (!skillId || !runId) {
      res.status(400).json({ error: 'Missing skillId or runId' });
      return;
    }

    const result = await query(
      `SELECT * FROM skill_runs WHERE skill_id = $1 AND run_id = $2`,
      [skillId, runId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Skill run not found' });
      return;
    }

    const run = result.rows[0];

    res.status(200).json({
      runId: run.run_id,
      skillId: run.skill_id,
      workspaceId: run.workspace_id,
      status: run.status,
      output: run.output,
      error: run.error,
      started_at: run.started_at,
      completed_at: run.completed_at,
    });
  } catch (error) {
    console.error('[Webhook] Error fetching skill run:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

/**
 * GET /api/webhooks/skills/:skillId/runs
 *
 * Get recent runs for a skill
 *
 * Query params:
 * - workspaceId (required)
 * - limit (optional, default 10)
 *
 * Response:
 * {
 *   runs: Array<{ runId, status, started_at, completed_at }>
 * }
 */
export async function handleListSkillRuns(req: Request, res: Response): Promise<void> {
  try {
    const { skillId } = req.params;
    const { workspaceId } = req.query;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!skillId || !workspaceId) {
      res.status(400).json({ error: 'Missing skillId or workspaceId' });
      return;
    }

    const result = await query(
      `SELECT run_id, skill_id, workspace_id, status, started_at, completed_at, error
       FROM skill_runs
       WHERE skill_id = $1 AND workspace_id = $2
       ORDER BY started_at DESC
       LIMIT $3`,
      [skillId, workspaceId, limit]
    );

    res.status(200).json({
      runs: result.rows.map(row => ({
        runId: row.run_id,
        skillId: row.skill_id,
        workspaceId: row.workspace_id,
        status: row.status,
        started_at: row.started_at,
        completed_at: row.completed_at,
        error: row.error,
      })),
    });
  } catch (error) {
    console.error('[Webhook] Error listing skill runs:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function matchesTrigger(trigger: string, event: string): boolean {
  // Exact match
  if (trigger === event) return true;

  // Pattern matching
  if (trigger === 'post_sync' && event === 'sync_completed') return true;
  if (trigger === 'on_deal_change' && event.startsWith('deal_')) return true;

  return false;
}

/**
 * Helper to format skill run as webhook payload
 */
export function formatSkillRunForWebhook(result: SkillResult): Record<string, any> {
  return {
    runId: result.runId,
    skillId: result.skillId,
    workspaceId: result.workspaceId,
    status: result.status,
    output: result.output,
    outputFormat: result.outputFormat,
    totalDuration_ms: result.totalDuration_ms,
    totalTokenUsage: result.totalTokenUsage,
    completedAt: result.completedAt.toISOString(),
    errors: result.errors,
  };
}
