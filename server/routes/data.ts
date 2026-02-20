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

const router = Router();

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

router.get('/:id/deals', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query;
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

export default router;
