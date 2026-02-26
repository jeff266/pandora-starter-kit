import { callLLM } from '../utils/llm-router.js';
import type { DealDossier } from './deal-dossier.js';
import type { AccountDossier } from './account-dossier.js';

function buildDealContext(dossier: DealDossier): string {
  const d = dossier.deal;
  const lines: string[] = [];

  lines.push(`Deal: ${d.name}`);
  lines.push(`Amount: $${(d.amount || 0).toLocaleString()} | Stage: ${d.stage_normalized || d.stage} | Days in stage: ${d.days_in_stage ?? '?'}`);
  lines.push(`Owner: ${d.owner_name || d.owner_email || 'unknown'} | Close date: ${d.close_date || 'not set'}`);
  if (d.account_name) lines.push(`Account: ${d.account_name}`);

  const hs = dossier.health_signals;
  lines.push(`\nHealth: activity=${hs.activity_recency}, threading=${hs.threading}, velocity=${hs.stage_velocity}, completeness=${hs.data_completeness}%`);

  if (dossier.risk_score) {
    lines.push(`Risk: grade=${dossier.risk_score.grade}, score=${dossier.risk_score.score}`);
  }

  if (dossier.findings.length > 0) {
    lines.push(`\nFindings (${dossier.findings.length}):`);
    for (const f of dossier.findings.slice(0, 5)) {
      lines.push(`  [${f.severity}] ${f.message}`);
    }
  }

  if (dossier.contacts.length > 0) {
    const active = dossier.contacts.filter(c => c.engagement_level === 'active').length;
    const fading = dossier.contacts.filter(c => c.engagement_level === 'fading').length;
    const dark = dossier.contacts.filter(c => c.engagement_level === 'dark').length;
    lines.push(`\nContacts: ${dossier.contacts.length} total (${active} active, ${fading} fading, ${dark} dark)`);
    for (const c of dossier.contacts.slice(0, 5)) {
      lines.push(`  ${c.name} (${c.title || 'no title'}) — ${c.engagement_level}${c.buying_role ? `, role: ${c.buying_role}` : ''}`);
    }
  }

  const cg = dossier.coverage_gaps;
  if (cg.contacts_never_called.length > 0 || cg.days_since_last_call != null) {
    lines.push(`\nCoverage: ${cg.contacts_never_called.length} contacts never called, ${cg.days_since_last_call ?? '?'} days since last call`);
  }

  if (dossier.stage_history.length > 0) {
    lines.push(`\nStage history: ${dossier.stage_history.length} transitions`);
    for (const sh of dossier.stage_history) {
      const label = sh.stage_label || sh.stage_normalized || sh.stage || 'Unknown';
      const entered = sh.entered_at?.split('T')[0] || '?';
      const days = sh.days_in_stage != null ? ` (${sh.days_in_stage}d)` : '';
      lines.push(`  ${label}${days} — entered ${entered}`);
    }
  }

  if (dossier.conversations.length > 0) {
    lines.push(`\nConversations: ${dossier.conversations.length} linked`);
    const recentConvos = dossier.conversations.slice(0, 3);
    let summaryBudget = 1200;
    for (const conv of recentConvos) {
      const dateStr = conv.date?.split('T')[0] || '?';
      lines.push(`  "${conv.title || 'Untitled'}" on ${dateStr}`);
      if (typeof conv.summary === 'string' && conv.summary.trim() && summaryBudget > 0) {
        const cleaned = conv.summary
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned) {
          const trimmed = cleaned.slice(0, Math.min(600, summaryBudget));
          lines.push(`    Summary: ${trimmed}`);
          summaryBudget -= trimmed.length;
        }
      }
    }
  }

  return lines.join('\n');
}

function buildAccountContext(dossier: AccountDossier): string {
  const a = dossier.account;
  const lines: string[] = [];

  lines.push(`Account: ${a.name}`);
  if (a.domain) lines.push(`Domain: ${a.domain}`);
  if (a.industry) lines.push(`Industry: ${a.industry}`);
  if (a.owner_email) lines.push(`Owner: ${a.owner_email}`);

  const ds = dossier.deal_summary;
  lines.push(`\nDeals: ${ds.open_count} open ($${ds.open_pipeline.toLocaleString()} pipeline), ${ds.won_count} won ($${ds.won_revenue.toLocaleString()}), ${ds.lost_count} lost`);

  if (dossier.deals.length > 0) {
    for (const d of dossier.deals.slice(0, 5)) {
      lines.push(`  ${d.name}: $${(d.amount || 0).toLocaleString()} — ${d.stage} (${d.health_status})`);
    }
  }

  const rh = dossier.relationship_health;
  lines.push(`\nRelationship: overall=${rh.overall}, trend=${rh.engagement_trend}`);
  lines.push(`  Conversations: ${rh.total_conversations} total, ${rh.conversations_last_30d} last 30d, ${rh.conversations_last_90d} last 90d`);
  lines.push(`  Coverage: ${rh.coverage_percentage}% (${rh.unique_contacts_engaged}/${rh.total_contacts_known})`);
  if (rh.days_since_last_interaction != null) {
    lines.push(`  Days since last interaction: ${rh.days_since_last_interaction}`);
  }

  if (dossier.contacts.length > 0) {
    const active = dossier.contacts.filter(c => c.engagement_level === 'active').length;
    const dark = dossier.contacts.filter(c => c.engagement_level === 'dark').length;
    lines.push(`\nContacts: ${dossier.contacts.length} total (${active} active, ${dark} dark)`);
  }

  if (dossier.findings.length > 0) {
    lines.push(`\nFindings (${dossier.findings.length}):`);
    for (const f of dossier.findings.slice(0, 5)) {
      lines.push(`  [${f.severity}] ${f.message}${f.deal_name ? ` (${f.deal_name})` : ''}`);
    }
  }

  if (rh.coverage_gaps && rh.coverage_gaps.length > 0) {
    lines.push(`\nCoverage gaps: ${rh.coverage_gaps.join('; ')}`);
  }

  return lines.join('\n');
}

const DEAL_SYSTEM_PROMPT = `You are a RevOps analyst summarizing a deal for a sales leader.
Write 2-4 sentences covering: current deal status, recent activity or inactivity, relationship health (threading, engagement), and any critical findings or risks.
Be direct, specific, and actionable. Reference actual data points. Do not use bullet points or headers.
If information is missing, note it briefly but focus on what is known.

Conversation weighting: If a conversation occurred within the last 7 days, treat it as the most important signal in the dossier and lead the summary with what was discussed and what it implies for deal momentum. Do not characterize a deal as stalling if a substantive call occurred within the last 7 days.

Stage inference: Compare the current CRM stage against the behavioral signals in the dossier (conversation topics, contact seniority engaged, timeline specificity). If the behavioral signals suggest the deal is further along than the CRM stage indicates, include a sentence flagging this: 'Based on recent conversations, this deal appears to be further along than the current stage reflects — consider updating the stage.'

After the summary paragraph, output a separate JSON block with recommended actions:
{"recommended_actions": ["action 1", "action 2", "action 3"]}

Cap at 3 actions maximum, each under 15 words, verb-led (e.g., "Schedule call with VP", "Update close date to reflect timeline", "Add missing contacts to CRM").`;

const ACCOUNT_SYSTEM_PROMPT = `You are a RevOps analyst summarizing an account relationship for a sales leader.
Write 2-4 sentences covering: overall relationship health, engagement trends, deal status, and any notable findings or coverage gaps.
Be direct, specific, and actionable. Reference actual data points. Do not use bullet points or headers.
If information is missing, note it briefly but focus on what is known.`;

export async function synthesizeDealNarrative(
  workspaceId: string,
  dossier: DealDossier
): Promise<{ narrative: string; recommended_actions: string[] }> {
  const context = buildDealContext(dossier);

  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt: DEAL_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: `Summarize this deal:\n\n${context}`,
      },
    ],
    maxTokens: 400,
    temperature: 0.3,
    _tracking: {
      feature: 'dossier_narrative',
      subFeature: 'deal',
    },
  });

  const content = response.content || '';

  // Parse JSON block if present
  const jsonMatch = content.match(/\{[\s\S]*?"recommended_actions"[\s\S]*?\}/);
  let recommended_actions: string[] = [];
  let narrative = content;

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      recommended_actions = (parsed.recommended_actions || []).slice(0, 3);
      narrative = content.replace(jsonMatch[0], '').trim();
    } catch (err) {
      console.warn('[Narrative] Failed to parse recommended_actions:', err);
    }
  }

  narrative = narrative
    .replace(/```json\s*```/g, '')
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  return { narrative, recommended_actions };
}

export async function synthesizeAccountNarrative(
  workspaceId: string,
  dossier: AccountDossier
): Promise<string> {
  const context = buildAccountContext(dossier);

  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt: ACCOUNT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: `Summarize this account relationship:\n\n${context}`,
      },
    ],
    maxTokens: 300,
    temperature: 0.3,
    _tracking: {
      feature: 'dossier_narrative',
      subFeature: 'account',
    },
  });

  return response.content || '';
}
