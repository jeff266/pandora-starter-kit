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
  formatQuarterLabel,
  comparePeriods,
  dealThreadingAnalysis,
  enrichCriticalDeals,
  dataQualityAudit,
  coverageByRep,
  coverageTrend,
  repPipelineQuality,
  type TimeConfig,
  type TimeWindows,
  type DataQualityAudit,
  type CoverageByRep,
  type RepCoverage,
} from '../analysis/aggregations.js';
import {
  getBusinessContext as fetchBusinessContext,
  getGoals,
  getDefinitions as fetchDefinitions,
  getMaturity as fetchMaturity,
  getContext,
} from '../context/index.js';
import {
  discoverCustomFields,
  generateDiscoveryReport,
  type CustomFieldDiscoveryResult,
} from './compute/custom-field-discovery.js';
import { scoreLeads } from './compute/lead-scoring.js';
import { resolveContactRoles, type ResolutionResult } from './compute/contact-role-resolution.js';
import { discoverICP, type ICPDiscoveryResult } from './compute/icp-discovery.js';
import { query } from '../db.js';
import {
  findConversationsWithoutDeals,
  getTopCWDConversations,
  getCWDByRep,
  type ConversationWithoutDeal,
  type CWDResult,
} from '../analysis/conversation-without-deals.js';

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
      stageNormalized: { type: 'string', description: 'Filter by normalized stage (awareness, qualification, evaluation, decision, negotiation, closed_won, closed_lost)' },
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
          quarter: formatQuarterLabel(windows.analysisRange.start),
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

const dealThreadingAnalysisTool: ToolDefinition = {
  name: 'dealThreadingAnalysis',
  description: 'Analyze deal pipeline for single-threaded risk by counting unique contacts per deal.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('dealThreadingAnalysis', async () => {
      const [threadingData, nameMap] = await Promise.all([
        dealThreadingAnalysis(context.workspaceId),
        resolveOwnerNames(context.workspaceId),
      ]);

      // Map owner IDs to names in all sections
      const mapOwner = (owner: string) => resolveOwnerName(owner, nameMap);

      return {
        summary: threadingData.summary,
        byStage: threadingData.byStage,
        byOwner: Object.fromEntries(
          Object.entries(threadingData.byOwner).map(([owner, stats]) => [
            mapOwner(owner),
            stats,
          ])
        ),
        criticalDeals: threadingData.criticalDeals.map(d => ({ ...d, owner: mapOwner(d.owner) })),
        warningDeals: threadingData.warningDeals.map(d => ({ ...d, owner: mapOwner(d.owner) })),
      };
    }, params);
  },
};

const enrichCriticalDealsTool: ToolDefinition = {
  name: 'enrichCriticalDeals',
  description: 'Enrich critical single-threaded deals with expansion opportunities and account context.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealIds: {
        type: 'array',
        description: 'Array of deal IDs to enrich (optional, auto-reads from threading_data)',
        items: { type: 'string' },
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('enrichCriticalDeals', async () => {
      // Auto-extract dealIds from threading_data if not provided
      let dealIds = params.dealIds || [];

      if (dealIds.length === 0) {
        const threadingData = (context.stepResults as any).threading_data;
        if (threadingData?.criticalDeals) {
          dealIds = threadingData.criticalDeals.map((d: any) => d.dealId);
        }
      }

      if (dealIds.length === 0) {
        return [];
      }

      const [enrichedDeals, nameMap] = await Promise.all([
        enrichCriticalDeals(context.workspaceId, dealIds),
        resolveOwnerNames(context.workspaceId),
      ]);

      // Map owner IDs to names
      return enrichedDeals.map(d => ({
        ...d,
        owner: resolveOwnerName(d.owner, nameMap),
      }));
    }, params);
  },
};

const dataQualityAuditTool: ToolDefinition = {
  name: 'dataQualityAudit',
  description: 'Run a comprehensive data quality audit across deals, contacts, and accounts.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('dataQualityAudit', async () => {
      const [qualityData, nameMap] = await Promise.all([
        dataQualityAudit(context.workspaceId),
        resolveOwnerNames(context.workspaceId),
      ]);

      // Map owner IDs to names in owner breakdown
      const mapOwner = (owner: string) => resolveOwnerName(owner, nameMap);

      const filteredOwners = qualityData.ownerBreakdown
        .map(ob => ({ ...ob, owner: mapOwner(ob.owner) }))
        .filter(ob => ob.avgCompleteness < 80 || ob.criticalIssues > 5)
        .slice(0, 15);

      return {
        ...qualityData,
        ownerBreakdown: filteredOwners,
        worstOffenders: qualityData.worstOffenders.map(wo => ({
          ...wo,
          owner: mapOwner(wo.owner),
        })),
      };
    }, params);
  },
};

const gatherQualityTrend: ToolDefinition = {
  name: 'gatherQualityTrend',
  description: 'Compare current data quality metrics against the previous audit run to identify trends.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('gatherQualityTrend', async () => {
      // Load previous run's result from skill_runs table
      const previousRun = await query(
        `SELECT result FROM skill_runs
         WHERE workspace_id = $1 AND skill_id = 'data-quality-audit' AND status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`,
        [context.workspaceId]
      );

      if (previousRun.rows.length === 0) {
        return { isFirstRun: true };
      }

      const previousResult = previousRun.rows[0].result;
      const currentMetrics = (context.stepResults as any).quality_metrics;

      if (!previousResult?.quality_metrics || !currentMetrics) {
        return { isFirstRun: true };
      }

      const prev = previousResult.quality_metrics;
      const curr = currentMetrics;

      const overallDelta = curr.overall.overallCompleteness - prev.overall.overallCompleteness;
      const criticalDelta = curr.overall.criticalFieldCompleteness - prev.overall.criticalFieldCompleteness;

      // Compare field fill rates
      const improved: Array<{ entity: string; field: string; delta: number }> = [];
      const declined: Array<{ entity: string; field: string; delta: number }> = [];

      for (const entity of ['deals', 'contacts', 'accounts'] as const) {
        const prevFields = prev.byEntity[entity].fieldCompleteness;
        const currFields = curr.byEntity[entity].fieldCompleteness;

        for (const currField of currFields) {
          const prevField = prevFields.find((f: any) => f.field === currField.field);
          if (prevField) {
            const delta = currField.fillRate - prevField.fillRate;
            if (delta > 0) {
              improved.push({ entity, field: currField.field, delta });
            } else if (delta < 0) {
              declined.push({ entity, field: currField.field, delta });
            }
          }
        }
      }

      // Calculate net change in total issues
      const prevIssues = Object.values(prev.byEntity.deals.issues).reduce((a: number, b: any) => a + b, 0) +
                         Object.values(prev.byEntity.contacts.issues).reduce((a: number, b: any) => a + b, 0) +
                         Object.values(prev.byEntity.accounts.issues).reduce((a: number, b: any) => a + b, 0);
      const currIssues = Object.values(curr.byEntity.deals.issues).reduce((a: number, b: any) => a + b, 0) +
                         Object.values(curr.byEntity.contacts.issues).reduce((a: number, b: any) => a + b, 0) +
                         Object.values(curr.byEntity.accounts.issues).reduce((a: number, b: any) => a + b, 0);
      const newIssuesDelta = currIssues - prevIssues;

      return {
        isFirstRun: false,
        overallDelta: Math.round(overallDelta),
        criticalDelta: Math.round(criticalDelta),
        improved: improved.sort((a, b) => b.delta - a.delta),
        declined: declined.sort((a, b) => a.delta - b.delta),
        newIssuesDelta,
      };
    }, params);
  },
};

const enrichWorstOffenders: ToolDefinition = {
  name: 'enrichWorstOffenders',
  description: 'Enrich worst offender records with additional context (deal close dates, contact deal counts, account value).',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('enrichWorstOffenders', async () => {
      const qualityMetrics = (context.stepResults as any).quality_metrics;
      if (!qualityMetrics?.worstOffenders) {
        return [];
      }

      const worstOffenders = qualityMetrics.worstOffenders.slice(0, 20);

      // Enrich each offender with contextual data
      const enriched = await Promise.all(
        worstOffenders.map(async (offender: any) => {
          if (offender.entity === 'deal') {
            // Add days_until_close, stage, forecast status
            const dealResult = await query(
              `SELECT close_date, stage_normalized, amount
               FROM deals
               WHERE id = $1 AND workspace_id = $2`,
              [offender.id, context.workspaceId]
            );

            if (dealResult.rows.length > 0) {
              const deal = dealResult.rows[0];
              const closeDate = deal.close_date ? new Date(deal.close_date) : null;
              const daysUntilClose = closeDate
                ? Math.floor((closeDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;

              return {
                ...offender,
                daysUntilClose,
                stage: deal.stage_normalized || 'Unknown',
                inCommitForecast: daysUntilClose !== null && daysUntilClose <= 30,
              };
            }
          } else if (offender.entity === 'contact') {
            // Add number of associated deals
            const dealsResult = await query(
              `SELECT COUNT(*) as deal_count
               FROM deals d
               WHERE d.contact_id = $1 AND d.workspace_id = $2`,
              [offender.id, context.workspaceId]
            );

            return {
              ...offender,
              associatedDeals: parseInt(dealsResult.rows[0]?.deal_count, 10) || 0,
            };
          } else if (offender.entity === 'account') {
            // Add total deal value and contact count
            const accountResult = await query(
              `SELECT
                 COALESCE(SUM(d.amount), 0) as total_deal_value,
                 (SELECT COUNT(*) FROM contacts c WHERE c.account_id = $1 AND c.workspace_id = $2) as contact_count
               FROM deals d
               WHERE d.account_id = $1 AND d.workspace_id = $2`,
              [offender.id, context.workspaceId]
            );

            if (accountResult.rows.length > 0) {
              return {
                ...offender,
                totalDealValue: Math.round(parseFloat(accountResult.rows[0].total_deal_value) || 0),
                contactCount: parseInt(accountResult.rows[0].contact_count, 10) || 0,
              };
            }
          }

          return offender;
        })
      );

      return enriched;
    }, params);
  },
};

const summarizeForClaude: ToolDefinition = {
  name: 'summarizeForClaude',
  description: 'Pre-summarize metrics into compact text for Claude prompt, replacing raw arrays with one-liners.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('summarizeForClaude', async () => {
      // Detect which skill is running based on context
      const skillId = context.skillId;

      // Handle data-quality-audit
      if (skillId === 'data-quality-audit') {
        const metrics = (context.stepResults as any).quality_metrics;
        if (!metrics) return { summary: 'No quality metrics available.' };

        const summarizeEntity = (entity: string, data: any) => {
          const criticalFields = data.fieldCompleteness.filter((f: any) => f.isCritical);
          const avgCritical = criticalFields.length > 0
            ? Math.round(criticalFields.reduce((s: number, f: any) => s + f.fillRate, 0) / criticalFields.length)
            : 100;
          const worstFields = [...criticalFields]
            .sort((a: any, b: any) => a.fillRate - b.fillRate)
            .slice(0, 3)
            .map((f: any) => `${f.field} ${f.fillRate}%`)
            .join(', ');

          const issueLines: string[] = [];
          for (const [key, val] of Object.entries(data.issues)) {
            if ((val as number) > 0) {
              issueLines.push(`${key}: ${val}`);
            }
          }
          const issueStr = issueLines.length > 0 ? issueLines.join(', ') : 'none';

          return `${entity}: ${data.total} records, ${avgCritical}% critical completeness (worst: ${worstFields}). Issues: ${issueStr}`;
        };

        const dealsSummary = summarizeEntity('Deals', metrics.byEntity.deals);
        const contactsSummary = summarizeEntity('Contacts', metrics.byEntity.contacts);
        const accountsSummary = summarizeEntity('Accounts', metrics.byEntity.accounts);

        return {
          entitySummaries: `${dealsSummary}\n${contactsSummary}\n${accountsSummary}`,
        };
      }

      // Handle pipeline-coverage
      if (skillId === 'pipeline-coverage') {
        const coverageData = (context.stepResults as any).coverage_data;
        const quotaConfig = (context.stepResults as any).quota_config;
        const trend = (context.stepResults as any).coverage_trend;
        const quality = (context.stepResults as any).pipeline_quality;
        const riskClassifications = (context.stepResults as any).rep_risk_classifications;

        if (!coverageData) return { summary: 'No coverage data available.' };

        const team = coverageData.team;

        // Quota note
        let quotaNote = '';
        if (quotaConfig?.source === 'none') {
          quotaNote = '⚠️ No quotas configured in context layer. Showing absolute pipeline numbers only. Configure quotas in goals_and_targets for coverage analysis.';
        } else if (quotaConfig?.source === 'revenue_target') {
          quotaNote = `Using revenue target as team quota: $${(team.totalQuota || 0).toLocaleString()}`;
        } else {
          quotaNote = `Team quota: $${(team.totalQuota || 0).toLocaleString()} | Coverage target: ${team.coverageTarget}x`;
        }

        // Team summary
        const coverageRatioStr = team.coverageRatio !== null ? `${team.coverageRatio.toFixed(1)}x` : 'N/A';
        const gapStr = team.gap !== null ? `$${team.gap.toLocaleString()}` : 'N/A';
        const weeklyGenStr = team.requiredWeeklyPipelineGen !== null ? `$${team.requiredWeeklyPipelineGen.toLocaleString()}` : 'N/A';

        const teamSummary = `Pipeline: $${team.totalPipeline.toLocaleString()} (${team.dealCount} deals, avg $${team.avgDealSize.toLocaleString()})
Closed Won: $${team.closedWon.toLocaleString()}
Coverage: ${coverageRatioStr} (target: ${team.coverageTarget}x)
Gap to target: ${gapStr}
Days in quarter: ${team.daysInQuarter} (${team.daysElapsed} elapsed, ${team.daysRemaining} remaining)
Required weekly pipeline gen: ${weeklyGenStr}`;

        // Rep table (limit to 15 reps)
        const reps = coverageData.reps.slice(0, 15);
        const repLines = reps.map((r: any) => {
          const coverage = r.coverageRatio !== null ? r.coverageRatio.toFixed(1) + 'x' : 'N/A';
          const quota = r.quota !== null ? `$${Math.round(r.quota / 1000)}K` : 'N/A';
          const pipeline = `$${Math.round(r.pipeline / 1000)}K`;
          const status = r.status;
          const statusEmoji = status === 'on_track' ? '✅' : status === 'at_risk' ? '⚠️' : status === 'behind' ? '🔴' : '❓';
          return `${statusEmoji} ${r.name} | ${pipeline} pipeline | ${coverage} coverage | Quota: ${quota}`;
        });

        const remainingCount = coverageData.reps.length - 15;
        if (remainingCount > 0) {
          repLines.push(`... and ${remainingCount} more reps`);
        }

        const repTable = repLines.join('\n');

        // Quality flags
        const qualityMap = new Map(quality.map((q: any) => [q.email, q]));
        const earlyHeavyReps = coverageData.reps
          .filter((r: any) => {
            const q = qualityMap.get(r.email);
            return q && q.qualityFlag === 'early_heavy';
          })
          .map((r: any) => r.name);

        const qualityFlags = earlyHeavyReps.length > 0
          ? `${earlyHeavyReps.length} reps have >70% of pipeline in early stages: ${earlyHeavyReps.join(', ')}`
          : 'All reps have balanced stage distribution';

        // Trend
        let trendStr = '';
        if (trend.isFirstRun) {
          trendStr = 'First run — no previous data for comparison';
        } else if (trend.repDeltas.length === 0) {
          trendStr = 'No significant changes since last week';
        } else {
          const topChanges = trend.repDeltas
            .sort((a: any, b: any) => Math.abs(b.coverageChange || 0) - Math.abs(a.coverageChange || 0))
            .slice(0, 5);
          const changeLines = topChanges.map((d: any) => {
            const coverageChange = d.coverageChange !== null ? `${d.coverageChange > 0 ? '+' : ''}${d.coverageChange.toFixed(1)}x` : '';
            const pipelineChange = `$${Math.round(d.pipelineChange / 1000)}K`;
            return `${d.name}: ${coverageChange} coverage, ${pipelineChange} pipeline`;
          });
          trendStr = 'Week-over-week changes:\n' + changeLines.join('\n');
        }

        // Risk classifications
        let riskStr = '';
        if (riskClassifications.skipped) {
          riskStr = 'No at-risk reps identified';
        } else if (riskClassifications.classifications.length === 0) {
          riskStr = 'All reps are on track';
        } else {
          const classLines = riskClassifications.classifications.map((c: any) => {
            return `${c.name} (${c.risk_level}): ${c.root_cause} — ${c.recommended_intervention}`;
          });
          riskStr = classLines.join('\n');
        }

        return {
          quotaNote,
          teamSummary,
          repTable,
          qualityFlags,
          trend: trendStr,
          riskClassifications: riskStr,
        };
      }

      return { summary: 'Unsupported skill for summarization' };
    }, params);
  },
};

const checkQuotaConfig: ToolDefinition = {
  name: 'checkQuotaConfig',
  description: 'Check workspace for quota configuration from quota tables or context layer',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('checkQuotaConfig', async () => {
      const activePeriod = await query<{
        id: string;
        name: string;
        period_type: string;
        start_date: string;
        end_date: string;
        team_quota: number;
      }>(
        `SELECT id, name, period_type, start_date, end_date, team_quota
         FROM quota_periods
         WHERE workspace_id = $1
           AND start_date <= CURRENT_DATE
           AND end_date >= CURRENT_DATE
         ORDER BY start_date DESC
         LIMIT 1`,
        [context.workspaceId]
      );

      if (activePeriod.rows.length > 0) {
        const period = activePeriod.rows[0];
        const repRows = await query<{ rep_name: string; quota_amount: number }>(
          `SELECT rep_name, quota_amount FROM rep_quotas WHERE period_id = $1 ORDER BY rep_name`,
          [period.id]
        );

        const repQuotas: Record<string, number> = {};
        for (const r of repRows.rows) {
          repQuotas[r.rep_name] = Number(r.quota_amount);
        }

        const teamQuota = Number(period.team_quota);
        const hasRepQuotas = Object.keys(repQuotas).length > 0;

        const goals = await getGoals(context.workspaceId);
        const coverageTarget = (goals as any).pipeline_coverage_target ?? 3.0;

        return {
          hasQuotas: true,
          hasRepQuotas,
          teamQuota,
          repQuotas: hasRepQuotas ? repQuotas : null,
          coverageTarget,
          source: 'quotas' as const,
          period: {
            id: period.id,
            name: period.name,
            type: period.period_type,
            startDate: period.start_date,
            endDate: period.end_date,
          },
        };
      }

      const goals = await getGoals(context.workspaceId);
      const quotas = (goals as any).quotas;
      const teamQuota = quotas?.team ?? (goals as any).quarterly_quota ?? null;
      const repQuotas = quotas?.byRep ?? null;
      const coverageTarget = (goals as any).pipeline_coverage_target ?? 3.0;
      const revenueTarget = (goals as any).revenue_target ?? null;

      const hasQuotas = teamQuota !== null || repQuotas !== null;
      const hasRepQuotas = repQuotas !== null && Object.keys(repQuotas).length > 0;

      let source: 'quotas' | 'revenue_target' | 'none';
      if (hasQuotas) {
        source = 'quotas';
      } else if (revenueTarget !== null) {
        source = 'revenue_target';
      } else {
        source = 'none';
      }

      return {
        hasQuotas,
        hasRepQuotas,
        teamQuota,
        repQuotas,
        coverageTarget,
        source,
      };
    }, params);
  },
};

const coverageByRepTool: ToolDefinition = {
  name: 'coverageByRep',
  description: 'Calculate pipeline coverage by rep for a quarter',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      quarterStart: {
        type: 'string',
        description: 'Quarter start date (ISO format)',
      },
      quarterEnd: {
        type: 'string',
        description: 'Quarter end date (ISO format)',
      },
      quotas: {
        type: 'object',
        description: 'Optional quota configuration',
      },
      coverageTarget: {
        type: 'number',
        description: 'Coverage target multiple (default 3.0)',
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('coverageByRep', async () => {
      // Auto-extract from step results if not provided
      const timeWindows = (context.stepResults as any).time_windows;
      const quotaConfig = (context.stepResults as any).quota_config;

      const quarterStart = params.quarterStart
        ? new Date(params.quarterStart)
        : new Date(timeWindows.analysisRange.start);

      const quarterEnd = params.quarterEnd
        ? new Date(params.quarterEnd)
        : new Date(timeWindows.analysisRange.end);

      const coverageTarget = params.coverageTarget ?? quotaConfig?.coverageTarget ?? 3.0;

      const quotas = params.quotas ?? (quotaConfig ? {
        team: quotaConfig.teamQuota ?? null,
        byRep: quotaConfig.repQuotas ?? null,
      } : undefined);

      const excludedOwners = (context.businessContext as any)?.excluded_owners
        ?? (context.businessContext as any)?.definitions?.excluded_owners
        ?? [];

      return await coverageByRep(
        context.workspaceId,
        quarterStart,
        quarterEnd,
        quotas,
        coverageTarget,
        excludedOwners.length > 0 ? excludedOwners : undefined
      );
    }, params);
  },
};

const coverageTrendTool: ToolDefinition = {
  name: 'coverageTrend',
  description: 'Compare current coverage to previous run',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('coverageTrend', async () => {
      const currentCoverage = (context.stepResults as any).coverage_data;

      // Load previous run
      const previousRun = await query(
        `SELECT result FROM skill_runs
         WHERE workspace_id = $1 AND skill_id = 'pipeline-coverage' AND status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`,
        [context.workspaceId]
      );

      if (previousRun.rows.length === 0) {
        return { isFirstRun: true, repDeltas: [] };
      }

      return await coverageTrend(
        context.workspaceId,
        currentCoverage.reps,
        previousRun.rows[0].result
      );
    }, params);
  },
};

const repPipelineQualityTool: ToolDefinition = {
  name: 'repPipelineQuality',
  description: 'Analyze stage distribution of each reps pipeline',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      quarterStart: {
        type: 'string',
        description: 'Quarter start date (ISO format)',
      },
      quarterEnd: {
        type: 'string',
        description: 'Quarter end date (ISO format)',
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('repPipelineQuality', async () => {
      const timeWindows = (context.stepResults as any).time_windows;

      const quarterStart = params.quarterStart
        ? new Date(params.quarterStart)
        : new Date(timeWindows.analysisRange.start);

      const quarterEnd = params.quarterEnd
        ? new Date(params.quarterEnd)
        : new Date(timeWindows.analysisRange.end);

      const excludedOwners = (context.businessContext as any)?.excluded_owners
        ?? (context.businessContext as any)?.definitions?.excluded_owners
        ?? [];

      return await repPipelineQuality(
        context.workspaceId,
        quarterStart,
        quarterEnd,
        excludedOwners.length > 0 ? excludedOwners : undefined
      );
    }, params);
  },
};

const prepareAtRiskReps: ToolDefinition = {
  name: 'prepareAtRiskReps',
  description: 'Filter and prepare at-risk reps for DeepSeek classification',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('prepareAtRiskReps', async () => {
      const coverageData = (context.stepResults as any).coverage_data;
      const quality = (context.stepResults as any).pipeline_quality;
      const trend = (context.stepResults as any).coverage_trend;
      const cwdByRep = (context.stepResults as any).cwd_by_rep || [];

      if (!coverageData?.reps) {
        return [];
      }

      // Build quality, trend, and CWD maps
      const qualityMap = new Map(quality.map((q: any) => [q.email, q]));
      const trendMap = new Map(
        (trend.repDeltas || []).map((d: any) => [d.email, d])
      );
      const cwdMap = new Map(cwdByRep.map((c: any) => [c.email, c]));

      // Filter at-risk reps
      const atRiskReps = coverageData.reps
        .filter((r: any) => {
          const isAtRisk = r.status === 'at_risk' || r.status === 'behind';
          const hasUnknownWithPipeline = r.status === 'unknown' && r.pipeline > 0;
          return isAtRisk || hasUnknownWithPipeline;
        })
        .slice(0, 10) // Cap at 10 reps
        .map((r: any) => {
          const q = qualityMap.get(r.email);
          const t = trendMap.get(r.email);
          const cwd = cwdMap.get(r.email);

          return {
            name: r.name,
            email: r.email,
            quota: r.quota,
            pipeline: r.pipeline,
            coverageRatio: r.coverageRatio,
            gap: r.gap,
            status: r.status,
            staleDeals: r.staleDeals,
            staleDealValue: r.staleDealValue,
            dealCount: r.dealCount,
            qualityFlag: q?.qualityFlag || 'balanced',
            earlyPct: q?.earlyPct || 0,
            coverageChange: t?.coverageChange || null,
            pipelineChange: t?.pipelineChange || 0,
            conversations_without_deals_count: cwd?.cwd_count || 0,
            cwd_accounts: cwd?.cwd_accounts || [],
          };
        });

      return atRiskReps;
    }, params);
  },
};

// ============================================================================
// CWD (Conversations Without Deals) Tools
// ============================================================================

const checkWorkspaceHasConversations: ToolDefinition = {
  name: 'checkWorkspaceHasConversations',
  description: 'Check if workspace has conversation data (Gong/Fireflies connectors active)',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('checkWorkspaceHasConversations', async () => {
      const result = await query(
        `SELECT EXISTS(
          SELECT 1 FROM conversations
          WHERE workspace_id = $1
          LIMIT 1
        ) as has_conversations`,
        [context.workspaceId]
      );
      return result.rows[0]?.has_conversations || false;
    }, params);
  },
};

const auditConversationDealCoverage: ToolDefinition = {
  name: 'auditConversationDealCoverage',
  description: 'Find conversations linked to accounts but not deals (CWD), with severity classification and account enrichment',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      daysBack: {
        type: 'number',
        description: 'Number of days to look back (default: 90)',
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('auditConversationDealCoverage', async () => {
      const daysBack = (params as any).daysBack || 90;

      // Get full CWD result
      const cwdResult = await findConversationsWithoutDeals(context.workspaceId, daysBack);

      // Get top 5 high-severity examples for DeepSeek classification
      const topExamples = getTopCWDConversations(cwdResult.conversations, 5);

      return {
        has_conversation_data: true,
        summary: cwdResult.summary,
        top_examples: topExamples,
      };
    }, params);
  },
};

const getCWDByRepTool: ToolDefinition = {
  name: 'getCWDByRep',
  description: 'Get CWD (Conversations Without Deals) aggregated by rep for shadow pipeline analysis',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      daysBack: {
        type: 'number',
        description: 'Number of days to look back (default: 90)',
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getCWDByRep', async () => {
      const daysBack = (params as any).daysBack || 90;

      // Get full CWD result
      const cwdResult = await findConversationsWithoutDeals(context.workspaceId, daysBack);

      // Aggregate by rep
      const byRepMap = getCWDByRep(cwdResult.conversations);

      // Convert Map to array for easier consumption in skills
      return Array.from(byRepMap.entries()).map(([email, data]) => ({
        email,
        rep_name: data.rep_name,
        cwd_count: data.cwd_count,
        high_severity_count: data.high_severity_count,
        cwd_accounts: data.conversations.map(c => c.account_name),
      }));
    }, params);
  },
};

// ============================================================================
// Forecast Roll-up Tools
// ============================================================================

const forecastRollup: ToolDefinition = {
  name: 'forecastRollup',
  description: 'Aggregate deals by forecast_category into team totals, bear/base/bull scenarios, and per-rep breakdown. Only includes forecasted pipelines.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('forecastRollup', async () => {
      const nameMap = await resolveOwnerNames(context.workspaceId);

      const teamResult = await query(
        `SELECT
          forecast_category,
          COUNT(*) AS deal_count,
          COALESCE(SUM(amount), 0) AS total_amount,
          COALESCE(SUM(amount * COALESCE(probability, 0)), 0) AS weighted_amount
        FROM deals
        WHERE workspace_id = $1
          AND forecast_category IS NOT NULL
          AND stage_normalized NOT IN ('closed_lost')
        GROUP BY forecast_category`,
        [context.workspaceId]
      );

      const categories: Record<string, { count: number; amount: number; weighted: number }> = {
        closed: { count: 0, amount: 0, weighted: 0 },
        commit: { count: 0, amount: 0, weighted: 0 },
        best_case: { count: 0, amount: 0, weighted: 0 },
        pipeline: { count: 0, amount: 0, weighted: 0 },
        not_forecasted: { count: 0, amount: 0, weighted: 0 },
      };

      for (const row of teamResult.rows) {
        const cat = row.forecast_category as string;
        if (categories[cat]) {
          categories[cat] = {
            count: Number(row.deal_count),
            amount: Number(row.total_amount),
            weighted: Number(row.weighted_amount),
          };
        }
      }

      const closedWon = categories.closed.amount;
      const commit = categories.commit.amount;
      const bestCase = categories.best_case.amount;
      const pipelineAmt = categories.pipeline.amount;

      const bearCase = closedWon + commit;
      const baseCase = closedWon + commit + bestCase;
      const bullCase = closedWon + commit + bestCase + pipelineAmt;
      const weightedForecast = closedWon + categories.commit.weighted + categories.best_case.weighted + categories.pipeline.weighted;

      const repResult = await query(
        `SELECT
          owner,
          forecast_category,
          COUNT(*) AS deal_count,
          COALESCE(SUM(amount), 0) AS total_amount
        FROM deals
        WHERE workspace_id = $1
          AND forecast_category IS NOT NULL
          AND stage_normalized NOT IN ('closed_lost')
          AND owner IS NOT NULL
        GROUP BY owner, forecast_category
        ORDER BY owner`,
        [context.workspaceId]
      );

      const repMap = new Map<string, {
        closedWon: number; commit: number; bestCase: number; pipeline: number; notForecasted: number;
        dealCount: number;
      }>();

      for (const row of repResult.rows) {
        const ownerRaw = row.owner as string;
        const owner = resolveOwnerName(ownerRaw, nameMap);
        if (!repMap.has(owner)) {
          repMap.set(owner, { closedWon: 0, commit: 0, bestCase: 0, pipeline: 0, notForecasted: 0, dealCount: 0 });
        }
        const rep = repMap.get(owner)!;
        const amt = Number(row.total_amount);
        const cnt = Number(row.deal_count);
        rep.dealCount += cnt;

        switch (row.forecast_category) {
          case 'closed': rep.closedWon += amt; break;
          case 'commit': rep.commit += amt; break;
          case 'best_case': rep.bestCase += amt; break;
          case 'pipeline': rep.pipeline += amt; break;
          case 'not_forecasted': rep.notForecasted += amt; break;
        }
      }

      const quotaConfig = (context.stepResults as any).quota_config;
      const teamQuota = quotaConfig?.teamQuota ?? null;
      const repQuotas = quotaConfig?.repQuotas ?? null;

      const byRep = Array.from(repMap.entries()).map(([name, data]) => {
        const repQuota = repQuotas?.[name] ?? null;
        const repBear = data.closedWon + data.commit;
        const attainment = repQuota ? repBear / repQuota : null;

        let status: string | null = null;
        if (attainment !== null) {
          if (attainment >= 1.2) status = 'crushing';
          else if (attainment >= 0.9) status = 'on_track';
          else if (attainment >= 0.7) status = 'at_risk';
          else if (attainment >= 0.5) status = 'behind';
          else status = 'off_track';
        }

        return {
          name,
          closedWon: data.closedWon,
          commit: data.commit,
          bestCase: data.bestCase,
          pipeline: data.pipeline,
          notForecasted: data.notForecasted,
          dealCount: data.dealCount,
          bearCase: repBear,
          quota: repQuota,
          attainment,
          status,
        };
      }).sort((a, b) => b.bearCase - a.bearCase);

      return {
        team: {
          closedWon,
          commit,
          bestCase,
          pipeline: pipelineAmt,
          notForecasted: categories.not_forecasted.amount,
          bearCase,
          baseCase,
          bullCase,
          weightedForecast,
          teamQuota,
          attainment: teamQuota ? bearCase / teamQuota : null,
        },
        dealCount: {
          closed: categories.closed.count,
          commit: categories.commit.count,
          bestCase: categories.best_case.count,
          pipeline: categories.pipeline.count,
          notForecasted: categories.not_forecasted.count,
          total: Object.values(categories).reduce((s, c) => s + c.count, 0),
        },
        byRep,
      };
    }, params);
  },
};

const forecastWoWDelta: ToolDefinition = {
  name: 'forecastWoWDelta',
  description: 'Compare current forecast roll-up to the most recent previous run for week-over-week delta analysis.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('forecastWoWDelta', async () => {
      const currentData = (context.stepResults as any).forecast_data;
      if (!currentData?.team) {
        return { available: false, reason: 'No current forecast data' };
      }

      const previousRun = await query(
        `SELECT result, completed_at
         FROM skill_runs
         WHERE workspace_id = $1
           AND skill_id = 'forecast-rollup'
           AND status = 'completed'
           AND run_id != $2
         ORDER BY completed_at DESC
         LIMIT 1`,
        [context.workspaceId, context.runId]
      );

      if (previousRun.rows.length === 0) {
        return { available: false, reason: 'First run - no previous data for comparison' };
      }

      const prevResult = previousRun.rows[0].result;
      const prevDate = previousRun.rows[0].completed_at;

      let prevTeam: any = null;
      if (prevResult?.forecast_data?.team) {
        prevTeam = prevResult.forecast_data.team;
      } else if (prevResult?.team) {
        prevTeam = prevResult.team;
      }

      if (!prevTeam) {
        return { available: false, reason: 'Previous run result missing team data' };
      }

      const calcDelta = (current: number, previous: number) => {
        const delta = current - previous;
        const deltaPercent = previous !== 0 ? (delta / previous) * 100 : (current > 0 ? 100 : 0);
        return {
          from: previous,
          to: current,
          delta,
          deltaPercent: Math.round(deltaPercent * 10) / 10,
          direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
        };
      };

      return {
        available: true,
        previousRunDate: prevDate,
        changes: {
          closedWon: calcDelta(currentData.team.closedWon, prevTeam.closedWon ?? 0),
          commit: calcDelta(currentData.team.commit, prevTeam.commit ?? 0),
          bestCase: calcDelta(currentData.team.bestCase, prevTeam.bestCase ?? 0),
          pipeline: calcDelta(currentData.team.pipeline, prevTeam.pipeline ?? 0),
          bearCase: calcDelta(currentData.team.bearCase, prevTeam.bearCase ?? 0),
          baseCase: calcDelta(currentData.team.baseCase, prevTeam.baseCase ?? 0),
          bullCase: calcDelta(currentData.team.bullCase, prevTeam.bullCase ?? 0),
        },
      };
    }, params);
  },
};

const prepareForecastSummary: ToolDefinition = {
  name: 'prepareForecastSummary',
  description: 'Prepare a pre-formatted summary of forecast data for Claude narrative synthesis.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('prepareForecastSummary', async () => {
      const forecast = (context.stepResults as any).forecast_data;
      const wow = (context.stepResults as any).wow_delta;
      const quotaConfig = (context.stepResults as any).quota_config;

      if (!forecast?.team) {
        return { error: 'No forecast data available' };
      }

      const fmt = (n: number) => `$${(n || 0).toLocaleString('en-US')}`;
      const team = forecast.team;

      let teamSummary = `Closed Won: ${fmt(team.closedWon)} | Commit: ${fmt(team.commit)} | Best Case: ${fmt(team.bestCase)} | Pipeline: ${fmt(team.pipeline)}`;
      teamSummary += `\nBear Case: ${fmt(team.bearCase)} | Base Case: ${fmt(team.baseCase)} | Bull Case: ${fmt(team.bullCase)}`;
      teamSummary += `\nWeighted Forecast: ${fmt(team.weightedForecast)}`;
      teamSummary += `\nSpread (Bull - Bear): ${fmt(team.bullCase - team.bearCase)}`;

      if (team.teamQuota) {
        const att = team.attainment ? `${(team.attainment * 100).toFixed(1)}%` : 'N/A';
        teamSummary += `\nTeam Quota: ${fmt(team.teamQuota)} | Bear Attainment: ${att}`;
      }

      let quotaNote = '';
      if (!quotaConfig?.hasQuotas) {
        quotaNote = 'NOTE: No quota data configured. All analysis uses absolute amounts only. Attainment percentages and rep status are unavailable.';
      } else if (!quotaConfig?.hasRepQuotas) {
        quotaNote = 'NOTE: Team quota is set but per-rep quotas are not configured. Rep-level attainment is unavailable.';
      }

      const dealCounts = forecast.dealCount;
      let countsLine = `Deals — Closed: ${dealCounts.closed} | Commit: ${dealCounts.commit} | Best Case: ${dealCounts.bestCase} | Pipeline: ${dealCounts.pipeline} | Not Forecasted: ${dealCounts.notForecasted} | Total: ${dealCounts.total}`;

      const repRows = (forecast.byRep || []).map((r: any) => {
        let line = `${r.name}: CW=${fmt(r.closedWon)} Commit=${fmt(r.commit)} BC=${fmt(r.bestCase)} Pipe=${fmt(r.pipeline)} (${r.dealCount} deals)`;
        if (r.quota) {
          line += ` | Quota: ${fmt(r.quota)} | Att: ${r.attainment ? (r.attainment * 100).toFixed(1) + '%' : 'N/A'} | Status: ${r.status || 'N/A'}`;
        }
        return line;
      }).join('\n');

      let wowSummary = '';
      if (wow?.available && wow.changes) {
        const c = wow.changes;
        wowSummary = `Previous run: ${new Date(wow.previousRunDate).toLocaleDateString()}\n`;
        wowSummary += `Closed Won: ${fmt(c.closedWon.from)} → ${fmt(c.closedWon.to)} (${c.closedWon.delta >= 0 ? '+' : ''}${fmt(c.closedWon.delta)}, ${c.closedWon.deltaPercent}%)\n`;
        wowSummary += `Commit: ${fmt(c.commit.from)} → ${fmt(c.commit.to)} (${c.commit.delta >= 0 ? '+' : ''}${fmt(c.commit.delta)}, ${c.commit.deltaPercent}%)\n`;
        wowSummary += `Best Case: ${fmt(c.bestCase.from)} → ${fmt(c.bestCase.to)} (${c.bestCase.delta >= 0 ? '+' : ''}${fmt(c.bestCase.delta)}, ${c.bestCase.deltaPercent}%)\n`;
        wowSummary += `Pipeline: ${fmt(c.pipeline.from)} → ${fmt(c.pipeline.to)} (${c.pipeline.delta >= 0 ? '+' : ''}${fmt(c.pipeline.delta)}, ${c.pipeline.deltaPercent}%)\n`;
        wowSummary += `Bear Case: ${fmt(c.bearCase.from)} → ${fmt(c.bearCase.to)} (${c.bearCase.delta >= 0 ? '+' : ''}${fmt(c.bearCase.delta)}, ${c.bearCase.deltaPercent}%)\n`;
        wowSummary += `Base Case: ${fmt(c.baseCase.from)} → ${fmt(c.baseCase.to)} (${c.baseCase.delta >= 0 ? '+' : ''}${fmt(c.baseCase.delta)}, ${c.baseCase.deltaPercent}%)`;
      } else {
        wowSummary = wow?.reason || 'First run — no previous data for comparison.';
      }

      return {
        quotaNote,
        teamSummary,
        dealCounts: countsLine,
        repTable: repRows || 'No rep data available.',
        wowSummary,
      };
    }, params);
  },
};

const gatherPreviousForecast: ToolDefinition = {
  name: 'gatherPreviousForecast',
  description: 'Retrieve the most recent previous forecast run for comparison and trend analysis.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('gatherPreviousForecast', async () => {
      const previousRun = await query(
        `SELECT result, completed_at
         FROM skill_runs
         WHERE workspace_id = $1
           AND skill_id = 'forecast-rollup'
           AND status = 'completed'
           AND run_id != $2
         ORDER BY completed_at DESC
         LIMIT 1`,
        [context.workspaceId, context.runId]
      );

      if (previousRun.rows.length === 0) {
        return {
          available: false,
          reason: 'No previous forecast run found',
        };
      }

      const prevResult = previousRun.rows[0].result;
      const prevDate = previousRun.rows[0].completed_at;

      // Extract forecast_data from previous run
      const prevForecastData = prevResult?.step_results?.forecast_data;

      if (!prevForecastData?.team) {
        return {
          available: false,
          reason: 'Previous run exists but has no forecast data',
        };
      }

      return {
        available: true,
        runDate: prevDate,
        team: prevForecastData.team,
        byRep: prevForecastData.byRep || [],
        dealCount: prevForecastData.dealCount,
      };
    }, params);
  },
};

const gatherDealConcentrationRisk: ToolDefinition = {
  name: 'gatherDealConcentrationRisk',
  description: 'Analyze deal concentration risk by identifying whale deals (>20% quota) and top 3 deals by value.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('gatherDealConcentrationRisk', async () => {
      const quotaConfig = (context.stepResults as any).quota_config;
      const forecast = (context.stepResults as any).forecast_data;

      // Get all open deals sorted by amount
      const deals = await query<{
        id: string;
        name: string;
        amount: number | null;
        probability: number | null;
        forecast_category: string | null;
        stage_normalized: string | null;
        owner_email: string | null;
        close_date: string | null;
      }>(
        `SELECT id, name, amount, probability, forecast_category, stage_normalized, owner_email, close_date
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized NOT IN ('closed_lost', 'closed_won')
           AND amount IS NOT NULL
         ORDER BY amount DESC
         LIMIT 50`,
        [context.workspaceId]
      );

      const nameMap = await resolveOwnerNames(context.workspaceId);
      const fmt = (n: number) => `$${(n || 0).toLocaleString('en-US')}`;

      // Top 3 deals
      const top3 = deals.rows.slice(0, 3).map(d => ({
        name: d.name,
        amount: d.amount || 0,
        probability: d.probability || 0,
        weighted: (d.amount || 0) * (d.probability || 0),
        category: d.forecast_category || 'unknown',
        owner: nameMap[d.owner_email || ''] || d.owner_email || 'Unknown',
        closeDate: d.close_date,
      }));

      let whaleDeals: any[] = [];
      let whaleThreshold = 0;

      if (quotaConfig?.hasQuotas && quotaConfig.teamQuota) {
        whaleThreshold = quotaConfig.teamQuota * 0.2; // 20% of team quota
        whaleDeals = deals.rows
          .filter(d => (d.amount || 0) >= whaleThreshold)
          .map(d => ({
            name: d.name,
            amount: d.amount || 0,
            percentOfQuota: ((d.amount || 0) / quotaConfig.teamQuota) * 100,
            probability: d.probability || 0,
            weighted: (d.amount || 0) * (d.probability || 0),
            category: d.forecast_category || 'unknown',
            owner: nameMap[d.owner_email || ''] || d.owner_email || 'Unknown',
            closeDate: d.close_date,
          }));
      }

      // Calculate concentration metrics
      const totalPipeline = forecast?.team?.baseCase || 0;
      const top3Total = top3.reduce((sum, d) => sum + d.weighted, 0);
      const top3Concentration = totalPipeline > 0 ? (top3Total / totalPipeline) * 100 : 0;

      const whaleTotal = whaleDeals.reduce((sum, d) => sum + d.weighted, 0);
      const whaleConcentration = totalPipeline > 0 ? (whaleTotal / totalPipeline) * 100 : 0;

      return {
        top3Deals: top3,
        top3Total: top3Total,
        top3Concentration: top3Concentration,
        whaleDealCount: whaleDeals.length,
        whaleDeals: whaleDeals,
        whaleThreshold: whaleThreshold,
        whaleTotal: whaleTotal,
        whaleConcentration: whaleConcentration,
        hasQuotaConfig: quotaConfig?.hasQuotas || false,
        riskLevel:
          top3Concentration > 50 || whaleConcentration > 40
            ? 'high'
            : top3Concentration > 30 || whaleConcentration > 25
            ? 'medium'
            : 'low',
      };
    }, params);
  },
};

// ============================================================================
// Pipeline Waterfall Tools
// ============================================================================

import { waterfallAnalysis } from '../analysis/waterfall-analysis.js';
import {
  getStageTransitionsInWindow,
  getAverageTimeInStage,
  getStalledDeals
} from '../analysis/stage-history-queries.js';
import {
  checkDataAvailability,
  repScorecard,
  type DataAvailability,
} from '../analysis/rep-scorecard-analysis.js';

const waterfallAnalysisTool: ToolDefinition = {
  name: 'waterfallAnalysis',
  description: 'Compute stage-by-stage pipeline flow for a time period',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['current', 'previous'],
        description: 'Which period to analyze',
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('waterfallAnalysis', async () => {
      const timeWindows = (context.stepResults as any).time_windows;
      if (!timeWindows) {
        throw new Error('time_windows not found in context');
      }

      const period = params.period || 'current';
      const periodStart = period === 'current'
        ? new Date(timeWindows.analysisRange.start)
        : new Date(timeWindows.previousPeriodRange?.start || timeWindows.analysisRange.start);
      const periodEnd = period === 'current'
        ? new Date(timeWindows.analysisRange.end)
        : new Date(timeWindows.previousPeriodRange?.end || timeWindows.analysisRange.end);

      return await waterfallAnalysis(context.workspaceId, periodStart, periodEnd);
    }, params);
  },
};

const waterfallDeltasTool: ToolDefinition = {
  name: 'waterfallDeltas',
  description: 'Compare current waterfall to previous period and identify anomalies',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('waterfallDeltas', async () => {
      const current = (context.stepResults as any).current_waterfall;
      const previous = (context.stepResults as any).previous_waterfall;

      if (!current || !previous) {
        throw new Error('current_waterfall and previous_waterfall required in context');
      }

      if (!current.stages || !previous.stages) {
        throw new Error('current_waterfall.stages and previous_waterfall.stages are required');
      }

      // Calculate deltas per stage
      const stageDeltas = current.stages.map((curStage: any) => {
        const prevStage = previous.stages.find((s: any) => s.stage === curStage.stage);
        if (!prevStage) {
          return {
            stage: curStage.stage,
            enteredDelta: null,
            advancedDelta: null,
            fellOutDelta: null,
          };
        }

        const calcDelta = (curr: number, prev: number) => {
          if (prev === 0) return curr > 0 ? 100 : 0;
          return Math.round(((curr - prev) / prev) * 100);
        };

        return {
          stage: curStage.stage,
          enteredDelta: calcDelta(curStage.entered, prevStage.entered),
          advancedDelta: calcDelta(curStage.advanced, prevStage.advanced),
          fellOutDelta: calcDelta(curStage.fellOut, prevStage.fellOut),
          enteredChange: curStage.entered - prevStage.entered,
          advancedChange: curStage.advanced - prevStage.advanced,
          fellOutChange: curStage.fellOut - prevStage.fellOut,
        };
      });

      // Identify anomalies (>20% change)
      const anomalies = stageDeltas.filter((d: any) =>
        Math.abs(d.enteredDelta || 0) > 20 ||
        Math.abs(d.advancedDelta || 0) > 20 ||
        Math.abs(d.fellOutDelta || 0) > 20
      );

      // Find biggest leakage (stage with most fell out)
      const biggestLeakage = current.stages.reduce((max: any, stage: any) =>
        stage.fellOut > (max?.fellOut || 0) ? stage : max
      , null);

      // Find biggest bottleneck (lowest advance rate)
      const biggestBottleneck = current.stages
        .filter((s: any) => s.startOfPeriod + s.entered > 0)
        .reduce((min: any, stage: any) => {
          const rate = stage.advanced / (stage.startOfPeriod + stage.entered);
          const minRate = min ? min.advanced / (min.startOfPeriod + min.entered) : 1;
          return rate < minRate ? stage : min;
        }, null);

      // Find fastest stage (highest advance rate)
      const fastestStage = current.stages
        .filter((s: any) => s.startOfPeriod + s.entered > 0)
        .reduce((max: any, stage: any) => {
          const rate = stage.advanced / (stage.startOfPeriod + stage.entered);
          const maxRate = max ? max.advanced / (max.startOfPeriod + max.entered) : 0;
          return rate > maxRate ? stage : max;
        }, null);

      return {
        stageDeltas,
        anomalies,
        biggestLeakage: biggestLeakage ? {
          stage: biggestLeakage.stage,
          count: biggestLeakage.fellOut,
          value: biggestLeakage.fellOutValue,
        } : null,
        biggestBottleneck: biggestBottleneck ? {
          stage: biggestBottleneck.stage,
          advanceRate: (biggestBottleneck.advanced / (biggestBottleneck.startOfPeriod + biggestBottleneck.entered)).toFixed(2),
        } : null,
        fastestStage: fastestStage ? {
          stage: fastestStage.stage,
          advanceRate: (fastestStage.advanced / (fastestStage.startOfPeriod + fastestStage.entered)).toFixed(2),
        } : null,
        summary: `Period over period: Net pipeline ${current.summary.netPipelineChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(current.summary.netPipelineChange)} deals. ${anomalies.length} stage anomalies detected.`,
      };
    }, params);
  },
};

const topDealsInMotionTool: ToolDefinition = {
  name: 'topDealsInMotion',
  description: 'Get top deals that advanced, fell out, or entered during the period',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('topDealsInMotion', async () => {
      const timeWindows = (context.stepResults as any).time_windows;
      if (!timeWindows) {
        throw new Error('time_windows not found in context');
      }

      const transitions = await getStageTransitionsInWindow(
        context.workspaceId,
        new Date(timeWindows.analysisRange.start),
        new Date(timeWindows.analysisRange.end)
      );

      const dealIds = [...new Set(transitions.map(t => t.dealId))];
      const dealResult = await query<{ id: string; amount: number; owner: string }>(
        `SELECT id, amount, owner FROM deals WHERE id = ANY($1)`,
        [dealIds]
      );
      const dealData = new Map(dealResult.rows.map(d => [d.id, { amount: Number(d.amount) || 0, owner: d.owner }]));

      const advanced = transitions
        .filter(t => t.toStageNormalized && !['closed_won', 'closed_lost'].includes(t.toStageNormalized))
        .map(t => ({
          ...t,
          amount: dealData.get(t.dealId)?.amount || 0,
          owner: dealData.get(t.dealId)?.owner || 'Unknown',
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10);

      const fellOut = transitions
        .filter(t => t.toStageNormalized === 'closed_lost')
        .map(t => ({
          ...t,
          amount: dealData.get(t.dealId)?.amount || 0,
          owner: dealData.get(t.dealId)?.owner || 'Unknown',
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10);

      const newDeals = transitions
        .filter(t => !t.fromStageNormalized)
        .map(t => ({
          ...t,
          amount: dealData.get(t.dealId)?.amount || 0,
          owner: dealData.get(t.dealId)?.owner || 'Unknown',
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      return {
        topAdvanced: advanced,
        topFellOut: fellOut,
        topNew: newDeals,
      };
    }, params);
  },
};

const velocityBenchmarksTool: ToolDefinition = {
  name: 'velocityBenchmarks',
  description: 'Get average time-in-stage benchmarks',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('velocityBenchmarks', async () => {
      const avgTimes = await getAverageTimeInStage(context.workspaceId);

      // Also get current period transitions to compare
      const timeWindows = (context.stepResults as any).time_windows;
      if (timeWindows) {
        const transitions = await getStageTransitionsInWindow(
          context.workspaceId,
          new Date(timeWindows.analysisRange.start),
          new Date(timeWindows.analysisRange.end)
        );

        // Calculate average for this period
        const periodAvgs = new Map<string, { sum: number; count: number }>();
        for (const t of transitions) {
          if (t.fromStageNormalized && t.durationInPreviousStageDays) {
            if (!periodAvgs.has(t.fromStageNormalized)) {
              periodAvgs.set(t.fromStageNormalized, { sum: 0, count: 0 });
            }
            const agg = periodAvgs.get(t.fromStageNormalized)!;
            agg.sum += t.durationInPreviousStageDays;
            agg.count++;
          }
        }

        // Enrich with period comparison
        return avgTimes.map(stage => {
          const periodData = periodAvgs.get(stage.stage);
          const thisPeriodAvg = periodData ? periodData.sum / periodData.count : null;
          const delta = thisPeriodAvg ? thisPeriodAvg - stage.avgDays : null;
          const trend = delta && Math.abs(delta) > stage.avgDays * 0.2
            ? (delta > 0 ? 'slower' : 'faster')
            : 'stable';

          return {
            ...stage,
            thisPeriodAvgDays: thisPeriodAvg,
            delta,
            trend,
          };
        });
      }

      return avgTimes;
    }, params);
  },
};

// ============================================================================
// Rep Scorecard Tools
// ============================================================================

const checkDataAvailabilityTool: ToolDefinition = {
  name: 'checkDataAvailability',
  description: 'Check which data sources are available for this workspace (quotas, activities, conversations, stage history)',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('checkDataAvailability', async () => {
      const availability = await checkDataAvailability(context.workspaceId);

      // Determine tier
      let tier = 'Tier 0 (Deals only)';
      if (availability.hasQuotas && availability.hasStageHistory && availability.hasActivities && availability.hasConversations) {
        tier = 'Tier 4 (Full data)';
      } else if (availability.hasQuotas && availability.hasStageHistory && availability.hasActivities) {
        tier = 'Tier 3 (Deals + Quotas + History + Activities)';
      } else if (availability.hasQuotas && availability.hasStageHistory) {
        tier = 'Tier 2 (Deals + Quotas + History)';
      } else if (availability.hasQuotas) {
        tier = 'Tier 1 (Deals + Quotas)';
      }

      console.log(`[Rep Scorecard] Operating at ${tier}`);
      console.log(`[Rep Scorecard] Data availability: quotas=${availability.hasQuotas} (${availability.quotaCount}), activities=${availability.hasActivities} (${availability.activityCount}), conversations=${availability.hasConversations} (${availability.conversationCount}), stageHistory=${availability.hasStageHistory} (${availability.stageHistoryCount})`);

      return {
        ...availability,
        tier,
      };
    }, params);
  },
};

const repScorecardComputeTool: ToolDefinition = {
  name: 'repScorecardCompute',
  description: 'Compute composite scorecard for all reps with adaptive weighting',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('repScorecardCompute', async () => {
      const timeWindows = (context.stepResults as any).time_windows;
      const dataAvailability = (context.stepResults as any).data_availability as DataAvailability;

      if (!timeWindows || !dataAvailability) {
        throw new Error('time_windows and data_availability required in context');
      }

      const periodStart = new Date(timeWindows.analysisRange?.start || timeWindows.quarterStart);
      const periodEnd = new Date(timeWindows.analysisRange?.end || timeWindows.quarterEnd);
      const changeWindowStart = new Date(timeWindows.changeRange.start);
      const changeWindowEnd = new Date(timeWindows.changeRange.end);

      const result = await repScorecard(
        context.workspaceId,
        periodStart,
        periodEnd,
        changeWindowStart,
        changeWindowEnd,
        dataAvailability
      );

      console.log(`[Rep Scorecard] Scored ${result.reps.length} reps. Top: ${result.top3[0]?.repName} (${result.top3[0]?.overallScore}), Bottom: ${result.bottom3[0]?.repName} (${result.bottom3[0]?.overallScore})`);

      return result;
    }, params);
  },
};

// ============================================================================
// Custom Field Discovery Tools
// ============================================================================

const discoverCustomFieldsTool: ToolDefinition = {
  name: 'discoverCustomFields',
  description: 'Automatically discover which CRM custom fields are meaningful for ICP analysis based on variance and win/loss correlation',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      enableClassification: {
        type: 'boolean',
        description: 'Enable DeepSeek semantic classification of fields (adds ~$0.003 cost)',
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('discoverCustomFields', async () => {
      const result = await discoverCustomFields(context.workspaceId, {
        enableClassification: params.enableClassification ?? false,
      });

      console.log(`[Custom Field Discovery] Discovered ${result.topFields.length} high-relevance fields (score >= 50)`);

      return result;
    }, params);
  },
};

const generateCustomFieldReportTool: ToolDefinition = {
  name: 'generateCustomFieldReport',
  description: 'Generate a markdown report from custom field discovery results',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('generateCustomFieldReport', async () => {
      const discoveryResult = (context.stepResults as any).discovery_result as CustomFieldDiscoveryResult;

      if (!discoveryResult) {
        throw new Error('discovery_result not found in context. Run discoverCustomFields first.');
      }

      const report = generateDiscoveryReport(discoveryResult);

      console.log(`[Custom Field Discovery] Generated report (${report.length} chars)`);

      return {
        report,
        topFields: discoveryResult.topFields,
        discoveredFields: discoveryResult.discoveredFields,
        entityBreakdown: discoveryResult.entityBreakdown,
        metadata: discoveryResult.metadata,
      };
    }, params);
  },
};

// ============================================================================
// Lead Scoring Tools
// ============================================================================

const scoreLeadsTool: ToolDefinition = {
  name: 'scoreLeads',
  description: 'Score open deals and contacts using point-based scoring with engagement, threading, velocity, and custom field signals',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('scoreLeads', async () => {
      const result = await scoreLeads(context.workspaceId);

      console.log(`[Lead Scoring] Scored ${result.dealScores.length} deals and ${result.contactScores.length} contacts`);

      return result;
    }, params);
  },
};

// ============================================================================
// Contact Role Resolution Tools
// ============================================================================

const resolveContactRolesTool: ToolDefinition = {
  name: 'resolveContactRoles',
  description: 'Resolve buying roles for deal contacts using multi-source inference (CRM, titles, activities, conversations)',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: {
        type: 'string',
        description: 'Optional deal ID to resolve roles for a specific deal. If not provided, resolves all deals.',
      },
      includeClosedDeals: {
        type: 'boolean',
        description: 'Include closed_won and closed_lost deals in resolution. Required for ICP Discovery which needs closed deal contact data. Default: false (only open deals).',
      },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('resolveContactRoles', async () => {
      const result = await resolveContactRoles(context.workspaceId, params.dealId, {
        includeClosedDeals: params.includeClosedDeals ?? false,
      });

      console.log(`[Contact Role Resolution] Resolved ${result.contactsResolved.total} contacts across ${result.dealsProcessed} deals`);

      return result;
    }, params);
  },
};

const generateContactRoleReportTool: ToolDefinition = {
  name: 'generateContactRoleReport',
  description: 'Generate a markdown report from contact role resolution results',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('generateContactRoleReport', async () => {
      const resolutionResult = (context.stepResults as any).resolution_result as ResolutionResult;

      if (!resolutionResult || !resolutionResult.contactsResolved) {
        throw new Error('resolution_result not found or incomplete in context. Run resolveContactRoles first.');
      }

      const report = generateResolutionReport(resolutionResult);

      console.log(`[Contact Role Resolution] Generated report (${report.length} chars)`);

      return {
        report,
        ...resolutionResult,
      };
    }, params);
  },
};

function generateResolutionReport(result: ResolutionResult): string {
  const pct = (num: number, total: number) => total > 0 ? Math.round((num / total) * 100) : 0;

  const sourceTable = Object.entries(result.contactsResolved.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => {
      const confidence = {
        crm_contact_role: '0.95',
        crm_deal_field: '0.90',
        cross_deal_match: '0.70',
        conversation_participant: '0.65',
        title_match: '0.50',
        activity_inference: '0.40',
        activity_discovery: '0.35',
        account_seniority_match: '0.25',
      }[source] || '—';

      return `| ${source} | ${count} | ${confidence} |`;
    })
    .join('\n');

  const roleTable = Object.entries(result.roleDistribution)
    .filter(([role]) => role !== 'unknown')
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => {
      return `| ${role} | ${count} | ${pct(count, result.totalDeals)}% |`;
    })
    .join('\n');

  const newContacts = result.newDiscoveries.fromActivities +
    result.newDiscoveries.fromConversations +
    result.newDiscoveries.fromAccountMatch;

  const resolvedCount = Object.values(result.roleDistribution).reduce((a, b) => a + b, 0) -
    (result.roleDistribution['unknown'] || 0);
  const unresolvedCount = result.roleDistribution['unknown'] || 0;

  return `# Contact Role Resolution Report

## Summary
- Deals processed: ${result.dealsProcessed}
- Total contacts mapped: ${result.contactsResolved.total}${newContacts > 0 ? ` (${newContacts} newly discovered)` : ''}
- Roles resolved: ${resolvedCount} / ${result.contactsResolved.total} (${pct(resolvedCount, result.contactsResolved.total)}%)
- Average contacts per deal: ${result.avgContactsPerDeal}
- Average roles per deal: ${result.avgRolesPerDeal}

## Resolution Sources
| Source | Count | Confidence |
|--------|-------|-----------|
${sourceTable}
${unresolvedCount > 0 ? `| Unresolved | ${unresolvedCount} | — |` : ''}

## Buying Committee Coverage
| Role | Count | % of Deals |
|------|-------|-----------|
${roleTable}

## Deal Threading Quality
- **Deals with champion**: ${result.dealsWithChampion} (${pct(result.dealsWithChampion, result.totalDeals)}%)
- **Deals with economic buyer**: ${result.dealsWithEconomicBuyer} (${pct(result.dealsWithEconomicBuyer, result.totalDeals)}%)
- **Fully threaded deals** (3+ roles including champion + EB/DM): ${result.dealsFullyThreaded} (${pct(result.dealsFullyThreaded, result.totalDeals)}%)

## Gaps
${result.dealsWithNoContacts > 0 ? `- **${result.dealsWithNoContacts} deals have zero contacts** (all resolution sources exhausted)\n` : ''}${result.dealsWithNoRoles > 0 ? `- **${result.dealsWithNoRoles} deals have contacts but no identified roles**\n` : ''}${result.totalDeals - result.dealsWithChampion > 0 ? `- **${result.totalDeals - result.dealsWithChampion} deals missing champion**\n` : ''}${result.totalDeals - result.dealsWithEconomicBuyer > 0 ? `- **${result.totalDeals - result.dealsWithEconomicBuyer} deals missing economic buyer**\n` : ''}
${newContacts > 0 ? `## New Discoveries
- From activities: ${result.newDiscoveries.fromActivities}
- From conversations: ${result.newDiscoveries.fromConversations}
- From account seniority match: ${result.newDiscoveries.fromAccountMatch}
` : ''}
---
*Resolution completed in ${Math.round(result.executionMs / 1000)}s*
`;
}

// ============================================================================
// ICP Discovery Tools
// ============================================================================

const discoverICPTool: ToolDefinition = {
  name: 'discoverICP',
  description: 'Discover ideal customer profile patterns from closed deal data (personas, buying committees, company sweet spots)',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('discoverICP', async () => {
      const result = await discoverICP(context.workspaceId);

      console.log(`[ICP Discovery] Mode: ${result.mode}, Analyzed ${result.metadata.dealsAnalyzed} deals, Discovered ${result.personas.length} personas`);

      return result;
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
  ['dealThreadingAnalysis', dealThreadingAnalysisTool],
  ['enrichCriticalDeals', enrichCriticalDealsTool],
  ['dataQualityAudit', dataQualityAuditTool],
  ['gatherQualityTrend', gatherQualityTrend],
  ['enrichWorstOffenders', enrichWorstOffenders],
  ['summarizeForClaude', summarizeForClaude],
  ['checkQuotaConfig', checkQuotaConfig],
  ['coverageByRep', coverageByRepTool],
  ['coverageTrend', coverageTrendTool],
  ['repPipelineQuality', repPipelineQualityTool],
  ['prepareAtRiskReps', prepareAtRiskReps],
  ['checkWorkspaceHasConversations', checkWorkspaceHasConversations],
  ['auditConversationDealCoverage', auditConversationDealCoverage],
  ['getCWDByRep', getCWDByRepTool],
  ['forecastRollup', forecastRollup],
  ['forecastWoWDelta', forecastWoWDelta],
  ['prepareForecastSummary', prepareForecastSummary],
  ['gatherPreviousForecast', gatherPreviousForecast],
  ['gatherDealConcentrationRisk', gatherDealConcentrationRisk],
  ['waterfallAnalysis', waterfallAnalysisTool],
  ['waterfallDeltas', waterfallDeltasTool],
  ['topDealsInMotion', topDealsInMotionTool],
  ['velocityBenchmarks', velocityBenchmarksTool],
  ['checkDataAvailability', checkDataAvailabilityTool],
  ['repScorecardCompute', repScorecardComputeTool],
  ['discoverCustomFields', discoverCustomFieldsTool],
  ['generateCustomFieldReport', generateCustomFieldReportTool],
  ['scoreLeads', scoreLeadsTool],
  ['resolveContactRoles', resolveContactRolesTool],
  ['generateContactRoleReport', generateContactRoleReportTool],
  ['discoverICP', discoverICPTool],
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
