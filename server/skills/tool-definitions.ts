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
import {
  getBusinessContext as fetchBusinessContext,
  getGoals,
  getDefinitions as fetchDefinitions,
  getMaturity as fetchMaturity,
  getContext,
} from '../context/index.js';

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
    return safeExecute('getActivitySummary', () =>
      activityTools.getActivitySummary(context.workspaceId, params.days), params);
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
