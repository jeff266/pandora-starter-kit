import { query } from '../db.js';

export interface DealDossier {
  deal: {
    id: string;
    name: string;
    amount: number;
    stage: string;
    stage_normalized: string;
    close_date: string | null;
    owner_email: string;
    owner_name: string;
    days_in_stage: number;
    days_open: number;
    created_at: string;
    probability: number | null;
    forecast_category: string | null;
    source: string | null;
    pipeline_name: string | null;
  };
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    role: string | null;
    is_primary: boolean;
    last_activity_date: string | null;
  }>;
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    duration_minutes: number | null;
    participants: string[];
    link_method: string;
    summary: string | null;
  }>;
  activities: Array<{
    id: string;
    type: string;
    date: string;
    subject: string | null;
    owner_email: string;
  }>;
  stage_history: Array<{
    stage: string;
    entered_at: string;
    exited_at: string | null;
    days_in_stage: number;
  }>;
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    skill_id: string;
    found_at: string;
  }>;
  health_signals: {
    activity_recency: 'active' | 'cooling' | 'stale';
    threading: 'multi' | 'dual' | 'single';
    stage_velocity: 'fast' | 'normal' | 'slow';
    data_completeness: number;
  };
}

async function getDealById(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT d.*,
            EXTRACT(day FROM now() - d.stage_changed_at) as calculated_days_in_stage,
            EXTRACT(day FROM now() - d.created_at) as days_open
     FROM deals d
     WHERE d.id = $1 AND d.workspace_id = $2`,
    [dealId, workspaceId]
  );
  return result.rows[0] || null;
}

async function getContactsForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT c.id, COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '') as name,
            c.email, c.title, dc.role, dc.is_primary, c.last_activity_date
     FROM deal_contacts dc
     JOIN contacts c ON dc.contact_id = c.id AND c.workspace_id = $1
     WHERE dc.deal_id = $2 AND dc.workspace_id = $1
     ORDER BY dc.is_primary DESC, c.last_name ASC`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getConversationsForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT cv.id, cv.title, cv.call_date, cv.duration_seconds, cv.participants,
            cv.link_method, cv.summary
     FROM conversations cv
     WHERE cv.workspace_id = $1
       AND (cv.deal_id = $2 OR cv.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1))
     ORDER BY cv.call_date DESC
     LIMIT 20`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getActivitiesForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT a.id, a.activity_type, a.timestamp, a.subject, a.actor
     FROM activities a
     WHERE a.workspace_id = $1 AND a.deal_id = $2
     ORDER BY a.timestamp DESC
     LIMIT 30`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getStageHistoryForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT stage, entered_at, exited_at, duration_days
     FROM deal_stage_history
     WHERE workspace_id = $1 AND deal_id = $2
     ORDER BY entered_at ASC`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getFindingsForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT f.id, f.severity, f.category, f.message, f.skill_id, f.found_at
     FROM findings f
     WHERE f.workspace_id = $1 AND f.deal_id = $2 AND f.resolved_at IS NULL
     ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 WHEN 'info' THEN 4 ELSE 5 END`,
    [workspaceId, dealId]
  );
  return result.rows;
}

function computeHealthSignals(
  deal: any,
  activities: any[],
  contacts: any[]
): DealDossier['health_signals'] {
  let activity_recency: 'active' | 'cooling' | 'stale' = 'stale';
  if (activities.length > 0 && activities[0].timestamp) {
    const mostRecent = new Date(activities[0].timestamp);
    const daysSince = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 7) activity_recency = 'active';
    else if (daysSince <= 21) activity_recency = 'cooling';
  }

  let threading: 'multi' | 'dual' | 'single' = 'single';
  if (contacts.length >= 3) threading = 'multi';
  else if (contacts.length === 2) threading = 'dual';

  const daysInStage = deal?.calculated_days_in_stage ?? deal?.days_in_stage ?? 0;
  let stage_velocity: 'fast' | 'normal' | 'slow' = 'normal';
  if (daysInStage <= 14) stage_velocity = 'fast';
  else if (daysInStage > 45) stage_velocity = 'slow';

  const fields = [deal?.amount, deal?.close_date, deal?.owner, deal?.stage, deal?.source, deal?.pipeline];
  const filledCount = fields.filter(f => f != null && f !== '').length;
  const data_completeness = Math.round((filledCount / fields.length) * 100);

  return { activity_recency, threading, stage_velocity, data_completeness };
}

export async function assembleDealDossier(workspaceId: string, dealId: string): Promise<DealDossier> {
  const [deal, contacts, conversations, activities, stageHistory, findings] = await Promise.all([
    getDealById(workspaceId, dealId),
    getContactsForDeal(workspaceId, dealId),
    getConversationsForDeal(workspaceId, dealId),
    getActivitiesForDeal(workspaceId, dealId),
    getStageHistoryForDeal(workspaceId, dealId),
    getFindingsForDeal(workspaceId, dealId),
  ]);

  if (!deal) {
    throw new Error(`Deal ${dealId} not found in workspace ${workspaceId}`);
  }

  const health_signals = computeHealthSignals(deal, activities, contacts);

  return {
    deal: {
      id: deal.id,
      name: deal.name || '',
      amount: deal.amount || 0,
      stage: deal.stage || '',
      stage_normalized: deal.stage_normalized || '',
      close_date: deal.close_date ? new Date(deal.close_date).toISOString() : null,
      owner_email: deal.owner || '',
      owner_name: deal.owner || '',
      days_in_stage: Math.max(0, Math.round(deal.calculated_days_in_stage ?? deal.days_in_stage ?? 0)),
      days_open: Math.max(0, Math.round(deal.days_open ?? 0)),
      created_at: deal.created_at ? new Date(deal.created_at).toISOString() : '',
      probability: deal.probability ?? null,
      forecast_category: deal.forecast_category ?? null,
      source: deal.source ?? null,
      pipeline_name: deal.pipeline ?? null,
    },
    contacts: contacts.map((c: any) => ({
      id: c.id,
      name: (c.name || '').trim(),
      email: c.email || '',
      title: c.title ?? null,
      role: c.role ?? null,
      is_primary: c.is_primary === true,
      last_activity_date: c.last_activity_date ? new Date(c.last_activity_date).toISOString() : null,
    })),
    conversations: conversations.map((cv: any) => ({
      id: cv.id,
      title: cv.title || '',
      date: cv.call_date ? new Date(cv.call_date).toISOString() : '',
      duration_minutes: cv.duration_seconds != null ? Math.round(cv.duration_seconds / 60) : null,
      participants: Array.isArray(cv.participants) ? cv.participants : [],
      link_method: cv.link_method || '',
      summary: cv.summary ?? null,
    })),
    activities: activities.map((a: any) => ({
      id: a.id,
      type: a.activity_type || '',
      date: a.timestamp ? new Date(a.timestamp).toISOString() : '',
      subject: a.subject ?? null,
      owner_email: a.actor || '',
    })),
    stage_history: stageHistory.map((sh: any) => ({
      stage: sh.stage || '',
      entered_at: sh.entered_at ? new Date(sh.entered_at).toISOString() : '',
      exited_at: sh.exited_at ? new Date(sh.exited_at).toISOString() : null,
      days_in_stage: sh.duration_days ?? 0,
    })),
    findings: findings.map((f: any) => ({
      id: f.id,
      severity: f.severity || '',
      category: f.category || '',
      message: f.message || '',
      skill_id: f.skill_id || '',
      found_at: f.found_at ? new Date(f.found_at).toISOString() : '',
    })),
    health_signals,
  };
}
