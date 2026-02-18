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
import { formatCurrency } from '../utils/format-currency.js';
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
import { prepareBowtieSummary, type BowtieSummary } from './compute/bowtie-analysis.js';
import { preparePipelineGoalsSummary } from './compute/pipeline-goals.js';
import { prepareProjectRecap } from './compute/project-recap.js';
import { prepareStrategyInsights } from './compute/strategy-insights.js';
import { runConfigAudit } from './compute/workspace-config-audit.js';
import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { addConfigSuggestion } from '../config/config-suggestions.js';
import {
  findConversationsWithoutDeals,
  getTopCWDConversations,
  getCWDByRep,
  type ConversationWithoutDeal,
  type CWDResult,
} from '../analysis/conversation-without-deals.js';
import {
  checkWorkspaceHasConversations as checkConversations,
} from './tools/check-workspace-has-conversations.js';
import {
  auditConversationDealCoverage as auditCWDCoverage,
} from './tools/audit-conversation-deal-coverage.js';
import { getDealRiskScore } from '../tools/deal-risk-score.js';
import { getPipelineRiskSummary } from '../tools/pipeline-risk-summary.js';

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
  description: 'Compute pipeline coverage ratio (pipeline value ÷ quota target) and generate full snapshot with ICP quality summary.',
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
    return safeExecute('computePipelineCoverage', async () => {
      const staleThreshold = await configLoader.getStaleThreshold(context.workspaceId);
      const staleDays = params.staleDaysThreshold || staleThreshold.warning;
      const snapshot = await generatePipelineSnapshot(context.workspaceId, params.quota, staleDays);

      // Load ICP scores for all open deals
      const icpResult = await query(
        `SELECT ls.score_grade, d.amount, d.id, d.stage_normalized, d.last_activity_date
         FROM lead_scores ls
         JOIN deals d ON d.id = ls.entity_id AND d.workspace_id = ls.workspace_id
         WHERE ls.workspace_id = $1
           AND ls.entity_type = 'deal'
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')`,
        [context.workspaceId]
      );

      const hasIcpScores = icpResult.rows.length > 0;

      if (!hasIcpScores) {
        return { ...snapshot, icpSummary: null };
      }

      // Build ICP quality summary
      const icpSummary: any = {
        total_scored: icpResult.rows.length,
        by_grade: {
          A: { count: 0, value: 0 },
          B: { count: 0, value: 0 },
          C: { count: 0, value: 0 },
          D: { count: 0, value: 0 },
          F: { count: 0, value: 0 },
        },
        ab_grade_pct: 0,
        df_grade_pct: 0,
        high_fit_stale_count: 0,
        low_fit_active_count: 0,
        high_fit_stuck_count: 0,
      };

      let totalValue = 0;

      for (const row of icpResult.rows) {
        const grade = row.score_grade;
        const amount = Number(row.amount || 0);
        totalValue += amount;

        if (icpSummary.by_grade[grade]) {
          icpSummary.by_grade[grade].count++;
          icpSummary.by_grade[grade].value += amount;
        }

        // Count risk signals
        const daysStale = row.last_activity_date
          ? Math.floor((Date.now() - new Date(row.last_activity_date).getTime()) / (1000 * 60 * 60 * 24))
          : 999;

        if (grade === 'A' && daysStale > staleDays) {
          icpSummary.high_fit_stale_count++;
        }

        if ((grade === 'D' || grade === 'F')) {
          icpSummary.low_fit_active_count++;
        }

        const isEarlyStage = ['qualification', 'discovery', 'demo'].includes(row.stage_normalized);
        // Estimate days_in_stage (would need stage_history for exact value)
        if ((grade === 'A' || grade === 'B') && isEarlyStage && daysStale > 14) {
          icpSummary.high_fit_stuck_count++;
        }
      }

      icpSummary.ab_grade_pct = totalValue > 0
        ? Math.round(((icpSummary.by_grade.A.value + icpSummary.by_grade.B.value) / totalValue) * 100)
        : 0;

      icpSummary.df_grade_pct = totalValue > 0
        ? Math.round(((icpSummary.by_grade.D.value + icpSummary.by_grade.F.value) / totalValue) * 100)
        : 0;

      return { ...snapshot, icpSummary };
    }, params);
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
  description: 'Get stale deals pre-aggregated into summary, severity buckets, per-owner breakdown, and top N deals. Includes ICP grade risk signals if available.',
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
      const staleThreshold = await configLoader.getStaleThreshold(context.workspaceId);
      const staleDays = params.staleDays || staleThreshold.warning;
      const topN = params.topN || 20;
      const [deals, nameMap] = await Promise.all([
        dealTools.getStaleDeals(context.workspaceId, staleDays),
        resolveOwnerNames(context.workspaceId),
      ]);

      // Load ICP scores for stale deals (if available)
      const dealIds = deals.map((d: any) => d.id);
      let icpScoresMap = new Map<string, { score: number; grade: string }>();
      let hasIcpScores = false;

      if (dealIds.length > 0) {
        const scoresResult = await query(
          `SELECT entity_id, total_score, score_grade
           FROM lead_scores
           WHERE workspace_id = $1
             AND entity_type = 'deal'
             AND entity_id = ANY($2)`,
          [context.workspaceId, dealIds]
        );

        hasIcpScores = scoresResult.rows.length > 0;
        for (const row of scoresResult.rows) {
          icpScoresMap.set(row.entity_id, {
            score: Number(row.total_score),
            grade: row.score_grade,
          });
        }
      }

      const staleItems = deals.map(pickStaleDealFields).map(d => {
        const icpData = icpScoresMap.get(d.dealId);
        return {
          ...d,
          owner: resolveOwnerName(d.owner, nameMap),
          icp_grade: icpData?.grade ?? null,
          icp_score: icpData?.score ?? null,
        };
      });

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

      // Add ICP-aware risk signals
      const icpRiskSignals: any[] = [];
      if (hasIcpScores) {
        for (const deal of staleItems) {
          // High-fit deal going stale — biggest loss risk
          if (deal.icp_grade === 'A' && deal.daysStale > staleDays) {
            icpRiskSignals.push({
              type: 'high_fit_stale',
              severity: 'high',
              deal_id: deal.dealId,
              deal_name: deal.name,
              amount: deal.amount,
              days_stale: deal.daysStale,
              icp_grade: deal.icp_grade,
              message: `${deal.name} is A-grade ICP fit ($${deal.amount}) but stale for ${deal.daysStale} days — high priority recovery`,
            });
          }
        }
      }

      // FEEDBACK SIGNAL: Parking lot detection
      if (staleItems.length >= 10) {
        const totalStale = staleItems.length;
        const sortedStages = Object.entries(byStage)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 3);

        for (const [stageName, stats] of sortedStages) {
          const concentration = stats.count / totalStale;
          // If a stage has >40% of stale deals, it's likely a parking lot
          if (concentration > 0.40 && stats.count >= 5) {
            await addConfigSuggestion(context.workspaceId, {
              source_skill: 'pipeline-hygiene',
              section: 'pipelines',
              path: 'pipelines[0].parking_lot_stages',
              type: 'add',
              message: `${Math.round(concentration * 100)}% of stale deals (${stats.count} of ${totalStale}) are in "${stageName}" stage`,
              evidence: `${stats.count} deals worth ${formatCurrency(stats.totalValue)}, avg ${Math.round(avgDaysStale)} days stale`,
              confidence: Math.min(0.95, 0.6 + concentration),
              suggested_value: [stageName],
              current_value: null,
            }).catch(err => console.error('[Feedback Signal] Error adding parking lot suggestion:', err));
          }
        }
      }

      // FEEDBACK SIGNAL: Stale threshold calibration
      if (staleItems.length >= 10) {
        const p75Index = Math.floor(staleItems.length * 0.75);
        const sortedByDays = [...staleItems].sort((a, b) => a.daysStale - b.daysStale);
        const p75Days = sortedByDays[p75Index]?.daysStale || 0;

        // If P75 is significantly different from threshold, suggest adjustment
        if (p75Days > staleDays * 2) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'pipeline-hygiene',
            section: 'thresholds',
            path: 'thresholds.stale_deal_days',
            type: 'adjust',
            message: `75% of stale deals are aging beyond ${p75Days} days (current threshold: ${staleDays} days)`,
            evidence: `${staleItems.length} stale deals, P75=${p75Days}d, P50=${sortedByDays[Math.floor(staleItems.length * 0.5)]?.daysStale || 0}d`,
            confidence: 0.7,
            suggested_value: Math.round(p75Days * 0.8),
            current_value: staleDays,
          }).catch(err => console.error('[Feedback Signal] Error adding stale threshold suggestion:', err));
        } else if (p75Days < staleDays * 0.5 && staleItems.length < 5) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'pipeline-hygiene',
            section: 'thresholds',
            path: 'thresholds.stale_deal_days',
            type: 'adjust',
            message: `Very few stale deals (${staleItems.length}) and P75 is only ${p75Days} days (threshold: ${staleDays} days). Consider tightening threshold.`,
            evidence: `Only ${staleItems.length} stale deals, P75=${p75Days}d`,
            confidence: 0.6,
            suggested_value: Math.max(7, Math.round(p75Days * 1.2)),
            current_value: staleDays,
          }).catch(err => console.error('[Feedback Signal] Error adding stale threshold suggestion:', err));
        }
      }

      return {
        summary: { total: summary.total, totalValue: summary.totalValue, avgDaysStale },
        bySeverity,
        byOwner,
        byStage,
        topDeals: topItems,
        remaining,
        hasIcpScores,
        icpRiskSignals,
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
      const staleThreshold = await configLoader.getStaleThreshold(context.workspaceId);
      const staleDays = params.staleDays || staleThreshold.warning;

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

      // FEEDBACK SIGNAL: Threading rule calibration
      if (threadingData.summary.totalOpenDeals >= 20) {
        const singleThreadedPct = threadingData.summary.singleThreaded.count / threadingData.summary.totalOpenDeals;
        const multiThreadedPct = threadingData.summary.multiThreaded.count / threadingData.summary.totalOpenDeals;

        // If >70% of deals are actually multi-threaded, current threshold might be working
        // If <30% are multi-threaded, threshold might be too strict or team isn't multi-threading
        if (multiThreadedPct > 0.70) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'single-thread-alert',
            section: 'thresholds',
            path: 'thresholds.threading_requires_distinct',
            type: 'confirm',
            message: `${Math.round(multiThreadedPct * 100)}% of deals (${threadingData.summary.multiThreaded.count} of ${threadingData.summary.totalOpenDeals}) are multi-threaded. Current threading practices are strong.`,
            evidence: `Single-threaded: ${threadingData.summary.singleThreaded.count} deals`,
            confidence: 0.8,
            suggested_value: null,
            current_value: null,
          }).catch(err => console.error('[Feedback Signal] Error adding threading confirmation:', err));
        } else if (multiThreadedPct < 0.30) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'single-thread-alert',
            section: 'thresholds',
            path: 'thresholds.threading_requires_distinct',
            type: 'alert',
            message: `Only ${Math.round(multiThreadedPct * 100)}% of deals (${threadingData.summary.multiThreaded.count} of ${threadingData.summary.totalOpenDeals}) are multi-threaded. ${threadingData.summary.singleThreaded.count} deals at risk of single-threading.`,
            evidence: `Critical: ${threadingData.criticalDeals.length} deals, Warning: ${threadingData.warningDeals.length} deals`,
            confidence: 0.85,
            suggested_value: null,
            current_value: null,
          }).catch(err => console.error('[Feedback Signal] Error adding threading alert:', err));
        }
      }

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

      // FEEDBACK SIGNAL: Required field discovery
      for (const entity of ['deals', 'contacts', 'accounts'] as const) {
        const fieldCompleteness = qualityData.byEntity[entity].fieldCompleteness || [];
        for (const fieldData of fieldCompleteness) {
          // If a field has >80% fill rate and is not already in required_fields, suggest it
          if (fieldData.fillRate > 0.80 && fieldData.fillRate < 0.95) {
            // High adoption but not enforced - likely should be required
            await addConfigSuggestion(context.workspaceId, {
              source_skill: 'data-quality-audit',
              section: 'thresholds',
              path: 'thresholds.required_fields',
              type: 'add',
              message: `${entity}.${fieldData.field} is filled in ${Math.round(fieldData.fillRate * 100)}% of records but not enforced as required`,
              evidence: `${fieldData.filled} of ${fieldData.total} ${entity} have this field populated`,
              confidence: 0.75,
              suggested_value: `${entity}.${fieldData.field}`,
              current_value: null,
            }).catch(err => console.error('[Feedback Signal] Error adding required field suggestion:', err));
          }
        }
      }

      // FEEDBACK SIGNAL: Excluded owner detection (owners with systematic data quality issues)
      for (const ownerData of filteredOwners) {
        if (ownerData.avgCompleteness < 50 && ownerData.criticalIssues > 10) {
          // Systematic neglect - might be an excluded/inactive user
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'data-quality-audit',
            section: 'teams',
            path: 'teams.excluded_owners',
            type: 'add',
            message: `${ownerData.owner} has ${ownerData.avgCompleteness}% avg completeness and ${ownerData.criticalIssues} critical issues - may be inactive`,
            evidence: `Consistent data quality issues across ${ownerData.totalRecords} records`,
            confidence: 0.65,
            suggested_value: ownerData.owner,
            current_value: null,
          }).catch(err => console.error('[Feedback Signal] Error adding excluded owner suggestion:', err));
        }
      }

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

const truncateConversations: ToolDefinition = {
  name: 'truncateConversations',
  description: 'Truncate conversation transcripts to fit within DeepSeek token limits. Keeps metadata and trims transcript text.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('truncateConversations', async () => {
      const conversations = (context.stepResults as any).recent_conversations;
      if (!conversations?.conversations || conversations.conversations.length === 0) {
        return [];
      }
      const convos = conversations.conversations;
      const maxTranscriptChars = Math.floor(40000 / Math.max(convos.length, 1));
      return convos.map((c: any) => {
        const trimmed: any = {
          id: c.id,
          title: c.title,
          date: c.date || c.started_at,
          participants: c.participants,
          deal_id: c.deal_id,
          account_id: c.account_id,
          source: c.source,
        };
        if (c.transcript) {
          trimmed.transcript = typeof c.transcript === 'string'
            ? c.transcript.substring(0, maxTranscriptChars)
            : JSON.stringify(c.transcript).substring(0, maxTranscriptChars);
        }
        if (c.source_data?.summary) {
          trimmed.summary = c.source_data.summary;
        }
        return trimmed;
      });
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
          const quota = r.quota !== null ? formatCurrency(r.quota) : 'N/A';
          const pipeline = formatCurrency(r.pipeline);
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
            const pipelineChange = formatCurrency(d.pipelineChange);
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

      // Handle weekly-recap
      if (skillId === 'weekly-recap') {
        const pipeline = (context.stepResults as any).current_pipeline;
        const closedWon = (context.stepResults as any).closed_won;
        const closedLost = (context.stepResults as any).closed_lost;
        const recentDeals = (context.stepResults as any).recent_deals;
        const activity = (context.stepResults as any).weekly_activity;
        const callHighlights = (context.stepResults as any).call_highlights;

        const summarizeDealList = (deals: any, label: string, limit: number) => {
          if (!deals?.deals || deals.deals.length === 0) return `${label}: None`;
          const top = deals.deals.slice(0, limit).map((d: any) =>
            `- ${d.name}: $${(d.amount || 0).toLocaleString()} | Stage: ${d.stage_normalized || d.stage} | Close: ${d.close_date || 'N/A'} | Owner: ${d.owner_name || 'Unknown'}`
          );
          const remaining = deals.deals.length - limit;
          const extra = remaining > 0 ? `\n  ... and ${remaining} more` : '';
          return `${label} (${deals.deals.length} total, $${(deals.summary?.totalValue || 0).toLocaleString()}):\n${top.join('\n')}${extra}`;
        };

        const pipelineSummary = pipeline
          ? `Pipeline: $${(pipeline.totalValue || 0).toLocaleString()} across ${pipeline.totalDeals || 0} deals. Avg: $${(pipeline.avgDealSize || 0).toLocaleString()}.`
          : 'Pipeline data not available.';

        const activitySummary = activity
          ? `Activity: ${JSON.stringify(activity)}`
          : 'No activity data.';

        const wonStr = summarizeDealList(closedWon, 'Closed Won', 10);
        const lostStr = summarizeDealList(closedLost, 'Closed Lost', 10);
        const newStr = summarizeDealList(recentDeals, 'Recent Deals', 10);

        let callStr = 'No call highlights available.';
        if (callHighlights && typeof callHighlights === 'object' && !callHighlights.error) {
          callStr = JSON.stringify(callHighlights);
          if (callStr.length > 2000) callStr = callStr.substring(0, 2000) + '...';
        }

        return {
          pipelineSummary,
          activitySummary,
          wonDeals: wonStr,
          lostDeals: lostStr,
          newDeals: newStr,
          callHighlights: callStr,
        };
      }

      if (skillId === 'deal-risk-review') {
        const openDeals = (context.stepResults as any).open_deals;
        const callSignals = (context.stepResults as any).call_signals;

        if (!openDeals?.deals || openDeals.deals.length === 0) {
          return { dealProfiles: 'No open deals found.', signalsSummary: 'N/A' };
        }

        const deals = openDeals.deals.slice(0, 20);
        const dealIds = deals.map((d: any) => d.id);

        const activitiesResult = await query(
          `SELECT deal_id, activity_type, COUNT(*)::int as cnt,
                  MAX(timestamp) as last_date
           FROM activities
           WHERE workspace_id = $1 AND deal_id = ANY($2)
           GROUP BY deal_id, activity_type
           ORDER BY deal_id, last_date DESC`,
          [context.workspaceId, dealIds]
        );

        const actByDeal = new Map<string, { types: string; lastActivity: string }>();
        const actMap = new Map<string, { types: string[]; lastDate: string }>();
        for (const row of activitiesResult.rows) {
          const key = row.deal_id;
          if (!actMap.has(key)) actMap.set(key, { types: [], lastDate: row.last_date });
          const entry = actMap.get(key)!;
          entry.types.push(`${row.activity_type}:${row.cnt}`);
          if (new Date(row.last_date) > new Date(entry.lastDate)) entry.lastDate = row.last_date;
        }
        for (const [did, data] of actMap) {
          actByDeal.set(did, { types: data.types.join(', '), lastActivity: data.lastDate });
        }

        const contactsResult = await query(
          `SELECT dc.deal_id, COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name, c.email) as name, c.title, c.email
           FROM deal_contacts dc
           JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
           WHERE dc.workspace_id = $1 AND dc.deal_id = ANY($2)
           ORDER BY dc.deal_id`,
          [context.workspaceId, dealIds]
        );

        const contactsByDeal = new Map<string, string[]>();
        for (const row of contactsResult.rows) {
          const key = row.deal_id;
          if (!contactsByDeal.has(key)) contactsByDeal.set(key, []);
          contactsByDeal.get(key)!.push(`${row.name || 'Unknown'}${row.title ? ' (' + row.title + ')' : ''}`);
        }

        const profiles = deals.map((d: any) => {
          const act = actByDeal.get(d.id);
          const contacts = contactsByDeal.get(d.id) || [];
          const daysSinceActivity = act?.lastActivity
            ? Math.floor((Date.now() - new Date(act.lastActivity).getTime()) / 86400000)
            : null;
          const daysSinceUpdate = d.updated_at
            ? Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 86400000)
            : null;

          return `DEAL: ${d.name} | $${(d.amount || 0).toLocaleString()} | Stage: ${d.stage_normalized || d.stage} | Close: ${d.close_date || 'N/A'} | Owner: ${d.owner_name || 'N/A'}
  Activity: ${act ? `${act.types} | Last: ${daysSinceActivity}d ago` : `No activities | Updated: ${daysSinceUpdate !== null ? daysSinceUpdate + 'd ago' : 'N/A'}`}
  Contacts (${contacts.length}): ${contacts.length > 0 ? contacts.slice(0, 5).join('; ') : 'None'}${contacts.length > 5 ? ` +${contacts.length - 5} more` : ''}
  Single-threaded: ${contacts.length <= 1 ? 'YES' : 'No'}`;
        });

        let signalsSummary = 'No call signals available.';
        if (Array.isArray(callSignals) && callSignals.length > 0) {
          const byDeal = new Map<string, string[]>();
          for (const s of callSignals) {
            const key = s.dealId || 'unlinked';
            if (!byDeal.has(key)) byDeal.set(key, []);
            byDeal.get(key)!.push(`[${s.severity}] ${s.type}: ${s.context}`);
          }
          const parts: string[] = [];
          for (const [did, signals] of byDeal) {
            parts.push(`Deal ${did}: ${signals.join(' | ')}`);
          }
          signalsSummary = parts.join('\n');
        }

        const hasActivities = activitiesResult.rows.length > 0;
        const hasContacts = contactsResult.rows.length > 0;

        return {
          dealProfiles: profiles.join('\n\n'),
          signalsSummary,
          dealCount: deals.length,
          contactCoverage: hasContacts
            ? `${deals.filter((d: any) => (contactsByDeal.get(d.id)?.length || 0) > 1).length}/${deals.length} multi-threaded`
            : 'No contact data available',
          dataAvailability: {
            hasActivities,
            hasContacts,
            activityNote: hasActivities ? null : 'Activity data not available. Use deal updated_at as staleness proxy.',
            contactNote: hasContacts ? null : 'Contact data not available. Skip single-threading analysis.',
          },
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
      const coverageTarget = (goals as any).pipeline_coverage_target ?? await configLoader.getCoverageTarget(context.workspaceId);
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

      const coverageTarget = params.coverageTarget ?? quotaConfig?.coverageTarget ?? undefined;

      const quotas = params.quotas ?? (quotaConfig ? {
        team: quotaConfig.teamQuota ?? null,
        byRep: quotaConfig.repQuotas ?? null,
      } : undefined);

      const excludedOwners = (context.businessContext as any)?.excluded_owners
        ?? (context.businessContext as any)?.definitions?.excluded_owners
        ?? [];

      const coverageData = await coverageByRep(
        context.workspaceId,
        quarterStart,
        quarterEnd,
        quotas,
        coverageTarget,
        excludedOwners.length > 0 ? excludedOwners : undefined
      );

      // FEEDBACK SIGNAL: Segmentation signal (deal size variance)
      const dealSizeResult = await query<{ p25: number; p75: number; p95: number; count: number }>(
        `SELECT
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) as p25,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) as p75,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount) as p95,
          COUNT(*) as count
         FROM deals
         WHERE workspace_id = $1
           AND amount > 0
           AND close_date >= $2 AND close_date <= $3
           AND stage_normalized NOT IN ('closed_lost', 'closed_won')`,
        [context.workspaceId, quarterStart, quarterEnd]
      );

      if (dealSizeResult.rows[0]?.count >= 20) {
        const { p25, p75, p95 } = dealSizeResult.rows[0];
        const variance = p95 / Math.max(p25, 1);

        // If P95/P25 ratio > 20x, suggest segmentation
        if (variance > 20) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'pipeline-coverage',
            section: 'pipelines',
            path: 'pipelines[0].segments',
            type: 'add',
            message: `Deal sizes vary widely: P95=${formatCurrency(p95)} vs P25=${formatCurrency(p25)} (${Math.round(variance)}x variance). Consider segmenting SMB vs Enterprise.`,
            evidence: `${dealSizeResult.rows[0].count} deals, P25=${formatCurrency(p25)}, P75=${formatCurrency(p75)}, P95=${formatCurrency(p95)}`,
            confidence: 0.8,
            suggested_value: [
              { name: 'SMB', min: 0, max: p75 },
              { name: 'Enterprise', min: p75, max: null }
            ],
            current_value: null,
          }).catch(err => console.error('[Feedback Signal] Error adding segmentation suggestion:', err));
        }
      }

      // FEEDBACK SIGNAL: Coverage target validation
      if (coverageData.team && coverageData.team.coverageRatio) {
        const actualCoverage = coverageData.team.coverageRatio;
        const targetCoverage = coverageTarget || 3.0;
        const delta = actualCoverage - targetCoverage;

        // If team consistently over/under by >1.5x, suggest adjusting target
        if (delta > 1.5) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'pipeline-coverage',
            section: 'thresholds',
            path: 'thresholds.coverage_target',
            type: 'adjust',
            message: `Team has ${actualCoverage.toFixed(1)}x coverage vs ${targetCoverage}x target. Consider raising target to challenge the team.`,
            evidence: `Pipeline value: ${formatCurrency(coverageData.team.totalPipeline)}, Quota: ${formatCurrency(coverageData.team.totalQuota || 0)}`,
            confidence: 0.65,
            suggested_value: Math.min(5.0, targetCoverage + 0.5),
            current_value: targetCoverage,
          }).catch(err => console.error('[Feedback Signal] Error adding coverage target suggestion:', err));
        } else if (delta < -0.5 && coverageData.team.daysRemaining > 30) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'pipeline-coverage',
            section: 'thresholds',
            path: 'thresholds.coverage_target',
            type: 'alert',
            message: `Team has ${actualCoverage.toFixed(1)}x coverage vs ${targetCoverage}x target with ${coverageData.team.daysRemaining} days left in quarter. Coverage gap detected.`,
            evidence: `Gap: ${formatCurrency(coverageData.team.gap || 0)}, ${coverageData.team.daysRemaining} days remaining`,
            confidence: 0.9,
            suggested_value: null,
            current_value: targetCoverage,
          }).catch(err => console.error('[Feedback Signal] Error adding coverage alert:', err));
        }
      }

      return coverageData;
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
  description: 'Check if workspace has external conversation data (Gong/Fireflies). Returns count, sources, and has_conversations boolean.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('checkWorkspaceHasConversations', async () => {
      return checkConversations(context.workspaceId);
    }, params);
  },
};

const auditConversationDealCoverage: ToolDefinition = {
  name: 'auditConversationDealCoverage',
  description: 'Find conversations linked to accounts but not deals (CWD), with severity classification, account enrichment, and top examples. Returns has_conversation_data, summary (total_cwd, by_rep, by_severity, estimated_pipeline_gap), and top_examples.',
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
      return auditCWDCoverage(context.workspaceId, daysBack);
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

      // Load ICP scores for forecast deals
      const icpDealsResult = await query(
        `SELECT d.id, d.amount, d.forecast_category, ls.score_grade
         FROM deals d
         LEFT JOIN lead_scores ls ON ls.entity_id = d.id
           AND ls.workspace_id = d.workspace_id
           AND ls.entity_type = 'deal'
         WHERE d.workspace_id = $1
           AND d.forecast_category IS NOT NULL
           AND d.stage_normalized NOT IN ('closed_lost')`,
        [context.workspaceId]
      );

      const hasIcpScores = icpDealsResult.rows.some((r: any) => r.score_grade !== null);

      let icpForecast: any = null;

      if (hasIcpScores) {
        const commitDeals = icpDealsResult.rows.filter((r: any) => r.forecast_category === 'commit');
        const bestCaseDeals = icpDealsResult.rows.filter((r: any) => r.forecast_category === 'best_case');
        const pipelineDeals = icpDealsResult.rows.filter((r: any) => r.forecast_category === 'pipeline');

        icpForecast = {
          commit: {
            total: commitDeals.reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
            ab_grade: commitDeals.filter((d: any) => d.score_grade === 'A' || d.score_grade === 'B')
              .reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
            cdf_grade: commitDeals.filter((d: any) => ['C','D','F'].includes(d.score_grade))
              .reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
          },
          best_case: {
            total: bestCaseDeals.reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
            ab_grade: bestCaseDeals.filter((d: any) => d.score_grade === 'A' || d.score_grade === 'B')
              .reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
            cdf_grade: bestCaseDeals.filter((d: any) => ['C','D','F'].includes(d.score_grade))
              .reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
          },
          pipeline: {
            total: pipelineDeals.reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
            ab_grade: pipelineDeals.filter((d: any) => d.score_grade === 'A' || d.score_grade === 'B')
              .reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
            cdf_grade: pipelineDeals.filter((d: any) => ['C','D','F'].includes(d.score_grade))
              .reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0),
          },
          has_grade_adjusted: false,
        };

        // Compute historical close rates by grade (only if enough data)
        const historicalByGrade = await query(
          `SELECT ls.score_grade as grade,
            COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won') as won,
            COUNT(*) as total,
            ROUND(COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::numeric /
              NULLIF(COUNT(*), 0) * 100) as close_rate
          FROM lead_scores ls
          JOIN deals d ON d.id = ls.entity_id AND d.workspace_id = ls.workspace_id
          WHERE ls.workspace_id = $1
            AND ls.entity_type = 'deal'
            AND d.stage_normalized IN ('closed_won', 'closed_lost')
          GROUP BY ls.score_grade
          HAVING COUNT(*) >= 5
          ORDER BY ls.score_grade`,
          [context.workspaceId]
        );

        const gradeCloseRates: Record<string, number> = {};
        for (const row of historicalByGrade.rows) {
          gradeCloseRates[row.grade] = Number(row.close_rate) / 100;
        }

        // Only compute grade-adjusted if we have enough grades
        if (Object.keys(gradeCloseRates).length >= 3) {
          icpForecast.grade_adjusted_commit = commitDeals.reduce((sum: number, d: any) => {
            const rate = gradeCloseRates[d.score_grade] ?? 0.5;
            return sum + (Number(d.amount) || 0) * rate;
          }, 0);

          icpForecast.grade_adjusted_best_case = bestCaseDeals.reduce((sum: number, d: any) => {
            const rate = gradeCloseRates[d.score_grade] ?? 0.3;
            return sum + (Number(d.amount) || 0) * rate;
          }, 0);

          icpForecast.has_grade_adjusted = true;
          icpForecast.grade_close_rates = gradeCloseRates;
        }
      }

      // FEEDBACK SIGNAL: Forecast category coverage
      const totalDealsResult = await query<{ total: number }>(
        `SELECT COUNT(*) as total FROM deals
         WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_lost', 'closed_won')`,
        [context.workspaceId]
      );
      const totalDeals = totalDealsResult.rows[0]?.total || 0;
      const forecastedDeals = Object.values(categories).reduce((s, c) => s + c.count, 0);
      const unforecastedDeals = totalDeals - forecastedDeals;

      if (totalDeals >= 10 && unforecastedDeals > totalDeals * 0.3) {
        await addConfigSuggestion(context.workspaceId, {
          source_skill: 'forecast-rollup',
          section: 'pipelines',
          path: 'pipelines[0].forecast_categories',
          type: 'alert',
          message: `${unforecastedDeals} of ${totalDeals} deals (${Math.round((unforecastedDeals / totalDeals) * 100)}%) have no forecast_category. Forecast accuracy is limited.`,
          evidence: `Only ${forecastedDeals} deals are categorized across closed/commit/best_case/pipeline`,
          confidence: 0.85,
          suggested_value: null,
          current_value: null,
        }).catch(err => console.error('[Feedback Signal] Error adding forecast category alert:', err));
      }

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
        icpForecast,
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
        owner: string | null;
        close_date: string | null;
      }>(
        `SELECT id, name, amount, probability, forecast_category, stage_normalized, owner, close_date
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
        owner: nameMap[d.owner || ''] || d.owner || 'Unknown',
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
            owner: nameMap[d.owner || ''] || d.owner || 'Unknown',
            closeDate: d.close_date,
          }));
      }

      // Calculate concentration metrics
      const totalPipeline = forecast?.team?.baseCase || 0;
      const top3Total = top3.reduce((sum, d) => sum + d.weighted, 0);
      const top3Concentration = totalPipeline > 0 ? (top3Total / totalPipeline) * 100 : 0;

      const whaleTotal = whaleDeals.reduce((sum, d) => sum + d.weighted, 0);
      const whaleConcentration = totalPipeline > 0 ? (whaleTotal / totalPipeline) * 100 : 0;

      const riskLevel =
        top3Concentration > 50 || whaleConcentration > 40
          ? 'high'
          : top3Concentration > 30 || whaleConcentration > 25
          ? 'medium'
          : 'low';

      // FEEDBACK SIGNAL: Risk concentration alert
      if (riskLevel === 'high' && whaleDeals.length > 0) {
        await addConfigSuggestion(context.workspaceId, {
          source_skill: 'deal-risk-review',
          section: 'thresholds',
          path: 'thresholds.risk_concentration',
          type: 'alert',
          message: `High risk concentration: ${whaleDeals.length} whale deals (>20% of quota) represent ${Math.round(whaleConcentration)}% of forecast. Top 3 deals: ${Math.round(top3Concentration)}% of forecast.`,
          evidence: `Whale deals: ${whaleDeals.map(d => `${d.name} (${formatCurrency(d.amount)})`).slice(0, 3).join(', ')}`,
          confidence: 0.9,
          suggested_value: null,
          current_value: null,
        }).catch(err => console.error('[Feedback Signal] Error adding risk concentration alert:', err));
      }

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
        riskLevel,
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

      // FEEDBACK SIGNAL: Stage anomalies
      if (biggestLeakage && biggestLeakage.fellOut >= 5) {
        await addConfigSuggestion(context.workspaceId, {
          source_skill: 'pipeline-waterfall',
          section: 'pipelines',
          path: 'pipelines[0].stages',
          type: 'alert',
          message: `"${biggestLeakage.stage}" has ${biggestLeakage.fellOut} deals falling out (highest leakage stage). Consider if this stage needs process improvement.`,
          evidence: `${formatCurrency(biggestLeakage.fellOutValue || 0)} in value fell out of this stage`,
          confidence: 0.75,
          suggested_value: null,
          current_value: null,
        }).catch(err => console.error('[Feedback Signal] Error adding stage leakage alert:', err));
      }

      if (biggestBottleneck) {
        const bottleneckRate = parseFloat(((biggestBottleneck.advanced / (biggestBottleneck.startOfPeriod + biggestBottleneck.entered)) * 100).toFixed(0));
        if (bottleneckRate < 30) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'pipeline-waterfall',
            section: 'pipelines',
            path: 'pipelines[0].stages',
            type: 'alert',
            message: `"${biggestBottleneck.stage}" has only ${bottleneckRate}% advance rate (biggest bottleneck). Deals are getting stuck here.`,
            evidence: `${biggestBottleneck.advanced} of ${biggestBottleneck.startOfPeriod + biggestBottleneck.entered} deals advanced`,
            confidence: 0.7,
            suggested_value: null,
            current_value: null,
          }).catch(err => console.error('[Feedback Signal] Error adding bottleneck alert:', err));
        }
      }

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
// Waterfall Summary Tool (pre-compute for Claude)
// ============================================================================

const prepareWaterfallSummaryTool: ToolDefinition = {
  name: 'prepareWaterfallSummary',
  description: 'Pre-compute pipeline snapshot, high-risk deals, and stale deals for the waterfall report so Claude does not need tool calls.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('prepareWaterfallSummary', async () => {
      const staleThreshold = await configLoader.getStaleThreshold(context.workspaceId);
      const staleDays = staleThreshold.warning;

      const stageRows = await query(
        `SELECT stage_normalized, COUNT(*) as count, SUM(amount) as total_value
         FROM deals
         WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         GROUP BY stage_normalized`,
        [context.workspaceId]
      );

      const highRiskRows = await query(
        `SELECT name, amount, owner, deal_risk, stage_normalized, days_in_stage
         FROM deals
         WHERE workspace_id = $1 AND deal_risk >= 60 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         ORDER BY deal_risk DESC, amount DESC
         LIMIT 5`,
        [context.workspaceId]
      );

      const staleRows = await query(
        `SELECT name, amount, owner, stage_normalized, EXTRACT(DAY FROM NOW() - last_activity_date)::int as days_since_activity
         FROM deals
         WHERE workspace_id = $1 AND last_activity_date < NOW() - INTERVAL '${staleDays} days' AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         ORDER BY amount DESC
         LIMIT 5`,
        [context.workspaceId]
      );

      const stageDistribution = stageRows.rows.map((r: any) => ({
        stage: r.stage_normalized,
        count: Number(r.count),
        totalValue: Number(r.total_value),
      }));

      const totalOpenDeals = stageDistribution.reduce((sum: number, s: any) => sum + s.count, 0);
      const totalOpenValue = stageDistribution.reduce((sum: number, s: any) => sum + s.totalValue, 0);

      return {
        stageDistribution,
        highRiskDeals: highRiskRows.rows.map((r: any) => ({
          name: r.name,
          amount: Number(r.amount),
          owner: r.owner,
          dealRisk: Number(r.deal_risk),
          stage: r.stage_normalized,
          daysInStage: Number(r.days_in_stage),
        })),
        staleDeals: staleRows.rows.map((r: any) => ({
          name: r.name,
          amount: Number(r.amount),
          owner: r.owner,
          stage: r.stage_normalized,
          daysSinceActivity: Number(r.days_since_activity),
        })),
        pipelineTotals: {
          totalOpenDeals,
          totalOpenValue,
          avgDealSize: totalOpenDeals > 0 ? Math.round(totalOpenValue / totalOpenDeals) : 0,
        },
      };
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

      const staleThreshold = await configLoader.getStaleThreshold(context.workspaceId);

      const result = await repScorecard(
        context.workspaceId,
        periodStart,
        periodEnd,
        changeWindowStart,
        changeWindowEnd,
        dataAvailability,
        staleThreshold.warning
      );

      console.log(`[Rep Scorecard] Scored ${result.reps.length} reps. Top: ${result.top3[0]?.repName} (${result.top3[0]?.overallScore}), Bottom: ${result.bottom3[0]?.repName} (${result.bottom3[0]?.overallScore})`);

      return result;
    }, params);
  },
};

const prepareRepScorecardSummaryTool: ToolDefinition = {
  name: 'prepareRepScorecardSummary',
  description: 'Prepare team context data for rep scorecard report: stage distribution, recent wins, at-risk deals, stale deals',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('prepareRepScorecardSummary', async () => {
      const scorecard = (context.stepResults as any).scorecard;
      if (!scorecard) {
        throw new Error('scorecard not found in context. Run repScorecardCompute first.');
      }

      const staleThreshold = await configLoader.getStaleThreshold(context.workspaceId);
      const staleDays = staleThreshold.warning;

      const [stageRows, recentWinsRows, atRiskRows, staleRows] = await Promise.all([
        query(
          `SELECT stage_normalized, COUNT(*) as count, SUM(amount) as total_value
           FROM deals WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
           GROUP BY stage_normalized`,
          [context.workspaceId]
        ),
        query(
          `SELECT name, amount, owner, close_date
           FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won'
           ORDER BY close_date DESC, amount DESC LIMIT 5`,
          [context.workspaceId]
        ),
        query(
          `SELECT name, amount, owner, deal_risk, stage_normalized
           FROM deals WHERE workspace_id = $1 AND deal_risk >= 70 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
           ORDER BY deal_risk DESC, amount DESC LIMIT 5`,
          [context.workspaceId]
        ),
        query(
          `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_value
           FROM deals WHERE workspace_id = $1 AND last_activity_date < NOW() - INTERVAL '${staleDays} days' AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
          [context.workspaceId]
        ),
      ]);

      const stageDistribution = stageRows.rows.map((r: any) => ({
        stage: r.stage_normalized,
        count: Number(r.count),
        totalValue: Number(r.total_value),
      }));

      const totalOpenDeals = stageDistribution.reduce((sum: number, s: any) => sum + s.count, 0);
      const totalOpenValue = stageDistribution.reduce((sum: number, s: any) => sum + s.totalValue, 0);

      return {
        stageDistribution,
        recentWins: recentWinsRows.rows.map((r: any) => ({
          name: r.name,
          amount: Number(r.amount),
          owner: r.owner,
          closeDate: r.close_date,
        })),
        atRiskDeals: atRiskRows.rows.map((r: any) => ({
          name: r.name,
          amount: Number(r.amount),
          owner: r.owner,
          dealRisk: Number(r.deal_risk),
          stage: r.stage_normalized,
        })),
        staleDealsSummary: {
          count: Number(staleRows.rows[0]?.count || 0),
          totalValue: Number(staleRows.rows[0]?.total_value || 0),
        },
        pipelineTotals: {
          totalOpenDeals,
          totalOpenValue,
        },
      };
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
// Bowtie Analysis Tools
// ============================================================================

const prepareBowtieSummaryTool: ToolDefinition = {
  name: 'prepareBowtieSummary',
  description: 'Compute full bowtie funnel analysis: left-side funnel (lead→MQL→SQL→SAO→Won), conversion rates, right-side post-sale stages, bottlenecks, and activity correlation',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('prepareBowtieSummary', async () => {
      const result = await prepareBowtieSummary(context.workspaceId);
      console.log(`[BowtieAnalysis] Completed bowtie summary for workspace ${context.workspaceId}`);

      // FEEDBACK SIGNAL: Funnel shape validation
      if (result.bottlenecks?.weakestConversion && result.bottlenecks.weakestConversion.rate < 0.15) {
        await addConfigSuggestion(context.workspaceId, {
          source_skill: 'bowtie-analysis',
          section: 'pipelines',
          path: 'pipelines[0].funnel',
          type: 'alert',
          message: `Funnel bottleneck: "${result.bottlenecks.weakestConversion.stage}" has only ${Math.round(result.bottlenecks.weakestConversion.rate * 100)}% conversion rate.`,
          evidence: `Weakest stage in funnel - consider process improvement or disqualification criteria`,
          confidence: 0.75,
          suggested_value: null,
          current_value: null,
        }).catch(err => console.error('[Feedback Signal] Error adding funnel bottleneck alert:', err));
      }

      if (result.conversions && result.conversions.totalFunnelEfficiency < 0.05) {
        await addConfigSuggestion(context.workspaceId, {
          source_skill: 'bowtie-analysis',
          section: 'pipelines',
          path: 'pipelines[0].funnel',
          type: 'alert',
          message: `Overall funnel efficiency is ${Math.round(result.conversions.totalFunnelEfficiency * 100)}%. Very few leads make it through the funnel.`,
          evidence: `End-to-end conversion rate across all stages`,
          confidence: 0.8,
          suggested_value: null,
          current_value: null,
        }).catch(err => console.error('[Feedback Signal] Error adding funnel efficiency alert:', err));
      }

      return result;
    }, params);
  },
};

// ============================================================================
// Pipeline Goals Tools
// ============================================================================

const preparePipelineGoalsSummaryTool: ToolDefinition = {
  name: 'preparePipelineGoalsSummary',
  description: 'Compute pipeline activity goals: reverse-math from quota to weekly activity targets, historical conversion rates, rep breakdown, and pace assessment',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('preparePipelineGoalsSummary', async () => {
      const result = await preparePipelineGoalsSummary(context.workspaceId);
      console.log(`[PipelineGoals] Completed pipeline goals summary for workspace ${context.workspaceId}`);

      // FEEDBACK SIGNAL: Quota period validation
      // Check if there are quota records to validate period alignment
      const quotaResult = await query<{ period_type: string; count: number }>(
        `SELECT DISTINCT period_type, COUNT(*) as count
         FROM quotas
         WHERE workspace_id = $1
         GROUP BY period_type`,
        [context.workspaceId]
      );

      if (quotaResult.rows.length > 0) {
        const periodTypes = quotaResult.rows.map(r => r.period_type);
        const hasQuarterly = periodTypes.includes('quarterly');
        const hasMonthly = periodTypes.includes('monthly');

        // Get fiscal year config
        const config = await configLoader.getConfig(context.workspaceId);
        const fiscalYearMonth = config.cadence.fiscal_year_start_month;

        if (hasQuarterly && fiscalYearMonth !== 1) {
          await addConfigSuggestion(context.workspaceId, {
            source_skill: 'pipeline-goals',
            section: 'cadence',
            path: 'cadence.fiscal_year_start_month',
            type: 'confirm',
            message: `Quarterly quotas detected with fiscal year starting in month ${fiscalYearMonth}. Confirm this matches your fiscal calendar.`,
            evidence: `${quotaResult.rows.find(r => r.period_type === 'quarterly')?.count || 0} quarterly quota records found`,
            confidence: 0.7,
            suggested_value: fiscalYearMonth,
            current_value: fiscalYearMonth,
          }).catch(err => console.error('[Feedback Signal] Error adding fiscal year confirmation:', err));
        }
      }

      return result;
    }, params);
  },
};

// ============================================================================
// Project Recap Tools
// ============================================================================

const prepareProjectRecapTool: ToolDefinition = {
  name: 'prepareProjectRecap',
  description: 'Load and format project updates for the Friday recap, including cross-workspace summary',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('prepareProjectRecap', async () => {
      const result = await prepareProjectRecap(context.workspaceId);
      console.log(`[ProjectRecap] Loaded project recap (hasUpdates: ${result.hasUpdates})`);
      return result;
    }, params);
  },
};

// ============================================================================
// Strategy Insights Tools
// ============================================================================

const prepareStrategyInsightsTool: ToolDefinition = {
  name: 'prepareStrategyInsights',
  description: 'Gather recent skill/agent outputs, cross-workspace metrics, and trend data for strategic analysis',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('prepareStrategyInsights', async () => {
      const result = await prepareStrategyInsights(context.workspaceId);
      console.log(`[StrategyInsights] Gathered ${result.recentOutputs.skillCount} skill outputs, ${result.recentOutputs.agentCount} agent outputs`);
      return result;
    }, params);
  },
};

// ============================================================================
// Config Audit Tools
// ============================================================================

const runConfigAuditTool: ToolDefinition = {
  name: 'runConfigAudit',
  description: 'Run 8 drift checks comparing workspace configuration against live CRM data: roster, stages, velocity, win rate, segmentation, coverage target, stale threshold, field fill rates',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('runConfigAudit', async () => {
      const result = await runConfigAudit(context.workspaceId);
      console.log(`[ConfigAudit] Completed: ${result.checks_run} checks, ${result.findings.length} findings`);
      return result;
    }, params);
  },
};

// ============================================================================
// Deal Intelligence Tools
// ============================================================================

const getDealRiskScoreTool: ToolDefinition = {
  name: 'getDealRiskScore',
  description: 'Get composite health score (0-100) for a single deal, aggregating active findings from all skills. Higher score = healthier.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'The deal ID to score' },
    },
    required: ['dealId'],
  },
  execute: async (params, context) => {
    return safeExecute('getDealRiskScore', () =>
      getDealRiskScore(context.workspaceId, params.dealId), params);
  },
};

const getPipelineRiskSummaryTool: ToolDefinition = {
  name: 'getPipelineRiskSummary',
  description: 'Get health scores for all open deals sorted by risk. Answers: which deals are most at risk? Optional rep filter.',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      repEmail: { type: 'string', description: 'Optional: filter to one rep email' },
      sortBy: { type: 'string', enum: ['score', 'amount', 'close_date'], description: 'Sort field (default: score ascending)' },
      limit: { type: 'number', description: 'Max deals to return' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('getPipelineRiskSummary', () =>
      getPipelineRiskSummary(context.workspaceId, {
        repEmail: params.repEmail,
        sortBy: params.sortBy,
        limit: params.limit,
      }), params);
  },
};

// ============================================================================
// Tool Registry
// ============================================================================
// Stage Velocity Benchmarks compute tools
// ============================================================================

const svbComputeBenchmarks: ToolDefinition = {
  name: 'svbComputeBenchmarks',
  description: 'Compute median/p75/p90 time-in-stage benchmarks from deal_stage_history',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: {
      lookback_months: { type: 'number', description: 'Months of history (default 12)' },
    },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('svbComputeBenchmarks', async () => {
      const lookbackMonths = params.lookback_months || 12;
      const result = await query<any>(
        `WITH stage_windows AS (
           SELECT
             dsh.deal_id,
             dsh.stage_normalized,
             dsh.stage,
             dsh.entered_at,
             LEAD(dsh.entered_at) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS next_entered_at
           FROM deal_stage_history dsh
           WHERE dsh.workspace_id = $1
             AND dsh.entered_at >= NOW() - ($2 || ' months')::interval
             AND dsh.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ),
         durations AS (
           SELECT stage_normalized, stage,
                  EXTRACT(EPOCH FROM (next_entered_at - entered_at)) / 86400.0 AS days
           FROM stage_windows
           WHERE next_entered_at IS NOT NULL AND next_entered_at > entered_at
         )
         SELECT
           stage_normalized, stage,
           PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY days)::numeric(10,1) AS median_days,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days)::numeric(10,1) AS p75_days,
           PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY days)::numeric(10,1) AS p90_days,
           AVG(days)::numeric(10,1) AS mean_days,
           COUNT(*)::int AS sample_size
         FROM durations WHERE days > 0
         GROUP BY stage_normalized, stage
         HAVING COUNT(*) >= 2
         ORDER BY median_days`,
        [context.workspaceId, lookbackMonths]
      );

      // Conversion rates per stage
      const convResult = await query<any>(
        `SELECT from_norm, to_norm, COUNT(*)::int AS cnt
         FROM (
           SELECT dsh.stage_normalized AS from_norm,
                  LEAD(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS to_norm
           FROM deal_stage_history dsh
           WHERE dsh.workspace_id = $1
             AND dsh.entered_at >= NOW() - ($2 || ' months')::interval
         ) sub WHERE to_norm IS NOT NULL
         GROUP BY from_norm, to_norm`,
        [context.workspaceId, lookbackMonths]
      );
      const convMap: Record<string, { advance: number; drop: number; total: number }> = {};
      for (const r of convResult.rows) {
        if (!convMap[r.from_norm]) convMap[r.from_norm] = { advance: 0, drop: 0, total: 0 };
        convMap[r.from_norm].total += r.cnt;
        if (r.to_norm === 'closed_lost') convMap[r.from_norm].drop += r.cnt;
        else if (r.to_norm !== r.from_norm) convMap[r.from_norm].advance += r.cnt;
      }

      return result.rows.map((r: any) => {
        const conv = convMap[r.stage_normalized] || { advance: 0, drop: 0, total: 0 };
        return {
          stage: r.stage,
          stage_normalized: r.stage_normalized,
          median_days: parseFloat(r.median_days) || 0,
          p75_days: parseFloat(r.p75_days) || 0,
          p90_days: parseFloat(r.p90_days) || 0,
          mean_days: parseFloat(r.mean_days) || 0,
          sample_size: r.sample_size,
          conversion_rate: conv.total > 0 ? Math.round((conv.advance / conv.total) * 100) : 0,
          drop_rate: conv.total > 0 ? Math.round((conv.drop / conv.total) * 100) : 0,
        };
      });
    }, params);
  },
};

const svbFlagSlowDeals: ToolDefinition = {
  name: 'svbFlagSlowDeals',
  description: 'Flag open deals where days_in_stage exceeds p75 or p90 benchmark',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('svbFlagSlowDeals', async () => {
      const benchmarks = (context.stepResults as any).benchmarks as any[];
      if (!benchmarks?.length) return [];

      const benchmarkMap: Record<string, { median_days: number; p75_days: number; p90_days: number }> = {};
      for (const b of benchmarks) benchmarkMap[b.stage_normalized] = b;

      // Get all open deals with their current stage and time in stage
      const dealsResult = await query<any>(
        `SELECT d.id, d.name, d.amount, d.stage, d.stage_normalized, d.owner,
                COALESCE(dsh.entered_at, d.created_at) AS stage_entered_at,
                EXTRACT(DAY FROM NOW() - COALESCE(dsh.entered_at, d.created_at))::int AS days_in_stage
         FROM deals d
         LEFT JOIN LATERAL (
           SELECT entered_at FROM deal_stage_history dsh2
           WHERE dsh2.deal_id = d.id AND dsh2.workspace_id = d.workspace_id
             AND dsh2.stage_normalized = d.stage_normalized
           ORDER BY entered_at DESC LIMIT 1
         ) dsh ON true
         WHERE d.workspace_id = $1
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND d.amount > 0`,
        [context.workspaceId]
      );

      const flagged = [];
      for (const deal of dealsResult.rows) {
        const bench = benchmarkMap[deal.stage_normalized];
        if (!bench) continue;
        const daysInStage = deal.days_in_stage || 0;
        if (daysInStage <= bench.p75_days) continue;

        const severity = daysInStage >= bench.p90_days ? 'critical' : 'warning';
        const daysOver = Math.round(daysInStage - bench.p75_days);
        flagged.push({
          deal_id: deal.id,
          deal_name: deal.name,
          amount: parseFloat(deal.amount) || 0,
          stage: deal.stage,
          stage_normalized: deal.stage_normalized,
          owner: deal.owner,
          days_in_stage: daysInStage,
          benchmark_median: bench.median_days,
          benchmark_p75: bench.p75_days,
          benchmark_p90: bench.p90_days,
          days_over_benchmark: daysOver,
          severity,
        });
      }

      return flagged.sort((a, b) => b.days_over_benchmark - a.days_over_benchmark);
    }, params);
  },
};

// ============================================================================
// Conversation Intelligence compute tools
// ============================================================================

const ciGatherConversations: ToolDefinition = {
  name: 'ciGatherConversations',
  description: 'Gather recent conversations with summaries for theme extraction',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('ciGatherConversations', async () => {
      const timeWindows = (context.stepResults as any).time_windows;
      const since = timeWindows?.changeRange?.start ||
        new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

      const result = await query<any>(
        `SELECT cv.id, cv.title, cv.call_date, cv.duration_seconds, cv.source,
                cv.summary, cv.objections, cv.competitor_mentions, cv.topics,
                cv.talk_listen_ratio,
                a.name AS account_name, d.name AS deal_name, d.id AS deal_id,
                cv.participants
         FROM conversations cv
         LEFT JOIN accounts a ON a.id = cv.account_id AND a.workspace_id = cv.workspace_id
         LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = cv.workspace_id
         WHERE cv.workspace_id = $1
           AND cv.is_internal = false
           AND cv.call_date >= $2
         ORDER BY cv.call_date DESC
         LIMIT 100`,
        [context.workspaceId, since]
      );

      const rows = result.rows;
      const withSummary = rows.filter((r: any) => r.summary);
      const totalDuration = rows.reduce((s: number, r: any) => s + (r.duration_seconds || 0), 0);

      return {
        conversations: rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          call_date: r.call_date,
          duration_minutes: r.duration_seconds ? Math.round(r.duration_seconds / 60) : null,
          account_name: r.account_name || null,
          deal_name: r.deal_name || null,
          deal_id: r.deal_id || null,
          summary: r.summary || null,
          source: r.source,
          talk_listen_ratio: r.talk_listen_ratio || null,
          // Include pre-extracted signals if they exist
          existing_objections: Array.isArray(r.objections) && r.objections.length ? r.objections : null,
          existing_competitors: Array.isArray(r.competitor_mentions) && r.competitor_mentions.length ? r.competitor_mentions : null,
          existing_topics: Array.isArray(r.topics) && r.topics.length ? r.topics : null,
        })),
        summary: {
          total_calls: rows.length,
          calls_with_summaries: withSummary.length,
          summary_coverage_pct: rows.length > 0 ? Math.round((withSummary.length / rows.length) * 100) : 0,
          total_hours: Math.round(totalDuration / 3600 * 10) / 10,
          unique_accounts: new Set(rows.map((r: any) => r.account_name).filter(Boolean)).size,
          since,
        },
      };
    }, params);
  },
};

const ciAggregateThemes: ToolDefinition = {
  name: 'ciAggregateThemes',
  description: 'Aggregate per-call theme extractions into workspace-level patterns',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('ciAggregateThemes', async () => {
      const extractions = (context.stepResults as any).theme_extractions;
      if (!extractions) return { objection_themes: [], competitor_mentions: [], risk_signals: [], buying_signals: [] };

      let parsed: any[] = [];
      try {
        parsed = typeof extractions === 'string'
          ? JSON.parse(extractions.match(/\[[\s\S]*\]/)?.[0] || '[]')
          : Array.isArray(extractions) ? extractions : [];
      } catch { parsed = []; }

      // Count objections
      const objectionCounts: Record<string, { count: number; deals: string[] }> = {};
      for (const e of parsed) {
        for (const obj of (e.objections_mentioned || [])) {
          const key = String(obj).toLowerCase().trim();
          if (!objectionCounts[key]) objectionCounts[key] = { count: 0, deals: [] };
          objectionCounts[key].count++;
          if (e.account_name && !objectionCounts[key].deals.includes(e.account_name)) {
            objectionCounts[key].deals.push(e.account_name);
          }
        }
      }

      // Count competitors
      const compCounts: Record<string, { count: number; deals: string[] }> = {};
      for (const e of parsed) {
        for (const comp of (e.competitors_mentioned || [])) {
          const key = String(comp).trim();
          if (!compCounts[key]) compCounts[key] = { count: 0, deals: [] };
          compCounts[key].count++;
          if (e.deal_name && !compCounts[key].deals.includes(e.deal_name)) {
            compCounts[key].deals.push(e.deal_name);
          }
        }
      }

      // Risk and buying signals per deal
      const riskSignals = parsed
        .filter(e => e.risk_signals?.length > 0)
        .map(e => ({ deal_name: e.deal_name, account_name: e.account_name, signals: e.risk_signals, call_date: e.conversation_title }));

      const buyingSignals = parsed
        .filter(e => e.buying_signals?.length > 0)
        .map(e => ({ deal_name: e.deal_name, account_name: e.account_name, signals: e.buying_signals, momentum: e.momentum }));

      return {
        objection_themes: Object.entries(objectionCounts)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 10)
          .map(([theme, data]) => ({ theme, count: data.count, accounts: data.deals })),
        competitor_mentions: Object.entries(compCounts)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([competitor, data]) => ({ competitor, count: data.count, deals: data.deals })),
        risk_signals: riskSignals.slice(0, 15),
        buying_signals: buyingSignals.slice(0, 10),
        deals_with_momentum: {
          accelerating: parsed.filter(e => e.momentum === 'accelerating').map(e => e.deal_name || e.account_name),
          decelerating: parsed.filter(e => e.momentum === 'decelerating').map(e => e.deal_name || e.account_name),
        },
        calls_analyzed: parsed.length,
      };
    }, params);
  },
};

// ============================================================================
// Forecast Model compute tools
// ============================================================================

const fmScoreOpenDeals: ToolDefinition = {
  name: 'fmScoreOpenDeals',
  description: 'Score all open deals for the current quarter using compute_close_probability logic',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('fmScoreOpenDeals', async () => {
      const result = await query<any>(
        `SELECT d.id, d.name, d.amount, d.stage, d.stage_normalized, d.close_date,
                d.owner as owner_name, d.account_id, d.forecast_category,
                d.probability as crm_probability, d.days_in_stage,
                CASE WHEN d.close_date IS NOT NULL
                     THEN (d.close_date::date - CURRENT_DATE)
                     ELSE NULL END as days_to_close
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND d.amount IS NOT NULL AND d.amount > 0
         ORDER BY d.amount DESC NULLS LAST
         LIMIT 100`,
        [context.workspaceId]
      );

      // Get call counts per deal
      const dealIds = result.rows.map((r: any) => r.id);
      if (!dealIds.length) return { scored_deals: [], total_pipeline: 0, probability_weighted_pipeline: 0 };

      const convResult = await query<any>(
        `SELECT cv.deal_id, COUNT(*)::int as call_count, MAX(cv.call_date)::text as last_call_date
         FROM conversations cv
         WHERE cv.workspace_id = $1 AND cv.deal_id = ANY($2) AND cv.is_internal = false
         GROUP BY cv.deal_id`,
        [context.workspaceId, dealIds]
      ).catch(() => ({ rows: [] as any[] }));
      const convMap = new Map(convResult.rows.map((r: any) => [r.deal_id, { call_count: r.call_count, last_call_date: r.last_call_date }]));

      const contactResult = await query<any>(
        `SELECT dc.deal_id, COUNT(*)::int as total,
                COUNT(CASE WHEN dc.role IN ('champion','economic_buyer') THEN 1 END)::int as key_contacts
         FROM deal_contacts dc
         WHERE dc.workspace_id = $1 AND dc.deal_id = ANY($2)
         GROUP BY dc.deal_id`,
        [context.workspaceId, dealIds]
      ).catch(() => ({ rows: [] as any[] }));
      const contactMap = new Map(contactResult.rows.map((r: any) => [r.deal_id, { total: r.total, key_contacts: r.key_contacts }]));

      // Simple probability scoring
      const scored = result.rows.map((deal: any) => {
        const conv = (convMap.get(deal.id) as any) || { call_count: 0, last_call_date: null };
        const cont = (contactMap.get(deal.id) as any) || { total: 0, key_contacts: 0 };
        const fcScores: Record<string, number> = { commit: 0.85, best_case: 0.55, pipeline: 0.25 };
        const baseProb = fcScores[deal.forecast_category] ?? 0.30;
        const callBonus = conv.call_count >= 3 ? 0.05 : conv.call_count >= 1 ? 0.02 : 0;
        const contactBonus = cont.key_contacts > 0 ? 0.05 : cont.total > 0 ? 0.02 : 0;
        const daysToClose = deal.days_to_close !== null ? parseFloat(deal.days_to_close) : null;
        const closePenalty = daysToClose !== null && daysToClose < 0 ? -0.10 : 0;
        const probability = Math.min(Math.round((baseProb + callBonus + contactBonus + closePenalty) * 100), 95);
        return {
          deal_id: deal.id,
          deal_name: deal.name,
          amount: parseFloat(deal.amount),
          stage: deal.stage,
          stage_normalized: deal.stage_normalized,
          close_date: deal.close_date,
          owner: deal.owner_name,
          forecast_category: deal.forecast_category,
          probability,
          crm_probability: deal.crm_probability,
          weighted_amount: Math.round(parseFloat(deal.amount) * probability / 100),
          call_count: conv.call_count,
          contacts: cont.total,
          key_contacts: cont.key_contacts,
          days_to_close: daysToClose !== null ? Math.round(daysToClose) : null,
          days_in_stage: Math.round(parseFloat(deal.days_in_stage) || 0),
        };
      }).sort((a: any, b: any) => b.weighted_amount - a.weighted_amount);

      const totalPipeline = scored.reduce((s: number, d: any) => s + d.amount, 0);
      const totalWeighted = scored.reduce((s: number, d: any) => s + d.weighted_amount, 0);

      return { scored_deals: scored, total_pipeline: Math.round(totalPipeline), probability_weighted_pipeline: Math.round(totalWeighted) };
    }, params);
  },
};

const fmApplyRepHaircuts: ToolDefinition = {
  name: 'fmApplyRepHaircuts',
  description: 'Apply historical forecast accuracy haircuts to rep-level deal scores',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('fmApplyRepHaircuts', async () => {
      const scoredDeals = ((context.stepResults as any).scored_deals as any[]) || [];
      if (!scoredDeals.length) return { adjusted_deals: [], rep_haircuts: {} };

      // Get historical accuracy per rep (last 4 quarters)
      const accuracyResult = await query<any>(
        `SELECT d.owner as owner_name,
                COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::float /
                  NULLIF(COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost')), 0) as win_rate,
                COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost'))::int as sample_size
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.close_date >= CURRENT_DATE - INTERVAL '365 days'
           AND d.owner IS NOT NULL
         GROUP BY d.owner
         HAVING COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost')) >= 3`,
        [context.workspaceId]
      ).catch(() => ({ rows: [] as any[] }));

      const repAccuracy = new Map<string, number>();
      let teamAvg = 0.5;
      if (accuracyResult.rows.length > 0) {
        const rates = accuracyResult.rows.map((r: any) => parseFloat(r.win_rate) || 0).filter((r: number) => r > 0);
        teamAvg = rates.length > 0 ? rates.reduce((s: number, r: number) => s + r, 0) / rates.length : 0.5;
        for (const r of accuracyResult.rows) {
          repAccuracy.set(r.owner_name, parseFloat(r.win_rate) || teamAvg);
        }
      }

      const repHaircuts: Record<string, number> = {};
      const adjustedDeals = scoredDeals.map((deal: any) => {
        const repRate = repAccuracy.get(deal.owner) ?? teamAvg;
        const haircutFactor = teamAvg > 0 ? Math.min(repRate / teamAvg, 1.2) : 1.0;
        repHaircuts[deal.owner] = haircutFactor;
        const adjustedProbability = Math.min(Math.round(deal.probability * haircutFactor), 95);
        return {
          ...deal,
          haircut_factor: Math.round(haircutFactor * 100) / 100,
          adjusted_probability: adjustedProbability,
          adjusted_amount: Math.round(deal.amount * adjustedProbability / 100),
        };
      });

      return { adjusted_deals: adjustedDeals, rep_haircuts: repHaircuts, team_avg_win_rate: Math.round(teamAvg * 100) };
    }, params);
  },
};

const fmComputePipelineProjection: ToolDefinition = {
  name: 'fmComputePipelineProjection',
  description: 'Compute how much pipeline will be created in the current quarter and how much will close in-quarter',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('fmComputePipelineProjection', async () => {
      const now = new Date();
      const currentQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const currentQEnd = new Date(currentQStart);
      currentQEnd.setMonth(currentQEnd.getMonth() + 3);

      // Pipeline created so far this quarter
      const createdResult = await query<any>(
        `SELECT COUNT(*)::int as deals_created,
                COALESCE(SUM(d.amount), 0)::numeric as amount_created
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.created_at >= $2 AND d.created_at < $3
           AND d.amount > 0`,
        [context.workspaceId, currentQStart.toISOString(), currentQEnd.toISOString()]
      );

      // Historical in-quarter close rate (last 4 quarters)
      const inQtrResult = await query<any>(
        `SELECT
           COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won'
             AND d.close_date >= d.created_at::date
             AND d.close_date < $2)::float /
           NULLIF(COUNT(*), 0) as inqtr_close_rate,
           COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won'
             AND d.close_date >= d.created_at::date
             AND d.close_date < $2), 0)::numeric / NULLIF(SUM(d.amount), 0) as inqtr_amount_rate
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.created_at >= $3 AND d.created_at < $2
           AND d.amount > 0`,
        [context.workspaceId, currentQStart.toISOString(), new Date(currentQStart.getTime() - 365 * 86400000).toISOString()]
      ).catch(() => ({ rows: [{ inqtr_close_rate: null, inqtr_amount_rate: null }] as any[] }));

      const daysInQtr = 91;
      const daysElapsed = Math.round((now.getTime() - currentQStart.getTime()) / 86400000);
      const fractionElapsed = Math.min(daysElapsed / daysInQtr, 1);
      const fractionRemaining = Math.max(0, 1 - fractionElapsed);

      const amtCreatedSoFar = parseFloat(createdResult.rows[0]?.amount_created || '0');
      const inqtrAmtRate = parseFloat(inQtrResult.rows[0]?.inqtr_amount_rate || '0') || 0.15;

      // Project remaining creation based on current pace
      const pacePerDay = daysElapsed > 0 ? amtCreatedSoFar / daysElapsed : 0;
      const projectedRemainingCreation = Math.round(pacePerDay * daysInQtr * fractionRemaining);
      const projectedTotalCreation = Math.round(amtCreatedSoFar + projectedRemainingCreation);
      const projectedInQtrBookings = Math.round(projectedTotalCreation * inqtrAmtRate);

      return {
        current_quarter: `${currentQStart.getFullYear()}-Q${Math.floor(currentQStart.getMonth() / 3) + 1}`,
        days_elapsed: daysElapsed,
        days_remaining: Math.round(daysInQtr * fractionRemaining),
        amount_created_so_far: Math.round(amtCreatedSoFar),
        deals_created_so_far: createdResult.rows[0]?.deals_created || 0,
        pace_per_day: Math.round(pacePerDay),
        projected_remaining_creation: projectedRemainingCreation,
        projected_total_creation: projectedTotalCreation,
        historical_inqtr_close_rate: Math.round(inqtrAmtRate * 1000) / 1000,
        projected_inqtr_bookings: projectedInQtrBookings,
      };
    }, params);
  },
};

const fmBuildForecastModel: ToolDefinition = {
  name: 'fmBuildForecastModel',
  description: 'Build bear/base/bull forecast tiers from adjusted deals and pipeline projection',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('fmBuildForecastModel', async () => {
      const adjustedDeals = Array.isArray((context.stepResults as any).adjusted_deals) ? (context.stepResults as any).adjusted_deals as any[] : [];
      const pipelineProjection = (context.stepResults as any).pipeline_projection || {};

      // Closed-won this quarter
      const now = new Date();
      const currentQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const currentQEnd = new Date(currentQStart);
      currentQEnd.setMonth(currentQEnd.getMonth() + 3);

      const closedResult = await query<any>(
        `SELECT COALESCE(SUM(d.amount), 0)::numeric as closed_won_amount,
                COUNT(*)::int as closed_won_count
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.stage_normalized = 'closed_won'
           AND d.close_date >= $2 AND d.close_date < $3`,
        [context.workspaceId, currentQStart.toISOString(), currentQEnd.toISOString()]
      ).catch(() => ({ rows: [{ closed_won_amount: '0', closed_won_count: 0 }] as any[] }));

      const closedWonAmount = parseFloat(closedResult.rows[0]?.closed_won_amount || '0');
      const closedWonCount = closedResult.rows[0]?.closed_won_count || 0;

      // Tier deals by adjusted probability
      const commitDeals = adjustedDeals.filter((d: any) => d.adjusted_probability >= 70);
      const bestCaseDeals = adjustedDeals.filter((d: any) => d.adjusted_probability >= 40 && d.adjusted_probability < 70);
      const pipelineDeals = adjustedDeals.filter((d: any) => d.adjusted_probability < 40);

      const commitAmount = commitDeals.reduce((s: number, d: any) => s + d.adjusted_amount, 0);
      const bestCaseAmount = bestCaseDeals.reduce((s: number, d: any) => s + d.adjusted_amount, 0);
      const pipelineAmount = pipelineDeals.reduce((s: number, d: any) => s + d.adjusted_amount, 0);
      const inQtrProjection = pipelineProjection.projected_inqtr_bookings || 0;

      const baseCase = Math.round(closedWonAmount + commitAmount + inQtrProjection);
      const bullCase = Math.round(closedWonAmount + commitAmount + bestCaseAmount * 0.5 + inQtrProjection * 1.2);
      const bearCase = Math.round(closedWonAmount + commitAmount * 0.7 + inQtrProjection * 0.5);

      // Rep rollup
      const repMap = new Map<string, { commit: number; best_case: number; pipeline: number; deals: number }>();
      for (const deal of adjustedDeals) {
        const rep = deal.owner || 'Unknown';
        if (!repMap.has(rep)) repMap.set(rep, { commit: 0, best_case: 0, pipeline: 0, deals: 0 });
        const entry = repMap.get(rep)!;
        entry.deals++;
        if (deal.adjusted_probability >= 70) entry.commit += deal.adjusted_amount;
        else if (deal.adjusted_probability >= 40) entry.best_case += deal.adjusted_amount;
        else entry.pipeline += deal.adjusted_amount;
      }

      const repRollup = Array.from(repMap.entries()).map(([rep, data]) => ({
        rep,
        commit: Math.round(data.commit),
        best_case: Math.round(data.best_case),
        pipeline: Math.round(data.pipeline),
        total_weighted: Math.round(data.commit + data.best_case * 0.5 + data.pipeline * 0.15),
        deal_count: data.deals,
      })).sort((a, b) => b.total_weighted - a.total_weighted);

      return {
        closed_won: { amount: Math.round(closedWonAmount), count: closedWonCount },
        commit_tier: { amount: Math.round(commitAmount), count: commitDeals.length, deals: commitDeals.slice(0, 10) },
        best_case_tier: { amount: Math.round(bestCaseAmount), count: bestCaseDeals.length, deals: bestCaseDeals.slice(0, 10) },
        pipeline_tier: { amount: Math.round(pipelineAmount), count: pipelineDeals.length },
        in_quarter_projection: { amount: inQtrProjection },
        scenarios: { bear: bearCase, base: baseCase, bull: bullCase },
        rep_rollup: repRollup,
      };
    }, params);
  },
};

// ============================================================================
// Pipeline Gen Forecast compute tools
// ============================================================================

const pgfGatherCreationHistory: ToolDefinition = {
  name: 'pgfGatherCreationHistory',
  description: 'Gather monthly pipeline creation history overall, by source, and by owner',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: { lookback_months: { type: 'number', description: 'Months of history (default 12)' } },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('pgfGatherCreationHistory', async () => {
      const lookbackMonths = params.lookback_months || 12;

      const overallResult = await query<any>(
        `SELECT DATE_TRUNC('month', d.created_date)::text as period,
                COUNT(*)::int as deals_created,
                COALESCE(SUM(d.amount), 0)::numeric as amount_created,
                COALESCE(AVG(d.amount), 0)::numeric as avg_deal_size
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.created_date >= NOW() - ($2 || ' months')::interval
           AND d.created_date IS NOT NULL AND d.amount > 0
         GROUP BY period ORDER BY period`,
        [context.workspaceId, String(lookbackMonths)]
      );

      const ownerResult = await query<any>(
        `SELECT DATE_TRUNC('month', d.created_date)::text as period,
                d.owner as segment_value,
                COUNT(*)::int as deals_created,
                COALESCE(SUM(d.amount), 0)::numeric as amount_created
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.created_date >= NOW() - ($2 || ' months')::interval
           AND d.created_date IS NOT NULL AND d.amount > 0 AND d.owner IS NOT NULL
         GROUP BY period, segment_value ORDER BY period, segment_value`,
        [context.workspaceId, String(lookbackMonths)]
      ).catch(() => ({ rows: [] as any[] }));

      const periods = overallResult.rows.map((r: any) => ({
        period: r.period,
        deals_created: r.deals_created,
        amount_created: parseFloat(r.amount_created),
        avg_deal_size: parseFloat(r.avg_deal_size),
      }));

      const allAmounts = periods.map(p => p.amount_created);
      const avgMonthly = allAmounts.length > 0 ? allAmounts.reduce((s, a) => s + a, 0) / allAmounts.length : 0;
      const last3 = periods.slice(-3);
      const prior3 = periods.slice(-6, -3);
      const last3Avg = last3.length > 0 ? last3.reduce((s, p) => s + p.amount_created, 0) / last3.length : 0;
      const prior3Avg = prior3.length > 0 ? prior3.reduce((s, p) => s + p.amount_created, 0) / prior3.length : last3Avg;
      const changePct = prior3Avg > 0 ? Math.round((last3Avg - prior3Avg) / prior3Avg * 100) : 0;

      // Aggregate by owner
      const ownerMap = new Map<string, { total: number; periods: number }>();
      for (const r of ownerResult.rows) {
        const key = r.segment_value;
        if (!ownerMap.has(key)) ownerMap.set(key, { total: 0, periods: 0 });
        const entry = ownerMap.get(key)!;
        entry.total += parseFloat(r.amount_created);
        entry.periods++;
      }
      const byOwner = Array.from(ownerMap.entries())
        .map(([owner, data]) => ({ owner, total_created: Math.round(data.total), avg_per_period: Math.round(data.total / Math.max(data.periods, 1)) }))
        .sort((a, b) => b.total_created - a.total_created)
        .slice(0, 10);

      return {
        periods,
        trend: { direction: changePct > 10 ? 'increasing' : changePct < -10 ? 'declining' : 'stable', change_pct: changePct, avg_monthly_amount: Math.round(avgMonthly), last_3m_avg: Math.round(last3Avg), prior_3m_avg: Math.round(prior3Avg) },
        by_owner: byOwner,
      };
    }, params);
  },
};

const pgfGatherInqtrCloseRates: ToolDefinition = {
  name: 'pgfGatherInqtrCloseRates',
  description: 'Gather historical in-quarter close rates for pipeline created in the same quarter',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: { lookback_quarters: { type: 'number', description: 'Quarters to analyze (default 4)' } },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('pgfGatherInqtrCloseRates', async () => {
      const lookbackQuarters = params.lookback_quarters || 4;
      const now = new Date();
      const currentQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const quarters = [];

      for (let q = lookbackQuarters; q >= 1; q--) {
        const qStart = new Date(currentQStart);
        qStart.setMonth(qStart.getMonth() - q * 3);
        const qEnd = new Date(qStart);
        qEnd.setMonth(qEnd.getMonth() + 3);

        const r = await query<any>(
          `SELECT
             COUNT(*)::int as deals_created,
             COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won'
               AND d.close_date >= $2 AND d.close_date < $3)::int as deals_closed,
             COALESCE(SUM(d.amount), 0)::numeric as amount_created,
             COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won'
               AND d.close_date >= $2 AND d.close_date < $3), 0)::numeric as amount_closed
           FROM deals d
           WHERE d.workspace_id = $1
             AND d.created_date >= $2 AND d.created_date < $3
             AND d.amount > 0`,
          [context.workspaceId, qStart.toISOString(), qEnd.toISOString()]
        ).catch(() => ({ rows: [{}] as any[] }));

        const row = r.rows[0] || {};
        const amtCreated = parseFloat(row.amount_created || '0');
        const amtClosed = parseFloat(row.amount_closed || '0');
        quarters.push({
          quarter: `${qStart.getFullYear()}-Q${Math.floor(qStart.getMonth() / 3) + 1}`,
          deals_created: row.deals_created || 0,
          amount_created: Math.round(amtCreated),
          amount_closed_inqtr: Math.round(amtClosed),
          amount_close_rate: amtCreated > 0 ? Math.round((amtClosed / amtCreated) * 1000) / 1000 : 0,
        });
      }

      const avgCloseRate = quarters.length > 0
        ? quarters.reduce((s, q) => s + q.amount_close_rate, 0) / quarters.length : 0;

      return { quarters, avg_inqtr_close_rate: Math.round(avgCloseRate * 1000) / 1000 };
    }, params);
  },
};

const pgfComputeProjections: ToolDefinition = {
  name: 'pgfComputeProjections',
  description: 'Build next quarter pipeline and booking projections from creation history and in-quarter close rates',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('pgfComputeProjections', async () => {
      const creationHistory = (context.stepResults as any).creation_history;
      const inqtrCloseRates = (context.stepResults as any).inqtr_close_rates;

      const avgMonthly = creationHistory?.trend?.avg_monthly_amount || 0;
      const avgInqtrRate = inqtrCloseRates?.avg_inqtr_close_rate || 0.15;

      // Next quarter projection
      const projectedNextQtrCreation = Math.round(avgMonthly * 3);
      const projectedNextQtrBookings = Math.round(projectedNextQtrCreation * avgInqtrRate);

      // Coverage ratio (assuming 3x is target)
      const now = new Date();
      const currentQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

      const quotaResult = await query<any>(
        `SELECT COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won'), 0)::numeric as last_qtr_won
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.close_date >= $2 AND d.close_date < $3`,
        [context.workspaceId,
          new Date(currentQStart.getTime() - 91 * 86400000).toISOString(),
          currentQStart.toISOString()]
      ).catch(() => ({ rows: [{ last_qtr_won: '0' }] as any[] }));

      const lastQtrWon = parseFloat(quotaResult.rows[0]?.last_qtr_won || '0');
      const impliedQuota = lastQtrWon * 1.1; // 10% growth target
      const coverageRatio = impliedQuota > 0 ? projectedNextQtrCreation / impliedQuota : 0;
      const targetCoverage = 3.0;
      const gapToTarget = Math.max(0, Math.round(impliedQuota * targetCoverage - projectedNextQtrCreation));

      return {
        next_quarter_projected_creation: projectedNextQtrCreation,
        next_quarter_projected_bookings: projectedNextQtrBookings,
        implied_quota: Math.round(impliedQuota),
        coverage_ratio: Math.round(coverageRatio * 10) / 10,
        target_coverage: targetCoverage,
        gap_to_3x_coverage: gapToTarget,
        avg_monthly_creation_pace: avgMonthly,
        avg_inqtr_close_rate: avgInqtrRate,
      };
    }, params);
  },
};

// ============================================================================
// Competitive Intelligence compute tools
// ============================================================================

const ciCompGatherMentions: ToolDefinition = {
  name: 'ciCompGatherMentions',
  description: 'Gather competitor mentions from conversations, deal_insights, and custom_fields',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: { lookback_months: { type: 'number', description: 'Months to analyze (default 6)' } },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('ciCompGatherMentions', async () => {
      const lookbackMonths = params.lookback_months || 6;

      const convResult = await query<any>(
        `SELECT DISTINCT ON (cv.deal_id, comp_name)
                cv.deal_id, cv.call_date,
                d.name as deal_name, d.amount, d.stage, d.stage_normalized, d.owner,
                comp_name
         FROM conversations cv
         CROSS JOIN LATERAL jsonb_array_elements_text(cv.competitor_mentions) AS comp_name
         LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = $1
         WHERE cv.workspace_id = $1
           AND cv.call_date >= NOW() - ($2 || ' months')::interval
           AND cv.competitor_mentions IS NOT NULL
           AND jsonb_array_length(cv.competitor_mentions) > 0
         ORDER BY cv.deal_id, comp_name, cv.call_date DESC
         LIMIT 500`,
        [context.workspaceId, String(lookbackMonths)]
      ).catch(() => ({ rows: [] as any[] }));

      const insightResult = await query<any>(
        `SELECT di.deal_id, di.insight_value,
                d.name as deal_name, d.amount, d.stage, d.stage_normalized, d.owner
         FROM deal_insights di
         JOIN deals d ON d.id = di.deal_id AND d.workspace_id = $1
         WHERE di.workspace_id = $1
           AND di.insight_type = 'competition'
           AND di.is_current = true
           AND d.created_date >= NOW() - ($2 || ' months')::interval`,
        [context.workspaceId, String(lookbackMonths)]
      ).catch(() => ({ rows: [] as any[] }));

      // Aggregate by competitor
      const compMap = new Map<string, { deal_ids: Set<string>; deals: any[] }>();
      const addMention = (name: string, deal: any) => {
        const key = name.toLowerCase().trim();
        if (!compMap.has(key)) compMap.set(key, { deal_ids: new Set(), deals: [] });
        const entry = compMap.get(key)!;
        const dealId = deal.deal_id || deal.id || String(Math.random());
        if (!entry.deal_ids.has(dealId)) {
          entry.deal_ids.add(dealId);
          if (entry.deals.length < 10) {
            entry.deals.push({ deal_name: deal.deal_name, amount: parseFloat(deal.amount || '0'), stage: deal.stage, stage_normalized: deal.stage_normalized, owner: deal.owner });
          }
        }
      };

      for (const r of convResult.rows) { if (r.comp_name) addMention(r.comp_name, r); }
      for (const r of insightResult.rows) {
        const val = typeof r.insight_value === 'string' ? r.insight_value : JSON.stringify(r.insight_value);
        if (val) addMention(val, r);
      }

      const competitors = Array.from(compMap.entries())
        .map(([name, data]) => ({
          competitor_name: name,
          total_mentions: data.deal_ids.size,
          open_deals: data.deals.filter(d => d.stage_normalized !== 'closed_won' && d.stage_normalized !== 'closed_lost').length,
          deals: data.deals,
        }))
        .sort((a, b) => b.total_mentions - a.total_mentions);

      return {
        competitors,
        total_deals_with_competition: new Set([...convResult.rows, ...insightResult.rows].map(r => r.deal_id)).size,
        data_sources: { conversations: convResult.rows.length, deal_insights: insightResult.rows.length },
      };
    }, params);
  },
};

const ciCompComputeWinRates: ToolDefinition = {
  name: 'ciCompComputeWinRates',
  description: 'Compute win/loss rates by competitor vs baseline',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: { lookback_months: { type: 'number', description: 'Months to analyze (default 6)' } },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('ciCompComputeWinRates', async () => {
      const lookbackMonths = params.lookback_months || 6;
      const competitorMentions = (context.stepResults as any).competitor_mentions;
      const competitors = competitorMentions?.competitors || [];

      // Baseline win rate (no competition)
      const baselineResult = await query<any>(
        `SELECT
           COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::int as wins,
           COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost'))::int as total_closed
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.created_date >= NOW() - ($2 || ' months')::interval
           AND NOT EXISTS (
             SELECT 1 FROM conversations cv
             WHERE cv.deal_id = d.id AND cv.workspace_id = $1
               AND jsonb_array_length(COALESCE(cv.competitor_mentions,'[]'::jsonb)) > 0
           )`,
        [context.workspaceId, String(lookbackMonths)]
      ).catch(() => ({ rows: [{ wins: 0, total_closed: 0 }] as any[] }));

      const baselineWins = baselineResult.rows[0]?.wins || 0;
      const baselineTotal = baselineResult.rows[0]?.total_closed || 0;
      const baselineWinRate = baselineTotal > 0 ? baselineWins / baselineTotal : 0;

      // Win rates per competitor from the deal data we already have
      const withRates = competitors.map((comp: any) => {
        const closed = comp.deals.filter((d: any) => d.stage_normalized === 'closed_won' || d.stage_normalized === 'closed_lost');
        const wins = comp.deals.filter((d: any) => d.stage_normalized === 'closed_won').length;
        const winRate = closed.length > 0 ? wins / closed.length : 0;
        return {
          competitor_name: comp.competitor_name,
          deals_mentioned: comp.total_mentions,
          wins,
          losses: closed.length - wins,
          open: comp.open_deals,
          win_rate: Math.round(winRate * 1000) / 1000,
          win_rate_baseline: Math.round(baselineWinRate * 1000) / 1000,
          win_rate_delta: Math.round((winRate - baselineWinRate) * 1000) / 1000,
        };
      });

      return {
        competitors: withRates,
        baseline: { win_rate: Math.round(baselineWinRate * 1000) / 1000, total_closed: baselineTotal, wins: baselineWins },
      };
    }, params);
  },
};

// ============================================================================
// Forecast Accuracy Tracking compute tools
// ============================================================================

const fatGatherRepAccuracy: ToolDefinition = {
  name: 'fatGatherRepAccuracy',
  description: 'Gather per-rep forecast accuracy metrics over the last 4 quarters: commit hit rate, close date error, amount error, and haircut factor',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('fatGatherRepAccuracy', async () => {
      // Rep-level accuracy: compare deal amounts at first stage vs closed amount,
      // and whether deals that were ever in commit/best_case actually closed.
      const repResult = await query<any>(
        `SELECT
           d.owner as rep_name,
           COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost'))::int as total_closed,
           COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::int as total_won,
           AVG(CASE WHEN d.stage_normalized = 'closed_won' AND d.close_date IS NOT NULL
                    THEN EXTRACT(DAY FROM (d.close_date::date - d.created_date::date))
                    ELSE NULL END)::numeric as avg_cycle_days,
           AVG(CASE WHEN d.stage_normalized IN ('closed_won','closed_lost') AND d.amount > 0
                    THEN d.amount ELSE NULL END)::numeric as avg_deal_size,
           COUNT(*) FILTER (WHERE d.forecast_category = 'commit'
             AND d.stage_normalized = 'closed_won')::int as commit_closed_won,
           COUNT(*) FILTER (WHERE d.forecast_category = 'commit'
             AND d.stage_normalized IN ('closed_won','closed_lost'))::int as commit_total_closed
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.close_date >= CURRENT_DATE - INTERVAL '365 days'
           AND d.owner IS NOT NULL
         GROUP BY d.owner
         HAVING COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost')) >= 1
         ORDER BY total_closed DESC`,
        [context.workspaceId]
      );

      const reps = repResult.rows.map((r: any) => {
        const totalClosed = r.total_closed || 0;
        const totalWon = r.total_won || 0;
        const commitTotal = r.commit_total_closed || 0;
        const commitWon = r.commit_closed_won || 0;
        const winRate = totalClosed > 0 ? totalWon / totalClosed : 0;
        const commitHitRate = commitTotal > 0 ? commitWon / commitTotal : null;
        const haircutFactor = Math.min(Math.max(winRate, 0.3), 1.0);

        let pattern: string;
        if (totalClosed < 3) {
          pattern = 'insufficient_data';
        } else if (commitHitRate !== null && commitHitRate > 0.85) {
          pattern = 'accurate';
        } else if (commitHitRate !== null && commitHitRate < 0.55) {
          pattern = 'over_committer';
        } else if (winRate > 0.7 && commitHitRate !== null && commitHitRate < 0.65) {
          pattern = 'sandbagger';
        } else if (totalClosed >= 3 && Math.abs((commitHitRate ?? 0.7) - 0.7) > 0.25) {
          pattern = 'volatile';
        } else {
          pattern = 'accurate';
        }

        return {
          rep_name: r.rep_name,
          quarters_analyzed: Math.min(4, Math.ceil(totalClosed / 3)),
          total_closed: totalClosed,
          total_won: totalWon,
          win_rate: Math.round(winRate * 100),
          commit_hit_rate: commitHitRate !== null ? Math.round(commitHitRate * 100) : null,
          avg_cycle_days: r.avg_cycle_days ? Math.round(parseFloat(r.avg_cycle_days)) : null,
          avg_deal_size: r.avg_deal_size ? Math.round(parseFloat(r.avg_deal_size)) : null,
          haircut_factor: Math.round(haircutFactor * 100) / 100,
          pattern,
        };
      });

      // Team-level summary
      const allWinRates = reps.filter((r: any) => r.total_closed >= 3).map((r: any) => r.win_rate);
      const teamAccuracy = allWinRates.length > 0
        ? Math.round(allWinRates.reduce((s: number, v: number) => s + v, 0) / allWinRates.length)
        : null;

      const sandbaggers = reps.filter((r: any) => r.pattern === 'sandbagger').map((r: any) => r.rep_name);
      const overCommitters = reps.filter((r: any) => r.pattern === 'over_committer').map((r: any) => r.rep_name);
      const mostAccurate = reps.filter((r: any) => r.pattern === 'accurate').sort((a: any, b: any) => b.total_closed - a.total_closed)[0]?.rep_name || null;
      const leastAccurate = reps.filter((r: any) => r.pattern === 'over_committer' || r.pattern === 'volatile').sort((a: any, b: any) => (a.commit_hit_rate ?? 100) - (b.commit_hit_rate ?? 100))[0]?.rep_name || null;
      const avgHaircut = reps.length > 0
        ? Math.round(reps.reduce((s: number, r: any) => s + r.haircut_factor, 0) / reps.length * 100) / 100
        : 1.0;

      return {
        reps,
        team_summary: {
          team_accuracy_pct: teamAccuracy,
          most_accurate_rep: mostAccurate,
          least_accurate_rep: leastAccurate,
          sandbaggers,
          over_committers: overCommitters,
          avg_haircut_factor: avgHaircut,
          total_reps_analyzed: reps.length,
          has_sufficient_data: reps.filter((r: any) => r.total_closed >= 3).length >= 2,
        },
      };
    }, params);
  },
};

const fatGatherHistoricalRollups: ToolDefinition = {
  name: 'fatGatherHistoricalRollups',
  description: 'Pull last 4 weekly-forecast-rollup skill runs to compute team-level forecast drift',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('fatGatherHistoricalRollups', async () => {
      // Pull last 4 completed skill runs for weekly-forecast-rollup
      const runsResult = await query<any>(
        `SELECT sr.id, sr.completed_at, sr.result_data
         FROM skill_runs sr
         WHERE sr.workspace_id = $1
           AND sr.skill_id = 'weekly-forecast-rollup'
           AND sr.status = 'completed'
           AND sr.result_data IS NOT NULL
         ORDER BY sr.completed_at DESC
         LIMIT 4`,
        [context.workspaceId]
      ).catch(() => ({ rows: [] as any[] }));

      const weeklyRollups = runsResult.rows.map((r: any) => {
        const data = r.result_data || {};
        return {
          run_id: r.id,
          week: r.completed_at ? new Date(r.completed_at).toISOString().split('T')[0] : null,
          commit_amount: data.commit?.amount ?? data.forecast?.commit ?? null,
          best_case_amount: data.best_case?.amount ?? data.forecast?.best_case ?? null,
          closed_won_amount: data.closed_won?.amount ?? data.closed_won ?? null,
        };
      });

      // Also get current quarter closed-won as baseline
      const now = new Date();
      const currentQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const closedResult = await query<any>(
        `SELECT COALESCE(SUM(d.amount), 0)::numeric as closed_won_qtd
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.stage_normalized = 'closed_won'
           AND d.close_date >= $2`,
        [context.workspaceId, currentQStart.toISOString()]
      ).catch(() => ({ rows: [{ closed_won_qtd: 0 }] }));

      return {
        weekly_rollups: weeklyRollups,
        has_rollup_history: weeklyRollups.length > 0,
        rollup_count: weeklyRollups.length,
        current_qtd_closed: Math.round(parseFloat(closedResult.rows[0]?.closed_won_qtd || '0')),
      };
    }, params);
  },
};

// ============================================================================
// Contact Role Resolution compute tools (for the new skill variant)
// ============================================================================

const crrGatherContactsNeedingRoles: ToolDefinition = {
  name: 'crrGatherContactsNeedingRoles',
  description: 'Gather deal contacts with NULL or unknown roles that need role assignment',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max contacts to process (default 100)' } },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('crrGatherContactsNeedingRoles', async () => {
      const limit = Math.min(params.limit || 100, 200);

      const result = await query<any>(
        `SELECT dc.id as deal_contact_id, dc.deal_id, dc.contact_id, dc.role as current_role,
                c.first_name, c.last_name, c.title, c.seniority, c.department, c.email,
                d.name as deal_name, d.stage, d.stage_normalized, d.amount, d.owner
         FROM deal_contacts dc
         JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
         JOIN deals d ON d.id = dc.deal_id AND d.workspace_id = dc.workspace_id
         WHERE dc.workspace_id = $1
           AND (dc.role IS NULL OR dc.role = '' OR dc.role = 'unknown')
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND d.amount > 0
         ORDER BY d.amount DESC NULLS LAST
         LIMIT $2`,
        [context.workspaceId, limit]
      );

      return {
        contacts: result.rows.map((r: any) => ({
          deal_contact_id: r.deal_contact_id,
          deal_id: r.deal_id,
          contact_id: r.contact_id,
          contact_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
          title: r.title,
          seniority: r.seniority,
          department: r.department,
          email: r.email,
          deal_name: r.deal_name,
          deal_stage: r.stage,
          deal_amount: parseFloat(r.amount || '0'),
          deal_owner: r.owner,
        })),
        total_needing_roles: result.rows.length,
      };
    }, params);
  },
};

const crrGatherConversationContext: ToolDefinition = {
  name: 'crrGatherConversationContext',
  description: 'Gather conversation participation context for contacts needing role assignment',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('crrGatherConversationContext', async () => {
      const contactsData = (context.stepResults as any).contacts_needing_roles;
      const contacts = contactsData?.contacts || [];
      if (!contacts.length) return { participation: [] };

      const dealIds = [...new Set(contacts.map((c: any) => c.deal_id))];

      const convResult = await query<any>(
        `SELECT cv.deal_id, cv.title, cv.call_date, cv.participants,
                cv.summary
         FROM conversations cv
         WHERE cv.workspace_id = $1
           AND cv.deal_id = ANY($2)
           AND cv.is_internal = false
         ORDER BY cv.call_date DESC
         LIMIT 200`,
        [context.workspaceId, dealIds]
      ).catch(() => ({ rows: [] as any[] }));

      // Match participants to contacts by email
      const participationMap = new Map<string, { calls: number; last_call: string | null; summaries: string[] }>();
      for (const conv of convResult.rows) {
        const participants = Array.isArray(conv.participants) ? conv.participants : [];
        for (const p of participants) {
          const email = (typeof p === 'object' ? p.email : p) || '';
          if (!email) continue;
          if (!participationMap.has(email)) participationMap.set(email, { calls: 0, last_call: null, summaries: [] });
          const entry = participationMap.get(email)!;
          entry.calls++;
          if (!entry.last_call || conv.call_date > entry.last_call) entry.last_call = conv.call_date;
          if (conv.summary && entry.summaries.length < 3) entry.summaries.push(conv.summary);
        }
      }

      return {
        participation: contacts.map((c: any) => ({
          contact_id: c.contact_id,
          deal_id: c.deal_id,
          email: c.email,
          call_count: participationMap.get(c.email)?.calls || 0,
          last_call: participationMap.get(c.email)?.last_call || null,
          recent_summaries: participationMap.get(c.email)?.summaries || [],
        })),
      };
    }, params);
  },
};

const crrPersistRoleEnrichments: ToolDefinition = {
  name: 'crrPersistRoleEnrichments',
  description: 'Persist inferred roles to deal_contacts where confidence meets threshold',
  tier: 'compute',
  parameters: {
    type: 'object',
    properties: { min_confidence: { type: 'number', description: 'Minimum confidence to persist (default 0.6)' } },
    required: [],
  },
  execute: async (params, context) => {
    return safeExecute('crrPersistRoleEnrichments', async () => {
      const minConfidence = params.min_confidence || 0.6;
      const roleInferences = (context.stepResults as any).role_inferences;
      if (!roleInferences) return { persisted: 0, skipped: 0 };

      let inferences: any[] = [];
      try {
        inferences = typeof roleInferences === 'string'
          ? JSON.parse(roleInferences.match(/\[[\s\S]*\]/)?.[0] || '[]')
          : Array.isArray(roleInferences) ? roleInferences : [];
      } catch { inferences = []; }

      const toUpdate = inferences.filter((r: any) => r.confidence >= minConfidence && r.role !== 'unknown');
      let persisted = 0;

      for (const r of toUpdate) {
        try {
          await query(
            `UPDATE deal_contacts
             SET role = $1, updated_at = NOW()
             WHERE workspace_id = $2 AND deal_id = $3 AND contact_id = $4
               AND (role IS NULL OR role = '' OR role = 'unknown')`,
            [r.role, context.workspaceId, r.deal_id, r.contact_id]
          );
          persisted++;
        } catch { /* skip individual failures */ }
      }

      return { persisted, skipped: toUpdate.length - persisted, total_inferred: inferences.length, below_threshold: inferences.length - toUpdate.length };
    }, params);
  },
};

const crrGenerateCoverageFindings: ToolDefinition = {
  name: 'crrGenerateCoverageFindings',
  description: 'Check each open deal for missing champion and economic buyer roles',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('crrGenerateCoverageFindings', async () => {
      const result = await query<any>(
        `SELECT d.id as deal_id, d.name as deal_name, d.amount, d.owner,
                d.stage, d.stage_normalized,
                BOOL_OR(dc.role = 'champion') as has_champion,
                BOOL_OR(dc.role = 'economic_buyer') as has_economic_buyer,
                COUNT(dc.id)::int as total_contacts,
                COUNT(dc.id) FILTER (WHERE dc.role IS NOT NULL AND dc.role != '')::int as contacts_with_roles
         FROM deals d
         LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
         WHERE d.workspace_id = $1
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND d.amount > 0
         GROUP BY d.id, d.name, d.amount, d.owner, d.stage, d.stage_normalized
         ORDER BY d.amount DESC NULLS LAST
         LIMIT 50`,
        [context.workspaceId]
      );

      const findings = result.rows
        .filter((r: any) => !r.has_champion || !r.has_economic_buyer || r.total_contacts === 0)
        .map((r: any) => {
          const missingRoles = [];
          if (!r.has_champion) missingRoles.push('champion');
          if (!r.has_economic_buyer) missingRoles.push('economic_buyer');
          return {
            deal_id: r.deal_id,
            deal_name: r.deal_name,
            amount: parseFloat(r.amount || '0'),
            owner: r.owner,
            stage: r.stage,
            total_contacts: r.total_contacts,
            contacts_with_roles: r.contacts_with_roles,
            missing_roles: missingRoles,
            severity: (r.total_contacts === 0 ? 'critical' : missingRoles.length > 1 ? 'warning' : 'info') as 'critical' | 'warning' | 'info',
          };
        });

      return {
        findings,
        summary: {
          deals_missing_champion: findings.filter(f => f.missing_roles.includes('champion')).length,
          deals_missing_economic_buyer: findings.filter(f => f.missing_roles.includes('economic_buyer')).length,
          deals_no_contacts: findings.filter(f => f.total_contacts === 0).length,
          total_open_deals_analyzed: result.rows.length,
        },
      };
    }, params);
  },
};

// ============================================================================
// Deal Scoring Model Tools
// ============================================================================

const dsmGatherOpenDeals: ToolDefinition = {
  name: 'dsmGatherOpenDeals',
  description: 'Gather all open deals with activity signals and contact role coverage for scoring',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('dsmGatherOpenDeals', async () => {
      const result = await query<any>(
        `SELECT
           d.id, d.name, d.amount, d.stage, d.stage_normalized,
           d.close_date, d.owner, d.days_in_stage, d.probability,
           d.forecast_category, d.next_steps, d.lead_source,
           d.ai_score as previous_ai_score, d.created_at as deal_created_at,
           -- Contact coverage
           COUNT(DISTINCT dc.id)::int as contact_count,
           BOOL_OR(dc.role = 'economic_buyer')::bool as has_economic_buyer,
           BOOL_OR(dc.role = 'champion')::bool as has_champion,
           BOOL_OR(dc.role = 'technical_evaluator')::bool as has_technical_evaluator,
           -- Activity signals
           COUNT(a.id) FILTER (WHERE a.timestamp >= NOW() - INTERVAL '7 days')::int as activities_7d,
           COUNT(a.id) FILTER (WHERE a.timestamp >= NOW() - INTERVAL '14 days')::int as activities_14d,
           COUNT(a.id) FILTER (WHERE a.timestamp >= NOW() - INTERVAL '30 days')::int as activities_30d,
           COUNT(a.id) FILTER (WHERE a.activity_type = 'meeting' AND a.timestamp >= NOW() - INTERVAL '14 days')::int as meetings_14d,
           MAX(a.timestamp) as last_activity_at
         FROM deals d
         LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
         LEFT JOIN activities a ON a.deal_id = d.id AND a.workspace_id = d.workspace_id
         WHERE d.workspace_id = $1
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND d.amount > 0
         GROUP BY d.id, d.name, d.amount, d.stage, d.stage_normalized,
                  d.close_date, d.owner, d.days_in_stage, d.probability,
                  d.forecast_category, d.next_steps, d.lead_source,
                  d.ai_score, d.created_at
         ORDER BY d.amount DESC NULLS LAST`,
        [context.workspaceId]
      );

      const deals = result.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        amount: parseFloat(r.amount || '0'),
        stage: r.stage,
        stage_normalized: r.stage_normalized,
        close_date: r.close_date,
        owner: r.owner,
        days_in_stage: r.days_in_stage || 0,
        probability: parseFloat(r.probability || '0'),
        forecast_category: r.forecast_category,
        next_steps: r.next_steps || '',
        lead_source: r.lead_source,
        previous_ai_score: r.previous_ai_score,
        deal_created_at: r.deal_created_at,
        contact_count: r.contact_count || 0,
        has_economic_buyer: r.has_economic_buyer || false,
        has_champion: r.has_champion || false,
        has_technical_evaluator: r.has_technical_evaluator || false,
        activities_7d: r.activities_7d || 0,
        activities_14d: r.activities_14d || 0,
        activities_30d: r.activities_30d || 0,
        meetings_14d: r.meetings_14d || 0,
        last_activity_at: r.last_activity_at,
        days_since_last_activity: r.last_activity_at
          ? Math.floor((Date.now() - new Date(r.last_activity_at).getTime()) / 86400000)
          : 999,
      }));

      return {
        deals,
        total_open_deals: deals.length,
        total_pipeline_value: deals.reduce((sum: number, d: any) => sum + d.amount, 0),
      };
    }, params);
  },
};

const dsmGatherScoringContext: ToolDefinition = {
  name: 'dsmGatherScoringContext',
  description: 'Gather stage benchmarks and rep win rates for deal scoring context',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('dsmGatherScoringContext', async () => {
      // Stage benchmarks: median and p75 days per stage from closed-won deals
      const benchmarkResult = await query<any>(
        `SELECT stage_normalized,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stage) as median_days,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_in_stage) as p75_days,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY days_in_stage) as p90_days,
                COUNT(*)::int as sample_size
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized = 'closed_won'
           AND days_in_stage > 0
           AND created_at >= NOW() - INTERVAL '12 months'
         GROUP BY stage_normalized`,
        [context.workspaceId]
      ).catch(() => ({ rows: [] as any[] }));

      // Also get per-stage benchmarks from all deals (not just CW)
      const stageResult = await query<any>(
        `SELECT stage_normalized,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stage) as median_days,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_in_stage) as p75_days,
                COUNT(*)::int as sample_size
         FROM deals
         WHERE workspace_id = $1
           AND days_in_stage > 0
           AND created_at >= NOW() - INTERVAL '12 months'
         GROUP BY stage_normalized`,
        [context.workspaceId]
      ).catch(() => ({ rows: [] as any[] }));

      // Rep win rates from closed deals (last 12 months)
      const repResult = await query<any>(
        `SELECT owner,
                COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::int as wins,
                COUNT(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost'))::int as decisions,
                COUNT(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost'))::float as total_closed
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized IN ('closed_won', 'closed_lost')
           AND updated_at >= NOW() - INTERVAL '12 months'
           AND owner IS NOT NULL AND owner != ''
         GROUP BY owner
         HAVING COUNT(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost')) >= 3`,
        [context.workspaceId]
      ).catch(() => ({ rows: [] as any[] }));

      const stageBenchmarks: Record<string, { median_days: number; p75_days: number; p90_days: number }> = {};
      for (const row of stageResult.rows) {
        stageBenchmarks[row.stage_normalized] = {
          median_days: parseFloat(row.median_days || '30'),
          p75_days: parseFloat(row.p75_days || '45'),
          p90_days: parseFloat(row.p90_days || '60'),
        };
      }

      const repWinRates: Record<string, number> = {};
      let totalWins = 0;
      let totalDecisions = 0;
      for (const row of repResult.rows) {
        const winRate = row.decisions > 0 ? row.wins / row.decisions : 0;
        repWinRates[row.owner] = winRate;
        totalWins += row.wins;
        totalDecisions += row.decisions;
      }
      const workspaceWinRate = totalDecisions > 0 ? totalWins / totalDecisions : 0.25;

      return {
        stage_benchmarks: stageBenchmarks,
        rep_win_rates: repWinRates,
        workspace_win_rate: workspaceWinRate,
        total_reps_analyzed: repResult.rows.length,
      };
    }, params);
  },
};

const dsmComputeAndWriteScores: ToolDefinition = {
  name: 'dsmComputeAndWriteScores',
  description: 'Compute 5-dimension deal scores and write ai_score back to deals table',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('dsmComputeAndWriteScores', async () => {
      const openDealsData = (context.stepResults as any).open_deals_data;
      const scoringContext = (context.stepResults as any).scoring_context;

      if (!openDealsData?.deals?.length) {
        return { scored: 0, avg_score: 0, score_distribution: {}, deals_scored: [] };
      }

      const deals: any[] = openDealsData.deals;
      const stageBenchmarks: Record<string, any> = scoringContext?.stage_benchmarks || {};
      const repWinRates: Record<string, number> = scoringContext?.rep_win_rates || {};
      const workspaceWinRate: number = scoringContext?.workspace_win_rate || 0.25;

      const scoredDeals: any[] = [];

      for (const deal of deals) {
        // ─── Dimension 1: Qualification / Fit (20%) ───────────────────────────
        let dim1 = 0;
        // Amount confidence: amount > 0 → 30pts
        if (deal.amount > 0) dim1 += 30;
        // Data completeness: next_steps filled → 15pts, contact_count > 1 → 15pts
        if (deal.next_steps && deal.next_steps.length > 10) dim1 += 15;
        if (deal.contact_count > 1) dim1 += 15;
        // Stage appropriateness: close_date realistic?
        if (deal.close_date) {
          const daysToClose = Math.floor((new Date(deal.close_date).getTime() - Date.now()) / 86400000);
          const stageOrder: Record<string, number> = {
            awareness: 0, qualification: 1, evaluation: 2, proposal: 3, negotiation: 4, closed_won: 5, closed_lost: 5
          };
          const stageRank = stageOrder[deal.stage_normalized] ?? 1;
          // Late stage + reasonable close window = good
          if (stageRank >= 3 && daysToClose >= 7 && daysToClose <= 90) dim1 += 40;
          else if (stageRank >= 2 && daysToClose >= 14 && daysToClose <= 180) dim1 += 25;
          else if (daysToClose > 180 && stageRank <= 1) dim1 += 20; // early stage, far out = ok
          else if (daysToClose < 0) dim1 += 0; // overdue
          else dim1 += 15;
        } else {
          dim1 += 10; // no close date = poor data quality
        }
        dim1 = Math.min(100, dim1);

        // ─── Dimension 2: Engagement / Buying Signals (25%) ──────────────────
        let dim2 = 0;
        // Activity trend (simplified from 30-day windows)
        const act30 = deal.activities_30d;
        const act7 = deal.activities_7d;
        const earlyAct = act30 - deal.activities_14d;
        const lateAct = deal.activities_14d;
        const trendSlope = lateAct - earlyAct; // positive = accelerating
        if (trendSlope > 1) dim2 += 40; // increasing
        else if (act30 > 0 && trendSlope >= -1) dim2 += 20; // flat but active
        else dim2 += 0; // declining or zero
        // Days since last activity
        const dsla = deal.days_since_last_activity;
        if (dsla < 7) dim2 += 30;
        else if (dsla < 14) dim2 += 20;
        else if (dsla < 30) dim2 += 10;
        // Contact breadth
        if (deal.has_economic_buyer) dim2 += 15;
        if (deal.has_champion) dim2 += 15;
        if (deal.contact_count >= 3) dim2 += 20;
        else if (deal.contact_count >= 2) dim2 += 10;
        dim2 = Math.min(100, dim2);

        // ─── Dimension 3: Velocity / Timing (20%) ────────────────────────────
        let dim3 = 0;
        const benchmark = stageBenchmarks[deal.stage_normalized];
        const p75 = benchmark?.p75_days || 30;
        const p90 = benchmark?.p90_days || 60;
        // Stage pacing
        if (deal.days_in_stage < p75) dim3 += 40;
        else if (deal.days_in_stage < p90) dim3 += 20;
        // Close date stability (no way to check pushes without field history — default 20)
        dim3 += 20;
        // Days to close vs stage
        if (deal.close_date) {
          const daysToClose = Math.floor((new Date(deal.close_date).getTime() - Date.now()) / 86400000);
          const stageOrder: Record<string, number> = { awareness: 0, qualification: 1, evaluation: 2, proposal: 3, negotiation: 4 };
          const stageRank = stageOrder[deal.stage_normalized] ?? 1;
          if (daysToClose >= 14 && daysToClose <= 90 && stageRank >= 3) dim3 += 40; // late stage, near close
          else if (daysToClose > 90 && stageRank <= 1) dim3 += 30; // early stage, far out
          else if (daysToClose < 14 && stageRank < 3) dim3 += 0; // wishful
          else dim3 += 20;
        } else {
          dim3 += 15;
        }
        dim3 = Math.min(100, dim3);

        // ─── Dimension 4: Seller Execution (20%) ─────────────────────────────
        let dim4 = 0;
        // Rep win rate
        const repRate = repWinRates[deal.owner] ?? workspaceWinRate;
        if (repRate > 0.30) dim4 += 40;
        else if (repRate > 0.20) dim4 += 25;
        else dim4 += 10;
        // Next steps documented
        if (deal.next_steps && deal.next_steps.length > 10) dim4 += 30;
        // Recent meetings
        if (deal.meetings_14d >= 2) dim4 += 30;
        else if (deal.meetings_14d >= 1) dim4 += 20;
        dim4 = Math.min(100, dim4);

        // ─── Dimension 5: Pipeline Position (15%) ────────────────────────────
        let dim5 = 0;
        // Forecast category
        const fc = (deal.forecast_category || '').toLowerCase();
        if (fc === 'commit' || fc === 'closed') dim5 += 50;
        else if (fc === 'best_case' || fc === 'best case') dim5 += 35;
        else if (fc === 'pipeline') dim5 += 20;
        // Stage normalized
        const sn = deal.stage_normalized || '';
        if (sn === 'negotiation') dim5 += 30;
        else if (sn === 'proposal' || sn === 'evaluation') dim5 += 20;
        else if (sn === 'qualification') dim5 += 10;
        else dim5 += 5;
        // Rep stated probability (max 20)
        if (deal.probability > 0) {
          dim5 += Math.min(20, Math.round(deal.probability / 5));
        }
        dim5 = Math.min(100, dim5);

        // ─── Overall weighted score ───────────────────────────────────────────
        const overall = Math.round(
          dim1 * 0.20 +
          dim2 * 0.25 +
          dim3 * 0.20 +
          dim4 * 0.20 +
          dim5 * 0.15
        );

        const breakdown = {
          qualification: dim1,
          engagement: dim2,
          velocity: dim3,
          execution: dim4,
          position: dim5,
        };

        // Write score to DB
        try {
          await query(
            `UPDATE deals
             SET ai_score = $1,
                 ai_score_updated_at = NOW(),
                 ai_score_breakdown = $2
             WHERE id = $3 AND workspace_id = $4`,
            [overall, JSON.stringify(breakdown), deal.id, context.workspaceId]
          );
        } catch { /* non-fatal */ }

        scoredDeals.push({
          id: deal.id,
          name: deal.name,
          amount: deal.amount,
          stage: deal.stage,
          owner: deal.owner,
          overall_score: overall,
          previous_score: deal.previous_ai_score,
          score_delta: deal.previous_ai_score != null ? overall - deal.previous_ai_score : null,
          breakdown,
          primary_risk: Object.entries(breakdown).sort(([, a], [, b]) => (a as number) - (b as number))[0]?.[0] || 'unknown',
        });
      }

      // ─── Workspace summary ────────────────────────────────────────────────────
      const distribution = { strong: 0, solid: 0, uncertain: 0, at_risk: 0, critical: 0 };
      for (const d of scoredDeals) {
        if (d.overall_score >= 80) distribution.strong++;
        else if (d.overall_score >= 60) distribution.solid++;
        else if (d.overall_score >= 40) distribution.uncertain++;
        else if (d.overall_score >= 20) distribution.at_risk++;
        else distribution.critical++;
      }

      const avgScore = scoredDeals.length > 0
        ? Math.round(scoredDeals.reduce((s: number, d: any) => s + d.overall_score, 0) / scoredDeals.length)
        : 0;

      const movers = scoredDeals.filter((d: any) => d.score_delta != null).sort((a: any, b: any) => Math.abs(b.score_delta) - Math.abs(a.score_delta));
      const biggestImprovers = movers.filter((d: any) => d.score_delta > 0).slice(0, 5);
      const biggestDecliners = movers.filter((d: any) => d.score_delta < 0).slice(0, 5);
      const highValueAtRisk = scoredDeals.filter((d: any) => d.amount > 50000 && d.overall_score < 40)
        .sort((a: any, b: any) => b.amount - a.amount).slice(0, 10);

      return {
        scored: scoredDeals.length,
        avg_score: avgScore,
        score_distribution: distribution,
        biggest_improvers: biggestImprovers,
        biggest_decliners: biggestDecliners,
        high_value_at_risk: highValueAtRisk,
        // Top 20 at-risk by amount for DeepSeek
        top_at_risk: scoredDeals
          .filter((d: any) => d.overall_score < 60)
          .sort((a: any, b: any) => b.amount - a.amount)
          .slice(0, 20),
      };
    }, params);
  },
};

const dsmBuildFindings: ToolDefinition = {
  name: 'dsmBuildFindings',
  description: 'Emit findings for critical and at-risk deals based on ai_score',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('dsmBuildFindings', async () => {
      const scores = (context.stepResults as any).score_results;
      if (!scores?.top_at_risk) return { findings_emitted: 0 };

      const allScored: any[] = [
        ...(scores.high_value_at_risk || []),
        ...(scores.top_at_risk || []),
      ];
      // deduplicate by id
      const seen = new Set<string>();
      const unique = allScored.filter((d: any) => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });

      let emitted = 0;
      for (const deal of unique) {
        const severity = deal.overall_score < 20 ? 'critical' : 'warning';
        const category = deal.overall_score < 20 ? 'deal_score_critical' : 'deal_score_at_risk';
        const weakDim = deal.primary_risk || 'unknown';
        try {
          await query(
            `INSERT INTO findings (workspace_id, deal_id, severity, category, message, evidence, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '7 days')
             ON CONFLICT (workspace_id, deal_id, category)
             DO UPDATE SET severity = EXCLUDED.severity, message = EXCLUDED.message,
                          evidence = EXCLUDED.evidence, updated_at = NOW()`,
            [
              context.workspaceId,
              deal.id,
              severity,
              category,
              `${deal.name} scored ${deal.overall_score}/100 — weakest dimension: ${weakDim}`,
              JSON.stringify({ score: deal.overall_score, breakdown: deal.breakdown, amount: deal.amount }),
            ]
          );
          emitted++;
        } catch { /* non-fatal — findings table may lack ON CONFLICT clause, skip */ }
      }

      return { findings_emitted: emitted, total_at_risk: unique.length };
    }, params);
  },
};

// ============================================================================

const icpScoreOpenDeals: ToolDefinition = {
  name: 'icpScoreOpenDeals',
  description: 'Score all open deals against ICP profile and write icp_fit_score to deals table',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('icpScoreOpenDeals', async () => {
      const discoveryResult = (context.stepResults as any).discovery_result;
      if (!discoveryResult) return { scored: 0, top_icp: [], bottom_icp: [] };

      // Extract ICP profile from discoverICP output
      const profile = discoveryResult.companyProfile || {};
      const sweetSpots: any[] = profile.sweetSpots || [];
      const idealIndustries: string[] = (profile.industryWinRates || [])
        .filter((i: any) => (i.winRate || 0) >= 0.40)
        .map((i: any) => (i.industry || '').toLowerCase());
      const dealAmounts: number[] = (discoveryResult.wonDeals || []).map((d: any) => d.amount || 0);
      dealAmounts.sort((a, b) => a - b);
      const p25Amount = dealAmounts[Math.floor(dealAmounts.length * 0.25)] || 0;
      const p75Amount = dealAmounts[Math.floor(dealAmounts.length * 0.75)] || 500000;
      const topSources: string[] = (profile.leadSourceFunnel || [])
        .filter((s: any) => (s.fullFunnelRate || 0) >= 0.20)
        .map((s: any) => (s.source || '').toLowerCase());

      // Get all open deals with account info
      const dealsResult = await query<any>(
        `SELECT d.id, d.name, d.amount, d.lead_source,
                a.industry, a.employee_count
         FROM deals d
         LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
         WHERE d.workspace_id = $1
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND d.amount > 0
         ORDER BY d.amount DESC`,
        [context.workspaceId]
      ).catch(() => ({ rows: [] as any[] }));

      const scored: any[] = [];
      let totalScored = 0;

      for (const deal of dealsResult.rows) {
        let score = 0;

        // Industry match (0-30 pts)
        const dealIndustry = (deal.industry || '').toLowerCase();
        if (dealIndustry && idealIndustries.length > 0) {
          const matched = idealIndustries.some(ind => dealIndustry.includes(ind) || ind.includes(dealIndustry));
          score += matched ? 30 : 0;
        } else {
          score += 15; // unknown = neutral
        }

        // Deal size match (0-25 pts)
        const amount = parseFloat(deal.amount || '0');
        if (amount >= p25Amount && amount <= p75Amount) {
          score += 25;
        } else if (amount < p25Amount) {
          score += Math.max(0, 25 - Math.round((p25Amount - amount) / p25Amount * 25));
        } else {
          score += Math.max(0, 25 - Math.round((amount - p75Amount) / p75Amount * 20));
        }

        // Employee count match (0-25 pts) — use sweet spots
        const empCount = deal.employee_count || 0;
        if (sweetSpots.length > 0 && empCount > 0) {
          // Check if any sweet spot description matches the employee count range
          const topSweetSpot = sweetSpots[0]?.description || '';
          const sizeMatch = topSweetSpot.toLowerCase().includes('employee') || empCount > 0;
          score += sizeMatch ? 20 : 10;
        } else {
          score += 15; // neutral if no data
        }

        // Lead source match (0-20 pts)
        const leadSource = (deal.lead_source || '').toLowerCase();
        if (leadSource && topSources.length > 0) {
          const matched = topSources.some(src => leadSource.includes(src) || src.includes(leadSource));
          score += matched ? 20 : 0;
        } else {
          score += 10; // neutral
        }

        score = Math.min(100, score);

        // Write score to DB
        try {
          await query(
            `UPDATE deals SET icp_fit_score = $1, icp_fit_at = NOW()
             WHERE id = $2 AND workspace_id = $3`,
            [score, deal.id, context.workspaceId]
          );
          totalScored++;
        } catch { /* non-fatal */ }

        scored.push({
          id: deal.id,
          name: deal.name,
          amount,
          icp_fit_score: score,
          industry: deal.industry,
        });
      }

      const topIcp = [...scored].sort((a, b) => b.icp_fit_score - a.icp_fit_score).slice(0, 5);
      const bottomIcp = [...scored].sort((a, b) => a.icp_fit_score - b.icp_fit_score).slice(0, 5);
      const pipelineInIcp = scored.filter(d => d.icp_fit_score >= 60);
      const pipelineOffIcp = scored.filter(d => d.icp_fit_score < 40);

      const pipelineTotal = scored.reduce((s, d) => s + d.amount, 0);
      const pipelineInIcpValue = pipelineInIcp.reduce((s, d) => s + d.amount, 0);
      const pipelineOffIcpValue = pipelineOffIcp.reduce((s, d) => s + d.amount, 0);

      return {
        scored: totalScored,
        total_open_deals: scored.length,
        avg_icp_fit: scored.length > 0
          ? Math.round(scored.reduce((s, d) => s + d.icp_fit_score, 0) / scored.length)
          : 0,
        pipeline_in_icp_pct: pipelineTotal > 0 ? Math.round(pipelineInIcpValue / pipelineTotal * 100) : 0,
        pipeline_off_icp_pct: pipelineTotal > 0 ? Math.round(pipelineOffIcpValue / pipelineTotal * 100) : 0,
        pipeline_in_icp_value: pipelineInIcpValue,
        pipeline_off_icp_value: pipelineOffIcpValue,
        top_icp_deals: topIcp,
        bottom_icp_deals: bottomIcp,
      };
    }, params);
  },
};

const icpPersistProfile: ToolDefinition = {
  name: 'icpPersistProfile',
  description: 'Write ICP profile to icp_profiles table and emit findings for off-ICP deals',
  tier: 'compute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (params, context) => {
    return safeExecute('icpPersistProfile', async () => {
      const discoveryResult = (context.stepResults as any).discovery_result;
      const fitScores = (context.stepResults as any).icp_fit_scores;

      // Write ICP profile
      let profileId: string | null = null;
      if (discoveryResult) {
        const confidence = discoveryResult.metadata?.dealsAnalyzed >= 20 ? 'high'
          : discoveryResult.metadata?.dealsAnalyzed >= 10 ? 'medium' : 'low';
        try {
          const insertResult = await query<any>(
            `INSERT INTO icp_profiles (workspace_id, profile, deal_sample_size, confidence)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [
              context.workspaceId,
              JSON.stringify(discoveryResult),
              discoveryResult.metadata?.dealsAnalyzed || 0,
              confidence,
            ]
          );
          profileId = insertResult.rows[0]?.id;
        } catch { /* table may not exist yet */ }
      }

      // Emit findings for off-ICP high-value deals
      let findingsEmitted = 0;
      const bottomIcpDeals: any[] = fitScores?.bottom_icp_deals || [];
      for (const deal of bottomIcpDeals) {
        if (deal.amount < 10000) continue;
        try {
          await query(
            `INSERT INTO findings (workspace_id, deal_id, severity, category, message, evidence, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '30 days')
             ON CONFLICT (workspace_id, deal_id, category)
             DO UPDATE SET message = EXCLUDED.message, evidence = EXCLUDED.evidence, updated_at = NOW()`,
            [
              context.workspaceId,
              deal.id,
              'warning',
              'off_icp_deal',
              `${deal.name} scores ${deal.icp_fit_score}/100 on ICP fit`,
              JSON.stringify({ icp_fit_score: deal.icp_fit_score, amount: deal.amount }),
            ]
          );
          findingsEmitted++;
        } catch { /* non-fatal */ }
      }

      // Emit pipeline-level finding if <50% pipeline is ICP-fit
      if (fitScores?.pipeline_in_icp_pct < 50 && fitScores?.total_open_deals >= 5) {
        try {
          await query(
            `INSERT INTO findings (workspace_id, severity, category, message, evidence, expires_at)
             VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days')
             ON CONFLICT DO NOTHING`,
            [
              context.workspaceId,
              'warning',
              'icp_misalignment',
              `Only ${fitScores.pipeline_in_icp_pct}% of pipeline matches ICP — review sourcing strategy`,
              JSON.stringify({ pipeline_in_icp_pct: fitScores.pipeline_in_icp_pct, pipeline_off_icp_value: fitScores.pipeline_off_icp_value }),
            ]
          );
        } catch { /* non-fatal — findings table may not have this conflict path */ }
      }

      return {
        profile_id: profileId,
        findings_emitted: findingsEmitted,
        pipeline_alignment_pct: fitScores?.pipeline_in_icp_pct || 0,
      };
    }, params);
  },
};

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
  ['truncateConversations', truncateConversations],
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
  ['prepareWaterfallSummary', prepareWaterfallSummaryTool],
  ['checkDataAvailability', checkDataAvailabilityTool],
  ['repScorecardCompute', repScorecardComputeTool],
  ['prepareRepScorecardSummary', prepareRepScorecardSummaryTool],
  ['discoverCustomFields', discoverCustomFieldsTool],
  ['generateCustomFieldReport', generateCustomFieldReportTool],
  ['scoreLeads', scoreLeadsTool],
  ['resolveContactRoles', resolveContactRolesTool],
  ['generateContactRoleReport', generateContactRoleReportTool],
  ['discoverICP', discoverICPTool],
  ['prepareBowtieSummary', prepareBowtieSummaryTool],
  ['preparePipelineGoalsSummary', preparePipelineGoalsSummaryTool],
  ['prepareProjectRecap', prepareProjectRecapTool],
  ['prepareStrategyInsights', prepareStrategyInsightsTool],
  ['runConfigAudit', runConfigAuditTool],
  ['getDealRiskScore', getDealRiskScoreTool],
  ['getPipelineRiskSummary', getPipelineRiskSummaryTool],
  ['svbComputeBenchmarks', svbComputeBenchmarks],
  ['svbFlagSlowDeals', svbFlagSlowDeals],
  ['ciGatherConversations', ciGatherConversations],
  ['ciAggregateThemes', ciAggregateThemes],
  ['fmScoreOpenDeals', fmScoreOpenDeals],
  ['fmApplyRepHaircuts', fmApplyRepHaircuts],
  ['fmComputePipelineProjection', fmComputePipelineProjection],
  ['fmBuildForecastModel', fmBuildForecastModel],
  ['pgfGatherCreationHistory', pgfGatherCreationHistory],
  ['pgfGatherInqtrCloseRates', pgfGatherInqtrCloseRates],
  ['pgfComputeProjections', pgfComputeProjections],
  ['ciCompGatherMentions', ciCompGatherMentions],
  ['ciCompComputeWinRates', ciCompComputeWinRates],
  ['fatGatherRepAccuracy', fatGatherRepAccuracy],
  ['fatGatherHistoricalRollups', fatGatherHistoricalRollups],
  ['crrGatherContactsNeedingRoles', crrGatherContactsNeedingRoles],
  ['crrGatherConversationContext', crrGatherConversationContext],
  ['crrPersistRoleEnrichments', crrPersistRoleEnrichments],
  ['crrGenerateCoverageFindings', crrGenerateCoverageFindings],
  ['dsmGatherOpenDeals', dsmGatherOpenDeals],
  ['dsmGatherScoringContext', dsmGatherScoringContext],
  ['dsmComputeAndWriteScores', dsmComputeAndWriteScores],
  ['dsmBuildFindings', dsmBuildFindings],
  ['icpScoreOpenDeals', icpScoreOpenDeals],
  ['icpPersistProfile', icpPersistProfile],
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
