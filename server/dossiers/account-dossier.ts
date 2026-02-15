import { query } from '../db.js';

export interface AccountDossier {
  account: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    employee_count: number | null;
    annual_revenue: number | null;
    owner_email: string | null;
  };
  deals: Array<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    is_open: boolean;
    close_date: string | null;
    owner_email: string;
  }>;
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    role: string | null;
  }>;
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    duration_minutes: number | null;
    participants: string[];
    linked_deal_name: string | null;
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
  }>;
}

async function getAccountById(workspaceId: string, accountId: string) {
  const result = await query(
    `SELECT id, name, domain, industry, employee_count, annual_revenue, owner
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
            c.email, c.title, dc.role
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
            d.name as linked_deal_name
     FROM conversations cv
     LEFT JOIN deals d ON cv.deal_id = d.id AND d.workspace_id = $1
     WHERE cv.workspace_id = $1 AND cv.account_id = $2
     ORDER BY cv.call_date DESC
     LIMIT 20`,
    [workspaceId, accountId]
  );
  return result.rows;
}

async function getFindingsForAccount(workspaceId: string, accountId: string) {
  const result = await query(
    `SELECT f.id, f.severity, f.category, f.message, d.name as deal_name
     FROM findings f
     LEFT JOIN deals d ON f.deal_id = d.id AND d.workspace_id = $1
     WHERE f.workspace_id = $1 AND f.account_id = $2 AND f.resolved_at IS NULL
     ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 WHEN 'info' THEN 4 ELSE 5 END`,
    [workspaceId, accountId]
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

export async function assembleAccountDossier(workspaceId: string, accountId: string): Promise<AccountDossier> {
  const [account, deals, contacts, conversations, findings] = await Promise.all([
    getAccountById(workspaceId, accountId),
    getDealsForAccount(workspaceId, accountId),
    getContactsForAccount(workspaceId, accountId),
    getConversationsForAccount(workspaceId, accountId),
    getFindingsForAccount(workspaceId, accountId),
  ]);

  if (!account) {
    throw new Error(`Account ${accountId} not found in workspace ${workspaceId}`);
  }

  const relationship_summary = computeRelationshipSummary(deals, conversations, contacts);

  return {
    account: {
      id: account.id,
      name: account.name || '',
      domain: account.domain ?? null,
      industry: account.industry ?? null,
      employee_count: account.employee_count ?? null,
      annual_revenue: account.annual_revenue ?? null,
      owner_email: account.owner ?? null,
    },
    deals: deals.map((d: any) => ({
      id: d.id,
      name: d.name || '',
      amount: d.amount || 0,
      stage: d.stage || '',
      is_open: !['closed_won', 'closed_lost'].includes(d.stage_normalized),
      close_date: d.close_date ? new Date(d.close_date).toISOString() : null,
      owner_email: d.owner || '',
    })),
    contacts: contacts.map((c: any) => ({
      id: c.id,
      name: (c.name || '').trim(),
      email: c.email || '',
      title: c.title ?? null,
      role: c.role ?? null,
    })),
    conversations: conversations.map((cv: any) => ({
      id: cv.id,
      title: cv.title || '',
      date: cv.call_date ? new Date(cv.call_date).toISOString() : '',
      duration_minutes: cv.duration_seconds != null ? Math.round(cv.duration_seconds / 60) : null,
      participants: Array.isArray(cv.participants) ? cv.participants : [],
      linked_deal_name: cv.linked_deal_name ?? null,
    })),
    relationship_summary,
    findings: findings.map((f: any) => ({
      id: f.id,
      severity: f.severity || '',
      category: f.category || '',
      message: f.message || '',
      deal_name: f.deal_name ?? null,
    })),
  };
}
