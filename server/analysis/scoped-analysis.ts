import { query } from '../db.js';
import { callLLM, assistantMessageFromResponse, toolResultMessage } from '../utils/llm-router.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { assembleDealDossier, type DealDossier } from '../dossiers/deal-dossier.js';
import { assembleAccountDossier, type AccountDossier } from '../dossiers/account-dossier.js';
import { generatePipelineSnapshot, type PipelineSnapshot } from './pipeline-snapshot.js';
import { searchTranscripts } from '../conversations/transcript-search.js';

export interface AnalysisRequest {
  workspace_id: string;
  question: string;
  scope: {
    type: 'deal' | 'account' | 'pipeline' | 'rep' | 'workspace' | 'conversations' | 'stage';
    entity_id?: string;
    rep_email?: string;
    stage?: string;
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

// ── Conversation Context ──────────────────────────────────────────────────────

function countBy(arr: any[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of arr) {
    const val = item[key];
    if (val != null) out[val] = (out[val] || 0) + 1;
  }
  return out;
}

interface ConversationContextFilters {
  since?: string;
  until?: string;
  account_id?: string;
  deal_id?: string;
  rep_name?: string;
  limit?: number;
}

async function buildConversationContext(
  workspaceId: string,
  filters?: ConversationContextFilters
): Promise<{ text: string; count: number; hasData: boolean }> {
  const limit = Math.min(filters?.limit ?? 50, 100);
  const params: any[] = [workspaceId];
  const clauses: string[] = [
    `c.workspace_id = $1`,
    `c.is_internal = FALSE`,
    `c.source IS DISTINCT FROM 'consultant'`,
  ];

  if (filters?.since) {
    params.push(filters.since);
    clauses.push(`c.call_date >= $${params.length}`);
  }
  if (filters?.until) {
    params.push(filters.until);
    clauses.push(`c.call_date <= $${params.length}`);
  }
  if (filters?.account_id) {
    params.push(filters.account_id);
    clauses.push(`c.account_id = $${params.length}`);
  }
  if (filters?.deal_id) {
    params.push(filters.deal_id);
    clauses.push(`c.deal_id = $${params.length}`);
  }
  if (filters?.rep_name) {
    params.push(`%${filters.rep_name}%`);
    clauses.push(`(d.owner ILIKE $${params.length} OR c.participants::text ILIKE $${params.length})`);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;

  const recentCalls = await query<{
    title: string | null;
    call_date: string | null;
    duration_seconds: number | null;
    summary: string | null;
    call_disposition: string | null;
    engagement_quality: string | null;
    pricing_discussed: boolean | null;
    pricing_signals: any;
    products_mentioned: any;
    next_steps: any;
    budget_signals: any;
    decision_makers_mentioned: any;
    timeline_signals: any;
    competitive_context: any;
    risk_signals: any;
    topics: any;
    objections: any;
    sentiment_score: number | null;
    participants: any;
    deal_name: string | null;
    account_name: string | null;
  }>(
    `SELECT c.title, c.call_date, c.duration_seconds, c.summary,
            c.call_disposition, c.engagement_quality,
            c.pricing_discussed, c.pricing_signals,
            c.products_mentioned, c.next_steps,
            c.budget_signals, c.decision_makers_mentioned,
            c.timeline_signals, c.competitive_context,
            c.risk_signals, c.topics, c.objections,
            c.sentiment_score, c.participants,
            d.name as deal_name, a.name as account_name
     FROM conversations c
     LEFT JOIN deals d ON c.deal_id = d.id
     LEFT JOIN accounts a ON c.account_id = a.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY c.call_date DESC NULLS LAST
     LIMIT ${limitParam}`,
    params
  );

  if (recentCalls.rows.length === 0) return { text: '', count: 0, hasData: false };

  const rows = recentCalls.rows;

  const stats = {
    total_calls: rows.length,
    calls_with_pricing: rows.filter(r => r.pricing_discussed).length,
    calls_with_competitors: rows.filter(r => (r.competitive_context as any)?.evaluating_others).length,
    calls_with_risk: rows.filter(r => Array.isArray(r.risk_signals) && r.risk_signals.length > 0).length,
    disposition_breakdown: countBy(rows, 'call_disposition'),
    engagement_breakdown: countBy(rows, 'engagement_quality'),
  };

  const allPricingSignals = rows.flatMap(r => Array.isArray(r.pricing_signals) ? r.pricing_signals : []);
  const allObjections = rows.flatMap(r => Array.isArray(r.objections) ? r.objections : []);
  const allProducts = rows.flatMap(r => Array.isArray(r.products_mentioned) ? r.products_mentioned : []);
  const allCompetitors = rows.flatMap(r => (r.competitive_context as any)?.competitors_named || []);
  const allRisks = rows.flatMap(r => Array.isArray(r.risk_signals) ? r.risk_signals : []);
  const allDecisionMakers = rows.flatMap(r => Array.isArray(r.decision_makers_mentioned) ? r.decision_makers_mentioned : []);

  let ctx = `\n## Conversation Intelligence (${stats.total_calls} recent calls)\n\n`;

  ctx += `### Call Stats\n`;
  ctx += `Total external calls: ${stats.total_calls}\n`;
  if (stats.calls_with_pricing > 0) ctx += `Calls discussing pricing: ${stats.calls_with_pricing}\n`;
  if (stats.calls_with_competitors > 0) ctx += `Calls mentioning competitors: ${stats.calls_with_competitors}\n`;
  if (stats.calls_with_risk > 0) ctx += `Calls with risk signals: ${stats.calls_with_risk}\n`;
  if (Object.keys(stats.disposition_breakdown).length > 0) ctx += `Call types: ${JSON.stringify(stats.disposition_breakdown)}\n`;
  if (Object.keys(stats.engagement_breakdown).length > 0) ctx += `Engagement quality: ${JSON.stringify(stats.engagement_breakdown)}\n`;
  ctx += '\n';

  if (allPricingSignals.length > 0) {
    ctx += `### Pricing Signals\n`;
    for (const sig of allPricingSignals.slice(0, 10)) {
      ctx += `- [${sig.type}] ${sig.summary} (${sig.speaker_role})\n`;
    }
    ctx += '\n';
  }

  if (allObjections.length > 0) {
    ctx += `### Objections Raised\n`;
    for (const obj of allObjections.slice(0, 10)) {
      ctx += `- ${typeof obj === 'string' ? obj : (obj as any).summary || JSON.stringify(obj)}\n`;
    }
    ctx += '\n';
  }

  if (allProducts.length > 0) {
    ctx += `### Products/Features Mentioned\n`;
    for (const prod of allProducts.slice(0, 10)) {
      ctx += `- ${prod.product}${prod.feature ? ` (${prod.feature})` : ''}: ${prod.context}\n`;
    }
    ctx += '\n';
  }

  if (allCompetitors.length > 0) {
    const unique = [...new Set<string>(allCompetitors)];
    ctx += `### Competitors Mentioned: ${unique.join(', ')}\n\n`;
  }

  if (allRisks.length > 0) {
    ctx += `### Risk Signals\n`;
    for (const risk of allRisks.slice(0, 10)) {
      ctx += `- [${risk.severity}] ${risk.type}: ${risk.summary}\n`;
    }
    ctx += '\n';
  }

  if (allDecisionMakers.length > 0) {
    ctx += `### Decision Makers Referenced\n`;
    for (const dm of allDecisionMakers.slice(0, 10)) {
      ctx += `- ${dm.title}${dm.name ? ` (${dm.name})` : ''}: ${dm.context} [${dm.involvement}]\n`;
    }
    ctx += '\n';
  }

  ctx += `### Recent Call Details\n`;
  for (const call of rows.slice(0, 15)) {
    const date = call.call_date
      ? new Date(call.call_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'unknown date';
    const duration = call.duration_seconds ? `${Math.round(call.duration_seconds / 60)}min` : '';
    const linked = [
      call.deal_name ? `Deal: ${call.deal_name}` : null,
      call.account_name ? `Account: ${call.account_name}` : null,
    ].filter(Boolean).join(', ');

    ctx += `\n**"${call.title || 'Untitled'}"** (${date}${duration ? `, ${duration}` : ''})`;
    if (linked) ctx += ` — ${linked}`;
    ctx += '\n';

    if (call.call_disposition) ctx += `  Type: ${call.call_disposition}\n`;
    if (call.engagement_quality) ctx += `  Engagement: ${call.engagement_quality}\n`;
    if (call.summary) ctx += `  Summary: ${call.summary.substring(0, 300)}\n`;

    const ns = Array.isArray(call.next_steps) ? call.next_steps : [];
    if (ns.length > 0) {
      ctx += `  Next steps: ${ns.map((n: any) => n.action).join('; ')}\n`;
    }

    const tl = (call.timeline_signals as any) || {};
    if (tl.urgency && tl.urgency !== 'none') {
      ctx += `  Timeline: ${tl.urgency} urgency${tl.context ? ` — ${tl.context}` : ''}\n`;
    }
  }

  return { text: ctx, count: rows.length, hasData: true };
}

// ── Pipeline Context ──────────────────────────────────────────────────────────

function compressPipelineContext(
  snapshot: PipelineSnapshot,
  findings: Array<{ severity: string; category: string; message: string; deal_name?: string; owner?: string }>,
  topDeals: Array<{ name: string; amount: number; stage: string; owner: string; days_in_stage: number; created_at: string | null; close_date: string | null }>,
  monthlyCreation?: Array<{ month: string; deal_count: string; total_amount: string }>
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

  if (monthlyCreation && monthlyCreation.length > 0) {
    lines.push(`\nPIPELINE CREATION BY MONTH (last 12 months):`);
    for (const m of monthlyCreation) {
      const mo = m.month ? m.month.slice(0, 7) : 'unknown';
      lines.push(`- ${mo}: ${m.deal_count} deals created, ${fmtAmount(Number(m.total_amount))}`);
    }
    const totalDeals = monthlyCreation.reduce((s, m) => s + parseInt(m.deal_count, 10), 0);
    const totalAmt = monthlyCreation.reduce((s, m) => s + Number(m.total_amount), 0);
    const months = monthlyCreation.length || 1;
    lines.push(`Average: ${Math.round(totalDeals / months)} deals/month, ${fmtAmount(totalAmt / months)}/month`);
  }

  if (topDeals.length > 0) {
    lines.push(`\nTOP OPEN DEALS:`);
    for (const d of topDeals.slice(0, 15)) {
      const created = d.created_at ? `, created: ${fmtDate(d.created_at)}` : '';
      const close = d.close_date ? `, close: ${fmtDate(d.close_date)}` : '';
      lines.push(`- ${d.name}: ${fmtAmount(d.amount)} — ${d.stage} (${d.days_in_stage}d) — ${d.owner}${created}${close}`);
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
  deals: Array<{ name: string; amount: number; stage: string; stage_normalized: string; days_in_stage: number; close_date: string | null; created_at: string | null }>,
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
      lines.push(`- ${d.name}: ${fmtAmount(d.amount)} — ${d.stage} (${d.days_in_stage}d)${d.created_at ? `, created: ${fmtDate(d.created_at)}` : ''}${d.close_date ? `, close: ${fmtDate(d.close_date)}` : ''}`);
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

const CONVERSATIONS_SYSTEM_PROMPT = `You are analyzing sales call data for a revenue team. Answer using ONLY the conversation data provided below. Be specific — cite call titles, account names, rep names, and dates when relevant. Quantify patterns whenever possible (e.g., "mentioned in 7 of 23 calls", "3 of the last 5 discovery calls").

Keep answers to 3-5 sentences unless listing specific items. Cite evidence from the calls. Do not invent patterns that aren't clearly supported by the data.

After your answer, on a new line starting with "CONFIDENCE:", rate your confidence as HIGH (patterns clearly visible in data), MEDIUM (limited data, patterns are suggestive), or LOW (insufficient call data to answer reliably).

On another new line starting with "FOLLOWUPS:", suggest 2-3 natural follow-up questions, separated by pipes (|).`;

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

function classifyConversationSubIntent(question: string): string {
  const q = question.toLowerCase();
  if (/compet|rival|vs\.|versus|alternative/.test(q)) return 'competitive';
  if (/objection|pushback|concern|resistance|obstacle/.test(q)) return 'themes';
  if (/coaching|call\s+quality|talk[\s-]ratio|monologue|discovery\s+question/.test(q)) return 'quality';
  if (/summarize|summary\s+of|recap|last\s+week|this\s+week|this\s+month/.test(q)) return 'time_summary';
  if (/pricing|budget|cost|discount|roi/.test(q)) return 'topic_search';
  if (/\bwith\s+\S+\s+(calls?|meetings?)\b/.test(q)) return 'account_scoped';
  return 'general';
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
      const [snapshot, findingsResult, topDealsResult, monthlyCreationResult, conversationCtx] = await Promise.all([
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
        query<{ name: string; amount: number; stage: string; owner: string; days_in_stage: number; created_at: string | null; close_date: string | null }>(
          `SELECT d.name, d.amount, COALESCE(d.stage, d.stage_normalized) as stage, d.owner as owner,
                  EXTRACT(DAY FROM NOW() - d.created_at)::int as days_in_stage,
                  d.created_at, d.close_date
           FROM deals d
           WHERE d.workspace_id = $1
             AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           ORDER BY d.amount DESC NULLS LAST
           LIMIT 20`,
          [workspace_id]
        ),
        query<{ month: string; deal_count: string; total_amount: string }>(
          `SELECT TO_CHAR(DATE_TRUNC('month', d.created_at), 'YYYY-MM') as month,
                  COUNT(*)::text as deal_count,
                  COALESCE(SUM(d.amount), 0)::text as total_amount
           FROM deals d
           WHERE d.workspace_id = $1
             AND d.created_at >= NOW() - INTERVAL '12 months'
           GROUP BY DATE_TRUNC('month', d.created_at)
           ORDER BY DATE_TRUNC('month', d.created_at) DESC`,
          [workspace_id]
        ),
        buildConversationContext(workspace_id).catch(() => ({ text: '', count: 0, hasData: false })),
      ]);

      const { text, sources } = compressPipelineContext(snapshot, findingsResult.rows, topDealsResult.rows, monthlyCreationResult.rows);
      const fullText = text + conversationCtx.text;
      if (conversationCtx.hasData) sources.push('conversations');

      return {
        contextText: fullText,
        dataSources: sources,
        dataConsulted: {
          deals: snapshot.dealCount,
          contacts: 0,
          conversations: conversationCtx.count,
          findings: findingsResult.rows.length,
          date_range: scope.date_range || null,
        },
      };
    }

    case 'rep': {
      if (!scope.rep_email) throw new Error('rep_email is required for rep scope');
      const [dealsResult, findingsResult] = await Promise.all([
        query<{ name: string; amount: number; stage: string; stage_normalized: string; days_in_stage: number; close_date: string | null; created_at: string | null }>(
          `SELECT d.name, d.amount, COALESCE(d.stage, d.stage_normalized) as stage, d.stage_normalized,
                  EXTRACT(DAY FROM NOW() - d.created_at)::int as days_in_stage,
                  d.close_date, d.created_at
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

    case 'conversations': {
      const subIntent = scope.filters?.sub_intent || classifyConversationSubIntent(request.question);

      // Graceful degradation: check connector status
      const connCheck = await query<{ cnt: string }>(
        `SELECT COUNT(*)::text as cnt FROM conversations
         WHERE workspace_id = $1 AND is_internal = false
           AND source_type IS DISTINCT FROM 'consultant'`,
        [workspace_id]
      );
      const totalConvos = parseInt(connCheck.rows[0]?.cnt || '0');

      if (totalConvos === 0) {
        return {
          contextText: 'NO_CONVERSATIONS',
          dataSources: [],
          dataConsulted: { deals: 0, contacts: 0, conversations: 0, findings: 0, date_range: null },
        };
      }

      const { text, count } = await buildConversationContext(workspace_id, {
        since: scope.date_range?.from,
        until: scope.date_range?.to,
        account_id: scope.entity_id,
        rep_name: scope.rep_email,
        limit: 50,
      });

      if (!text) {
        return {
          contextText: 'NO_CONVERSATIONS',
          dataSources: [],
          dataConsulted: { deals: 0, contacts: 0, conversations: 0, findings: 0, date_range: null },
        };
      }

      const headerNote = `Sub-intent: ${subIntent}\n`;
      return {
        contextText: headerNote + text,
        dataSources: ['conversations'],
        dataConsulted: {
          deals: 0,
          contacts: 0,
          conversations: count,
          findings: 0,
          date_range: scope.date_range || null,
        },
      };
    }

    case 'stage': {
      const stageName = scope.stage || scope.entity_id;
      if (!stageName) {
        return {
          contextText: 'NO_CONTEXT',
          dataSources: ['deals'],
          dataConsulted: { deals: 0, contacts: 0, conversations: 0, findings: 0, date_range: null },
        };
      }

      const dealsResult = await query<any>(
        `SELECT d.id, d.name, d.amount, d.probability, d.close_date,
           d.owner, d.owner as owner_name, d.stage, d.stage_normalized,
           COALESCE(d.forecast_category, 'pipeline') as forecast_category,
           COALESCE(d.days_in_stage, 0) as days_in_stage
         FROM deals d
         WHERE d.workspace_id = $1
           AND (d.stage = $2 OR d.stage_normalized = $2)
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ORDER BY d.amount DESC NULLS LAST
         LIMIT 30`,
        [workspace_id, stageName]
      );

      const dealIds = dealsResult.rows.map((d: any) => d.id);
      let findingsText = '';
      if (dealIds.length > 0) {
        const findingsResult = await query<any>(
          `SELECT f.deal_id, f.category, f.message, f.severity
           FROM findings f
           WHERE f.workspace_id = $1 AND f.deal_id = ANY($2) AND f.resolved_at IS NULL
           ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END`,
          [workspace_id, dealIds]
        );
        const byDeal: Record<string, string[]> = {};
        for (const row of findingsResult.rows) {
          if (!byDeal[row.deal_id]) byDeal[row.deal_id] = [];
          byDeal[row.deal_id].push(`[${row.severity}] ${row.category}: ${row.message}`);
        }
        findingsText = Object.entries(byDeal).map(([id, msgs]) => `Deal ${id}: ${msgs.join('; ')}`).join('\n');
      }

      const stageContext = `STAGE: ${stageName}
DEALS (${dealsResult.rows.length} total):
${dealsResult.rows.map((d: any) =>
  `- ${d.name}: $${d.amount || 0} | ${Math.round(d.days_in_stage || 0)} days in stage | ${Math.round((d.probability || 0) * 100)}% prob | close: ${d.close_date || 'unknown'} | forecast: ${d.forecast_category} | owner: ${d.owner_name || d.owner}`
).join('\n')}

${findingsText ? `FINDINGS:\n${findingsText}` : 'No active findings for this stage.'}`;

      return {
        contextText: stageContext,
        dataSources: ['deals', 'findings'],
        dataConsulted: {
          deals: dealsResult.rows.length,
          contacts: 0,
          conversations: 0,
          findings: findingsText.split('\n').filter(Boolean).length,
          date_range: null,
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
    type: 'deal' | 'account' | 'pipeline' | 'rep' | 'workspace' | 'conversations' | 'stage';
    entityId?: string;
    ownerEmail?: string;
    stage?: string;
    date_range?: { from: string; to: string };
    filters?: Record<string, any>;
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
      stage: scope.stage,
      date_range: scope.date_range,
      filters: scope.filters,
    },
  };

  const { contextText, dataSources } = await gatherContext(request);

  // Graceful degradation for conversations scope
  if (contextText === 'NO_CONVERSATIONS') {
    return {
      answer: "No conversation data found. Connect Gong or Fireflies in Settings → Connectors to enable call analysis.",
      data_consulted: dataSources,
      confidence: 'low',
      suggested_followups: [],
      tokens_used: 0,
      latency_ms: Date.now() - startTime,
    };
  }

  const voiceConfig = await configLoader.getVoiceConfig(workspaceId).catch(() => ({ promptBlock: '' }));

  const basePrompt = scope.type === 'conversations' ? CONVERSATIONS_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt: basePrompt + (voiceConfig.promptBlock ? `\n\n${voiceConfig.promptBlock}` : ''),
    messages: [
      {
        role: 'user' as const,
        content: `CONTEXT:\n${contextText}\n\nQUESTION: ${question}`,
      },
    ],
    maxTokens: scope.type === 'conversations' ? 1500 : 800,
    temperature: 0.3,
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

// Tool definition for transcript search — available to all scopes
const TRANSCRIPT_SEARCH_TOOL = {
  name: 'search_call_transcripts',
  description: 'Search through call transcript text for specific topics, quotes, or discussions. Use when the user asks about what was specifically said in calls, or needs exact quotes or detailed context from conversations.',
  parameters: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search term or topic to find in transcripts' },
      account_name: { type: 'string', description: 'Optional: filter to calls with this account' },
      deal_name: { type: 'string', description: 'Optional: filter to calls about this deal' },
    },
    required: ['query'],
  },
};

export async function runScopedAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const startTime = Date.now();
  const { workspace_id, question, scope, max_tokens } = request;
  const maxTokens = max_tokens || 2000;

  const { contextText, dataConsulted } = await gatherContext(request);

  // Graceful degradation for conversations scope
  if (contextText === 'NO_CONVERSATIONS') {
    return {
      answer: "No conversation data found. Connect Gong or Fireflies in Settings → Connectors to enable call analysis.",
      data_consulted: dataConsulted,
      tokens_used: 0,
      latency_ms: Date.now() - startTime,
    };
  }

  const voiceConfig = await configLoader.getVoiceConfig(workspace_id).catch(() => ({ promptBlock: '' }));

  const basePrompt = scope.type === 'conversations' ? CONVERSATIONS_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const systemPrompt = basePrompt + (voiceConfig.promptBlock ? `\n\n${voiceConfig.promptBlock}` : '');

  const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: any; toolCallId?: string }> = [
    {
      role: 'user',
      content: `CONTEXT:\n${contextText}\n\nQUESTION: ${question}`,
    },
  ];

  let totalTokens = 0;
  let finalContent = '';

  // Multi-turn loop to support tool use (max 2 tool calls)
  for (let turn = 0; turn < 3; turn++) {
    const response = await callLLM(workspace_id, 'reason', {
      systemPrompt,
      messages,
      maxTokens,
      temperature: 0.3,
      tools: [TRANSCRIPT_SEARCH_TOOL],
    });

    totalTokens += (response.usage?.input || 0) + (response.usage?.output || 0);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      // No tool calls — final answer
      finalContent = response.content;
      break;
    }

    // Handle tool calls
    messages.push(assistantMessageFromResponse(response));

    for (const tc of response.toolCalls) {
      let toolResult: string;
      try {
        const input = tc.input as { query: string; account_name?: string; deal_name?: string };
        const results = await searchTranscripts(workspace_id, input.query, {
          account_name: input.account_name,
          deal_name: input.deal_name,
          limit: 5,
        });

        if (results.length === 0) {
          toolResult = 'No transcripts found matching that search.';
        } else {
          toolResult = results.map(r => {
            const date = r.call_date
              ? new Date(r.call_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'unknown date';
            const linked = [
              r.deal_name ? `Deal: ${r.deal_name}` : null,
              r.account_name ? `Account: ${r.account_name}` : null,
            ].filter(Boolean).join(', ');
            return [
              `**"${r.title || 'Untitled'}"** (${date})${linked ? ` — ${linked}` : ''}`,
              r.excerpt,
            ].join('\n');
          }).join('\n\n---\n\n');
        }
      } catch (err) {
        toolResult = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      messages.push(toolResultMessage(tc.id, toolResult));
    }
  }

  const parsed = parseAnalysisResponse(finalContent || '');

  return {
    answer: parsed.answer,
    data_consulted: dataConsulted,
    tokens_used: totalTokens,
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
    case 'conversations':
      return [
        "What are the most common objections we're hearing?",
        "Which competitors keep coming up on calls?",
        "How are our discovery calls going?",
        "What did prospects say about pricing this month?",
      ];
    default:
      return [
        "What should I focus on today?",
        "Where are the biggest risks?",
        "What changed recently?",
      ];
  }
}
