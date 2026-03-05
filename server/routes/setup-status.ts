import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/:workspaceId/setup-status', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;

  try {
    const [
      crmResult,
      convResult,
      icpResult,
      membersResult,
      slackResult,
      targetsResult,
      skillRunResult,
      rosterResult,
      benchmarkResult,
    ] = await Promise.all([
      query(
        `SELECT COUNT(*) FROM connections
         WHERE workspace_id = $1
           AND connector_name IN ('hubspot', 'salesforce')
           AND status NOT IN ('error', 'disconnected')`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) FROM connections
         WHERE workspace_id = $1
           AND connector_name IN ('gong', 'fireflies')
           AND status NOT IN ('error', 'disconnected')`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) FROM icp_profiles WHERE workspace_id = $1`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) FROM workspace_members
         WHERE workspace_id = $1 AND status = 'active'`,
        [workspaceId]
      ),
      query(
        `SELECT settings->>'slack_webhook_url' AS slack_url FROM workspaces WHERE id = $1`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) FROM targets WHERE workspace_id = $1`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) FROM skill_runs
         WHERE workspace_id = $1 AND status = 'completed'`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) FROM user_reporting_lines WHERE workspace_id = $1`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) FROM skill_runs
         WHERE workspace_id = $1
           AND skill_id LIKE '%stage%'
           AND status = 'completed'`,
        [workspaceId]
      ),
    ]);

    res.json({
      crm_connected: parseInt(crmResult.rows[0].count) > 0,
      conversation_connected: parseInt(convResult.rows[0].count) > 0,
      icp_configured: parseInt(icpResult.rows[0].count) > 0,
      team_invited: parseInt(membersResult.rows[0].count) > 1,
      slack_configured: !!(slackResult.rows[0]?.slack_url),
      targets_set: parseInt(targetsResult.rows[0].count) > 0,
      first_skill_run: parseInt(skillRunResult.rows[0].count) > 0,
      roster_configured: parseInt(rosterResult.rows[0].count) > 0,
      benchmarks_run: parseInt(benchmarkResult.rows[0].count) > 0,
    });
  } catch (err) {
    console.error('[setup-status] Error:', err);
    res.status(500).json({ error: 'Failed to load setup status' });
  }
});

export default router;
