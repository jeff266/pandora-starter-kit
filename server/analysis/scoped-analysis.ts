import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { assembleDealDossier } from '../dossiers/deal-dossier.js';
import { assembleAccountDossier } from '../dossiers/account-dossier.js';

export interface AnalysisRequest {
  workspace_id: string;
  question: string;
  scope: {
    type: 'deal' | 'account' | 'pipeline' | 'rep' | 'workspace';
    entity_id?: string;
    rep_email?: string;
    date_range?: { from: string; to: string };
    filters?: Record<string, any>;
    skill_run_id?: string;
    skill_run_context?: any;
  };
  format?: 'text' | 'slack';
  max_tokens?: number;
}

export interface AnalysisResponse {
  answer: string;
  data_consulted: {
    deals: number;
    contacts: number;
    conversations: number;
    findings: number;
    date_range: { from: string; to: string } | null;
  };
  tokens_used: number;
  latency_ms: number;
}

const MAX_CONTEXT_BYTES = 50 * 1024;

function truncateContext(data: any): any {
  let json = JSON.stringify(data, null, 2);
  if (json.length <= MAX_CONTEXT_BYTES) return data;

  const copy = JSON.parse(JSON.stringify(data));

  if (Array.isArray(copy.conversations) && copy.conversations.length > 5) {
    copy.conversations = copy.conversations.slice(0, 5);
    copy._truncated_conversations = true;
  }
  if (Array.isArray(copy.activities) && copy.activities.length > 10) {
    copy.activities = copy.activities.slice(0, 10);
    copy._truncated_activities = true;
  }

  json = JSON.stringify(copy, null, 2);
  if (json.length <= MAX_CONTEXT_BYTES) return copy;

  if (copy.conversations) {
    for (const cv of copy.conversations) {
      if (cv.summary && cv.summary.length > 200) {
        cv.summary = cv.summary.slice(0, 200) + '...';
      }
    }
  }

  return copy;
}

async function assembleRepContext(workspaceId: string, repEmail: string) {
  const [dealsResult, findingsResult, activitiesResult] = await Promise.all([
    query(
      `SELECT * FROM deals WHERE workspace_id = $1 AND owner = $2 AND stage_normalized NOT IN ('closed_won', 'closed_lost') ORDER BY amount DESC LIMIT 20`,
      [workspaceId, repEmail]
    ),
    query(
      `SELECT * FROM findings WHERE workspace_id = $1 AND owner_email = $2 AND resolved_at IS NULL ORDER BY found_at DESC LIMIT 20`,
      [workspaceId, repEmail]
    ),
    query(
      `SELECT * FROM activities WHERE workspace_id = $1 AND actor = $2 ORDER BY timestamp DESC LIMIT 20`,
      [workspaceId, repEmail]
    ),
  ]);

  return {
    data: {
      rep_email: repEmail,
      deals: dealsResult.rows,
      findings: findingsResult.rows,
      activities: activitiesResult.rows,
    },
    data_consulted: {
      deals: dealsResult.rows.length,
      contacts: 0,
      conversations: 0,
      findings: findingsResult.rows.length,
      date_range: null as { from: string; to: string } | null,
    },
  };
}

async function assemblePipelineContext(workspaceId: string) {
  const [stageResult, findingsResult] = await Promise.all([
    query(
      `SELECT
         d.stage_normalized as stage,
         count(*)::int as deal_count,
         COALESCE(sum(d.amount), 0)::float as total_value,
         COALESCE(sum(d.amount * COALESCE(d.probability, 0.5)), 0)::float as weighted_value
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
       GROUP BY d.stage_normalized
       ORDER BY d.stage_normalized`,
      [workspaceId]
    ),
    query(
      `SELECT severity, count(*)::int as count
       FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL
       GROUP BY severity`,
      [workspaceId]
    ),
  ]);

  const totalDeals = stageResult.rows.reduce((s: number, r: any) => s + r.deal_count, 0);
  const totalPipeline = stageResult.rows.reduce((s: number, r: any) => s + r.total_value, 0);
  const findingsSummary: Record<string, number> = {};
  let totalFindings = 0;
  for (const row of findingsResult.rows) {
    findingsSummary[row.severity] = row.count;
    totalFindings += row.count;
  }

  return {
    data: {
      pipeline: {
        total_deals: totalDeals,
        total_pipeline_value: totalPipeline,
        by_stage: stageResult.rows,
      },
      findings_summary: findingsSummary,
    },
    data_consulted: {
      deals: totalDeals,
      contacts: 0,
      conversations: 0,
      findings: totalFindings,
      date_range: null as { from: string; to: string } | null,
    },
  };
}

async function assembleWorkspaceContext(workspaceId: string) {
  const [pipelineCtx, recentFindings] = await Promise.all([
    assemblePipelineContext(workspaceId),
    query(
      `SELECT f.severity, f.category, f.message, f.skill_id, f.deal_id, f.found_at
       FROM findings f
       WHERE f.workspace_id = $1 AND f.resolved_at IS NULL
       ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 ELSE 4 END, f.found_at DESC
       LIMIT 30`,
      [workspaceId]
    ),
  ]);

  return {
    data: {
      ...pipelineCtx.data,
      recent_findings: recentFindings.rows,
    },
    data_consulted: {
      ...pipelineCtx.data_consulted,
      findings: pipelineCtx.data_consulted.findings,
    },
  };
}

async function assembleContext(request: AnalysisRequest): Promise<{
  data: any;
  data_consulted: AnalysisResponse['data_consulted'];
}> {
  const { workspace_id, scope } = request;
  let result: { data: any; data_consulted: AnalysisResponse['data_consulted'] };

  switch (scope.type) {
    case 'deal': {
      if (!scope.entity_id) throw new Error('entity_id is required for deal scope');
      const dossier = await assembleDealDossier(workspace_id, scope.entity_id);
      result = {
        data: dossier,
        data_consulted: {
          deals: 1,
          contacts: dossier.contacts.length,
          conversations: dossier.conversations.length,
          findings: dossier.findings.length,
          date_range: null,
        },
      };
      break;
    }
    case 'account': {
      if (!scope.entity_id) throw new Error('entity_id is required for account scope');
      const dossier = await assembleAccountDossier(workspace_id, scope.entity_id);
      result = {
        data: dossier,
        data_consulted: {
          deals: dossier.deals.length,
          contacts: dossier.contacts.length,
          conversations: dossier.conversations.length,
          findings: dossier.findings.length,
          date_range: null,
        },
      };
      break;
    }
    case 'rep': {
      if (!scope.rep_email) throw new Error('rep_email is required for rep scope');
      result = await assembleRepContext(workspace_id, scope.rep_email);
      break;
    }
    case 'pipeline': {
      result = await assemblePipelineContext(workspace_id);
      break;
    }
    case 'workspace': {
      result = await assembleWorkspaceContext(workspace_id);
      break;
    }
    default:
      throw new Error(`Unknown scope type: ${scope.type}`);
  }

  if (scope.skill_run_context) {
    result.data.skill_run_context = scope.skill_run_context;
  }

  if (scope.date_range) {
    result.data_consulted.date_range = scope.date_range;
  }

  result.data = truncateContext(result.data);

  return result;
}

export async function runScopedAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const startTime = Date.now();
  const { workspace_id, question, scope, max_tokens } = request;
  const maxTokens = max_tokens || 2000;

  const { data: context, data_consulted } = await assembleContext(request);

  const voiceConfig = await configLoader.getVoiceConfig(workspace_id);

  const systemPrompt = `You are a senior RevOps analyst answering a specific question.

CONTEXT DATA:
${JSON.stringify(context, null, 2)}

SCOPE: ${scope.type}${scope.entity_id ? ` (ID: ${scope.entity_id})` : ''}

RULES:
- Answer the question directly. No preamble.
- Use specific numbers and deal names from the context.
- If the data doesn't contain enough information to answer, say what's missing.
- Keep the answer under ${maxTokens < 1500 ? '150' : '300'} words.
- Do not speculate beyond what the data shows.

${voiceConfig.promptBlock}`;

  const response = await callLLM(workspace_id, 'reason', {
    systemPrompt,
    messages: [{ role: 'user', content: question }],
    maxTokens,
  });

  const latencyMs = Date.now() - startTime;
  const tokensUsed = response.usage.input + response.usage.output;

  return {
    answer: response.content,
    data_consulted,
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
  };
}
