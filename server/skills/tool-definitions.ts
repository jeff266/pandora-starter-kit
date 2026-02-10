/**
 * Tool Registry for Agent Runtime
 *
 * Wraps every query function from server/tools/ and compute function from server/analysis/
 * into tool definitions that Claude's tool_use API can call.
 *
 * CRITICAL: workspaceId is NEVER in tool parameters - always extracted from execution context.
 * This prevents cross-tenant data access.
 */

import type { ToolDefinition, SkillExecutionContext } from './types.js';
import * as dealTools from '../tools/deal-query.js';
import * as contactTools from '../tools/contact-query.js';
import * as accountTools from '../tools/account-query.js';
import * as activityTools from '../tools/activity-query.js';
import * as conversationTools from '../tools/conversation-query.js';
import * as taskTools from '../tools/task-query.js';
import * as documentTools from '../tools/document-query.js';
import { generatePipelineSnapshot } from '../analysis/pipeline-snapshot.js';
import { computeFields } from '../computed-fields/engine.js';
import { resolveOwnerNames, resolveOwnerName } from '../utils/owner-resolver.js';
import {
  aggregateBy,
  bucketByThreshold,
  topNWithSummary,
  summarizeDeals,
  pickStaleDealFields,
  pickClosingSoonFields,
  resolveTimeWindows,
  comparePeriods,
  type TimeConfig,
  type TimeWindows,
} from '../analysis/aggregations.js';
import {
  getBusinessContext as fetchBusinessContext,
  getGoals,
  getDefinitions as fetchDefinitions,
  getMaturity as fetchMaturity,
  getContext,
} from '../context/index.js';
import { query } from '../db.js';

// ============================================================================
// Helper: Safe Tool Execution
// ============================================================================

async function safeExecute<T>(
  toolName: string,
  fn: () => Promise<T>,
  params: any
): Promise<T | { error: string }> {
  try {
    const result = await fn();
    const resultCount = Array.isArray(result) ? result.length : typeof result === 'object' && result !== null ? Object.keys(result).length : 0;
    console.log(`[Tool] ${toolName} called with ${JSON.stringify(params)} → ${resultCount} results`);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Tool Error] ${toolName}:`, errorMsg);
    return { error: errorMsg };
  }
}

// ============================================================================
// Deal Tools
// ============================================================================

const queryDeals: ToolDefinition = {
  name: 'queryDeals',
  description: 'Search deals with filters. Returns list of deals matching criteria. Use this to find deals by stage, owner, amount, risk, or staleness.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      stage: { type: 'string', description: 'Filter by stage name' },
      stageNormalized: { type: 'string', description: 'Filter by normalized stage (open, closed_won, closed_lost)' },
      owner: { type: 'string', description: 'Filter by deal owner' },
      amountMin: { type: 'number', description: 'Minimum deal amount' },
      amountMax: { type: 'number', description: 'Maximum deal amount' },
      dealRiskMin: { type: 'number', description: 'Minimum deal risk score (0-100)' },
      dealRiskMax: { type: 'number', description: 'Maximum deal risk score (0-100)' },
      daysInStageGt: { type: 'number', description: 'Deals in current stage longer than N days' },
      daysSinceActivityGt: { type: 'number', description: 'Deals with no activity in last N days' },
      search: { type: 'string', description: 'Text search in deal name' },
      sortBy: { type: 'string', enum: ['amount', 'close_date', 'deal_risk', 'health_score', 'days_in_stage'], description: 'Sort field' },
      sortDir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
      limit: { type: 'number', description: 'Max results to return' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('queryDeals', () =>
      dealTools.queryDeals(context.workspaceId, params), params);
  },
};

const getDeal: ToolDefinition = {
  name: 'getDeal',
  description: 'Get a single deal by ID with all fields including computed scores.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'Deal ID to retrieve' },
    },
    required: ['dealId'],
  },
  execute: async (params, context) => {
    return safeExecute('getDeal', () =>
      dealTools.getDeal(context.workspaceId, params.dealId), params);
  },
};

const getDealsByStage: ToolDefinition = {
  name: 'getDealsByStage',
  description: 'Get deal counts and totals grouped by stage and pipeline.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getDealsByStage', () =>
      dealTools.getDealsByStage(context.workspaceId), params);
  },
};

const getStaleDeals: ToolDefinition = {
  name: 'getStaleDeals',
  description: 'Get deals with no recent activity (stale threshold from context or parameter).',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      staleDays: { type: 'number', description: 'Days without activity to consider stale (default from context)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getStaleDeals', () =>
      dealTools.getStaleDeals(context.workspaceId, params.staleDays), params);
  },
};

const getDealsClosingInRange: ToolDefinition = {
  name: 'getDealsClosingInRange',
  description: 'Get deals with close dates within a date range.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start date (ISO format)' },
      endDate: { type: 'string', description: 'End date (ISO format)' },
    },
    required: ['startDate', 'endDate'],
  },
  execute: async (params, context) => {
    return safeExecute('getDealsClosingInRange', () =>
      dealTools.getDealsClosingInRange(context.workspaceId, new Date(params.startDate), new Date(params.endDate)), params);
  },
};

const getPipelineSummary: ToolDefinition = {
  name: 'getPipelineSummary',
  description: 'Get aggregate pipeline metrics: total value, weighted value, deal counts, averages.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getPipelineSummary', () =>
      dealTools.getPipelineSummary(context.workspaceId), params);
  },
};

// ============================================================================
// Contact Tools
// ============================================================================

const queryContacts: ToolDefinition = {
  name: 'queryContacts',
  description: 'Search contacts with filters. Returns list of contacts.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      email: { type: 'string', description: 'Filter by email' },
      lifecycleStage: { type: 'string', description: 'Filter by lifecycle stage' },
      seniority: { type: 'string', description: 'Filter by seniority level' },
      department: { type: 'string', description: 'Filter by department' },
      search: { type: 'string', description: 'Text search in name or email' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('queryContacts', () =>
      contactTools.queryContacts(context.workspaceId, params), params);
  },
};

const getContact: ToolDefinition = {
  name: 'getContact',
  description: 'Get a single contact by ID.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      contactId: { type: 'string', description: 'Contact ID to retrieve' },
    },
    required: ['contactId'],
  },
  execute: async (params, context) => {
    return safeExecute('getContact', () =>
      contactTools.getContact(context.workspaceId, params.contactId), params);
  },
};

const getContactsForDeal: ToolDefinition = {
  name: 'getContactsForDeal',
  description: 'Get all contacts associated with a specific deal.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'Deal ID' },
    },
    required: ['dealId'],
  },
  execute: async (params, context) => {
    return safeExecute('getContactsForDeal', () =>
      contactTools.getContactsForDeal(context.workspaceId, params.dealId), params);
  },
};

const getStakeholderMap: ToolDefinition = {
  name: 'getStakeholderMap',
  description: 'Get contacts for an account grouped by seniority/role (stakeholder map).',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'Account ID' },
    },
    required: ['accountId'],
  },
  execute: async (params, context) => {
    return safeExecute('getStakeholderMap', () =>
      contactTools.getStakeholderMap(context.workspaceId, params.accountId), params);
  },
};

// ============================================================================
// Account Tools
// ============================================================================

const queryAccounts: ToolDefinition = {
  name: 'queryAccounts',
  description: 'Search accounts/companies with filters.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      domain: { type: 'string', description: 'Filter by domain' },
      industry: { type: 'string', description: 'Filter by industry' },
      search: { type: 'string', description: 'Text search in name' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('queryAccounts', () =>
      accountTools.queryAccounts(context.workspaceId, params), params);
  },
};

const getAccount: ToolDefinition = {
  name: 'getAccount',
  description: 'Get a single account by ID with summary stats (deal count, contact count).',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'Account ID' },
    },
    required: ['accountId'],
  },
  execute: async (params, context) => {
    return safeExecute('getAccount', () =>
      accountTools.getAccount(context.workspaceId, params.accountId), params);
  },
};

const getAccountHealth: ToolDefinition = {
  name: 'getAccountHealth',
  description: 'Get health metrics across all deals for an account.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'Account ID' },
    },
    required: ['accountId'],
  },
  execute: async (params, context) => {
    return safeExecute('getAccountHealth', () =>
      accountTools.getAccountHealth(context.workspaceId, params.accountId), params);
  },
};

// ============================================================================
// Activity Tools
// ============================================================================

const queryActivities: ToolDefinition = {
  name: 'queryActivities',
  description: 'Search activities (emails, calls, meetings, notes) with filters.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'Filter by deal' },
      contactId: { type: 'string', description: 'Filter by contact' },
      activityType: { type: 'string', description: 'Filter by activity type' },
      startDate: { type: 'string', description: 'Filter activities after this date' },
      endDate: { type: 'string', description: 'Filter activities before this date' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: [],
  },
  execute: async (params, context) => {
    const filters = { ...params };
    if (filters.startDate) filters.startDate = new Date(filters.startDate);
    if (filters.endDate) filters.endDate = new Date(filters.endDate);
    return safeExecute('queryActivities', () =>
      activityTools.queryActivities(context.workspaceId, filters), params);
  },
};

const getActivityTimeline: ToolDefinition = {
  name: 'getActivityTimeline',
  description: 'Get chronological activity timeline for a deal.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'Deal ID' },
    },
    required: ['dealId'],
  },
  execute: async (params, context) => {
    return safeExecute('getActivityTimeline', () =>
      activityTools.getActivityTimeline(context.workspaceId, params.dealId), params);
  },
};

const getActivitySummary: ToolDefinition = {
  name: 'getActivitySummary',
  description: 'Get activity counts by type and by rep for a time period.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Look back N days (default 7)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    const days = params.days || 7;
    const dateTo = new Date();
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return safeExecute('getActivitySummary', () =>
      activityTools.getActivitySummary(context.workspaceId, dateFrom, dateTo), params);
  },
};

// ============================================================================
// Conversation Tools
// ============================================================================

const queryConversations: ToolDefinition = {
  name: 'queryConversations',
  description: 'Search call/meeting recordings and transcripts with filters.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'Filter by deal' },
      startDate: { type: 'string', description: 'Filter conversations after this date' },
      endDate: { type: 'string', description: 'Filter conversations before this date' },
      hasTranscript: { type: 'boolean', description: 'Only conversations with transcripts' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: [],
  },
  execute: async (params, context) => {
    const filters = { ...params };
    if (filters.startDate) filters.startDate = new Date(filters.startDate);
    if (filters.endDate) filters.endDate = new Date(filters.endDate);
    return safeExecute('queryConversations', () =>
      conversationTools.queryConversations(context.workspaceId, filters), params);
  },
};

const getConversation: ToolDefinition = {
  name: 'getConversation',
  description: 'Get full conversation details including transcript.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      conversationId: { type: 'string', description: 'Conversation ID' },
    },
    required: ['conversationId'],
  },
  execute: async (params, context) => {
    return safeExecute('getConversation', () =>
      conversationTools.getConversation(context.workspaceId, params.conversationId), params);
  },
};

const getRecentCallsForDeal: ToolDefinition = {
  name: 'getRecentCallsForDeal',
  description: 'Get recent calls/meetings for a specific deal.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'Deal ID' },
      limit: { type: 'number', description: 'Max results (default 5)' },
    },
    required: ['dealId'],
  },
  execute: async (params, context) => {
    return safeExecute('getRecentCallsForDeal', () =>
      conversationTools.getRecentCallsForDeal(context.workspaceId, params.dealId, params.limit), params);
  },
};

const getCallInsights: ToolDefinition = {
  name: 'getCallInsights',
  description: 'Get aggregate call metrics and trends.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Look back N days (default 30)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getCallInsights', () =>
      conversationTools.getCallInsights(context.workspaceId, params.days), params);
  },
};

// ============================================================================
// Task Tools
// ============================================================================

const queryTasks: ToolDefinition = {
  name: 'queryTasks',
  description: 'Search tasks with filters.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'], description: 'Filter by status' },
      priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], description: 'Filter by priority' },
      assignee: { type: 'string', description: 'Filter by assignee' },
      overdue: { type: 'boolean', description: 'Only overdue tasks' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('queryTasks', () =>
      taskTools.queryTasks(context.workspaceId, params), params);
  },
};

const getOverdueTasks: ToolDefinition = {
  name: 'getOverdueTasks',
  description: 'Get all overdue tasks.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getOverdueTasks', () =>
      taskTools.getOverdueTasks(context.workspaceId), params);
  },
};

const getTaskSummary: ToolDefinition = {
  name: 'getTaskSummary',
  description: 'Get task counts by status and priority.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getTaskSummary', () =>
      taskTools.getTaskSummary(context.workspaceId), params);
  },
};

// ============================================================================
// Document Tools
// ============================================================================

const queryDocuments: ToolDefinition = {
  name: 'queryDocuments',
  description: 'Search documents with filters.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      fileType: { type: 'string', description: 'Filter by file type' },
      search: { type: 'string', description: 'Text search in title or content' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('queryDocuments', () =>
      documentTools.queryDocuments(context.workspaceId, params), params);
  },
};

const getDocument: ToolDefinition = {
  name: 'getDocument',
  description: 'Get full document details including content.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'Document ID' },
    },
    required: ['documentId'],
  },
  execute: async (params, context) => {
    return safeExecute('getDocument', () =>
      documentTools.getDocument(context.workspaceId, params.documentId), params);
  },
};

const getDocumentsForDeal: ToolDefinition = {
  name: 'getDocumentsForDeal',
  description: 'Get documents linked to a specific deal.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'Deal ID' },
    },
    required: ['dealId'],
  },
  execute: async (params, context) => {
    return safeExecute('getDocumentsForDeal', () =>
      documentTools.getDocumentsForDeal(context.workspaceId, params.dealId), params);
  },
};

// ============================================================================
// Context Tools
// ============================================================================

const getBusinessContext: ToolDefinition = {
  name: 'getBusinessContext',
  description: 'Get workspace business model, GTM motion, ICP, pricing.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getBusinessContext', () =>
      fetchBusinessContext(context.workspaceId), params);
  },
};

const getGoalsAndTargets: ToolDefinition = {
  name: 'getGoalsAndTargets',
  description: 'Get quotas, KPIs, pipeline coverage targets, thresholds.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getGoalsAndTargets', () =>
      getGoals(context.workspaceId), params);
  },
};

const getDefinitions: ToolDefinition = {
  name: 'getDefinitions',
  description: 'Get stage definitions, qualified definition, methodology, terminology.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getDefinitions', () =>
      fetchDefinitions(context.workspaceId), params);
  },
};

const getMaturityScores: ToolDefinition = {
  name: 'getMaturityScores',
  description: 'Get operational maturity scores.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getMaturityScores', () =>
      fetchMaturity(context.workspaceId), params);
  },
};

// ============================================================================
// Compute Tools (Analysis Functions)
// ============================================================================

const computePipelineCoverage: ToolDefinition = {
  name: 'computePipelineCoverage',
  description: 'Compute pipeline coverage ratio (pipeline value ÷ quota target) and generate full snapshot.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      quota: { type: 'number', description: 'Quota target (optional, uses context if not provided)' },
      staleDaysThreshold: { type: 'number', description: 'Days to consider a deal stale (default from context)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('computePipelineCoverage', () =>
      generatePipelineSnapshot(context.workspaceId, params.quota, params.staleDaysThreshold), params);
  },
};

const refreshComputedFields: ToolDefinition = {
  name: 'refreshComputedFields',
  description: 'Recalculate all computed fields (deal risk, health, velocity scores) for the workspace.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('refreshComputedFields', () =>
      computeFields(context.workspaceId), params);
  },
};

// ============================================================================
// Aggregation Tools (for three-phase skill pattern)
// ============================================================================

const aggregateStaleDeals: ToolDefinition = {
  name: 'aggregateStaleDeals',
  description: 'Get stale deals pre-aggregated into summary, severity buckets, per-owner breakdown, and top N deals. Designed for LLM consumption.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      staleDays: { type: 'number', description: 'Days without activity to consider stale (default from context)' },
      topN: { type: 'number', description: 'Number of top deals to include (default 20)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('aggregateStaleDeals', async () => {
      const staleDays = params.staleDays || 14;
      const topN = params.topN || 20;
      const [deals, nameMap] = await Promise.all([
        dealTools.getStaleDeals(context.workspaceId, staleDays),
        resolveOwnerNames(context.workspaceId),
      ]);

      const staleItems = deals.map(pickStaleDealFields).map(d => ({
        ...d, owner: resolveOwnerName(d.owner, nameMap),
      }));
      const summary = summarizeDeals(deals);
      const avgDaysStale = staleItems.length > 0
        ? Math.round(staleItems.reduce((s, d) => s + d.daysStale, 0) / staleItems.length)
        : 0;

      const bySeverity = bucketByThreshold(
        staleItems,
        d => d.daysStale,
        d => d.amount,
        [7, 14, 30],
        ['watch', 'warning', 'serious', 'critical']
      );

      const byOwner = aggregateBy(staleItems, d => d.owner, d => d.amount);
      const byStage = aggregateBy(staleItems, d => d.stage, d => d.amount);

      const { topItems, remaining } = topNWithSummary(
        staleItems, topN, d => d.amount, d => d.amount
      );

      return {
        summary: { total: summary.total, totalValue: summary.totalValue, avgDaysStale },
        bySeverity,
        byOwner,
        byStage,
        topDeals: topItems,
        remaining,
      };
    }, params);
  },
};

const aggregateClosingSoon: ToolDefinition = {
  name: 'aggregateClosingSoon',
  description: 'Get deals closing in a date range, pre-aggregated into summary and top N deals for LLM consumption.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      daysAhead: { type: 'number', description: 'Days ahead to look (default 30)' },
      topN: { type: 'number', description: 'Number of top deals to include (default 10)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('aggregateClosingSoon', async () => {
      const daysAhead = params.daysAhead || 30;
      const topN = params.topN || 10;
      const startDate = new Date();
      const endDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

      const [deals, nameMap] = await Promise.all([
        dealTools.getDealsClosingInRange(context.workspaceId, startDate, endDate),
        resolveOwnerNames(context.workspaceId),
      ]);
      const closingItems = deals.map(pickClosingSoonFields).map(d => ({
        ...d, owner: resolveOwnerName(d.owner, nameMap),
      }));
      const summary = summarizeDeals(deals);

      const { topItems, remaining } = topNWithSummary(
        closingItems, topN, d => d.amount, d => d.amount
      );

      return {
        summary: { total: summary.total, totalValue: summary.totalValue },
        byStage: summary.byStage,
        topDeals: topItems,
        remaining,
      };
    }, params);
  },
};

const computeOwnerPerformance: ToolDefinition = {
  name: 'computeOwnerPerformance',
  description: 'Compute per-rep performance summary: open deals, pipeline value, stale deals, activity count, stale rate.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      staleDays: { type: 'number', description: 'Stale threshold in days (default 14)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('computeOwnerPerformance', async () => {
      const staleDays = params.staleDays || 14;

      const [allDealsResult, staleDeals, nameMap] = await Promise.all([
        dealTools.queryDeals(context.workspaceId, { limit: 5000 }),
        dealTools.getStaleDeals(context.workspaceId, staleDays),
        resolveOwnerNames(context.workspaceId),
      ]);

      const allDeals = allDealsResult.deals || [];
      const dateTo = new Date();
      const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const activityData = await activityTools.getActivitySummary(context.workspaceId, dateFrom, dateTo);

      const staleSet = new Set(staleDeals.map((d: any) => d.id));
      const ownerStats: Record<string, {
        openDeals: number;
        pipelineValue: number;
        staleDeals: number;
        staleValue: number;
        activityCount: number;
        staleRate: number;
      }> = {};

      for (const deal of allDeals) {
        const rawOwner = (deal as any).owner;
        const owner = resolveOwnerName(rawOwner, nameMap);
        if (!ownerStats[owner]) {
          ownerStats[owner] = { openDeals: 0, pipelineValue: 0, staleDeals: 0, staleValue: 0, activityCount: 0, staleRate: 0 };
        }
        ownerStats[owner].openDeals++;
        ownerStats[owner].pipelineValue += parseFloat((deal as any).amount) || 0;
        if (staleSet.has((deal as any).id)) {
          ownerStats[owner].staleDeals++;
          ownerStats[owner].staleValue += parseFloat((deal as any).amount) || 0;
        }
      }

      if (Array.isArray(activityData)) {
        for (const row of activityData) {
          const rawOwner = (row as any).owner || (row as any).rep;
          const owner = resolveOwnerName(rawOwner, nameMap);
          if (ownerStats[owner]) {
            ownerStats[owner].activityCount = parseInt((row as any).count || (row as any).total || '0', 10);
          }
        }
      }

      for (const stats of Object.values(ownerStats)) {
        stats.pipelineValue = Math.round(stats.pipelineValue);
        stats.staleValue = Math.round(stats.staleValue);
        stats.staleRate = stats.openDeals > 0
          ? Math.round((stats.staleDeals / stats.openDeals) * 100)
          : 0;
      }

      const sorted = Object.entries(ownerStats)
        .sort(([, a], [, b]) => b.staleRate - a.staleRate)
        .map(([owner, stats]) => ({ owner, ...stats }));

      return sorted;
    }, params);
  },
};

const resolveTimeWindowsTool: ToolDefinition = {
  name: 'resolveTimeWindows',
  description: 'Resolve time windows for skill execution based on timeConfig and last run timestamp.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      analysisWindow: {
        type: 'string',
        description: 'Analysis window mode',
        enum: ['current_quarter', 'current_month', 'trailing_90d', 'trailing_30d', 'all_time'],
      },
      changeWindow: {
        type: 'string',
        description: 'Change detection window',
        enum: ['since_last_run', 'last_7d', 'last_14d', 'last_30d'],
      },
      trendComparison: {
        type: 'string',
        description: 'Period comparison mode',
        enum: ['previous_period', 'same_period_last_quarter', 'none'],
      },
    },
    required: ['analysisWindow', 'changeWindow', 'trendComparison'],
  },
  execute: async (params, context) => {
    return safeExecute('resolveTimeWindows', async () => {
      // Use merged timeConfig from context (skill defaults + runtime overrides)
      const contextTimeConfig = (context.businessContext as any).timeConfig || {};
      const config: TimeConfig = {
        analysisWindow: params.analysisWindow || contextTimeConfig.analysisWindow || 'current_quarter',
        changeWindow: params.changeWindow || contextTimeConfig.changeWindow || 'last_7d',
        trendComparison: params.trendComparison || contextTimeConfig.trendComparison || 'previous_period',
      };

      // Query last successful run
      const lastRunResult = await query(
        `SELECT completed_at
         FROM skill_runs
         WHERE workspace_id = $1
           AND skill_id = $2
           AND status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`,
        [context.workspaceId, context.skillId]
      );

      const lastRunAt = lastRunResult.rows[0]?.completed_at || null;

      const windows = resolveTimeWindows(config, lastRunAt);

      return {
        analysisRange: {
          start: windows.analysisRange.start.toISOString(),
          end: windows.analysisRange.end.toISOString(),
        },
        changeRange: {
          start: windows.changeRange.start.toISOString(),
          end: windows.changeRange.end.toISOString(),
        },
        previousPeriodRange: windows.previousPeriodRange
          ? {
              start: windows.previousPeriodRange.start.toISOString(),
              end: windows.previousPeriodRange.end.toISOString(),
            }
          : null,
        lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
        config,
      };
    }, params);
  },
};

const gatherPeriodComparison: ToolDefinition = {
  name: 'gatherPeriodComparison',
  description: 'Compare pipeline metrics between current and previous period using resolved time windows.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      currentStart: { type: 'string', description: 'Current period start (ISO date, optional if time_windows in context)' },
      currentEnd: { type: 'string', description: 'Current period end (ISO date, optional if time_windows in context)' },
      previousStart: { type: 'string', description: 'Previous period start (ISO date, optional)' },
      previousEnd: { type: 'string', description: 'Previous period end (ISO date, optional)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('gatherPeriodComparison', async () => {
      // Read from time_windows step result if available
      const timeWindows = (context.stepResults as any).time_windows;

      const currentStart = params.currentStart
        ? new Date(params.currentStart)
        : timeWindows?.analysisRange?.start
        ? new Date(timeWindows.analysisRange.start)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      const currentEnd = params.currentEnd
        ? new Date(params.currentEnd)
        : timeWindows?.analysisRange?.end
        ? new Date(timeWindows.analysisRange.end)
        : new Date();

      const currentDeals = await dealTools.getDealsClosingInRange(
        context.workspaceId,
        currentStart,
        currentEnd
      );
      const currentSummary = summarizeDeals(currentDeals);

      const previousStart = params.previousStart
        ? new Date(params.previousStart)
        : timeWindows?.previousPeriodRange?.start
        ? new Date(timeWindows.previousPeriodRange.start)
        : null;

      const previousEnd = params.previousEnd
        ? new Date(params.previousEnd)
        : timeWindows?.previousPeriodRange?.end
        ? new Date(timeWindows.previousPeriodRange.end)
        : null;

      if (!previousStart || !previousEnd) {
        return comparePeriods(currentSummary, null);
      }

      const previousDeals = await dealTools.getDealsClosingInRange(
        context.workspaceId,
        previousStart,
        previousEnd
      );
      const previousSummary = summarizeDeals(previousDeals);

      return comparePeriods(currentSummary, previousSummary);
    }, params);
  },
};

const calculateOutputBudget: ToolDefinition = {
  name: 'calculateOutputBudget',
  description: 'Calculate dynamic word budget and report depth based on issue complexity from step results.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      issueCount: { type: 'number', description: 'Number of classified issues (optional, auto-detected from deal_classifications)' },
      rootCauseCategories: { type: 'number', description: 'Number of distinct root cause types (optional, auto-detected)' },
      problemReps: { type: 'number', description: 'Number of reps with issues (optional, auto-detected)' },
      coverageGap: { type: 'boolean', description: 'Whether coverage is below target (optional, auto-detected)' },
      negativeTrend: { type: 'boolean', description: 'Whether trend is negative (optional, auto-detected)' },
      firstRun: { type: 'boolean', description: 'Whether this is the first run (optional, auto-detected)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('calculateOutputBudget', async () => {
      const rawClassifications = (context.stepResults as any).deal_classifications;
      const periodComparison = (context.stepResults as any).period_comparison;
      const pipelineSummary = (context.stepResults as any).pipeline_summary;
      const goalsAndTargets = (context.businessContext as any).goals_and_targets || {};

      let dealClassifications: any[] = [];
      if (Array.isArray(rawClassifications)) {
        dealClassifications = rawClassifications;
      } else if (rawClassifications && typeof rawClassifications === 'object') {
        const isClassification = (item: any) =>
          item && typeof item === 'object' && ('dealName' in item || 'root_cause' in item || 'suggested_action' in item);

        const arrayKeys = Object.keys(rawClassifications).filter(k => Array.isArray(rawClassifications[k]));
        const classificationKey = arrayKeys.find(k =>
          rawClassifications[k].length > 0 && isClassification(rawClassifications[k][0])
        );
        if (classificationKey) {
          dealClassifications = rawClassifications[classificationKey];
          console.log(`[calculateOutputBudget] Unwrapped deal_classifications from key '${classificationKey}' (${dealClassifications.length} items)`);
        } else {
          console.warn(`[calculateOutputBudget] deal_classifications is object with no valid classification array. Keys: ${Object.keys(rawClassifications).join(', ')}. Treating as empty.`);
        }
      } else if (typeof rawClassifications === 'string') {
        try {
          const parsed = JSON.parse(rawClassifications);
          dealClassifications = Array.isArray(parsed) ? parsed : [];
        } catch {
          console.warn(`[calculateOutputBudget] deal_classifications is unparseable string, treating as empty`);
        }
      }

      const issueCount = params.issueCount ?? dealClassifications.length;

      const rootCauseCategories = params.rootCauseCategories ??
        new Set(dealClassifications.map((d: any) => d.root_cause)).size;

      const problemReps = params.problemReps ??
        new Set(dealClassifications.map((d: any) => d.owner || d.dealOwner)).size;

      const targetCoverage = goalsAndTargets.pipeline_coverage_target || 3;
      const currentCoverage = pipelineSummary?.coverage_ratio || 0;
      const coverageGap = params.coverageGap ?? (currentCoverage < targetCoverage);

      const negativeTrend = params.negativeTrend ??
        (periodComparison?.deltas?.find((d: any) => d.field === 'totalValue')?.direction === 'down');

      const firstRun = params.firstRun ?? (periodComparison?.previous === null);

      let complexity = 0;
      let reasoning: string[] = [];

      if (issueCount >= 15) {
        complexity += 2;
        reasoning.push(`High issue count (${issueCount})`);
      } else if (issueCount >= 5) {
        complexity += 1;
        reasoning.push(`Moderate issue count (${issueCount})`);
      }

      if (rootCauseCategories >= 3) {
        complexity += 1;
        reasoning.push(`Multiple root cause categories (${rootCauseCategories})`);
      }

      if (problemReps >= 3) {
        complexity += 1;
        reasoning.push(`Multiple reps with issues (${problemReps})`);
      }

      if (coverageGap) {
        complexity += 1;
        reasoning.push('Coverage below target');
      }

      if (negativeTrend) {
        complexity += 1;
        reasoning.push('Negative period-over-period trend');
      }

      let wordBudget: number;
      let reportDepth: 'minimal' | 'standard' | 'detailed';

      if (complexity === 0 && !firstRun) {
        wordBudget = 300;
        reportDepth = 'minimal';
        reasoning.push('Pipeline healthy, minimal report');
      } else if (complexity <= 2) {
        wordBudget = 600;
        reportDepth = 'standard';
      } else {
        wordBudget = 1000;
        reportDepth = 'detailed';
      }

      return {
        wordBudget,
        reportDepth,
        complexityScore: complexity,
        reasoning: reasoning.join('; '),
      };
    }, params);
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

export const toolRegistry = new Map<string, ToolDefinition>([
  ['queryDeals', queryDeals],
  ['getDeal', getDeal],
  ['getDealsByStage', getDealsByStage],
  ['getStaleDeals', getStaleDeals],
  ['getDealsClosingInRange', getDealsClosingInRange],
  ['getPipelineSummary', getPipelineSummary],
  ['queryContacts', queryContacts],
  ['getContact', getContact],
  ['getContactsForDeal', getContactsForDeal],
  ['getStakeholderMap', getStakeholderMap],
  ['queryAccounts', queryAccounts],
  ['getAccount', getAccount],
  ['getAccountHealth', getAccountHealth],
  ['queryActivities', queryActivities],
  ['getActivityTimeline', getActivityTimeline],
  ['getActivitySummary', getActivitySummary],
  ['queryConversations', queryConversations],
  ['getConversation', getConversation],
  ['getRecentCallsForDeal', getRecentCallsForDeal],
  ['getCallInsights', getCallInsights],
  ['queryTasks', queryTasks],
  ['getOverdueTasks', getOverdueTasks],
  ['getTaskSummary', getTaskSummary],
  ['queryDocuments', queryDocuments],
  ['getDocument', getDocument],
  ['getDocumentsForDeal', getDocumentsForDeal],
  ['getBusinessContext', getBusinessContext],
  ['getGoalsAndTargets', getGoalsAndTargets],
  ['getDefinitions', getDefinitions],
  ['getMaturityScores', getMaturityScores],
  ['computePipelineCoverage', computePipelineCoverage],
  ['refreshComputedFields', refreshComputedFields],
  ['aggregateStaleDeals', aggregateStaleDeals],
  ['aggregateClosingSoon', aggregateClosingSoon],
  ['computeOwnerPerformance', computeOwnerPerformance],
  ['resolveTimeWindows', resolveTimeWindowsTool],
  ['gatherPeriodComparison', gatherPeriodComparison],
  ['calculateOutputBudget', calculateOutputBudget],
]);

// ============================================================================
// Export Functions
// ============================================================================

export function getAllToolDefinitions(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

export function getToolsByNames(names: string[]): ToolDefinition[] {
  return names.map(name => toolRegistry.get(name)).filter((t): t is ToolDefinition => t !== undefined);
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}
