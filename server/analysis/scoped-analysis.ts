import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { assembleDealDossier, type DealDossier } from '../dossiers/deal-dossier.js';
import { assembleAccountDossier, type AccountDossier } from '../dossiers/account-dossier.js';
import { generatePipelineSnapshot, type PipelineSnapshot } from './pipeline-snapshot.js';

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

export interface AnalysisResult {
  answer: string;
  data_consulted: string[];
  confidence: 'high' | 'medium' | 'low';
  suggested_followups: string[];
  tokens_used: number;
  latency_ms: number;
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

function fmtAmount(amount: number | string | null | undefined): string {
  const n = Number(amount) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return 'not set';
  return d.split('T')[0] || d;
}

function compressDealContext(dossier: DealDossier): { text: string; sources: string[] } {
  const d = dossier.deal;
  const lines: string[] = [];
  const sources: string[] = ['deal'];

  lines.push(`DEAL: ${d.name}`);
  lines.push(`Amount: ${fmtAmount(d.amount)} | Stage: ${d.stage || d.stage_normalized} (${d.days_in_stage ?? '?'} days) | Close: ${fmtDate(d.close_date)}`);
  lines.push(`Owner: ${d.owner_name || d.owner_email || 'unknown'}`);
  if (d.account_name) lines.push(`Account: ${d.account_name}`);
  if (d.probability != null) lines.push(`Probability: ${Math.round(Number(d.probability) * 100)}% | Forecast: ${d.forecast_category || 'unknown'}`);

  const hs = dossier.health_signals;
  lines.push(`\nHEALTH: activity=${hs.activity_recency}, threading=${hs.threading}, velocity=${hs.stage_velocity}, completeness=${hs.data_completeness}%`);

  if (dossier.risk_score) {
    lines.push(`RISK: grade=${dossier.risk_score.grade}, score=${dossier.risk_score.score} (act:${dossier.risk_score.signal_counts.act}, watch:${dossier.risk_score.signal_counts.watch})`);
  }

  if (dossier.contacts.length > 0) {
    sources.push('contacts');
    lines.push(`\nCONTACTS (${dossier.contacts.length}):`);
    for (const c of dossier.contacts) {
      const parts = [`${c.name}`];
      if (c.title) parts.push(c.title);
      parts.push(c.engagement_level);
      if (c.buying_role && c.buying_role !== 'unknown') parts.push(c.buying_role);
      lines.push(`- ${parts.join(', ')}`);
    }
  }

  if (dossier.conversations.length > 0) {
    sources.push('conversations');
    lines.push(`\nCONVERSATIONS (${dossier.conversations.length} recent):`);
    for (const cv of dossier.conversations.slice(0, 5)) {
      const dur = cv.duration_minutes ? ` (${cv.duration_minutes}min)` : '';
      const method = cv.link_method ? ` — linked via ${cv.link_method}` : '';
      lines.push(`- ${fmtDate(cv.date)}: "${cv.title}"${dur}${method}`);
    }
  }

  if (dossier.findings.length > 0) {
    sources.push('findings');
    lines.push(`\nFINDINGS (${dossier.findings.length} active):`);
    for (const f of dossier.findings) {
      const actionStr = f.actionability && f.actionability !== 'unknown' ? ` [${f.actionability}]` : '';
      lines.push(`- ${f.severity.toUpperCase()}: ${f.message}${actionStr}`);
    }
  }

  const cg = dossier.coverage_gaps;
  if (cg.contacts_never_called.length > 0 || cg.unlinked_calls > 0) {
    lines.push(`\nCOVERAGE GAPS:`);
    if (cg.contacts_never_called.length > 0) {
      const names = cg.contacts_never_called.map(c => `${c.name}${c.title ? ` (${c.title})` : ''}`).join(', ');
      lines.push(`- Never called: ${names}`);
    }
    if (cg.days_since_last_call != null) {
      lines.push(`- ${cg.days_since_last_call} days since last call`);
    }
    if (cg.unlinked_calls > 0) {
      lines.push(`- ${cg.unlinked_calls} unlinked call(s) matching account domain`);
    }
  }

  if (dossier.stage_history.length > 0) {
    lines.push(`\nSTAGE HISTORY:`);
    for (const sh of dossier.stage_history) {
      const exitLabel = sh.exited_at ? ` → exited ${fmtDate(sh.exited_at)}` : ' (current)';
      lines.push(`- ${sh.stage}: ${sh.days_in_stage} days (entered ${fmtDate(sh.entered_at)}${exitLabel})`);
    }
  }

  if (dossier.enrichment) {
    const e = dossier.enrichment;
    if (e.buying_committee_size > 0 || e.icp_fit_score) {
      lines.push(`\nENRICHMENT: buying committee: ${e.buying_committee_size}, roles identified: ${e.roles_identified}, ICP fit: ${e.icp_fit_score ?? 'unknown'}`);
    }
  }

  if (dossier.annotations.length > 0) {
    lines.push(`\nTEAM NOTES (${dossier.annotations.length}):`);
    for (const a of dossier.annotations.slice(0, 5)) {
      lines.push(`- [${a.annotation_type}] ${a.content} (${a.source}, ${fmtDate(a.created_at)})`);
    }
  }

  return { text: lines.join('\n'), sources };
}

function compressAccountContext(dossier: AccountDossier): { text: string; sources: string[] } {
  const a = dossier.account;
  const lines: string[] = [];
  const sources: string[] = ['account'];

  lines.push(`ACCOUNT: ${a.name}`);
  if (a.domain) lines.push(`Domain: ${a.domain}`);
  if (a.industry) lines.push(`Industry: ${a.industry}`);
  if (a.owner_email) lines.push(`Owner: ${a.owner_email}`);
  if (a.employee_count) lines.push(`Employees: ${a.employee_count}`);

  const ds = dossier.deal_summary;
  lines.push(`\nDEAL SUMMARY: ${ds.open_count} open (${fmtAmount(ds.open_pipeline)} pipeline), ${ds.won_count} won (${fmtAmount(ds.won_revenue)}), ${ds.lost_count} lost, avg size: ${fmtAmount(ds.avg_deal_size)}`);

  if (dossier.deals.length > 0) {
    sources.push('deals');
    lines.push(`\nDEALS (${dossier.deals.length}):`);
    for (const d of dossier.deals) {
      lines.push(`- ${d.name}: ${fmtAmount(d.amount)} — ${d.stage} (${d.health_status})${d.close_date ? `, close: ${fmtDate(d.close_date)}` : ''}`);
    }
  }

  const rh = dossier.relationship_health;
  lines.push(`\nRELATIONSHIP HEALTH: overall=${rh.overall}, trend=${rh.engagement_trend}`);
  lines.push(`Conversations: ${rh.total_conversations} total, ${rh.conversations_last_30d} last 30d, ${rh.conversations_last_90d} last 90d`);
  lines.push(`Contact coverage: ${rh.coverage_percentage}% (${rh.unique_contacts_engaged}/${rh.total_contacts_known})`);
  if (rh.days_since_last_interaction != null) {
    lines.push(`Days since last interaction: ${rh.days_since_last_interaction}`);
  }

  if (dossier.contacts.length > 0) {
    sources.push('contacts');
    const active = dossier.contacts.filter(c => c.engagement_level === 'active').length;
    const fading = dossier.contacts.filter(c => c.engagement_level === 'fading').length;
    const dark = dossier.contacts.filter(c => c.engagement_level === 'dark').length;
    lines.push(`\nCONTACTS (${dossier.contacts.length}: ${active} active, ${fading} fading, ${dark} dark):`);
    for (const c of dossier.contacts.slice(0, 10)) {
      const parts = [c.name];
      if (c.title) parts.push(c.title);
      parts.push(c.engagement_level);
      if (c.buying_role && c.buying_role !== 'unknown') parts.push(c.buying_role);
      if (c.conversation_count > 0) parts.push(`${c.conversation_count} conversations`);
      lines.push(`- ${parts.join(', ')}`);
    }
  }

  if (dossier.conversations.length > 0) {
    sources.push('conversations');
    lines.push(`\nCONVERSATIONS (${dossier.conversations.length} recent):`);
    for (const cv of dossier.conversations.slice(0, 5)) {
      const dur = cv.duration_minutes ? ` (${cv.duration_minutes}min)` : '';
      const deal = cv.linked_deal_name ? ` — deal: ${cv.linked_deal_name}` : '';
      lines.push(`- ${fmtDate(cv.date)}: "${cv.title}"${dur}${deal}`);
    }
  }

  if (dossier.findings.length > 0) {
    sources.push('findings');
    lines.push(`\nFINDINGS (${dossier.findings.length} active):`);
    for (const f of dossier.findings.slice(0, 10)) {
      const deal = f.deal_name ? ` (${f.deal_name})` : '';
      lines.push(`- ${f.severity.toUpperCase()}: ${f.message}${deal}`);
    }
  }

  if (rh.coverage_gaps.length > 0) {
    lines.push(`\nCOVERAGE GAPS: ${rh.coverage_gaps.join('; ')}`);
  }

  if (dossier.annotations.length > 0) {
    lines.push(`\nTEAM NOTES (${dossier.annotations.length}):`);
    for (const an of dossier.annotations.slice(0, 5)) {
      lines.push(`- [${an.annotation_type}] ${an.content} (${an.source}, ${fmtDate(an.created_at)})`);
    }
  }

  return { text: lines.join('\n'), sources };
}

function compressPipelineContext(
  snapshot: PipelineSnapshot,
  findings: Array<{ severity: string; category: string; message: string; deal_name?: string; owner?: string }>,
  topDeals: Array<{ name: string; amount: number; stage: string; owner: string; days_in_stage: number }>
): { text: string; sources: string[] } {
  const lines: string[] = [];
  const sources = ['pipeline_snapshot', 'findings', 'deals'];

  lines.push(`PIPELINE OVERVIEW:`);
  lines.push(`Total: ${snapshot.dealCount} deals, ${fmtAmount(snapshot.totalPipeline)} pipeline, avg deal: ${fmtAmount(snapshot.avgDealSize)}`);
  lines.push(`Closing this month: ${snapshot.closingThisMonth.dealCount} deals (${fmtAmount(snapshot.closingThisMonth.totalAmount)})`);
  lines.push(`Stale (>${snapshot.staleDeals.staleDaysThreshold}d): ${snapshot.staleDeals.dealCount} deals (${fmtAmount(snapshot.staleDeals.totalAmount)})`);
  lines.push(`New this week: ${snapshot.newDealsThisWeek.dealCount} deals (${fmtAmount(snapshot.newDealsThisWeek.totalAmount)})`);
  if (snapshot.winRate.rate != null) {
    lines.push(`Win rate: ${Math.round(snapshot.winRate.rate * 100)}% (${snapshot.winRate.won}W / ${snapshot.winRate.lost}L)`);
  }
  if (snapshot.coverageRatio != null) {
    lines.push(`Coverage ratio: ${snapshot.coverageRatio.toFixed(1)}x`);
  }

  if (snapshot.byStage.length > 0) {
    lines.push(`\nBY STAGE:`);
    for (const s of snapshot.byStage) {
      lines.push(`- ${s.stage}: ${s.deal_count} deals, ${fmtAmount(s.total_amount)}`);
    }
  }

  if (topDeals.length > 0) {
    lines.push(`\nTOP DEALS:`);
    for (const d of topDeals.slice(0, 15)) {
      lines.push(`- ${d.name}: ${fmtAmount(d.amount)} — ${d.stage} (${d.days_in_stage}d) — ${d.owner}`);
    }
  }

  if (findings.length > 0) {
    lines.push(`\nACTIVE FINDINGS (${findings.length}):`);
    for (const f of findings.slice(0, 20)) {
      const deal = f.deal_name ? ` (${f.deal_name})` : '';
      const owner = f.owner ? ` [${f.owner}]` : '';
      lines.push(`- ${f.severity.toUpperCase()}: ${f.message}${deal}${owner}`);
    }
  }

  return { text: lines.join('\n'), sources };
}

function compressRepContext(
  deals: Array<{ name: string; amount: number; stage: string; stage_normalized: string; days_in_stage: number; close_date: string | null }>,
  findings: Array<{ severity: string; message: string; deal_name?: string; category: string }>,
  repEmail: string
): { text: string; sources: string[] } {
  const lines: string[] = [];
  const sources = ['deals', 'findings', 'contacts'];

  lines.push(`REP: ${repEmail}`);

  const openDeals = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized));
  const wonDeals = deals.filter(d => d.stage_normalized === 'closed_won');
  const totalPipeline = openDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const wonRevenue = wonDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  lines.push(`\nPIPELINE: ${openDeals.length} open deals (${fmtAmount(totalPipeline)}), ${wonDeals.length} won (${fmtAmount(wonRevenue)})`);

  if (openDeals.length > 0) {
    lines.push(`\nOPEN DEALS (${openDeals.length}):`);
    for (const d of openDeals.slice(0, 15)) {
      lines.push(`- ${d.name}: ${fmtAmount(d.amount)} — ${d.stage} (${d.days_in_stage}d)${d.close_date ? `, close: ${fmtDate(d.close_date)}` : ''}`);
    }
  }

  if (findings.length > 0) {
    lines.push(`\nFINDINGS (${findings.length}):`);
    for (const f of findings.slice(0, 15)) {
      const deal = f.deal_name ? ` (${f.deal_name})` : '';
      lines.push(`- ${f.severity.toUpperCase()}: ${f.message}${deal}`);
    }
  }

  return { text: lines.join('\n'), sources };
}

const SYSTEM_PROMPT = `You are a revenue operations analyst. Answer the user's question using ONLY the data provided below. Be specific — cite deal names, contact names, dollar amounts, and dates. If the data doesn't contain enough information to answer confidently, say so and explain what additional data would help.

Keep your answer to 2-4 sentences unless the question requires more detail. No bullet points unless listing specific items. No hyperbole.

After your answer, on a new line starting with "CONFIDENCE:", rate your confidence as HIGH (data directly answers the question), MEDIUM (data partially answers, some inference needed), or LOW (limited data, significant inference).

On another new line starting with "FOLLOWUPS:", suggest 2-3 natural follow-up questions the user might ask next, separated by pipes (|).`;

function parseAnalysisResponse(raw: string): { answer: string; confidence: 'high' | 'medium' | 'low'; followups: string[] } {
  let answer = raw;
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let followups: string[] = [];

  const confMatch = raw.match(/\n\s*CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
  if (confMatch) {
    confidence = confMatch[1].toLowerCase() as 'high' | 'medium' | 'low';
    answer = raw.substring(0, confMatch.index!).trim();
  }

  const followupMatch = raw.match(/\n\s*FOLLOWUPS?:\s*(.+)/i);
  if (followupMatch) {
    followups = followupMatch[1].split('|').map(q => q.trim()).filter(q => q.length > 0);
    if (!confMatch) {
      answer = raw.substring(0, followupMatch.index!).trim();
    }
  }

  return { answer, confidence, followups };
}

async function gatherContext(request: AnalysisRequest): Promise<{
  contextText: string;
  dataSources: string[];
  dataConsulted: AnalysisResponse['data_consulted'];
}> {
  const { workspace_id, scope } = request;

  switch (scope.type) {
    case 'deal': {
      if (!scope.entity_id) throw new Error('entity_id is required for deal scope');
      const dossier = await assembleDealDossier(workspace_id, scope.entity_id);
      const { text, sources } = compressDealContext(dossier);
      return {
        contextText: text,
        dataSources: sources,
        dataConsulted: {
          deals: 1,
          contacts: dossier.contacts.length,
          conversations: dossier.conversations.length,
          findings: dossier.findings.length,
          date_range: scope.date_range || null,
        },
      };
    }

    case 'account': {
      if (!scope.entity_id) throw new Error('entity_id is required for account scope');
      const dossier = await assembleAccountDossier(workspace_id, scope.entity_id);
      const { text, sources } = compressAccountContext(dossier);
      return {
        contextText: text,
        dataSources: sources,
        dataConsulted: {
          deals: dossier.deals.length,
          contacts: dossier.contacts.length,
          conversations: dossier.conversations.length,
          findings: dossier.findings.length,
          date_range: scope.date_range || null,
        },
      };
    }

    case 'pipeline':
    case 'workspace': {
      const [snapshot, findingsResult, topDealsResult] = await Promise.all([
        generatePipelineSnapshot(workspace_id),
        query<{ severity: string; category: string; message: string; deal_name: string; owner: string }>(
          `SELECT f.severity, f.category, f.message,
                  d.name as deal_name, f.owner_email as owner
           FROM findings f
           LEFT JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id
           WHERE f.workspace_id = $1 AND f.resolved_at IS NULL
           ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 ELSE 4 END, f.found_at DESC
           LIMIT 50`,
          [workspace_id]
        ),
        query<{ name: string; amount: number; stage: string; owner: string; days_in_stage: number }>(
          `SELECT d.name, d.amount, COALESCE(d.stage, d.stage_normalized) as stage, d.owner as owner,
                  EXTRACT(DAY FROM NOW() - d.created_at)::int as days_in_stage
           FROM deals d
           WHERE d.workspace_id = $1
             AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           ORDER BY d.amount DESC NULLS LAST
           LIMIT 20`,
          [workspace_id]
        ),
      ]);

      const { text, sources } = compressPipelineContext(snapshot, findingsResult.rows, topDealsResult.rows);
      return {
        contextText: text,
        dataSources: sources,
        dataConsulted: {
          deals: snapshot.dealCount,
          contacts: 0,
          conversations: 0,
          findings: findingsResult.rows.length,
          date_range: scope.date_range || null,
        },
      };
    }

    case 'rep': {
      if (!scope.rep_email) throw new Error('rep_email is required for rep scope');
      const [dealsResult, findingsResult] = await Promise.all([
        query<{ name: string; amount: number; stage: string; stage_normalized: string; days_in_stage: number; close_date: string }>(
          `SELECT d.name, d.amount, COALESCE(d.stage, d.stage_normalized) as stage, d.stage_normalized,
                  EXTRACT(DAY FROM NOW() - d.created_at)::int as days_in_stage,
                  d.close_date
           FROM deals d
           WHERE d.workspace_id = $1 AND d.owner = $2
           ORDER BY d.amount DESC NULLS LAST
           LIMIT 30`,
          [workspace_id, scope.rep_email]
        ),
        query<{ severity: string; message: string; deal_name: string; category: string }>(
          `SELECT f.severity, f.message, d.name as deal_name, f.category
           FROM findings f
           LEFT JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id
           WHERE f.workspace_id = $1 AND f.owner_email = $2 AND f.resolved_at IS NULL
           ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END, f.found_at DESC
           LIMIT 30`,
          [workspace_id, scope.rep_email]
        ),
      ]);

      const { text, sources } = compressRepContext(dealsResult.rows, findingsResult.rows, scope.rep_email);
      return {
        contextText: text,
        dataSources: sources,
        dataConsulted: {
          deals: dealsResult.rows.length,
          contacts: 0,
          conversations: 0,
          findings: findingsResult.rows.length,
          date_range: scope.date_range || null,
        },
      };
    }

    default:
      throw new Error(`Unknown scope type: ${scope.type}`);
  }
}

export async function analyzeQuestion(
  workspaceId: string,
  question: string,
  scope: {
    type: 'deal' | 'account' | 'pipeline' | 'rep' | 'workspace';
    entityId?: string;
    ownerEmail?: string;
  }
): Promise<AnalysisResult> {
  const startTime = Date.now();

  const request: AnalysisRequest = {
    workspace_id: workspaceId,
    question,
    scope: {
      type: scope.type,
      entity_id: scope.entityId,
      rep_email: scope.ownerEmail,
    },
  };

  const { contextText, dataSources } = await gatherContext(request);

  const voiceConfig = await configLoader.getVoiceConfig(workspaceId).catch(() => ({ promptBlock: '' }));

  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt: SYSTEM_PROMPT + (voiceConfig.promptBlock ? `\n\n${voiceConfig.promptBlock}` : ''),
    messages: [
      {
        role: 'user' as const,
        content: `CONTEXT:\n${contextText}\n\nQUESTION: ${question}`,
      },
    ],
    maxTokens: 800,
    temperature: 0.3,
    _tracking: {
      feature: 'scoped_analysis',
      subFeature: scope.type,
    },
  });

  const tokensUsed = (response.usage?.input || 0) + (response.usage?.output || 0);
  const parsed = parseAnalysisResponse(response.content);

  return {
    answer: parsed.answer,
    data_consulted: dataSources,
    confidence: parsed.confidence,
    suggested_followups: parsed.followups,
    tokens_used: tokensUsed,
    latency_ms: Date.now() - startTime,
  };
}

export async function runScopedAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const startTime = Date.now();
  const { workspace_id, question, scope, max_tokens } = request;
  const maxTokens = max_tokens || 2000;

  const { contextText, dataConsulted } = await gatherContext(request);

  const voiceConfig = await configLoader.getVoiceConfig(workspace_id).catch(() => ({ promptBlock: '' }));

  const response = await callLLM(workspace_id, 'reason', {
    systemPrompt: SYSTEM_PROMPT + (voiceConfig.promptBlock ? `\n\n${voiceConfig.promptBlock}` : ''),
    messages: [
      {
        role: 'user' as const,
        content: `CONTEXT:\n${contextText}\n\nQUESTION: ${question}`,
      },
    ],
    maxTokens,
    temperature: 0.3,
    _tracking: {
      feature: 'scoped_analysis',
      subFeature: scope.type,
    },
  });

  const tokensUsed = (response.usage?.input || 0) + (response.usage?.output || 0);
  const parsed = parseAnalysisResponse(response.content);

  return {
    answer: parsed.answer,
    data_consulted: dataConsulted,
    tokens_used: tokensUsed,
    latency_ms: Date.now() - startTime,
  };
}

export function getAnalysisSuggestions(scope: string): string[] {
  switch (scope) {
    case 'deal':
      return [
        "What's the biggest risk to closing this deal?",
        "Who on the buying committee haven't we engaged?",
        "How does this deal's velocity compare to won deals?",
        "What should the rep focus on this week?",
      ];
    case 'account':
      return [
        "How healthy is our relationship with this account?",
        "Which contacts are going dark?",
        "What's the total pipeline exposure here?",
        "Are there deals that should be consolidated or split?",
      ];
    case 'pipeline':
      return [
        "Where will I land this quarter?",
        "Which deals are most at risk of slipping?",
        "Where are the biggest coverage gaps across the team?",
        "What changed in the pipeline this week?",
      ];
    case 'rep':
      return [
        "How is this rep tracking against quota?",
        "Which of their deals need immediate attention?",
        "Are they single-threaded on any deals?",
        "What's their pipeline coverage ratio?",
      ];
    case 'workspace':
      return [
        "What's the overall health of our pipeline?",
        "Which reps have the most at-risk deals?",
        "Where are the biggest gaps in our coverage?",
        "What are the top findings across all deals?",
      ];
    default:
      return [
        "What should I focus on today?",
        "Where are the biggest risks?",
        "What changed recently?",
      ];
  }
}
