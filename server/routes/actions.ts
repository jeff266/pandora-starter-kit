import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { generatePipelineSnapshot } from '../analysis/pipeline-snapshot.js';
import { formatPipelineSnapshot, postToSlack } from '../connectors/slack/client.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

router.post('/:workspaceId/actions/pipeline-snapshot', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { slackWebhookUrl, quota } = req.body as { slackWebhookUrl?: string; quota?: number };

    const wsResult = await query<{ id: string; name: string }>(
      'SELECT id, name FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const workspaceName = wsResult.rows[0].name;
    const snapshot = await generatePipelineSnapshot(workspaceId, quota);

    if (!slackWebhookUrl) {
      res.json({
        success: true,
        posted: false,
        message: 'Snapshot generated. Provide slackWebhookUrl to post to Slack.',
        snapshot,
      });
      return;
    }

    const blocks = formatPipelineSnapshot(snapshot, workspaceName);
    const slackResult = await postToSlack(slackWebhookUrl, blocks);

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
      snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actions] Pipeline snapshot error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
