import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { generatePipelineSnapshot } from '../analysis/pipeline-snapshot.js';
import { formatPipelineSnapshot, formatPipelineOneLiner, postToSlack } from '../connectors/slack/client.js';
import { getGoals } from '../context/index.js';
import { computeFields } from '../computed-fields/engine.js';
import { refreshComputedFields } from '../tools/computed-fields-refresh.js';

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

export default router;
