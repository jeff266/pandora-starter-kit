import { query } from '../db.js';
import { getBatchDealRiskScores } from '../tools/deal-risk-score.js';
import { getActiveAnnotations } from '../feedback/annotations.js';

export interface AccountDossier {
  account: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    employee_count: number | null;
    annual_revenue: number | null;
    owner_email: string | null;
    created_at: string | null;
    source: string | null;
    source_id: string | null;
    source_url: string | null;
  };
  deals: Array<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    is_open: boolean;
    close_date: string | null;
    owner_email: string;
    health_status: 'healthy' | 'at-risk' | 'critical';
  }>;
  deal_summary: {
    open_count: number;
    open_pipeline: number;
    won_count: number;
    won_revenue: number;
    lost_count: number;
    avg_deal_size: number;
  };
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    role: string | null;
    seniority: string;
    buying_role: string | null;
    last_activity_date: string | null;
    conversation_count: number;
    engagement_level: 'active' | 'fading' | 'dark';
    engagement_status: 'active' | 'dark' | 'unknown';
  }>;
  contact_map: {
    total: number;
    by_seniority: Record<string, number>;
    by_role: Record<string, number>;
    engaged: number;
    dark: number;
  };
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    duration_minutes: number | null;
    participants: string[];
    linked_deal_name: string | null;
    link_method: string | null;
    source: string;
    summary: string | null;
  }>;
  relationship_summary: {
    total_deals: number;
    open_deals: number;
    total_value: number;
    open_value: number;
    won_value: number;
    lost_value: number;
    first_interaction: string | null;
    last_interaction: string | null;
    total_conversations: number;
    unique_contacts: number;
  };
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    deal_name: string | null;
    found_at: string | null;
  }>;
  relationship_health: {
    overall: 'healthy' | 'at_risk' | 'declining' | 'cold';
    engagement_trend: 'increasing' | 'stable' | 'decreasing' | 'no_data';
    total_conversations: number;
    conversations_last_30d: number;
    conversations_last_90d: number;
    unique_contacts_engaged: number;
    total_contacts_known: number;
    coverage_percentage: number;
    days_since_last_interaction: number | null;
    coverage_gaps: string[];
  };
  annotations: Array<{
    id: string;
    annotation_type: string;
    content: string;
    source: string;
    created_at: string;
    created_by: string | null;
    expires_at: string | null;
  }>;
  hasUserContext: boolean;
  data_availability: {
    has_deals: boolean;
    has_contacts: boolean;
    has_conversations: boolean;
    has_findings: boolean;
  };
  narrative: string | null;
  metadata: {
    assembled_at: string;
    data_sources_consulted: string[];
    assembly_duration_ms: number;
  };
}

async function getAccountById(workspaceId: string, accountId: string) {
  const result = await query(
    `SELECT id, name, domain, industry, employee_count, annual_revenue, owner, created_at, source, source_id
     FROM accounts
     WHERE id = $1 AND workspace_id = $2`,
    [accountId, workspaceId]
  );
  return result.rows[0] || null;
}

async function getDealsForAccount(workspaceId: string, accountId: string) {
  const result = await query(
    `SELECT id, name, amount, stage, stage_normalized, close_date, owner
     FROM deals
     WHERE workspace_id = $1 AND account_id = $2
     ORDER BY created_at DESC`,
    [workspaceId, accountId]
  );
  return result.rows;
}

async function getContactsForAccount(workspaceId: string, accountId: string) {
  const result = await query(
    `SELECT DISTINCT ON (c.id) c.id,
            COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '') as name,
            c.email, c.title, dc.role, dc.buying_role, dc.seniority_verified,
            c.last_activity_date
     FROM contacts c
     LEFT JOIN deal_contacts dc ON dc.contact_id = c.id AND dc.workspace_id = $1
     WHERE c.workspace_id = $1 AND c.account_id = $2
     ORDER BY c.id, dc.is_primary DESC NULLS LAST`,
    [workspaceId, accountId]
  );
  return result.rows;
}

async function getConversationsForAccount(workspaceId: string, accountId: string) {
  const result = await query(
    `SELECT cv.id, cv.title, cv.call_date, cv.duration_seconds, cv.participants,
            cv.link_method, cv.source, cv.summary,
            d.name as linked_deal_name
     FROM conversations cv
     LEFT JOIN deals d ON cv.deal_id = d.id AND d.workspace_id = $1
     WHERE cv.workspace_id = $1 AND cv.account_id = $2
     ORDER BY cv.call_date DESC
     LIMIT 30`,
    [workspaceId, accountId]
  );
  return result.rows;
}

async function getFindingsForAccount(workspaceId: string, accountId: string, dealIds: string[]) {
  const result = await query(
    `SELECT f.id, f.severity, f.category, f.message, f.found_at, d.name as deal_name
     FROM findings f
     LEFT JOIN deals d ON f.deal_id = d.id AND d.workspace_id = $1
     WHERE f.workspace_id = $1
       AND (f.account_id = $2 ${dealIds.length > 0 ? 'OR f.deal_id = ANY($3)' : ''})
       AND f.resolved_at IS NULL
     ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 WHEN 'info' THEN 4 ELSE 5 END`,
    dealIds.length > 0 ? [workspaceId, accountId, dealIds] : [workspaceId, accountId]
  );
  return result.rows;
}

function computeRelationshipSummary(
  deals: any[],
  conversations: any[],
  contacts: any[]
): AccountDossier['relationship_summary'] {
  const openDeals = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized));
  const wonDeals = deals.filter(d => d.stage_normalized === 'closed_won');
  const lostDeals = deals.filter(d => d.stage_normalized === 'closed_lost');

  const total_value = deals.reduce((s, d) => s + (d.amount || 0), 0);
  const open_value = openDeals.reduce((s, d) => s + (d.amount || 0), 0);
  const won_value = wonDeals.reduce((s, d) => s + (d.amount || 0), 0);
  const lost_value = lostDeals.reduce((s, d) => s + (d.amount || 0), 0);

  let first_interaction: string | null = null;
  let last_interaction: string | null = null;
  if (conversations.length > 0) {
    const dates = conversations
      .map(cv => cv.call_date)
      .filter(Boolean)
      .map(d => new Date(d).getTime());
    if (dates.length > 0) {
      first_interaction = new Date(Math.min(...dates)).toISOString();
      last_interaction = new Date(Math.max(...dates)).toISOString();
    }
  }

  return {
    total_deals: deals.length,
    open_deals: openDeals.length,
    total_value,
    open_value,
    won_value,
    lost_value,
    first_interaction,
    last_interaction,
    total_conversations: conversations.length,
    unique_contacts: contacts.length,
  };
}

function classifySeniority(title: string | null): string {
  if (!title) return 'unknown';
  const t = title.toLowerCase();
  if (/\b(ceo|cfo|cto|coo|cro|cmo|chief|president|founder|partner)\b/.test(t)) return 'executive';
  if (/\b(vp|vice president|svp|evp|head of|director)\b/.test(t)) return 'senior_leader';
  if (/\b(manager|lead|senior|principal|supervisor)\b/.test(t)) return 'manager';
  if (/\b(analyst|specialist|associate|coordinator|engineer|developer|rep|representative)\b/.test(t)) return 'individual_contributor';
  return 'other';
}

function computeEngagementTrend(conversations: any[]): 'increasing' | 'stable' | 'declining' | 'unknown' {
  if (conversations.length < 2) return 'unknown';
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const recent = conversations.filter((cv: any) => {
    const d = cv.call_date ? new Date(cv.call_date).getTime() : 0;
    return d > 0 && (now - d) < thirtyDaysMs;
  }).length;
  const older = conversations.filter((cv: any) => {
    const d = cv.call_date ? new Date(cv.call_date).getTime() : 0;
    return d > 0 && (now - d) >= thirtyDaysMs && (now - d) < 2 * thirtyDaysMs;
  }).length;
  if (recent > older + 1) return 'increasing';
  if (older > recent + 1) return 'declining';
  return 'stable';
}

function computeEngagementLevel(lastActivityDate: string | null): 'active' | 'fading' | 'dark' {
  if (!lastActivityDate) return 'dark';
  const daysSince = (Date.now() - new Date(lastActivityDate).getTime()) / (1000*60*60*24);
  if (daysSince <= 14) return 'active';
  if (daysSince <= 30) return 'fading';
  return 'dark';
}

export async function assembleAccountDossier(
  workspaceId: string,
  accountId: string,
  options?: { includeNarrative?: boolean }
): Promise<AccountDossier> {
  const startTime = Date.now();
  const [account, deals, contacts, conversations, accountAnnotations] = await Promise.all([
    getAccountById(workspaceId, accountId),
    getDealsForAccount(workspaceId, accountId).catch(e => { console.error('[AccountDossier] deals error:', e.message); return []; }),
    getContactsForAccount(workspaceId, accountId).catch(e => { console.error('[AccountDossier] contacts error:', e.message); return []; }),
    getConversationsForAccount(workspaceId, accountId).catch(e => { console.error('[AccountDossier] conversations error:', e.message); return []; }),
    getActiveAnnotations(workspaceId, 'account', accountId).catch(() => []),
  ]);

  if (!account) {
    throw new Error(`Account ${accountId} not found in workspace ${workspaceId}`);
  }

  const dealIds = deals.map((d: any) => d.id);
  const openDeals = deals.filter((d: any) => !['closed_won', 'closed_lost'].includes(d.stage_normalized));
  const openDealIds = openDeals.map((d: any) => d.id);

  const dealAnnotationResults = await Promise.all(
    dealIds.slice(0, 20).map((did: string) =>
      getActiveAnnotations(workspaceId, 'deal', did).catch(() => [])
    )
  );
  const dealAnnotations = dealAnnotationResults.flat();
  const annotations = [...accountAnnotations, ...dealAnnotations];

  const [findings, riskScores] = await Promise.all([
    getFindingsForAccount(workspaceId, accountId, dealIds),
    openDealIds.length > 0
      ? getBatchDealRiskScores(workspaceId, openDealIds).catch(() => [])
      : Promise.resolve([]),
  ]);

  const riskMap = new Map<string, { score: number; grade: string }>();
  for (const rs of riskScores) {
    riskMap.set(rs.deal_id, { score: rs.score, grade: rs.grade });
  }

  const relationship_summary = computeRelationshipSummary(deals, conversations, contacts);

  const participantEmails = new Set<string>();
  const participantCounts = new Map<string, number>();
  for (const cv of conversations) {
    if (Array.isArray(cv.participants)) {
      for (const p of cv.participants) {
        if (typeof p === 'string' && p.includes('@')) {
          const lower = p.toLowerCase();
          participantEmails.add(lower);
          participantCounts.set(lower, (participantCounts.get(lower) || 0) + 1);
        }
      }
    }
  }

  const mappedContacts = contacts.map((c: any) => {
    const email = c.email || '';
    const isEngaged = email && participantEmails.has(email.toLowerCase());
    return {
      id: c.id,
      name: (c.name || '').trim(),
      email,
      title: c.title ?? null,
      role: c.role ?? null,
      seniority: classifySeniority(c.title),
      buying_role: c.buying_role ?? c.role ?? null,
      last_activity_date: c.last_activity_date ? new Date(c.last_activity_date).toISOString() : null,
      conversation_count: participantCounts.get((email || '').toLowerCase()) || 0,
      engagement_level: computeEngagementLevel(c.last_activity_date),
      engagement_status: (isEngaged ? 'active' : email ? 'dark' : 'unknown') as 'active' | 'dark' | 'unknown',
    };
  });

  const by_seniority: Record<string, number> = {};
  const by_role: Record<string, number> = {};
  for (const c of mappedContacts) {
    const seniority = classifySeniority(c.title);
    by_seniority[seniority] = (by_seniority[seniority] || 0) + 1;
    if (c.role) {
      by_role[c.role] = (by_role[c.role] || 0) + 1;
    }
  }
  const engaged = mappedContacts.filter(c => c.engagement_status === 'active').length;
  const dark = mappedContacts.filter(c => c.engagement_status === 'dark').length;

  const coverage_gaps: string[] = [];
  if (mappedContacts.length === 0) coverage_gaps.push('No contacts linked');
  else if (!by_seniority['executive'] && !by_seniority['senior_leader']) coverage_gaps.push('No executive or senior leader contacts');
  if (dark > 0 && dark >= mappedContacts.length * 0.5) coverage_gaps.push(`${dark} of ${mappedContacts.length} contacts have no recent calls`);
  if (conversations.length === 0) coverage_gaps.push('No conversations linked');

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const conversations_last_30d = conversations.filter((cv: any) => {
    const d = cv.call_date ? new Date(cv.call_date).getTime() : 0;
    return d > 0 && (now - d) < thirtyDaysMs;
  }).length;

  const conversations_last_90d = conversations.filter((cv: any) => {
    const d = cv.call_date ? new Date(cv.call_date).getTime() : 0;
    return d > 0 && (now - d) < ninetyDaysMs;
  }).length;

  const conversations_30_60d = conversations.filter((cv: any) => {
    const d = cv.call_date ? new Date(cv.call_date).getTime() : 0;
    return d > 0 && (now - d) >= thirtyDaysMs && (now - d) < 2 * thirtyDaysMs;
  }).length;

  let days_since_last_interaction: number | null = null;
  const convDates = conversations.map((cv: any) => cv.call_date ? new Date(cv.call_date).getTime() : 0).filter((t: number) => t > 0);
  if (convDates.length > 0) {
    days_since_last_interaction = Math.round((now - Math.max(...convDates)) / (1000*60*60*24));
  }

  const unique_contacts_engaged = participantEmails.size;
  const total_contacts_known = mappedContacts.length;
  const coverage_percentage = total_contacts_known > 0
    ? Math.round((unique_contacts_engaged / total_contacts_known) * 100)
    : 0;

  let engagement_trend: 'increasing' | 'stable' | 'decreasing' | 'no_data' = 'no_data';
  if (conversations_last_30d > 0 || conversations_30_60d > 0) {
    if (conversations_last_30d > conversations_30_60d * 1.2) engagement_trend = 'increasing';
    else if (conversations_30_60d > conversations_last_30d * 1.2) engagement_trend = 'decreasing';
    else engagement_trend = 'stable';
  }

  let overall: 'healthy' | 'at_risk' | 'declining' | 'cold' = 'cold';
  if (days_since_last_interaction !== null) {
    if (days_since_last_interaction > 60) {
      overall = 'cold';
    } else if (engagement_trend === 'decreasing' && days_since_last_interaction > 30) {
      overall = 'declining';
    } else if (engagement_trend === 'decreasing' || coverage_percentage < 30) {
      overall = 'at_risk';
    } else if ((engagement_trend === 'stable' || engagement_trend === 'increasing') && coverage_percentage > 50 && days_since_last_interaction < 14) {
      overall = 'healthy';
    } else {
      overall = 'at_risk';
    }
  } else if (conversations.length === 0) {
    overall = 'cold';
  }

  const wonDeals = deals.filter((d: any) => d.stage_normalized === 'closed_won');
  const lostDeals = deals.filter((d: any) => d.stage_normalized === 'closed_lost');
  const allAmounts = deals.filter((d: any) => d.amount > 0).map((d: any) => d.amount);

  return {
    account: {
      id: account.id,
      name: account.name || '',
      domain: account.domain ?? null,
      industry: account.industry ?? null,
      employee_count: account.employee_count ?? null,
      annual_revenue: account.annual_revenue ?? null,
      owner_email: account.owner ?? null,
      created_at: account.created_at ? new Date(account.created_at).toISOString() : null,
      source: account.source ?? null,
      source_id: account.source_id ?? null,
      source_url: null,
    },
    deals: deals.map((d: any) => {
      const isOpen = !['closed_won', 'closed_lost'].includes(d.stage_normalized);
      const risk = riskMap.get(d.id);
      let health_status: 'healthy' | 'at-risk' | 'critical' = 'healthy';
      if (isOpen && risk) {
        if (risk.score < 50) health_status = 'critical';
        else if (risk.score < 75) health_status = 'at-risk';
      }
      return {
        id: d.id,
        name: d.name || '',
        amount: d.amount || 0,
        stage: d.stage || '',
        is_open: isOpen,
        close_date: d.close_date ? new Date(d.close_date).toISOString() : null,
        owner_email: d.owner || '',
        health_status,
      };
    }),
    deal_summary: {
      open_count: openDeals.length,
      open_pipeline: openDeals.reduce((s: number, d: any) => s + (d.amount || 0), 0),
      won_count: wonDeals.length,
      won_revenue: wonDeals.reduce((s: number, d: any) => s + (d.amount || 0), 0),
      lost_count: lostDeals.length,
      avg_deal_size: allAmounts.length > 0 ? Math.round(allAmounts.reduce((a: number, b: number) => a + b, 0) / allAmounts.length) : 0,
    },
    contacts: mappedContacts,
    contact_map: {
      total: mappedContacts.length,
      by_seniority,
      by_role,
      engaged,
      dark,
    },
    conversations: conversations.map((cv: any) => ({
      id: cv.id,
      title: cv.title || '',
      date: cv.call_date ? new Date(cv.call_date).toISOString() : '',
      duration_minutes: cv.duration_seconds != null ? Math.round(cv.duration_seconds / 60) : null,
      participants: Array.isArray(cv.participants) ? cv.participants : [],
      linked_deal_name: cv.linked_deal_name ?? null,
      link_method: cv.link_method ?? null,
      source: cv.source ?? 'unknown',
      summary: cv.summary ?? null,
    })),
    relationship_summary,
    findings: findings.map((f: any) => ({
      id: f.id,
      severity: f.severity || '',
      category: f.category || '',
      message: f.message || '',
      deal_name: f.deal_name ?? null,
      found_at: f.found_at ? new Date(f.found_at).toISOString() : null,
    })),
    relationship_health: {
      overall,
      engagement_trend,
      total_conversations: conversations.length,
      conversations_last_30d,
      conversations_last_90d,
      unique_contacts_engaged,
      total_contacts_known,
      coverage_percentage,
      days_since_last_interaction,
      coverage_gaps,
    },
    annotations: annotations.map((a: any) => ({
      id: a.id,
      annotation_type: a.annotation_type,
      content: a.content,
      source: a.source,
      created_at: a.created_at ? new Date(a.created_at).toISOString() : '',
      created_by: a.created_by ?? null,
      expires_at: a.expires_at ? new Date(a.expires_at).toISOString() : null,
    })),
    hasUserContext: annotations.length > 0,
    data_availability: {
      has_deals: deals.length > 0,
      has_contacts: contacts.length > 0,
      has_conversations: conversations.length > 0,
      has_findings: findings.length > 0,
    },
    narrative: null,
    metadata: {
      assembled_at: new Date().toISOString(),
      data_sources_consulted: ['accounts', 'deals', 'contacts', 'deal_contacts', 'conversations', 'findings'],
      assembly_duration_ms: Date.now() - startTime,
    },
  };
}
