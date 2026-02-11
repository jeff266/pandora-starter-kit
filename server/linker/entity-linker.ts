import { query } from '../db.js';

export interface LinkResult {
  processed: number;
  linked: {
    tier1_email: number;
    tier2_native: number;
    tier3_inferred: number;
  };
  stillUnlinked: number;
  errors: string[];
  durationMs: number;
}

interface UnlinkedConversation {
  id: string;
  participants: Array<{ name?: string; email?: string; affiliation?: string }>;
  source_data: Record<string, unknown> | null;
  source: string;
  account_id: string | null;
  deal_id: string | null;
}

interface ContactMatch {
  contact_id: string;
  email: string;
  account_id: string | null;
}

interface BatchUpdate {
  id: string;
  account_id: string | null;
  deal_id: string | null;
  link_method: string;
}

export async function linkConversations(workspaceId: string): Promise<LinkResult> {
  const start = Date.now();
  const result: LinkResult = {
    processed: 0,
    linked: { tier1_email: 0, tier2_native: 0, tier3_inferred: 0 },
    stillUnlinked: 0,
    errors: [],
    durationMs: 0,
  };

  try {
    const tier1Count = await tier1EmailMatch(workspaceId, result);
    const tier2Count = await tier2NativeCRM(workspaceId, result);
    const tier3Count = await tier3DealInference(workspaceId, result);

    result.processed = tier1Count.examined + tier2Count.examined + tier3Count.examined;

    const stillUnlinked = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM conversations
       WHERE workspace_id = $1
         AND deal_id IS NULL AND account_id IS NULL
         AND linked_at IS NULL`,
      [workspaceId]
    );
    result.stillUnlinked = parseInt(stillUnlinked.rows[0].count, 10);

    await logLinkerRun(workspaceId, result, Date.now() - start);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Linker fatal: ${msg}`);
    console.error(`[Linker] Fatal error for ${workspaceId}:`, msg);
  }

  result.durationMs = Date.now() - start;
  return result;
}

async function tier1EmailMatch(
  workspaceId: string,
  result: LinkResult
): Promise<{ examined: number }> {
  const unlinked = await query<UnlinkedConversation>(
    `SELECT id, participants, source_data, source, account_id, deal_id
     FROM conversations
     WHERE workspace_id = $1
       AND (deal_id IS NULL OR account_id IS NULL)
       AND linked_at IS NULL`,
    [workspaceId]
  );

  if (unlinked.rows.length === 0) return { examined: 0 };

  const allEmails = new Set<string>();
  for (const conv of unlinked.rows) {
    if (!Array.isArray(conv.participants)) continue;
    for (const p of conv.participants) {
      if (p.email && typeof p.email === 'string') {
        allEmails.add(p.email.toLowerCase());
      }
    }
  }

  if (allEmails.size === 0) return { examined: unlinked.rows.length };

  const emailArray = Array.from(allEmails);
  const contacts = await query<ContactMatch>(
    `SELECT id as contact_id, email, account_id
     FROM contacts
     WHERE workspace_id = $1
       AND LOWER(email) = ANY($2::text[])`,
    [workspaceId, emailArray]
  );

  const emailToContact = new Map<string, ContactMatch>();
  for (const c of contacts.rows) {
    if (c.email) {
      emailToContact.set(c.email.toLowerCase(), c);
    }
  }

  if (emailToContact.size === 0) return { examined: unlinked.rows.length };

  const updates: BatchUpdate[] = [];

  for (const conv of unlinked.rows) {
    if (!Array.isArray(conv.participants) || conv.participants.length === 0) continue;

    let resolvedAccountId: string | null = null;

    const externals: ContactMatch[] = [];
    const internals: ContactMatch[] = [];
    const unknowns: ContactMatch[] = [];

    for (const p of conv.participants) {
      if (!p.email) continue;
      const match = emailToContact.get(p.email.toLowerCase());
      if (!match || !match.account_id) continue;

      if (p.affiliation === 'External') {
        externals.push(match);
      } else if (p.affiliation === 'Internal') {
        internals.push(match);
      } else {
        unknowns.push(match);
      }
    }

    if (externals.length > 0) {
      resolvedAccountId = externals[0].account_id;
    } else if (unknowns.length > 0) {
      resolvedAccountId = unknowns[0].account_id;
    } else if (internals.length > 0) {
      resolvedAccountId = internals[0].account_id;
    }

    if (resolvedAccountId && conv.account_id === null) {
      updates.push({
        id: conv.id,
        account_id: resolvedAccountId,
        deal_id: null,
        link_method: 'email_match',
      });
    }
  }

  if (updates.length > 0) {
    await batchUpdateConversations(workspaceId, updates);
    result.linked.tier1_email = updates.length;
  }

  return { examined: unlinked.rows.length };
}

async function tier2NativeCRM(
  workspaceId: string,
  result: LinkResult
): Promise<{ examined: number }> {
  const unlinked = await query<{ id: string; source: string; source_data: Record<string, unknown> | null; account_id: string | null; deal_id: string | null }>(
    `SELECT id, source, source_data, account_id, deal_id
     FROM conversations
     WHERE workspace_id = $1
       AND (account_id IS NULL OR deal_id IS NULL)
       AND linked_at IS NULL
       AND source_data IS NOT NULL`,
    [workspaceId]
  );

  if (unlinked.rows.length === 0) return { examined: 0 };

  const updates: BatchUpdate[] = [];

  for (const conv of unlinked.rows) {
    if (!conv.source_data || typeof conv.source_data !== 'object') continue;

    try {
      let crmDealId: string | null = null;
      let crmAccountId: string | null = null;

      if (conv.source === 'gong') {
        const context = conv.source_data.context as Record<string, unknown> | undefined;
        const crmContext = context?.crmContext as Record<string, unknown> | undefined;
        if (crmContext) {
          const objects = crmContext.crmObjects as Array<{ objectType?: string; objectId?: string }> | undefined;
          if (Array.isArray(objects)) {
            for (const obj of objects) {
              if (obj.objectType === 'Deal' || obj.objectType === 'Opportunity') {
                crmDealId = obj.objectId || null;
              }
              if (obj.objectType === 'Account' || obj.objectType === 'Company') {
                crmAccountId = obj.objectId || null;
              }
            }
          }
        }
      }

      if (conv.source === 'fireflies') {
        const appIntegrations = conv.source_data.app_integrations as Record<string, unknown> | undefined;
        if (appIntegrations) {
          const hubspot = appIntegrations.hubspot as Record<string, unknown> | undefined;
          const salesforce = appIntegrations.salesforce as Record<string, unknown> | undefined;
          if (hubspot?.dealId) crmDealId = String(hubspot.dealId);
          if (hubspot?.companyId) crmAccountId = String(hubspot.companyId);
          if (salesforce?.opportunityId) crmDealId = String(salesforce.opportunityId);
          if (salesforce?.accountId) crmAccountId = String(salesforce.accountId);
        }
      }

      let resolvedDealId: string | null = null;
      let resolvedAccountId: string | null = null;

      if (crmDealId) {
        const dealResult = await query<{ id: string; account_id: string | null }>(
          `SELECT id, account_id FROM deals
           WHERE workspace_id = $1 AND source_id = $2
           LIMIT 1`,
          [workspaceId, crmDealId]
        );
        if (dealResult.rows.length > 0) {
          resolvedDealId = dealResult.rows[0].id;
          resolvedAccountId = dealResult.rows[0].account_id;
        }
      }

      if (!resolvedAccountId && crmAccountId) {
        const acctResult = await query<{ id: string }>(
          `SELECT id FROM accounts
           WHERE workspace_id = $1 AND source_id = $2
           LIMIT 1`,
          [workspaceId, crmAccountId]
        );
        if (acctResult.rows.length > 0) {
          resolvedAccountId = acctResult.rows[0].id;
        }
      }

      const newAccountId = conv.account_id === null ? resolvedAccountId : null;
      const newDealId = conv.deal_id === null ? resolvedDealId : null;

      if (newAccountId || newDealId) {
        updates.push({
          id: conv.id,
          account_id: newAccountId,
          deal_id: newDealId,
          link_method: 'crm_native',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Tier2 error for conv ${conv.id}: ${msg}`);
    }
  }

  if (updates.length > 0) {
    await batchUpdateConversations(workspaceId, updates);
    result.linked.tier2_native = updates.length;
  }

  return { examined: unlinked.rows.length };
}

async function tier3DealInference(
  workspaceId: string,
  result: LinkResult
): Promise<{ examined: number }> {
  const withAccount = await query<{ id: string; account_id: string }>(
    `SELECT id, account_id
     FROM conversations
     WHERE workspace_id = $1
       AND account_id IS NOT NULL
       AND deal_id IS NULL`,
    [workspaceId]
  );

  if (withAccount.rows.length === 0) return { examined: 0 };

  const accountIds = [...new Set(withAccount.rows.map(r => r.account_id))];

  const openDeals = await query<{ id: string; account_id: string; name: string }>(
    `SELECT id, account_id, name
     FROM deals
     WHERE workspace_id = $1
       AND account_id = ANY($2::uuid[])
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId, accountIds]
  );

  const dealsByAccount = new Map<string, Array<{ id: string; name: string }>>();
  for (const deal of openDeals.rows) {
    if (!dealsByAccount.has(deal.account_id)) {
      dealsByAccount.set(deal.account_id, []);
    }
    dealsByAccount.get(deal.account_id)!.push({ id: deal.id, name: deal.name });
  }

  const updates: BatchUpdate[] = [];
  let ambiguousCount = 0;

  for (const conv of withAccount.rows) {
    const deals = dealsByAccount.get(conv.account_id);
    if (!deals || deals.length === 0) continue;

    if (deals.length === 1) {
      updates.push({
        id: conv.id,
        account_id: null,
        deal_id: deals[0].id,
        link_method: 'deal_inference',
      });
    } else {
      ambiguousCount++;
    }
  }

  if (ambiguousCount > 0) {
    console.log(`[Linker] ${ambiguousCount} conversations have ambiguous deal matches (2+ open deals at account)`);
  }

  if (updates.length > 0) {
    await batchUpdateDealOnly(workspaceId, updates);
    result.linked.tier3_inferred = updates.length;
  }

  return { examined: withAccount.rows.length };
}

async function batchUpdateConversations(workspaceId: string, updates: BatchUpdate[]): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    const ids = batch.map(u => u.id);
    const accountIds = batch.map(u => u.account_id);
    const dealIds = batch.map(u => u.deal_id);
    const methods = batch.map(u => u.link_method);

    await query(
      `UPDATE conversations AS c SET
        account_id = COALESCE(v.new_account_id::uuid, c.account_id),
        deal_id = COALESCE(v.new_deal_id::uuid, c.deal_id),
        link_method = v.method,
        linked_at = NOW(),
        updated_at = NOW()
      FROM (
        SELECT
          unnest($1::uuid[]) AS conv_id,
          unnest($2::text[]) AS new_account_id,
          unnest($3::text[]) AS new_deal_id,
          unnest($4::text[]) AS method
      ) AS v
      WHERE c.id = v.conv_id
        AND c.workspace_id = $5`,
      [ids, accountIds, dealIds, methods, workspaceId]
    );
  }
}

async function batchUpdateDealOnly(workspaceId: string, updates: BatchUpdate[]): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    const ids = batch.map(u => u.id);
    const dealIds = batch.map(u => u.deal_id);
    const methods = batch.map(u => u.link_method);

    await query(
      `UPDATE conversations AS c SET
        deal_id = v.new_deal_id::uuid,
        link_method = v.method,
        linked_at = NOW(),
        updated_at = NOW()
      FROM (
        SELECT
          unnest($1::uuid[]) AS conv_id,
          unnest($2::text[]) AS new_deal_id,
          unnest($3::text[]) AS method
      ) AS v
      WHERE c.id = v.conv_id
        AND c.workspace_id = $4
        AND c.deal_id IS NULL`,
      [ids, dealIds, methods, workspaceId]
    );
  }
}

async function logLinkerRun(workspaceId: string, result: LinkResult, durationMs: number): Promise<void> {
  const totalLinked = result.linked.tier1_email + result.linked.tier2_native + result.linked.tier3_inferred;

  try {
    const startedAt = new Date(Date.now() - durationMs);
    await query(
      `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, records_synced, errors, duration_ms, started_at, completed_at)
       VALUES ($1, 'linker', 'link', $2, $3, $4, $5, $6, NOW())`,
      [
        workspaceId,
        result.errors.length > 0 ? 'completed_with_errors' : 'completed',
        totalLinked,
        JSON.stringify({
          tier1_email: result.linked.tier1_email,
          tier2_native: result.linked.tier2_native,
          tier3_inferred: result.linked.tier3_inferred,
          stillUnlinked: result.stillUnlinked,
          processed: result.processed,
          errors: result.errors,
        }),
        durationMs,
        startedAt,
      ]
    );
  } catch (err) {
    console.error('[Linker] Failed to log run:', err instanceof Error ? err.message : err);
  }
}

export async function getLinkerStatus(workspaceId: string) {
  const statusResult = await query<{
    total_conversations: string;
    linked_to_deal: string;
    linked_to_account: string;
    fully_unlinked: string;
    via_email: string;
    via_crm: string;
    via_inference: string;
  }>(
    `SELECT
      COUNT(*) as total_conversations,
      COUNT(*) FILTER (WHERE deal_id IS NOT NULL) as linked_to_deal,
      COUNT(*) FILTER (WHERE account_id IS NOT NULL) as linked_to_account,
      COUNT(*) FILTER (WHERE linked_at IS NULL AND deal_id IS NULL AND account_id IS NULL) as fully_unlinked,
      COUNT(*) FILTER (WHERE link_method = 'email_match') as via_email,
      COUNT(*) FILTER (WHERE link_method = 'crm_native') as via_crm,
      COUNT(*) FILTER (WHERE link_method = 'deal_inference') as via_inference
    FROM conversations
    WHERE workspace_id = $1`,
    [workspaceId]
  );

  const row = statusResult.rows[0];
  return {
    total_conversations: parseInt(row.total_conversations, 10),
    linked_to_deal: parseInt(row.linked_to_deal, 10),
    linked_to_account: parseInt(row.linked_to_account, 10),
    fully_unlinked: parseInt(row.fully_unlinked, 10),
    via_email: parseInt(row.via_email, 10),
    via_crm: parseInt(row.via_crm, 10),
    via_inference: parseInt(row.via_inference, 10),
  };
}
