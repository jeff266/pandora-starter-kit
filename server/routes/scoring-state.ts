/**
 * Scoring State Routes
 *
 * Manages the ICP lock/unlock state for account scoring.
 * Four endpoints: state, activate, refresh-icp, state/poll
 */

import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { recomputeScoringState, getScoringState } from '../scoring/workspace-scoring-state.js';
import { runAccountEnrichmentBatch } from '../enrichment/account-enrichment-batch.js';
import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';

const router = Router();

/**
 * GET /:workspaceId/scoring/state
 * Returns the full scoring state for the workspace.
 */
router.get('/:workspaceId/scoring/state', requirePermission('data.deals_view'), async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });

    const state = await getScoringState(workspaceId);
    return res.json(state);
  } catch (err) {
    console.error('[scoring-state] state error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/scoring/state/poll
 * Lightweight polling endpoint for the processing state UI.
 * Returns only the fields needed for the progress banner.
 */
router.get('/:workspaceId/scoring/state/poll', requirePermission('data.deals_view'), async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // Recompute state to catch transitions (ICP Discovery may have completed)
    await recomputeScoringState(workspaceId);

    const rows = await query<{
      state: string;
      processing_step: string | null;
      accounts_scored: number;
      accounts_total: number;
    }>(
      `SELECT state, processing_step, accounts_scored, accounts_total
       FROM workspace_scoring_state WHERE workspace_id = $1`,
      [workspaceId]
    );

    if (rows.rows.length === 0) {
      return res.json({ state: 'locked', processingStep: null, accountsScored: 0, accountsTotal: 0 });
    }

    const row = rows.rows[0];
    return res.json({
      state: row.state,
      processingStep: row.processing_step,
      accountsScored: row.accounts_scored,
      accountsTotal: row.accounts_total,
    });
  } catch (err) {
    console.error('[scoring-state] poll error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:workspaceId/scoring/activate
 * Triggers ICP Discovery → account enrichment → scoring pipeline.
 * Only valid when state = 'ready'.
 */
router.post('/:workspaceId/scoring/activate', requirePermission('config.edit'), async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });

    // Verify workspace has enough closed-won deals
    const dealCount = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM deals
       WHERE workspace_id = $1 AND stage_normalized = 'closed_won'`,
      [workspaceId]
    );
    const count = parseInt(dealCount.rows[0]?.count ?? '0');
    if (count < 5) {
      return res.status(400).json({
        error: 'Insufficient closed-won deals',
        message: `Need at least 5 closed-won deals to activate scoring. Currently have ${count}.`,
        closedWonCount: count,
        minimum: 5,
      });
    }

    // Check not already processing
    const existing = await query<{ state: string }>(
      `SELECT state FROM workspace_scoring_state WHERE workspace_id = $1`,
      [workspaceId]
    );
    if (existing.rows[0]?.state === 'processing') {
      return res.status(409).json({ error: 'Scoring activation already in progress' });
    }

    // Get and run the ICP Discovery skill
    const registry = getSkillRegistry();
    const icpSkill = registry.get('icp-discovery');
    if (!icpSkill) {
      return res.status(500).json({ error: 'ICP Discovery skill not found' });
    }

    const runtime = getSkillRuntime();

    // Set state to processing immediately so UI transitions
    await query(
      `INSERT INTO workspace_scoring_state (workspace_id, state, closed_won_deals_count, processing_step, processing_started_at)
       VALUES ($1, 'processing', $2, 'icp_discovery', now())
       ON CONFLICT (workspace_id) DO UPDATE SET
         state = 'processing',
         processing_step = 'icp_discovery',
         processing_started_at = now(),
         updated_at = now()`,
      [workspaceId, count]
    );

    // Run ICP Discovery in background, then trigger enrichment + scoring
    const runPromise = runtime.executeSkill(icpSkill, workspaceId, { trigger: 'scoring_activate' });

    // Register completion callback — when ICP finishes, trigger batch scoring
    runPromise.then(async (result) => {
      console.log(`[ScoringActivate] ICP Discovery completed for ${workspaceId} (status=${result.status})`);

      // Update processing step
      await query(
        `UPDATE workspace_scoring_state
         SET processing_step = 'enriching', updated_at = now()
         WHERE workspace_id = $1`,
        [workspaceId]
      ).catch(() => {});

      // Recompute state (picks up new icp_profiles record)
      await recomputeScoringState(workspaceId);

      // Fire enrichment batch → triggers scoring batch automatically when it completes
      await runAccountEnrichmentBatch(workspaceId, { limit: 500, forceRefresh: false }).catch(err => {
        console.error('[ScoringActivate] Enrichment batch failed:', err instanceof Error ? err.message : err);
      });

      // Final recompute
      await recomputeScoringState(workspaceId);

      console.log(`[ScoringActivate] Activation pipeline complete for workspace ${workspaceId}`);
    }).catch(async (err) => {
      console.error(`[ScoringActivate] ICP Discovery failed for ${workspaceId}:`, err instanceof Error ? err.message : err);
      await recomputeScoringState(workspaceId).catch(() => {});
    });

    // Get the run ID (may not be available synchronously — return a placeholder)
    return res.json({
      ok: true,
      message: 'ICP Discovery and scoring activation started',
      estimatedMinutes: 2,
    });
  } catch (err) {
    console.error('[scoring-state] activate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:workspaceId/scoring/refresh-icp
 * Re-runs ICP Discovery and rescores all accounts.
 * Only valid when state = 'active'.
 */
router.post('/:workspaceId/scoring/refresh-icp', requirePermission('config.edit'), async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });

    const stateResult = await query<{ state: string }>(
      `SELECT state FROM workspace_scoring_state WHERE workspace_id = $1`,
      [workspaceId]
    );
    if (stateResult.rows[0]?.state !== 'active') {
      return res.status(400).json({ error: 'ICP refresh is only available when scoring is active' });
    }

    const registry = getSkillRegistry();
    const icpSkill = registry.get('icp-discovery');
    if (!icpSkill) return res.status(500).json({ error: 'ICP Discovery skill not found' });

    const runtime = getSkillRuntime();

    // Set to processing state
    await query(
      `UPDATE workspace_scoring_state
       SET state = 'processing', processing_step = 'icp_discovery', processing_started_at = now(), updated_at = now()
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    // Run in background
    runtime.executeSkill(icpSkill, workspaceId, { trigger: 'icp_refresh' })
      .then(async () => {
        await recomputeScoringState(workspaceId);
        await runAccountEnrichmentBatch(workspaceId, { limit: 500, forceRefresh: true }).catch(err =>
          console.error('[ScoringRefresh] Enrichment failed:', err instanceof Error ? err.message : err)
        );
        await recomputeScoringState(workspaceId);
      })
      .catch(async (err) => {
        console.error('[ScoringRefresh] ICP refresh failed:', err instanceof Error ? err.message : err);
        await recomputeScoringState(workspaceId).catch(() => {});
      });

    return res.json({ ok: true, message: 'ICP refresh started' });
  } catch (err) {
    console.error('[scoring-state] refresh-icp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
