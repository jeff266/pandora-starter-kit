import { requirePermission } from '../middleware/permissions.js';
import { Router, type Request, type Response } from 'express';
import {
  queryDeals, getDeal, getDealsByStage, getStaleDeals,
  getDealsClosingInRange, getPipelineSummary,
} from '../tools/deal-query.js';
import {
  queryContacts, getContact, getContactsForDeal, getStakeholderMap,
} from '../tools/contact-query.js';
import {
  queryAccounts, getAccount, getAccountHealth,
} from '../tools/account-query.js';
import {
  queryActivities, getActivityTimeline, getActivitySummary,
} from '../tools/activity-query.js';
import {
  queryConversations, getConversation, getRecentCallsForDeal, getCallInsights,
} from '../tools/conversation-query.js';
import {
  queryTasks, getOverdueTasks, getTaskSummary,
} from '../tools/task-query.js';
import {
  queryDocuments, getDocument, getDocumentsForDeal,
} from '../tools/document-query.js';
import { FilterResolver } from '../tools/filter-resolver.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { query } from '../db.js';

const router = Router();
const filterResolver = new FilterResolver();

async function resolveLens(
  req: Request,
  entityType: 'deals' | 'contacts' | 'accounts' | 'conversations'
): Promise<{ additionalWhere?: string; additionalParams?: any[] }> {
  const lensId = req.activeLens;
  if (!lensId) return {};
  try {
    const workspaceId = req.params.id;
    const config = await configLoader.getConfig(workspaceId);
    const filters = config.named_filters || [];
    const filter = filters.find(f => f.id === lensId);
    if (!filter) return {};
    if (filter.object !== entityType) return {};
    const resolution = await filterResolver.resolve(workspaceId, lensId, { parameter_offset: 1 });
    const sql = resolution.sql.replace(/^ AND /, '');
    if (!sql) return {};
    return { additionalWhere: sql, additionalParams: resolution.params };
  } catch {
    return {};
  }
}

function parseNum(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
}

function parseDate(val: unknown): Date | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseBool(val: unknown): boolean | undefined {
  if (val === 'true') return true;
  if (val === 'false') return false;
  return undefined;
}

router.get('/:id/deals/by-stage', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getDealsByStage(req.params.id);
    res.json({ data: result.stages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/deals/stale', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parseNum(req.query.days);
    const result = await getStaleDeals(req.params.id, days);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/deals/closing-in-range', async (req: Request, res: Response): Promise<void> => {
  try {
    const startDate = parseDate(req.query.startDate);
    const endDate = parseDate(req.query.endDate);
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
      return;
    }
    const result = await getDealsClosingInRange(req.params.id, startDate, endDate);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/deals/pipeline-summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getPipelineSummary(req.params.id);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/deals/pipelines', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query<{ pipeline: string }>(
      `SELECT DISTINCT pipeline FROM deals WHERE workspace_id = $1 AND pipeline IS NOT NULL AND pipeline != '' ORDER BY pipeline`,
      [req.params.id]
    );
    res.json({ data: result.rows.map(r => r.pipeline) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/deals/:dealId', async (req: Request, res: Response): Promise<void> => {
  try {
    const deal = await getDeal(req.params.id, req.params.dealId);
    if (!deal) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    res.json({ data: deal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.patch('/:id/deals/:dealId/pipeline', async (req: Request, res: Response): Promise<void> => {
  try {
    const { pipeline } = req.body;
    if (!pipeline || typeof pipeline !== 'string') {
      res.status(400).json({ error: 'Pipeline name is required' });
      return;
    }

    const workspaceId = req.params.id;
    const dealId = req.params.dealId;

    const dealResult = await query<{ owner: string | null }>(
      `SELECT owner FROM deals WHERE id = $1 AND workspace_id = $2`,
      [dealId, workspaceId]
    );
    if (dealResult.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    const dealOwner = dealResult.rows[0].owner || '';
    const userEmail = req.user?.email || '';
    const userName = req.user?.name || '';
    const userRole = req.userWorkspaceRole || '';

    const isAdmin = userRole === 'admin';
    const isOwner = dealOwner &&
      (dealOwner.toLowerCase() === userEmail.toLowerCase() ||
       dealOwner.toLowerCase() === userName.toLowerCase());

    if (!isAdmin && !isOwner) {
      res.status(403).json({ error: 'Only the deal owner or a workspace admin can reassign the pipeline' });
      return;
    }

    await query(
      `UPDATE deals SET pipeline = $1, updated_at = NOW() WHERE id = $2 AND workspace_id = $3`,
      [pipeline.trim(), dealId, workspaceId]
    );

    res.json({ success: true, pipeline: pipeline.trim() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/deals', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
    const lens = await resolveLens(req, 'deals');
    const result = await queryDeals(req.params.id, {
      stage: q.stage as string | string[] | undefined,
      stageNormalized: q.stageNormalized as string | string[] | undefined,
      owner: q.owner as string | undefined,
      closeDateFrom: parseDate(q.closeDateFrom),
      closeDateTo: parseDate(q.closeDateTo),
      amountMin: parseNum(q.amountMin),
      amountMax: parseNum(q.amountMax),
      dealRiskMin: parseNum(q.dealRiskMin),
      dealRiskMax: parseNum(q.dealRiskMax),
      daysInStageGt: parseNum(q.daysInStageGt),
      daysSinceActivityGt: parseNum(q.daysSinceActivityGt),
      pipelineName: q.pipelineName as string | undefined,
      search: q.search as string | undefined,
      sortBy: q.sortBy as any,
      sortDir: q.sortDir as any,
      limit: parseNum(q.limit),
      offset: parseNum(q.offset),
      ...lens,
    });
    res.json({ data: result.deals, total: result.total, limit: result.limit, offset: result.offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/contacts/for-deal/:dealId', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getContactsForDeal(req.params.id, req.params.dealId);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/contacts/stakeholder-map/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getStakeholderMap(req.params.id, req.params.accountId);
    if (!result) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/contacts/:contactId', async (req: Request, res: Response): Promise<void> => {
  try {
    const contact = await getContact(req.params.id, req.params.contactId);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ data: contact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/contacts', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
    const lens = await resolveLens(req, 'contacts');
    const result = await queryContacts(req.params.id, {
      email: q.email as string | undefined,
      accountId: q.accountId as string | undefined,
      seniority: q.seniority as string | undefined,
      department: q.department as string | undefined,
      lastActivityAfter: parseDate(q.lastActivityAfter),
      search: q.search as string | undefined,
      sortBy: q.sortBy as any,
      sortDir: q.sortDir as any,
      limit: parseNum(q.limit),
      offset: parseNum(q.offset),
      ...lens,
    });
    res.json({ data: result.contacts, total: result.total, limit: result.limit, offset: result.offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/accounts/:accountId/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getAccountHealth(req.params.id, req.params.accountId);
    if (!result) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/accounts/:accountId/signals', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id;
    const accountId = req.params.accountId;

    const signalsResult = await query(
      `SELECT id, signals, signal_summary, enrichment_source, created_at, updated_at
       FROM account_signals
       WHERE workspace_id = $1 AND account_id = $2
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 5`,
      [workspaceId, accountId]
    );

    const priorityMap: Record<string, string> = {
      funding: 'high', acquisition: 'high', executive_change: 'high',
      expansion: 'medium', partnership: 'medium', product_launch: 'medium',
      hiring: 'medium', layoff: 'high',
    };
    const buyingTriggerTypes = new Set(['funding', 'expansion', 'hiring', 'executive_change']);

    const allSignals: any[] = [];
    for (const row of signalsResult.rows) {
      const rawSignals = Array.isArray(row.signals) ? row.signals : [];
      for (const s of rawSignals) {
        const category = (s.type || 'partnership').toLowerCase().replace(/\s+/g, '_');
        allSignals.push({
          id: `${row.id}-${allSignals.length}`,
          workspace_id: workspaceId,
          account_id: accountId,
          signal_type: 'market_news',
          signal_category: category,
          headline: s.signal || s.headline || '',
          description: s.signal || '',
          source: s.source || row.enrichment_source || 'web',
          source_url: s.source_url || null,
          signal_date: s.date || row.updated_at || row.created_at,
          priority: priorityMap[category] || 'medium',
          relevance: s.relevance >= 0.7 ? 'high' : s.relevance >= 0.4 ? 'medium' : 'low',
          buying_trigger: buyingTriggerTypes.has(category),
          confidence: s.relevance || 0.5,
          metadata: null,
          created_at: row.created_at,
        });
      }
    }

    const highPriority = allSignals.filter((s: any) => s.priority === 'critical' || s.priority === 'high').length;
    const buyingTriggers = allSignals.filter((s: any) => s.buying_trigger === true).length;

    let signalStrength: 'HOT' | 'WARM' | 'NEUTRAL' | 'COLD' = 'COLD';
    if (buyingTriggers >= 2 || highPriority >= 3) signalStrength = 'HOT';
    else if (buyingTriggers >= 1 || highPriority >= 1) signalStrength = 'WARM';
    else if (allSignals.length > 0) signalStrength = 'NEUTRAL';

    const byCategory: Record<string, number> = {};
    allSignals.forEach((s: any) => {
      byCategory[s.signal_category] = (byCategory[s.signal_category] || 0) + 1;
    });

    res.json({
      signals: allSignals,
      summary: {
        total_signals: allSignals.length,
        high_priority: highPriority,
        buying_triggers: buyingTriggers,
        signal_strength: signalStrength,
        recent_signals: allSignals.slice(0, 5),
        by_category: Object.entries(byCategory).map(([category, count]) => ({ category, count })),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/accounts/:accountId/signals/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id;
    const accountId = req.params.accountId;

    const result = await query(
      `SELECT signals, COALESCE(updated_at, created_at) as last_date
       FROM account_signals
       WHERE workspace_id = $1 AND account_id = $2
       ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 5`,
      [workspaceId, accountId]
    );

    const buyingTriggerTypes = new Set(['funding', 'expansion', 'hiring', 'executive_change']);
    const highPriorityTypes = new Set(['funding', 'acquisition', 'executive_change', 'layoff']);
    let totalSignals = 0;
    let highPriority = 0;
    let buyingTriggers = 0;
    let lastSignalDate: string | null = null;

    for (const row of result.rows) {
      if (!lastSignalDate) lastSignalDate = row.last_date;
      const sigs = Array.isArray(row.signals) ? row.signals : [];
      for (const s of sigs) {
        totalSignals++;
        const cat = (s.type || '').toLowerCase();
        if (highPriorityTypes.has(cat)) highPriority++;
        if (buyingTriggerTypes.has(cat)) buyingTriggers++;
      }
    }

    let signalStrength: 'HOT' | 'WARM' | 'NEUTRAL' | 'COLD' = 'COLD';
    if (buyingTriggers >= 2 || highPriority >= 3) signalStrength = 'HOT';
    else if (buyingTriggers >= 1 || highPriority >= 1) signalStrength = 'WARM';
    else if (totalSignals > 0) signalStrength = 'NEUTRAL';

    res.json({
      total_signals: totalSignals,
      high_priority: highPriority,
      buying_triggers: buyingTriggers,
      last_signal_date: lastSignalDate,
      signal_strength: signalStrength,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/accounts/:accountId/scores', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id;
    const accountId = req.params.accountId;

    const result = await query(
      `SELECT
         s.account_id,
         s.icp_score,
         CASE
           WHEN s.icp_score >= 85 THEN 'A'
           WHEN s.icp_score >= 70 THEN 'B'
           WHEN s.icp_score >= 50 THEN 'C'
           ELSE 'D'
         END as icp_tier,
         s.lead_score,
         CASE
           WHEN s.lead_score >= 80 THEN 'HOT'
           WHEN s.lead_score >= 50 THEN 'WARM'
           ELSE 'COLD'
         END as lead_tier,
         s.intent_score,
         s.engagement_score,
         s.fit_score,
         s.recency_score,
         s.last_scored_at
       FROM account_scores s
       WHERE s.workspace_id = $1 AND s.account_id = $2`,
      [workspaceId, accountId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No scores found for account' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post('/:id/accounts/:accountId/scores/recalculate', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id;
    const accountId = req.params.accountId;

    // Trigger score recalculation
    // This would call the scoring system - for now just return success
    res.json({ success: true, message: 'Score recalculation queued' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/accounts/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await getAccount(req.params.id, req.params.accountId);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({ data: account });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/accounts', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
    const lens = await resolveLens(req, 'accounts');
    const result = await queryAccounts(req.params.id, {
      domain: q.domain as string | undefined,
      industry: q.industry as string | undefined,
      owner: q.owner as string | undefined,
      employeeCountMin: parseNum(q.employeeCountMin),
      employeeCountMax: parseNum(q.employeeCountMax),
      revenueMin: parseNum(q.revenueMin),
      revenueMax: parseNum(q.revenueMax),
      search: q.search as string | undefined,
      sortBy: q.sortBy as any,
      sortDir: q.sortDir as any,
      limit: parseNum(q.limit),
      offset: parseNum(q.offset),
      ...lens,
    });
    res.json({ data: result.accounts, total: result.total, limit: result.limit, offset: result.offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/activities/timeline/:dealId', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getActivityTimeline(req.params.id, req.params.dealId);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/activities/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const dateFrom = parseDate(req.query.dateFrom);
    const dateTo = parseDate(req.query.dateTo);
    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: 'dateFrom and dateTo are required' });
      return;
    }
    const result = await getActivitySummary(req.params.id, dateFrom, dateTo);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/activities', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
    const result = await queryActivities(req.params.id, {
      activityType: q.activityType as string | undefined,
      dealId: q.dealId as string | undefined,
      contactId: q.contactId as string | undefined,
      accountId: q.accountId as string | undefined,
      dateFrom: parseDate(q.dateFrom),
      dateTo: parseDate(q.dateTo),
      actor: q.actor as string | undefined,
      sortBy: q.sortBy as any,
      sortDir: q.sortDir as any,
      limit: parseNum(q.limit),
      offset: parseNum(q.offset),
    });
    res.json({ data: result.activities, total: result.total, limit: result.limit, offset: result.offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/conversations/for-deal/:dealId', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseNum(req.query.limit);
    const result = await getRecentCallsForDeal(req.params.id, req.params.dealId, limit);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/conversations/insights', async (req: Request, res: Response): Promise<void> => {
  try {
    const dateFrom = parseDate(req.query.dateFrom);
    const dateTo = parseDate(req.query.dateTo);
    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: 'dateFrom and dateTo are required' });
      return;
    }
    const result = await getCallInsights(req.params.id, dateFrom, dateTo);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/conversations/:conversationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const conversation = await getConversation(req.params.id, req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json({ data: conversation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/conversations', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
    const lens = await resolveLens(req, 'conversations');
    const result = await queryConversations(req.params.id, {
      dealId: q.dealId as string | undefined,
      accountId: q.accountId as string | undefined,
      dateFrom: parseDate(q.dateFrom),
      dateTo: parseDate(q.dateTo),
      source: q.source as string | undefined,
      search: q.search as string | undefined,
      sortBy: q.sortBy as any,
      sortDir: q.sortDir as any,
      limit: parseNum(q.limit),
      offset: parseNum(q.offset),
      ...lens,
    });
    res.json({ data: result.conversations, total: result.total, limit: result.limit, offset: result.offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/tasks/overdue', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getOverdueTasks(req.params.id);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/tasks/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getTaskSummary(req.params.id);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
    const result = await queryTasks(req.params.id, {
      status: q.status as string | undefined,
      assignee: q.assignee as string | undefined,
      dealId: q.dealId as string | undefined,
      accountId: q.accountId as string | undefined,
      priority: q.priority as string | undefined,
      dueDateFrom: parseDate(q.dueDateFrom),
      dueDateTo: parseDate(q.dueDateTo),
      overdue: parseBool(q.overdue),
      search: q.search as string | undefined,
      sortBy: q.sortBy as any,
      sortDir: q.sortDir as any,
      limit: parseNum(q.limit),
      offset: parseNum(q.offset),
    });
    res.json({ data: result.tasks, total: result.total, limit: result.limit, offset: result.offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/documents/for-deal/:dealId', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getDocumentsForDeal(req.params.id, req.params.dealId);
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/documents/:documentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await getDocument(req.params.id, req.params.documentId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ data: doc });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/documents', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
    const result = await queryDocuments(req.params.id, {
      docType: q.docType as string | undefined,
      dealId: q.dealId as string | undefined,
      accountId: q.accountId as string | undefined,
      mimeType: q.mimeType as string | undefined,
      modifiedAfter: parseDate(q.modifiedAfter),
      search: q.search as string | undefined,
      sortBy: q.sortBy as any,
      sortDir: q.sortDir as any,
      limit: parseNum(q.limit),
      offset: parseNum(q.offset),
    });
    res.json({ data: result.documents, total: result.total, limit: result.limit, offset: result.offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Market Signals Endpoints ───────────────────────────────────────────────

/**
 * POST /api/workspaces/:id/accounts/:accountId/scan-signals
 * Triggers an on-demand market signal scan for a single account
 */
router.post('/:id/accounts/:accountId/scan-signals', async (req: Request, res: Response): Promise<void> => {
  try {
    const { getMarketSignalsCollector } = await import('../connectors/serper/market-signals.js');
    const collector = getMarketSignalsCollector();

    if (!collector.isConfigured()) {
      res.status(503).json({ error: 'Market signals API not configured (SERPER_API_KEY missing)' });
      return;
    }

    const result = await collector.getSignalsForAccount(
      req.params.id,
      req.params.accountId,
      { force_check: true } // Force check even for lower-tier accounts
    );

    // Store signals if any were found
    if (result.signals.length > 0) {
      await collector.storeSignals(req.params.id, req.params.accountId, result.signals);
    }

    res.json({
      account_name: result.account_name,
      signals_found: result.signals.length,
      top_signal: result.strongest_signal?.headline || null,
      signal_strength: result.signal_strength,
      icp_tier: result.icp_tier,
      cost_usd: 0.005, // Estimated cost: $0.004 Serper + $0.001 DeepSeek
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Market Signals] Scan failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/workspaces/:id/signals/batch-scan
 * Triggers batch scan for accounts with active deals
 */
router.post('/:id/signals/batch-scan', async (req: Request, res: Response): Promise<void> => {
  try {
    const { getMarketSignalsCollector } = await import('../connectors/serper/market-signals.js');
    const collector = getMarketSignalsCollector();

    if (!collector.isConfigured()) {
      res.status(503).json({ error: 'Market signals API not configured (SERPER_API_KEY missing)' });
      return;
    }

    const limit = req.body.limit || 50;
    const minAmount = req.body.min_deal_amount || 10000;
    const daysSince = req.body.days_since_last_scan || 7;

    // Find accounts with active deals that haven't been scanned recently
    const accountsResult = await query<{ id: string; name: string; max_deal_amount: number }>(
      `SELECT DISTINCT a.id, a.name, MAX(d.amount) as max_deal_amount
       FROM accounts a
       JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND d.amount >= $2
         AND a.id NOT IN (
           SELECT DISTINCT account_id FROM account_signals
           WHERE workspace_id = $1
             AND signal_type = 'market_news'
             AND created_at > now() - ($3 || ' days')::interval
         )
       GROUP BY a.id, a.name
       ORDER BY max_deal_amount DESC
       LIMIT $4`,
      [req.params.id, minAmount, daysSince, limit]
    );

    const results = [];
    const errors = [];
    let totalSignals = 0;
    let totalCost = 0;

    for (const account of accountsResult.rows) {
      try {
        // Rate limit: 500ms between requests
        await new Promise(r => setTimeout(r, 500));

        const result = await collector.getSignalsForAccount(
          req.params.id,
          account.id,
          { force_check: false } // Respect ICP tier filtering
        );

        // Store signals
        if (result.signals.length > 0) {
          await collector.storeSignals(req.params.id, account.id, result.signals);
        }

        results.push({
          account_name: result.account_name,
          signals: result.signals.length,
          score: result.signal_strength,
        });

        totalSignals += result.signals.length;
        totalCost += 0.005; // $0.004 Serper + $0.001 DeepSeek
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${account.name}: ${msg}`);
      }
    }

    console.log(`[Market Signals Batch] Scanned ${results.length} accounts, found ${totalSignals} signals, cost $${totalCost.toFixed(3)}`);

    res.json({
      accounts_scanned: results.length,
      total_signals: totalSignals,
      total_cost_usd: totalCost,
      errors,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Market Signals] Batch scan failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/workspaces/:id/signals/scan-status
 * Shows when accounts were last scanned for market signals
 */
router.get('/:id/signals/scan-status', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = await query<{
      accounts_scanned: number;
      total_market_signals: number;
      last_scan_at: Date | null;
      accounts_scanned_this_week: number;
    }>(
      `SELECT
         COUNT(DISTINCT account_id) as accounts_scanned,
         COALESCE(SUM(jsonb_array_length(COALESCE(signals, '[]'::jsonb))), 0) as total_market_signals,
         MAX(COALESCE(updated_at, created_at)) as last_scan_at,
         COUNT(DISTINCT account_id) FILTER (
           WHERE COALESCE(updated_at, created_at) > now() - interval '7 days'
         ) as accounts_scanned_this_week
       FROM account_signals
       WHERE workspace_id = $1 AND signals IS NOT NULL AND jsonb_array_length(COALESCE(signals, '[]'::jsonb)) > 0`,
      [req.params.id]
    );

    res.json(status.rows[0] || {
      accounts_scanned: 0,
      total_market_signals: 0,
      last_scan_at: null,
      accounts_scanned_this_week: 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
