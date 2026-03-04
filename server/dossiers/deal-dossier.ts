import { query } from '../db.js';
import { getDealRiskScore } from '../tools/deal-risk-score.js';
import { getActiveAnnotations } from '../feedback/annotations.js';
import { computeCompositeScore } from '../computed-fields/deal-scores.js';

export interface DealDossier {
  deal: {
    id: string;
    name: string;
    amount: number;
    stage: string;
    stage_normalized: string;
    close_date: string | null;
    close_date_suspect: boolean;
    owner_email: string;
    owner_name: string;
    days_in_stage: number;
    days_open: number;
    created_at: string;
    probability: number | null;
    forecast_category: string | null;
    source: string | null;
    source_id: string | null;
    source_url: string | null;
    pipeline_name: string | null;
    account_name: string | null;
    account_id: string | null;
    custom_fields: Record<string, any>;
    inferred_phase: string | null;
    phase_confidence: number | null;
    phase_signals: Array<{ keyword: string; phase: string; count: number }>;
    phase_divergence: boolean;
    phase_inferred_at: string | null;
  };
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    role: string | null;
    is_primary: boolean;
    last_activity_date: string | null;
    seniority: string | null;
    buying_role: string | null;
    role_confidence: number | null;
    engagement_level: 'active' | 'fading' | 'dark';
  }>;
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    duration_minutes: number | null;
    participants: string[];
    link_method: string;
    summary: string | null;
  }>;
  activities: Array<{
    id: string;
    type: string;
    date: string;
    subject: string | null;
    owner_email: string;
    body: string | null;
  }>;
  stage_history: Array<{
    stage: string;
    stage_normalized?: string;
    stage_label?: string;
    entered_at: string;
    exited_at: string | null;
    days_in_stage: number;
  }>;
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    skill_id: string;
    found_at: string;
    resolved_at: string | null;
    actionability: string;
  }>;
  health_signals: {
    activity_recency: 'active' | 'cooling' | 'stale';
    threading: 'multi' | 'dual' | 'single';
    stage_velocity: 'fast' | 'normal' | 'slow';
    data_completeness: number;
    velocity_suspect: boolean;
  };
  coverage_gaps: {
    contacts_never_called: Array<{ name: string; title: string | null; email: string | null }>;
    days_since_last_call: number | null;
    total_contacts: number;
    contacts_on_calls: number;
    unlinked_calls: number;
  };
  risk_score: {
    score: number;
    grade: string;
    signal_counts: { act: number; watch: number; notable: number; info: number };
  };
  mechanical_score: {
    score: number;
    grade: string;
  } | null;
  active_score: {
    score: number;
    grade: string;
    source: 'skill' | 'health';
    skill_score: number | null;
    health_score: number | null;
    divergence: number;
    divergence_flag: boolean;
    conversation_modifier: number;
    weights_used: { crm: number; findings: number; conversations: number };
    degradation_state: 'full' | 'no_conversations' | 'no_findings' | 'crm_only';
  };
  annotations: Array<{
    id: string;
    annotation_type: string;
    content: string;
    source: string;
    created_at: string;
    created_by: string | null;
    expires_at: string | null;
  }>;
  enrichment: {
    buying_committee_size: number;
    roles_identified: string[];
    icp_fit_score: number | null;
    account_signals: any[];
  } | null;
  narrative: string | null;
  hasUserContext: boolean;
  data_availability: {
    has_stage_history: boolean;
    has_contacts: boolean;
    has_conversations: boolean;
    has_findings: boolean;
  };
  metadata: {
    assembled_at: string;
    data_sources_consulted: string[];
    assembly_duration_ms: number;
  };
}

async function getDealById(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT d.*,
            EXTRACT(day FROM now() - d.stage_changed_at) as calculated_days_in_stage,
            EXTRACT(day FROM now() - d.created_at) as days_open,
            a.domain as account_domain, a.name as account_name, a.id as account_id
     FROM deals d
     LEFT JOIN accounts a ON d.account_id = a.id AND a.workspace_id = $2
     WHERE d.id = $1 AND d.workspace_id = $2`,
    [dealId, workspaceId]
  );
  return result.rows[0] || null;
}

async function getContactsForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT c.id, COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '') as name,
            c.email, c.title, dc.role, dc.is_primary, c.last_activity_date,
            dc.buying_role, dc.role_confidence, dc.seniority_verified
     FROM deal_contacts dc
     JOIN contacts c ON dc.contact_id = c.id AND c.workspace_id = $1
     WHERE dc.deal_id = $2 AND dc.workspace_id = $1
     ORDER BY dc.is_primary DESC, c.last_name ASC`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getConversationsForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT cv.id, cv.title, cv.call_date, cv.duration_seconds, cv.participants,
            cv.link_method, cv.summary, cv.source, cv.source_id, cv.source_data, cv.custom_fields
     FROM conversations cv
     WHERE cv.workspace_id = $1
       AND (cv.deal_id = $2 OR cv.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1))
     ORDER BY cv.call_date DESC
     LIMIT 20`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getActivitiesForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT a.id, a.activity_type, a.timestamp, a.subject, a.actor, a.body
     FROM activities a
     WHERE a.workspace_id = $1 AND a.deal_id = $2
     ORDER BY a.timestamp DESC
     LIMIT 30`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getStageHistoryForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT stage, stage_normalized, entered_at, exited_at, duration_days
     FROM deal_stage_history
     WHERE workspace_id = $1 AND deal_id = $2
     ORDER BY entered_at ASC`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getFindingsForDeal(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT f.id, f.severity, f.category, f.message, f.skill_id, f.found_at, f.resolved_at, f.actionability
     FROM findings f
     WHERE f.workspace_id = $1 AND f.deal_id = $2 AND f.resolved_at IS NULL
     ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 WHEN 'info' THEN 4 ELSE 5 END`,
    [workspaceId, dealId]
  );
  return result.rows;
}

async function getDealEnrichment(workspaceId: string, dealId: string) {
  const result = await query(
    `SELECT dc.buying_role, dc.role_confidence, dc.seniority_verified,
            c.first_name, c.last_name, c.email, c.title
     FROM deal_contacts dc
     JOIN contacts c ON dc.contact_id = c.id AND c.workspace_id = $1
     WHERE dc.deal_id = $2 AND dc.workspace_id = $1
       AND dc.buying_role IS NOT NULL`,
    [workspaceId, dealId]
  );
  if (result.rows.length === 0) return null;

  const roles_identified = [...new Set(result.rows.map((r: any) => r.buying_role).filter(Boolean))];
  const avgConfidence = result.rows.reduce((s: number, r: any) => s + (Number(r.role_confidence) || 0), 0) / result.rows.length;

  return {
    buying_committee_size: result.rows.length,
    roles_identified,
    icp_fit_score: avgConfidence > 0 ? Math.round(avgConfidence * 100) : null,
    account_signals: [],
  };
}

async function getUnlinkedCallCount(workspaceId: string, dealId: string, accountDomain: string | null): Promise<number> {
  if (!accountDomain) return 0;
  try {
    const result = await query(
      `SELECT COUNT(*)::int as cnt FROM conversations cv
       WHERE cv.workspace_id = $1 AND cv.deal_id IS NULL
         AND cv.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1)
         AND EXISTS (
           SELECT 1 FROM unnest(cv.participants) p
           WHERE p LIKE $3
         )`,
      [workspaceId, dealId, `%@${accountDomain}`]
    );
    return result.rows[0]?.cnt || 0;
  } catch { return 0; }
}

function computeHealthSignals(
  deal: any,
  activities: any[],
  contacts: Array<{
    engagement_level: 'active' | 'fading' | 'dark' | 'unengaged';
    seniority: string | null;
  }>,
  daysSinceLastCall: number | null
): DealDossier['health_signals'] {
  let activity_recency: 'active' | 'cooling' | 'stale' = 'stale';
  if (activities.length > 0 && activities[0].timestamp) {
    const mostRecent = new Date(activities[0].timestamp);
    const daysSince = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 7) activity_recency = 'active';
    else if (daysSince <= 21) activity_recency = 'cooling';
  }

  // Compute engagement-weighted threading score
  const getEngagementMultiplier = (level: string): number => {
    switch (level) {
      case 'active': return 1.0;
      case 'fading': return 0.5;
      case 'dark': return 0.1;
      case 'unengaged': return 0.0;
      default: return 0.0;
    }
  };

  const getSeniorityMultiplier = (seniority: string | null): number => {
    if (!seniority) return 1.0;
    const normalized = seniority.toLowerCase();
    if (normalized.includes('c_level') || normalized.includes('c-level') ||
        normalized.includes('svp') || normalized.includes('evp')) return 2.0;
    if (normalized.includes('vp') || normalized.includes('director')) return 1.5;
    if (normalized.includes('manager') || normalized.includes('senior')) return 1.0;
    return 0.75;
  };

  const effective_thread_score = contacts.reduce((sum, contact) => {
    const engagementMult = getEngagementMultiplier(contact.engagement_level);
    const seniorityMult = getSeniorityMultiplier(contact.seniority);
    return sum + (engagementMult * seniorityMult);
  }, 0);

  let threading: 'multi' | 'dual' | 'single' = 'single';
  if (effective_thread_score >= 3.0) threading = 'multi';
  else if (effective_thread_score >= 1.5) threading = 'dual';

  const daysInStage = deal?.calculated_days_in_stage ?? deal?.days_in_stage ?? 0;
  let stage_velocity: 'fast' | 'normal' | 'slow' = 'normal';
  let velocity_suspect = false;

  // Fix 1: Deal just entered stage cannot be stalled
  if (daysInStage === 0 || daysInStage === null) {
    stage_velocity = 'fast';
  } else if (daysInStage <= 14) {
    stage_velocity = 'fast';
  } else if (daysInStage > 45) {
    stage_velocity = 'slow';
  }

  // Fix 2: Recent call activity may indicate stale stage data
  if (stage_velocity === 'slow' && daysSinceLastCall !== null && daysSinceLastCall <= 7) {
    stage_velocity = 'normal';
    velocity_suspect = true;
  }

  const fields = [deal?.amount, deal?.close_date, deal?.owner, deal?.stage, deal?.source, deal?.pipeline];
  const filledCount = fields.filter(f => f != null && f !== '').length;
  const data_completeness = Math.round((filledCount / fields.length) * 100);

  return { activity_recency, threading, stage_velocity, data_completeness, velocity_suspect };
}

function gradeFromScore(s: number): string {
  if (s >= 90) return 'A'; if (s >= 75) return 'B'; if (s >= 50) return 'C'; if (s >= 25) return 'D'; return 'F';
}

const HUBSPOT_STAGE_LABELS: Record<string, string> = {
  appointmentscheduled: 'Appointment Scheduled',
  closedlost: 'Closed Lost',
  closedwon: 'Closed Won',
  contractsent: 'Contract Sent',
  decisionmakerboughtin: 'Decision Maker Bought In',
  presentationscheduled: 'Presentation Scheduled',
  qualifiedtobuy: 'Qualified to Buy',
};

function formatStageLabel(rawStage: string, normalizedStage: string): string {
  if (!rawStage) {
    return normalizedStage
      ? normalizedStage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Unknown';
  }
  if (/^\d+$/.test(rawStage)) {
    return normalizedStage
      ? normalizedStage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Unknown Stage';
  }
  const lower = rawStage.toLowerCase();
  if (HUBSPOT_STAGE_LABELS[lower]) {
    return HUBSPOT_STAGE_LABELS[lower];
  }
  if (/^[a-z]+$/.test(rawStage)) {
    return normalizedStage
      ? normalizedStage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : rawStage.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
  }
  return rawStage;
}

export async function assembleDealDossier(
  workspaceId: string,
  dealId: string,
  options?: { includeNarrative?: boolean }
): Promise<DealDossier> {
  const startTime = Date.now();
  const [deal, contacts, conversations, activities, stageHistory, findings, riskResult, annotations, enrichment] = await Promise.all([
    getDealById(workspaceId, dealId),
    getContactsForDeal(workspaceId, dealId).catch(e => { console.error('[DealDossier] contacts error:', e.message); return []; }),
    getConversationsForDeal(workspaceId, dealId).catch(e => { console.error('[DealDossier] conversations error:', e.message); return []; }),
    getActivitiesForDeal(workspaceId, dealId).catch(e => { console.error('[DealDossier] activities error:', e.message); return []; }),
    getStageHistoryForDeal(workspaceId, dealId).catch(e => { console.error('[DealDossier] stageHistory error:', e.message); return []; }),
    getFindingsForDeal(workspaceId, dealId).catch(e => { console.error('[DealDossier] findings error:', e.message); return []; }),
    getDealRiskScore(workspaceId, dealId).catch(() => null),
    getActiveAnnotations(workspaceId, 'deal', dealId).catch(() => []),
    getDealEnrichment(workspaceId, dealId).catch(e => { console.error('[DealDossier] enrichment error:', e.message); return null; }),
  ]);

  if (!deal) {
    throw new Error(`Deal ${dealId} not found in workspace ${workspaceId}`);
  }

  // Compute composite active score with graceful degradation
  const healthScoreVal = deal?.health_score != null ? Number(deal.health_score) : null;
  const conversationModifier = deal?.conversation_modifier != null ? Number(deal.conversation_modifier) : 0;
  const closeDateSuspect = deal?.close_date_suspect === true;
  const skillScoreVal = riskResult?.score ?? null;
  const hasConversations = conversations.length > 0;

  const conversationScore = conversationModifier !== 0 ? Math.max(0, Math.min(100, 50 + conversationModifier * 2.5)) : null;

  const compositeResult = computeCompositeScore(
    healthScoreVal,
    skillScoreVal,
    conversationScore,
    undefined,
    hasConversations
  );

  const activeScore = compositeResult.score;
  const activeSource: 'skill' | 'health' = (healthScoreVal != null && skillScoreVal != null && healthScoreVal < skillScoreVal) ? 'health' : 'skill';

  const availableScores = [
    healthScoreVal,
    skillScoreVal,
    conversationScore
  ].filter((s): s is number => s !== null);

  const divergence = availableScores.length >= 2
    ? Math.max(...availableScores) - Math.min(...availableScores)
    : 0;
  const divergenceFlag = divergence >= 20;

  const accountDomain = deal?.account_domain || null;
  const unlinkedCalls = await getUnlinkedCallCount(workspaceId, dealId, accountDomain).catch(() => 0);

  const mappedContacts = contacts.map((c: any) => {
    const engagement_level = (() => {
      if (!c.last_activity_date) return 'unengaged' as const;
      const daysSince = (Date.now() - new Date(c.last_activity_date).getTime()) / (1000*60*60*24);
      if (daysSince <= 14) return 'active' as const;
      if (daysSince <= 30) return 'fading' as const;
      return 'dark' as const;
    })();

    return {
      id: c.id,
      name: (c.name || '').trim(),
      email: c.email || '',
      title: c.title ?? null,
      role: c.role ?? null,
      is_primary: c.is_primary === true,
      last_activity_date: c.last_activity_date ? new Date(c.last_activity_date).toISOString() : null,
      seniority: c.seniority_verified ?? null,
      buying_role: c.buying_role ?? null,
      role_confidence: c.role_confidence ? Number(c.role_confidence) : null,
      engagement_level,
    };
  });

  // Compute days since last call for velocity suspect detection
  let daysSinceLastCall: number | null = null;
  if (conversations.length > 0 && conversations[0].call_date) {
    const mostRecentCallDate = new Date(conversations[0].call_date).getTime();
    if (mostRecentCallDate > 0) {
      daysSinceLastCall = Math.round((Date.now() - mostRecentCallDate) / (1000 * 60 * 60 * 24));
    }
  }

  // Compute health signals using engagement-weighted contacts
  const health_signals = computeHealthSignals(deal, activities, mappedContacts, daysSinceLastCall);

  const mappedConversations = conversations.map((cv: any) => ({
    id: cv.id,
    title: cv.title || '',
    date: cv.call_date ? new Date(cv.call_date).toISOString() : '',
    duration_minutes: cv.duration_seconds != null ? Math.round(cv.duration_seconds / 60) : null,
    participants: Array.isArray(cv.participants) ? cv.participants : [],
    link_method: cv.link_method || '',
    summary: cv.summary ?? null,
    source: cv.source ?? null,
    source_id: cv.source_id ?? null,
    source_data: cv.source_data ?? null,
    custom_fields: cv.custom_fields ?? null,
  }));

  const participantEmails = new Set<string>();
  for (const cv of mappedConversations) {
    for (const p of cv.participants) {
      if (typeof p === 'string' && p.includes('@')) participantEmails.add(p.toLowerCase());
    }
  }

  const contacts_never_called = mappedContacts
    .filter((c: any) => c.email && !participantEmails.has(c.email.toLowerCase()))
    .filter((c, i, arr) => arr.findIndex(x => x.email === c.email) === i)
    .map((c: any) => ({
      name: c.name,
      title: c.title,
      email: c.email,
      seniority: c.seniority,
      buying_role: c.buying_role,
      engagement_level: c.engagement_level,
    }));

  let days_since_last_call: number | null = null;
  if (mappedConversations.length > 0) {
    const dates = mappedConversations
      .map((cv: any) => cv.date ? new Date(cv.date).getTime() : 0)
      .filter((t: number) => t > 0);
    if (dates.length > 0) {
      const mostRecent = Math.max(...dates);
      days_since_last_call = Math.round((Date.now() - mostRecent) / (1000 * 60 * 60 * 24));
    }
  }

  // Stage-aware threshold for days since last call
  const getCallThresholdForStage = (stage: string | null): number => {
    if (!stage) return 10; // default
    const normalized = stage.toLowerCase();
    if (normalized.includes('prospect') || normalized.includes('discovery')) return 14;
    if (normalized.includes('evaluation') || normalized.includes('proposal')) return 7;
    if (normalized.includes('negotiat') || normalized.includes('clos')) return 5;
    return 10; // default
  };
  const days_threshold = getCallThresholdForStage(deal.stage_normalized || deal.stage);

  const contacts_on_calls = mappedContacts.filter(
    (c: any) => c.email && participantEmails.has(c.email.toLowerCase())
  ).length;

  return {
    deal: {
      id: deal.id,
      name: deal.name || '',
      amount: deal.amount || 0,
      stage: deal.stage || '',
      stage_normalized: deal.stage_normalized || '',
      close_date: deal.close_date ? new Date(deal.close_date).toISOString() : null,
      close_date_suspect: closeDateSuspect,
      owner_email: deal.owner || '',
      owner_name: deal.owner || '',
      days_in_stage: Math.max(0, Math.round(deal.calculated_days_in_stage ?? deal.days_in_stage ?? 0)),
      days_open: Math.max(0, Math.round(deal.days_open ?? 0)),
      created_at: deal.created_at ? new Date(deal.created_at).toISOString() : '',
      probability: deal.probability ?? null,
      forecast_category: deal.forecast_category ?? null,
      source: deal.source ?? null,
      source_id: deal.source_id ?? null,
      source_url: deal.source_url ?? null,
      pipeline_name: deal.pipeline ?? null,
      account_name: deal.account_name ?? null,
      account_id: deal.account_id ?? null,
      custom_fields: deal.custom_fields || {},
      inferred_phase: deal.inferred_phase ?? null,
      phase_confidence: deal.phase_confidence ?? null,
      phase_signals: deal.phase_signals ?? [],
      phase_divergence: deal.phase_divergence ?? false,
      phase_inferred_at: deal.phase_inferred_at ? new Date(deal.phase_inferred_at).toISOString() : null,
    },
    contacts: mappedContacts as any,
    conversations: mappedConversations,
    activities: activities.map((a: any) => ({
      id: a.id,
      type: a.activity_type || '',
      date: a.timestamp ? new Date(a.timestamp).toISOString() : '',
      subject: a.subject ?? null,
      owner_email: a.actor || '',
      body: a.body ?? null,
    })),
    stage_history: stageHistory.map((sh: any) => ({
      stage: sh.stage || '',
      stage_normalized: sh.stage_normalized || '',
      stage_label: formatStageLabel(sh.stage, sh.stage_normalized),
      entered_at: sh.entered_at ? new Date(sh.entered_at).toISOString() : '',
      exited_at: sh.exited_at ? new Date(sh.exited_at).toISOString() : null,
      days_in_stage: sh.duration_days ?? 0,
    })),
    findings: findings.map((f: any) => ({
      id: f.id,
      severity: f.severity || '',
      category: f.category || '',
      message: f.message || '',
      skill_id: f.skill_id || '',
      found_at: f.found_at ? new Date(f.found_at).toISOString() : '',
      resolved_at: f.resolved_at ? new Date(f.resolved_at).toISOString() : null,
      actionability: f.actionability ?? 'monitor',
    })),
    health_signals,
    coverage_gaps: {
      contacts_never_called,
      days_since_last_call,
      total_contacts: mappedContacts.length,
      contacts_on_calls,
      unlinked_calls: unlinkedCalls,
    },
    risk_score: {
      score: riskResult?.score ?? 100,
      grade: riskResult?.grade ?? 'A',
      signal_counts: riskResult?.signal_counts ?? { act: 0, watch: 0, notable: 0, info: 0 },
    },
    mechanical_score: healthScoreVal != null ? {
      score: healthScoreVal,
      grade: gradeFromScore(healthScoreVal),
    } : null,
    active_score: {
      score: activeScore,
      grade: compositeResult.grade,
      source: activeSource,
      skill_score: skillScoreVal,
      health_score: healthScoreVal,
      divergence,
      divergence_flag: divergenceFlag,
      conversation_modifier: conversationModifier,
      weights_used: compositeResult.weights_used,
      degradation_state: compositeResult.degradation_state,
    },
    annotations: annotations.map((a: any) => ({
      id: a.id,
      annotation_type: a.annotation_type,
      content: a.content,
      source: a.source,
      created_at: a.created_at ? new Date(a.created_at).toISOString() : '',
      created_by: a.created_by ?? null,
      expires_at: a.expires_at ? new Date(a.expires_at).toISOString() : null,
    })),
    enrichment: enrichment ?? null,
    narrative: deal.narrative || null,
    // @ts-ignore extra property
    recommended_actions: (deal as any).narrative_actions || [],
    narrative_generated_at: deal.narrative_generated_at ? new Date(deal.narrative_generated_at).toISOString() : null,
    hasUserContext: annotations.length > 0,
    data_availability: {
      has_stage_history: stageHistory.length > 0,
      has_contacts: contacts.length > 0,
      has_conversations: conversations.length > 0,
      has_findings: findings.length > 0,
    },
    metadata: {
      assembled_at: new Date().toISOString(),
      data_sources_consulted: [
        'deals', 'deal_contacts', 'contacts', 'conversations', 'activities',
        'deal_stage_history', 'findings',
        ...(enrichment ? ['deal_contacts_enrichment'] : []),
      ],
      assembly_duration_ms: Date.now() - startTime,
    },
  };
}
