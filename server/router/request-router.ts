/**
 * Request Router
 *
 * Classifies free-text user input into one of four request types:
 * 1. evidence_inquiry - "Show me how you calculated X"
 * 2. scoped_analysis - "Why did pipeline drop last week?"
 * 3. deliverable_request - "Build me a sales process map"
 * 4. skill_execution - "Run pipeline hygiene"
 *
 * Pre-routes common patterns to bypass LLM classification for speed.
 * Uses DeepSeek for classification when LLM is needed.
 */

import { getWorkspaceState, WorkspaceStateIndex } from './state-index.js';
import { ClaudeClient } from '../utils/llm-client.js';

export type RequestType = 'evidence_inquiry' | 'scoped_analysis' | 'deliverable_request' | 'skill_execution';

export interface RouterDecision {
  type: RequestType;
  confidence: number;

  // Evidence Inquiry fields
  target_skill?: string;
  target_metric?: string;
  target_entity_type?: string;
  target_entity_id?: string;

  // Scoped Analysis fields
  scope_type?: 'deal' | 'account' | 'rep' | 'pipeline' | 'segment' | 'forecast' | 'time_range';
  scope_entity?: string;
  scope_question?: string;
  skills_to_consult?: string[];

  // Deliverable Request fields
  deliverable_type?: string;
  template_id?: string;

  // Skill Execution fields
  skill_id?: string;
  skill_params?: Record<string, any>;

  // Router metadata
  needs_clarification: boolean;
  clarification_question?: string;

  // Freshness decisions
  stale_skills_to_rerun?: string[];
  estimated_wait?: string;

  // For the execution layer
  workspace_state: WorkspaceStateIndex;
}

const ROUTER_SYSTEM_PROMPT = `You are a request classifier for Pandora, a GTM Intelligence Platform.

Your job is to classify user requests into exactly one of four types and extract structured parameters.

## Request Types

TYPE 1 — evidence_inquiry: The user wants to see how something was calculated or view existing evidence.
Signal words: "show me", "how did you", "why is", "what went into", "break down", "explain"
Examples:
- "Show me how you calculated win rate" → evidence_inquiry, target_metric: win_rate
- "Why is the Acme deal flagged?" → evidence_inquiry, target_entity: Acme

TYPE 2 — scoped_analysis: The user is asking an analytical question about a specific entity or metric.
Signal words: "why did", "what happened", "what's going on", "compare", "trend"
Examples:
- "Why did pipeline drop last week?" → scoped_analysis, scope: pipeline
- "What's happening with the Acme account?" → scoped_analysis, scope: account, entity: Acme

TYPE 3 — deliverable_request: The user wants a structured output document or report.
Signal words: "build", "create", "generate", "give me a", "produce", "export"
Examples:
- "Build me a sales process map" → deliverable_request, deliverable_type: sales_process_map
- "Score my leads" → deliverable_request, deliverable_type: lead_scoring

TYPE 4 — skill_execution: The user explicitly wants to run a specific skill.
Signal words: "run", "execute", "refresh", "rerun", "update"
Examples:
- "Run pipeline hygiene" → skill_execution, skill_id: pipeline-hygiene
- "Refresh lead scores" → skill_execution, skill_id: lead-scoring

Respond with ONLY valid JSON matching this exact schema:
{
  "type": "evidence_inquiry" | "scoped_analysis" | "deliverable_request" | "skill_execution",
  "confidence": 0.0-1.0,
  "target_skill": "skill-id or null",
  "target_metric": "metric name or null",
  "scope_type": "deal|account|rep|pipeline|segment|forecast|time_range or null",
  "scope_entity": "entity name or null",
  "scope_question": "distilled question or null",
  "skills_to_consult": ["skill-id", ...] or null,
  "deliverable_type": "template id or null",
  "skill_id": "skill-id or null",
  "needs_clarification": true|false,
  "clarification_question": "question or null"
}`;

export async function classifyRequest(
  workspaceId: string,
  userInput: string,
  context?: {
    scope_type?: string;
    scope_entity?: string;
    source?: 'command_center' | 'slack_thread' | 'slack_dm' | 'api';
    thread_context?: string;
  }
): Promise<RouterDecision> {
  // Step 1: Get workspace state
  const state = await getWorkspaceState(workspaceId);

  // Step 2: Check for pre-routed patterns first (skip LLM for obvious cases)
  const preRouted = checkPreRoutedPatterns(userInput, state, context);
  if (preRouted) {
    return { ...preRouted, workspace_state: state } as RouterDecision;
  }

  // Step 3: Build context summary for the classifier
  const contextSummary = buildContextSummary(state, context);

  // Step 4: Call Claude for classification
  const classificationPrompt = `${contextSummary}

User request: "${userInput}"`;

  const client = new ClaudeClient({ model: 'claude-sonnet-4-5' });
  const response = await client.call(
    ROUTER_SYSTEM_PROMPT,
    classificationPrompt,
    { temperature: 0, maxTokens: 300 }
  );

  // Step 5: Parse classification
  let classification: any;
  try {
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    classification = JSON.parse(cleaned);
  } catch (err) {
    console.error('[Router] Failed to parse classification:', response);
    return {
      type: 'scoped_analysis',
      confidence: 0.3,
      scope_question: userInput,
      needs_clarification: true,
      clarification_question: "I wasn't sure what you meant. Could you rephrase your question?",
      workspace_state: state,
    };
  }

  // Step 6: Enrich classification with freshness decisions
  const enriched = enrichWithFreshnessDecisions(classification, state);

  // Step 7: Apply pre-set scope from UI context
  if (context?.scope_type && !enriched.scope_type) {
    enriched.scope_type = context.scope_type;
    enriched.scope_entity = context.scope_entity || enriched.scope_entity;
  }

  return {
    ...enriched,
    workspace_state: state,
  };
}

function checkPreRoutedPatterns(
  userInput: string,
  state: WorkspaceStateIndex,
  context?: any
): Partial<RouterDecision> | null {
  const input = userInput.toLowerCase().trim();

  // Explicit skill run commands
  const runPatterns: Record<string, string> = {
    'run pipeline hygiene': 'pipeline-hygiene',
    'run pipeline-hygiene': 'pipeline-hygiene',
    'run data quality': 'data-quality-audit',
    'run single thread': 'single-thread-alert',
    'run pipeline coverage': 'pipeline-coverage',
    'run lead scoring': 'lead-scoring',
    'run icp discovery': 'icp-discovery',
    'run forecast': 'forecast-rollup',
    'run waterfall': 'pipeline-waterfall',
    'refresh lead scores': 'lead-scoring',
    'refresh pipeline': 'pipeline-hygiene',
  };

  for (const [pattern, skillId] of Object.entries(runPatterns)) {
    if (input.startsWith(pattern) || input === pattern) {
      return {
        type: 'skill_execution',
        confidence: 0.99,
        skill_id: skillId,
        needs_clarification: false,
        estimated_wait: '10-30 seconds',
      };
    }
  }

  // Explicit deliverable requests
  const deliverablePatterns: Record<string, string> = {
    'build me a sales process map': 'sales_process_map',
    'create a sales process map': 'sales_process_map',
    'generate sales process map': 'sales_process_map',
    'export sales process map': 'sales_process_map',
    'build me a gtm blueprint': 'gtm_blueprint',
    'export pipeline audit': 'pipeline_audit',
    'generate forecast report': 'forecast_report',
  };

  for (const [pattern, templateId] of Object.entries(deliverablePatterns)) {
    if (input.includes(pattern)) {
      return {
        type: 'deliverable_request',
        confidence: 0.95,
        deliverable_type: templateId,
        template_id: templateId,
        needs_clarification: false,
        estimated_wait: '30-60 seconds',
      };
    }
  }

  // Workspace status requests
  if (input === 'status' || input === 'workspace status' || input === 'what can you do') {
    return {
      type: 'evidence_inquiry',
      confidence: 0.95,
      target_metric: 'workspace_status',
      needs_clarification: false,
      estimated_wait: '< 1 second',
    };
  }

  return null;
}

function buildContextSummary(state: WorkspaceStateIndex, context?: any): string {
  const skillList = Object.values(state.skill_states)
    .filter(s => s.has_evidence)
    .map(s => {
      const age = s.last_run ? getRelativeTime(new Date(s.last_run)) : 'never';
      return `${s.skill_id} (${age}, ${s.claim_count} findings)`;
    })
    .join(', ');

  const missingSkills = Object.values(state.skill_states)
    .filter(s => !s.has_evidence)
    .map(s => s.skill_id)
    .join(', ');

  const dc = state.data_coverage;

  let summary = `Available workspace context:
- CRM: ${dc.crm_type || 'not connected'} (${dc.deals_total} deals, ${dc.deals_closed_won} won, ${dc.deals_closed_lost} lost)
- Skills with evidence: ${skillList || 'none'}
- Skills without evidence: ${missingSkills || 'all have evidence'}`;

  if (context?.scope_type) {
    summary += `\n- Current UI scope: ${context.scope_type}${context.scope_entity ? ` — ${context.scope_entity}` : ''}`;
  }

  if (context?.thread_context) {
    summary += `\n- Thread context: ${context.thread_context}`;
  }

  return summary;
}

function getRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

function enrichWithFreshnessDecisions(
  classification: any,
  state: WorkspaceStateIndex
): Partial<RouterDecision> {
  const result: Partial<RouterDecision> = { ...classification };
  result.stale_skills_to_rerun = [];

  switch (classification.type) {
    case 'evidence_inquiry':
      if (classification.target_skill) {
        const skillState = state.skill_states[classification.target_skill];
        if (!skillState?.has_evidence) {
          result.needs_clarification = true;
          result.clarification_question =
            `${formatSkillName(classification.target_skill)} hasn't been run yet. Would you like me to run it now?`;
          result.type = 'skill_execution';
          result.skill_id = classification.target_skill;
        }
      }
      result.estimated_wait = '< 1 second';
      break;

    case 'scoped_analysis':
      const consultSkills = classification.skills_to_consult || inferConsultSkills(classification);
      result.skills_to_consult = consultSkills;

      const staleForAnalysis = consultSkills.filter(
        (s: string) => state.skill_states[s]?.is_stale
      );
      if (staleForAnalysis.length > 0) {
        result.stale_skills_to_rerun = staleForAnalysis;
        result.estimated_wait = '10-30 seconds';
      } else {
        result.estimated_wait = '3-5 seconds';
      }
      break;

    case 'deliverable_request':
      const templateId = classification.deliverable_type || classification.template_id;
      if (templateId && state.template_readiness[templateId]) {
        const readiness = state.template_readiness[templateId];
        if (!readiness.ready) {
          result.needs_clarification = true;
          result.clarification_question = readiness.reason;
        }
        if (readiness.stale_skills.length > 0) {
          result.stale_skills_to_rerun = readiness.stale_skills;
        }
      }
      result.estimated_wait = '30-60 seconds';
      break;

    case 'skill_execution':
      result.estimated_wait = '10-30 seconds';
      break;
  }

  return result;
}

function inferConsultSkills(classification: any): string[] {
  const scopeSkillMap: Record<string, string[]> = {
    'deal': ['pipeline-hygiene', 'single-thread-alert'],
    'account': ['single-thread-alert', 'icp-discovery'],
    'rep': ['pipeline-coverage', 'pipeline-hygiene', 'rep-scorecard'],
    'pipeline': ['pipeline-hygiene', 'pipeline-coverage', 'pipeline-waterfall', 'forecast-rollup'],
    'forecast': ['forecast-rollup', 'pipeline-hygiene', 'pipeline-coverage'],
    'segment': ['icp-discovery', 'pipeline-hygiene'],
    'time_range': ['pipeline-hygiene', 'pipeline-waterfall'],
  };

  return scopeSkillMap[classification.scope_type] || ['pipeline-hygiene'];
}

function formatSkillName(skillId: string): string {
  return skillId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
