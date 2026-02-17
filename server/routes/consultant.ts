import { Router, Request, Response } from 'express';
import { query } from '../db.js';

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

export default router;
