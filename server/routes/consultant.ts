import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import {
  createConsultantConnector,
  getConsultantConnectors,
  getConsultantConnector,
  deleteConsultantConnector,
} from '../connectors/consultant-connector.js';
import { syncConsultantFireflies } from '../connectors/consultant-fireflies-sync.js';
import { assignCallToWorkspace, skipCall } from '../connectors/consultant-distributor.js';
import { FirefliesClient } from '../connectors/fireflies/client.js';

const router = Router();

interface CacheEntry {
  data: any;
  expiresAt: number;
}

const dashboardCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function authenticateSession(req: Request, res: Response): Promise<{ user_id: string; email: string; name: string } | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const token = header.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  const session = await query<{ user_id: string; email: string; name: string }>(
    `SELECT us.user_id, u.email, u.name
     FROM user_sessions us
     JOIN users u ON u.id = us.user_id
     WHERE us.token = $1 AND us.expires_at > now()`,
    [token]
  );

  if (session.rows.length === 0) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }

  return session.rows[0];
}

async function getWorkspaceData(workspaceId: string, workspaceName: string) {
  const [connResult, dealResult, findingResult, actionResult, skillRunResult, skillCountResult] = await Promise.all([
    query<{ connector_name: string; status: string; last_sync_at: string | null }>(
      `SELECT connector_name, status, last_sync_at FROM connections WHERE workspace_id = $1`,
      [workspaceId]
    ),
    query<{ deal_count: string; total_value: string; weighted_value: string; avg_age_days: string }>(
      `SELECT
         count(*) as deal_count,
         coalesce(sum(amount), 0) as total_value,
         coalesce(sum(amount * coalesce(probability, 0) / 100.0), 0) as weighted_value,
         coalesce(avg(extract(epoch from (now() - created_at)) / 86400.0), 0) as avg_age_days
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    ),
    query<{ severity: string; cnt: string }>(
      `SELECT severity, count(*) as cnt
       FROM findings
       WHERE workspace_id = $1
         AND resolved_at IS NULL
         AND (snoozed_until IS NULL OR snoozed_until < now())
       GROUP BY severity`,
      [workspaceId]
    ),
    query<{ execution_status: string; severity: string; impact_amount: string | null; created_at: string }>(
      `SELECT execution_status, severity, impact_amount, created_at
       FROM actions
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    query<{ last_run: string | null }>(
      `SELECT max(started_at) as last_run FROM skill_runs WHERE workspace_id = $1`,
      [workspaceId]
    ),
    query<{ cnt: string }>(
      `SELECT count(DISTINCT skill_id) as cnt FROM skill_runs WHERE workspace_id = $1 AND status = 'completed'`,
      [workspaceId]
    ),
  ]);

  const connectors = connResult.rows;
  const crmConn = connectors.find(c => c.connector_name === 'hubspot' || c.connector_name === 'salesforce');
  const convConn = connectors.find(c => c.connector_name === 'gong' || c.connector_name === 'fireflies');
  const crm_type = crmConn?.connector_name as 'hubspot' | 'salesforce' | null ?? null;
  const conversation_source = convConn?.connector_name as 'gong' | 'fireflies' | null ?? null;

  const deal = dealResult.rows[0];
  const pipeline = {
    total_value: parseFloat(deal.total_value) || 0,
    deal_count: parseInt(deal.deal_count) || 0,
    weighted_value: parseFloat(deal.weighted_value) || 0,
    avg_age_days: Math.round(parseFloat(deal.avg_age_days) || 0),
  };

  const findingsMap: Record<string, number> = {};
  for (const row of findingResult.rows) {
    findingsMap[row.severity] = parseInt(row.cnt) || 0;
  }
  const findings = {
    critical: findingsMap['act'] || 0,
    warning: findingsMap['watch'] || 0,
    info: (findingsMap['notable'] || 0) + (findingsMap['info'] || 0),
    total: Object.values(findingsMap).reduce((a, b) => a + b, 0),
  };

  const openStatuses = ['pending', 'snoozed'];
  const resolvedStatuses = ['executed'];
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let openActions = 0;
  let criticalOpen = 0;
  let resolvedThisWeek = 0;
  let pipelineAtRisk = 0;

  for (const action of actionResult.rows) {
    const isOpen = openStatuses.includes(action.execution_status);
    if (isOpen) {
      openActions++;
      if (action.severity === 'critical' || action.severity === 'high') criticalOpen++;
      if (action.impact_amount) pipelineAtRisk += parseFloat(action.impact_amount) || 0;
    }
    if (resolvedStatuses.includes(action.execution_status) && new Date(action.created_at) >= weekAgo) {
      resolvedThisWeek++;
    }
  }

  const actions = {
    open: openActions,
    critical_open: criticalOpen,
    resolved_this_week: resolvedThisWeek,
    pipeline_at_risk: pipelineAtRisk,
  };

  const lastSyncDates = connectors.map(c => c.last_sync_at).filter(Boolean);
  const connectorData = {
    count: connectors.length,
    any_errors: connectors.some(c => c.status === 'error' || c.status === 'failed'),
    last_sync: lastSyncDates.length > 0
      ? lastSyncDates.sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0]
      : null,
  };

  return {
    id: workspaceId,
    name: workspaceName,
    crm_type,
    conversation_source,
    pipeline,
    findings,
    actions,
    connectors: connectorData,
    last_skill_run: skillRunResult.rows[0]?.last_run || null,
    skills_active: parseInt(skillCountResult.rows[0]?.cnt) || 0,
  };
}

router.get('/dashboard', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const cached = dashboardCache.get(user.user_id);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const wsResult = await query<{ workspace_id: string; name: string }>(
      `SELECT uw.workspace_id, w.name
       FROM user_workspaces uw
       JOIN workspaces w ON w.id = uw.workspace_id
       WHERE uw.user_id = $1`,
      [user.user_id]
    );

    const workspaces = await Promise.all(
      wsResult.rows.map(ws => getWorkspaceData(ws.workspace_id, ws.name))
    );

    workspaces.sort((a, b) => {
      if (a.findings.critical !== b.findings.critical) return b.findings.critical - a.findings.critical;
      if (a.actions.open !== b.actions.open) return b.actions.open - a.actions.open;
      return a.name.localeCompare(b.name);
    });

    const totals = {
      total_pipeline: workspaces.reduce((s, w) => s + w.pipeline.total_value, 0),
      total_deals: workspaces.reduce((s, w) => s + w.pipeline.deal_count, 0),
      total_critical_findings: workspaces.reduce((s, w) => s + w.findings.critical, 0),
      total_open_actions: workspaces.reduce((s, w) => s + w.actions.open, 0),
      total_pipeline_at_risk: workspaces.reduce((s, w) => s + w.actions.pipeline_at_risk, 0),
      workspaces_with_errors: workspaces.filter(w => w.connectors.any_errors).length,
    };

    const data = { workspaces, totals };

    dashboardCache.set(user.user_id, { data, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json(data);
  } catch (err) {
    console.error('[consultant] Dashboard error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to load consultant dashboard' });
  }
});

// ============================================================================
// Consultant Connector CRUD
// ============================================================================

router.post('/connectors', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const { source, credentials } = req.body;
    if (!source || !credentials) {
      res.status(400).json({ error: 'source and credentials are required' });
      return;
    }

    const validSources = ['fireflies', 'gong', 'otter'];
    if (!validSources.includes(source)) {
      res.status(400).json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` });
      return;
    }

    // Validate credentials before saving
    if (source === 'fireflies') {
      if (!credentials.api_key) {
        res.status(400).json({ error: 'api_key is required for Fireflies' });
        return;
      }

      const client = new FirefliesClient(credentials.api_key);
      const testResult = await client.testConnection();
      if (!testResult.success) {
        res.status(400).json({ error: `Fireflies connection failed: ${testResult.error}` });
        return;
      }
    }

    const connector = await createConsultantConnector(user.user_id, source, credentials);

    console.log(`[consultant] Created ${source} connector for user ${user.email}`);

    // Trigger initial sync in background
    if (source === 'fireflies') {
      syncConsultantFireflies(connector.id)
        .then(result => console.log(`[consultant] Initial sync complete: ${result.synced} synced, ${JSON.stringify(result.distributed)}`))
        .catch(err => console.error(`[consultant] Initial sync failed: ${err.message}`));
    }

    res.status(201).json({
      ...connector,
      credentials: undefined, // Don't return credentials
    });
  } catch (err) {
    console.error('[consultant] Create connector error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to create connector' });
  }
});

router.get('/connectors', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const connectors = await getConsultantConnectors(user.user_id);

    // Get sync stats per connector
    const enriched = await Promise.all(
      connectors.map(async (c) => {
        const stats = await query<{ total: string; assigned: string; unassigned: string; skipped: string }>(
          `SELECT
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE workspace_id IS NOT NULL) as assigned,
             COUNT(*) FILTER (WHERE workspace_id IS NULL AND skipped = FALSE) as unassigned,
             COUNT(*) FILTER (WHERE skipped = TRUE) as skipped
           FROM consultant_call_assignments
           WHERE consultant_connector_id = $1`,
          [c.id]
        );
        const row = stats.rows[0];
        return {
          id: c.id,
          source: c.source,
          status: c.status,
          last_synced_at: c.last_synced_at,
          sync_config: c.sync_config,
          created_at: c.created_at,
          calls: {
            total: parseInt(row?.total || '0'),
            assigned: parseInt(row?.assigned || '0'),
            unassigned: parseInt(row?.unassigned || '0'),
            skipped: parseInt(row?.skipped || '0'),
          },
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error('[consultant] List connectors error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list connectors' });
  }
});

router.delete('/connectors/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const connector = await getConsultantConnector(req.params.id as string);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    if (connector.user_id !== user.user_id) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    await deleteConsultantConnector(req.params.id as string);
    console.log(`[consultant] Deleted connector ${req.params.id as string} for user ${user.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[consultant] Delete connector error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to delete connector' });
  }
});

router.post('/connectors/:id/sync', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const connector = await getConsultantConnector(req.params.id as string);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    if (connector.user_id !== user.user_id) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    if (connector.source === 'fireflies') {
      const result = await syncConsultantFireflies(connector.id);
      res.json(result);
    } else {
      res.status(400).json({ error: `Sync not yet supported for ${connector.source}` });
    }
  } catch (err) {
    console.error('[consultant] Sync error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ============================================================================
// Call Assignment
// ============================================================================

router.get('/calls/unassigned', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const result = await query<{
      id: string;
      conversation_id: string;
      candidate_workspaces: any;
      title: string | null;
      call_date: string | null;
      duration_seconds: number | null;
      participants: any;
      summary: string | null;
    }>(
      `SELECT cca.id, cca.conversation_id, cca.candidate_workspaces,
              c.title, c.call_date, c.duration_seconds, c.participants, c.summary
       FROM consultant_call_assignments cca
       JOIN conversations c ON c.id = cca.conversation_id
       JOIN consultant_connectors cc ON cc.id = cca.consultant_connector_id
       WHERE cc.user_id = $1
         AND cca.workspace_id IS NULL
         AND cca.skipped = FALSE
       ORDER BY c.call_date DESC NULLS LAST`,
      [user.user_id]
    );

    const calls = result.rows.map(row => {
      const participants = Array.isArray(row.participants) ? row.participants : [];
      const participantEmails = participants.filter((p: any) => p.email).map((p: any) => p.email);
      return {
        id: row.id,
        conversation_id: row.conversation_id,
        title: row.title,
        call_date: row.call_date,
        duration_minutes: row.duration_seconds ? Math.round(row.duration_seconds / 60) : null,
        participant_count: participants.length,
        has_emails: participantEmails.length > 0,
        transcript_preview: row.summary ? row.summary.substring(0, 200) : null,
        candidate_workspaces: row.candidate_workspaces || [],
      };
    });

    res.json({ calls, total: calls.length });
  } catch (err) {
    console.error('[consultant] Unassigned calls error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch unassigned calls' });
  }
});

router.post('/calls/:conversationId/assign', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const { workspace_id } = req.body;
    if (!workspace_id) {
      res.status(400).json({ error: 'workspace_id is required' });
      return;
    }

    // Verify conversation belongs to this user's connector
    const check = await query<{ id: string }>(
      `SELECT cca.id
       FROM consultant_call_assignments cca
       JOIN consultant_connectors cc ON cc.id = cca.consultant_connector_id
       WHERE cca.conversation_id = $1 AND cc.user_id = $2`,
      [req.params.conversationId as string, user.user_id]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Call not found or not authorized' });
      return;
    }

    // Verify user has access to the target workspace
    const wsAccess = await query(
      `SELECT 1 FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2`,
      [user.user_id, workspace_id]
    );
    if (wsAccess.rows.length === 0) {
      res.status(403).json({ error: 'No access to target workspace' });
      return;
    }

    await assignCallToWorkspace(
      req.params.conversationId as string,
      workspace_id,
      'manual',
      1.0,
      user.email
    );

    res.json({ success: true, assignment_method: 'manual' });
  } catch (err) {
    console.error('[consultant] Assign call error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to assign call' });
  }
});

router.post('/calls/:conversationId/skip', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    const { reason } = req.body;
    const validReasons = ['internal', 'personal', 'irrelevant'];
    const skipReason = validReasons.includes(reason) ? reason : 'irrelevant';

    // Verify ownership
    const check = await query<{ id: string }>(
      `SELECT cca.id
       FROM consultant_call_assignments cca
       JOIN consultant_connectors cc ON cc.id = cca.consultant_connector_id
       WHERE cca.conversation_id = $1 AND cc.user_id = $2`,
      [req.params.conversationId as string, user.user_id]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Call not found or not authorized' });
      return;
    }

    await skipCall(req.params.conversationId as string, skipReason);
    res.json({ success: true, skip_reason: skipReason });
  } catch (err) {
    console.error('[consultant] Skip call error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to skip call' });
  }
});

router.get('/calls/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateSession(req, res);
    if (!user) return;

    // Overall stats
    const statsResult = await query<{
      total_calls: string;
      assigned: string;
      unassigned: string;
      skipped: string;
      by_email: string;
      by_calendar: string;
      by_transcript: string;
      by_manual: string;
    }>(
      `SELECT
         COUNT(*) as total_calls,
         COUNT(*) FILTER (WHERE cca.workspace_id IS NOT NULL) as assigned,
         COUNT(*) FILTER (WHERE cca.workspace_id IS NULL AND cca.skipped = FALSE) as unassigned,
         COUNT(*) FILTER (WHERE cca.skipped = TRUE) as skipped,
         COUNT(*) FILTER (WHERE cca.assignment_method = 'email_match') as by_email,
         COUNT(*) FILTER (WHERE cca.assignment_method = 'calendar_match') as by_calendar,
         COUNT(*) FILTER (WHERE cca.assignment_method = 'transcript_scan') as by_transcript,
         COUNT(*) FILTER (WHERE cca.assignment_method = 'manual') as by_manual
       FROM consultant_call_assignments cca
       JOIN consultant_connectors cc ON cc.id = cca.consultant_connector_id
       WHERE cc.user_id = $1`,
      [user.user_id]
    );

    const s = statsResult.rows[0];

    // By workspace breakdown
    const byWorkspace = await query<{ workspace_id: string; workspace_name: string; count: string }>(
      `SELECT cca.workspace_id, w.name as workspace_name, COUNT(*) as count
       FROM consultant_call_assignments cca
       JOIN consultant_connectors cc ON cc.id = cca.consultant_connector_id
       JOIN workspaces w ON w.id = cca.workspace_id
       WHERE cc.user_id = $1 AND cca.workspace_id IS NOT NULL
       GROUP BY cca.workspace_id, w.name
       ORDER BY count DESC`,
      [user.user_id]
    );

    res.json({
      total_calls: parseInt(s?.total_calls || '0'),
      assigned: parseInt(s?.assigned || '0'),
      unassigned: parseInt(s?.unassigned || '0'),
      skipped: parseInt(s?.skipped || '0'),
      by_method: {
        email_match: parseInt(s?.by_email || '0'),
        calendar_match: parseInt(s?.by_calendar || '0'),
        transcript_scan: parseInt(s?.by_transcript || '0'),
        manual: parseInt(s?.by_manual || '0'),
      },
      by_workspace: byWorkspace.rows.map(row => ({
        workspace_id: row.workspace_id,
        workspace_name: row.workspace_name,
        count: parseInt(row.count),
      })),
    });
  } catch (err) {
    console.error('[consultant] Stats error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
