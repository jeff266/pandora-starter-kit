import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { generatePipelineSnapshot } from '../analysis/pipeline-snapshot.js';
import { formatPipelineSnapshot, formatPipelineOneLiner, postToSlack } from '../connectors/slack/client.js';
import { getGoals } from '../context/index.js';
import { computeFields } from '../computed-fields/engine.js';
import { refreshComputedFields } from '../tools/computed-fields-refresh.js';
import { resolveConversationParticipants } from '../conversations/resolve-participants.js';
import { discoverWinPatterns } from '../coaching/win-pattern-discovery.js';
import { sendSlackDraft, dismissSlackDraft } from '../actions/slack-draft.js';

const router = Router();

const DEFAULT_QUOTA = 1_000_000;

interface WorkspaceParams {
  workspaceId: string;
}

router.post('/:workspaceId/actions/pipeline-snapshot', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const {
      slackWebhookUrl: bodyWebhookUrl,
      quota: bodyQuota,
      staleDaysThreshold: bodyStaleDays,
      format: bodyFormat,
    } = req.body as {
      slackWebhookUrl?: string;
      quota?: number;
      staleDaysThreshold?: number;
      format?: 'detailed' | 'compact';
    };

    const wsResult = await query<{ id: string; name: string }>(
      'SELECT id, name FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const workspaceName = wsResult.rows[0].name;

    const goals = await getGoals(workspaceId);
    const thresholds = (goals.thresholds ?? {}) as Record<string, unknown>;

    const quota = bodyQuota
      ?? (goals.revenue_target as number | undefined)
      ?? DEFAULT_QUOTA;
    const staleDaysThreshold = bodyStaleDays
      ?? (thresholds.stale_deal_days as number | undefined)
      ?? 14;
    const format = bodyFormat ?? 'detailed';

    const snapshot = await generatePipelineSnapshot(workspaceId, quota, staleDaysThreshold);

    const webhookUrl = bodyWebhookUrl ?? process.env.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
      res.json({
        success: true,
        posted: false,
        message: 'Snapshot generated. Provide slackWebhookUrl or set SLACK_WEBHOOK_URL to post to Slack.',
        snapshot,
      });
      return;
    }

    let payload: { blocks?: any[]; text?: string };

    if (format === 'compact') {
      const text = formatPipelineOneLiner(snapshot);
      payload = { text };
    } else {
      const blocks = formatPipelineSnapshot(snapshot, workspaceName);
      payload = { blocks };
    }

    const slackResult = await postToSlack(webhookUrl, payload);

    if (!slackResult.ok) {
      res.status(502).json({
        success: false,
        error: slackResult.error,
        snapshot,
      });
      return;
    }

    res.json({
      success: true,
      posted: true,
      format,
      snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Pipeline snapshot error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/actions/compute-fields', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    const wsResult = await query<{ id: string }>(
      'SELECT id FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const result = await computeFields(workspaceId);

    res.json({
      success: true,
      message: 'Computed fields updated',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Compute fields error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/actions/refresh-computed-fields', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const result = await refreshComputedFields(workspaceId);
    res.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Refresh computed fields error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/actions/toggle-experimental-scoring', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Check if workspace has sufficient outcome data
    const outcomeCount = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM deal_outcomes WHERE workspace_id = $1`,
      [workspaceId]
    );

    const count = parseInt(outcomeCount.rows[0]?.count || '0', 10);

    if (count < 20) {
      return res.status(400).json({
        error: 'insufficient_data',
        message: 'Need at least 20 closed deals to enable experimental scoring',
        deals_needed: 20,
        deals_have: count,
      });
    }

    // Check if experimental weight row exists
    const existingWeight = await query<{ id: string; active: boolean }>(
      `SELECT id, active FROM workspace_score_weights
       WHERE workspace_id = $1 AND weight_type = 'experimental'`,
      [workspaceId]
    );

    if (existingWeight.rows.length === 0) {
      // Create experimental weight row with default weights (will be optimized later)
      await query(
        `INSERT INTO workspace_score_weights (workspace_id, weight_type, crm_weight, findings_weight, conversations_weight, active)
         VALUES ($1, 'experimental', 0.40, 0.35, 0.25, true)`,
        [workspaceId]
      );

      res.json({
        success: true,
        message: 'Experimental scoring enabled',
        active: true,
      });
    } else {
      // Toggle active state
      const newActive = !existingWeight.rows[0].active;
      await query(
        `UPDATE workspace_score_weights
         SET active = $2, updated_at = NOW()
         WHERE workspace_id = $1 AND weight_type = 'experimental'`,
        [workspaceId, newActive]
      );

      res.json({
        success: true,
        message: newActive ? 'Experimental scoring enabled' : 'Experimental scoring disabled',
        active: newActive,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Toggle experimental scoring error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/actions/resolve-participants', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    console.log(`[Actions] Starting participant resolution for workspace ${workspaceId}`);
    const result = await resolveConversationParticipants(workspaceId);

    console.log(`[Actions] Participant resolution complete:`, result);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Resolve participants error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/actions/discover-win-patterns', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    console.log(`[Actions] Starting win pattern discovery for workspace ${workspaceId}`);
    const result = await discoverWinPatterns(workspaceId);

    console.log(`[Actions] Win pattern discovery complete: ${result.patterns_found.length} patterns found`);
    res.json({
      success: true,
      workspace_id: result.workspace_id,
      discovered_at: result.discovered_at,
      total_closed_deals: result.total_closed_deals,
      won_deals: result.won_deals,
      lost_deals: result.lost_deals,
      segments_analyzed: result.segments_analyzed,
      dimensions_checked: result.dimensions_checked,
      patterns_found: result.patterns_found.map(p => ({
        dimension: p.dimension,
        direction: p.direction,
        separation_score: p.separation_score,
        won_median: p.won_median,
        lost_median: p.lost_median,
        sample_size_won: p.sample_size_won,
        sample_size_lost: p.sample_size_lost,
        segment_size_min: p.segment.size_band_min,
        segment_size_max: p.segment.size_band_max,
        relevant_stages: p.relevant_stages,
      })),
      insufficient_data: result.insufficient_data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Win pattern discovery error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/actions/slack-drafts/:draftId/send', async (req: Request<WorkspaceParams & { draftId: string }>, res: Response) => {
  try {
    const { workspaceId, draftId } = req.params;
    const { editedMessage } = req.body;
    await sendSlackDraft(workspaceId, draftId, editedMessage);
    res.json({ success: true, message: 'Slack draft sent' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Send slack draft error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/actions/slack-drafts/:draftId/dismiss', async (req: Request<WorkspaceParams & { draftId: string }>, res: Response) => {
  try {
    const { workspaceId, draftId } = req.params;
    const { reason } = req.body;
    await dismissSlackDraft(workspaceId, draftId, reason);
    res.json({ success: true, message: 'Slack draft dismissed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Dismiss slack draft error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
