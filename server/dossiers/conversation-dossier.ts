/**
 * Conversation Dossier Assembler
 *
 * Assembles comprehensive context for conversation detail page:
 * - Deal context (what Gong/Fireflies can't show)
 * - Health impact analysis
 * - CRM follow-through gaps
 * - Conversation arc timeline
 * - Coaching signals (benchmark-driven)
 * - Absent contacts (who should have been on the call)
 */

import { query, getClient } from '../db.js';
import type { PoolClient } from 'pg';
import type { ResolvedParticipant } from '../conversations/resolve-participants.js';
import type { PostCallCrmState } from '../conversations/post-call-tracker.js';
import { generateCoachingSignals } from '../coaching/coaching-signals.js';
import type { CoachingSignal, CoachingMode } from '../coaching/coaching-signals.js';

export interface ConversationDossier {
  conversation: {
    id: string;
    title: string;
    started_at: string;
    duration_seconds: number;
    source: string;
    source_url: string | null;
    summary: string | null;
    action_items: any[];
    resolved_participants: ResolvedParticipant[];
    call_metrics: CallMetrics | null;
  };

  deal_context: {
    deal_id: string;
    deal_name: string;
    amount: number;
    stage: string;
    stage_normalized: string;
    days_in_stage: number;
    stage_benchmark_median: number | null;
    close_date: string;
    original_close_date: string | null;
    close_date_pushes: number;
    forecast_category: string | null;
    owner_name: string;
    owner_email: string;
    health_score: number | null;
    inferred_phase: string | null;
    phase_confidence: number | null;
    phase_divergence: boolean;
    phase_signals: any;
  } | null;

  health_impact: {
    health_before: number | null;
    health_after: number | null;
    health_delta: number | null;
    factors: HealthFactor[];
  } | null;

  crm_follow_through: {
    stage_changed: boolean;
    next_step_updated: boolean;
    close_date_changed: boolean;
    amount_changed: boolean;
    activity_logged: boolean;
    next_meeting_scheduled: boolean | null;
    hours_since_call: number;
    gaps: CrmGap[];
  } | null;

  conversation_arc: ConversationArcEntry[];

  coaching_signals: CoachingSignal[];
  coaching_mode: CoachingMode;
  coaching_metadata: {
    won_count: number;
    lost_count: number;
    pattern_count: number;
  };

  skill_findings: {
    skill_id: string;
    severity: string;
    message: string;
    found_at: string;
  }[];

  contacts_absent: {
    name: string;
    title: string;
    email: string;
    last_conversation_date: string | null;
    buying_role: string | null;
  }[];
}

export interface CallMetrics {
  talk_ratio_rep: number | null;
  talk_ratio_buyer: number | null;
  speaker_count_internal: number;
  speaker_count_external: number;
  question_count: number | null;
  longest_monologue_seconds: number | null;
  source_of_metrics: 'gong_native' | 'fireflies_derived' | 'unavailable';
}

export interface HealthFactor {
  label: string;
  delta: number;
  detail: string;
}

export interface CrmGap {
  type: 'missing' | 'stale' | 'inconsistent';
  label: string;
  severity: 'high' | 'medium' | 'low';
  detail: string;
}

// CoachingSignal interface imported from coaching-signals module

export interface ConversationArcEntry {
  id: string;
  title: string;
  started_at: string;
  duration_seconds: number;
  health_delta: number | null;
  is_current: boolean;
  participant_count_external: number;
  summary_one_liner: string | null;
}

/**
 * Main entry point: Assemble complete conversation dossier
 */
export async function assembleConversationDossier(
  workspaceId: string,
  conversationId: string
): Promise<ConversationDossier> {
  const client = await getClient();

  try {
    // Step 1: Load conversation with all enriched data
    const conversationResult = await client.query<{
      id: string;
      title: string;
      call_date: string;
      duration_seconds: number;
      source: string;
      source_id: string;
      source_data: any;
      summary: string | null;
      action_items: any[];
      next_steps: any[] | null;
      keywords: string[];
      resolved_participants: ResolvedParticipant[];
      call_metrics: CallMetrics | null;
      post_call_crm_state: PostCallCrmState | null;
      deal_health_before: number | null;
      deal_health_after: number | null;
      deal_id: string | null;
      account_id: string | null;
    }>(
      `SELECT id, title, call_date as started_at, duration_seconds, source, source_id, source_data,
              summary, action_items, next_steps, resolved_participants, call_metrics,
              post_call_crm_state, deal_health_before, deal_health_after,
              deal_id, account_id
       FROM conversations
       WHERE id = $1 AND workspace_id = $2`,
      [conversationId, workspaceId]
    );

    if (conversationResult.rows.length === 0) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const conv = conversationResult.rows[0];

    // Merge next_steps into action_items when action_items is empty
    // Signal extractor writes to next_steps; action_items comes from Gong/Fireflies native
    if ((!conv.action_items || conv.action_items.length === 0) && conv.next_steps && conv.next_steps.length > 0) {
      conv.action_items = conv.next_steps.map((ns: any) => ({
        text: ns.action,
        owner: ns.owner !== 'unknown' ? ns.owner : undefined,
        status: ns.status,
        deadline: ns.deadline,
      }));
    }

    // Build source URL
    const sourceUrl = buildSourceUrl(conv.source, conv.source_id, conv.source_data);

    // Step 2: Load deal context (if linked)
    let dealContext: ConversationDossier['deal_context'] = null;
    let previousConversation: any = null;
    let allDealContacts: any[] = [];
    let allDealConversations: any[] = [];

    if (conv.deal_id) {
      dealContext = await loadDealContext(conv.deal_id, workspaceId, client);

      // Load all contacts on this deal — exclude internal (seller-side) users
      // and deduplicate by contact ID, preferring the most specific buying role
      const contactsResult = await client.query(
        `SELECT DISTINCT ON (c.id)
                c.id,
                TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) as name,
                c.title, c.email, dc.buying_role
         FROM deal_contacts dc
         JOIN contacts c ON dc.contact_id = c.id AND c.workspace_id = $1
         WHERE dc.deal_id = $2
           AND dc.workspace_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_each_text(
               (SELECT settings->'owner_map' FROM workspaces WHERE id = $1)
             ) om
             WHERE om.value = TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
           )
           AND (
             c.email IS NULL
             OR SPLIT_PART(c.email, '@', 2) NOT IN (
               SELECT SPLIT_PART(c2.email, '@', 2)
               FROM contacts c2
               WHERE c2.workspace_id = $1
                 AND c2.email LIKE '%@%'
                 AND SPLIT_PART(c2.email, '@', 2) NOT IN (
                   'gmail.com','yahoo.com','hotmail.com','outlook.com',
                   'icloud.com','me.com','aol.com','protonmail.com'
                 )
                 AND EXISTS (
                   SELECT 1 FROM jsonb_each_text(
                     (SELECT settings->'owner_map' FROM workspaces WHERE id = $1)
                   ) om
                   WHERE om.value = TRIM(COALESCE(c2.first_name, '') || ' ' || COALESCE(c2.last_name, ''))
                 )
             )
           )
         ORDER BY c.id,
           CASE dc.buying_role
             WHEN 'unknown' THEN 3
             WHEN null THEN 4
             ELSE 1
           END,
           dc.buying_role NULLS LAST`,
        [workspaceId, conv.deal_id]
      );
      allDealContacts = contactsResult.rows;

      // Load all conversations on this deal for arc
      const conversationsResult = await client.query(
        `SELECT id, title, call_date as started_at, duration_seconds, summary,
                deal_health_before, deal_health_after, resolved_participants
         FROM conversations
         WHERE workspace_id = $1 AND deal_id = $2
         ORDER BY call_date ASC`,
        [workspaceId, conv.deal_id]
      );
      allDealConversations = conversationsResult.rows;

      // Find previous conversation for health impact comparison
      const prevIndex = allDealConversations.findIndex(c => c.id === conversationId) - 1;
      if (prevIndex >= 0) {
        previousConversation = allDealConversations[prevIndex];
      }
    }

    // Step 3: Compute health impact
    const healthImpact = computeHealthImpact(
      conv,
      dealContext,
      previousConversation,
      allDealContacts,
      allDealConversations
    );

    // Step 4: Compute CRM gaps
    const crmFollowThrough = computeCrmFollowThrough(
      conv.post_call_crm_state,
      conv.call_date,
      conv.action_items
    );

    // Step 5: Build conversation arc
    const conversationArc = buildConversationArc(
      allDealConversations,
      conversationId,
      conv.deal_id,
      workspaceId
    );

    // Step 6: Generate coaching signals (pattern-based)
    const coachingResult = conv.deal_id && dealContext
      ? await generateCoachingSignals(
          conv.deal_id,
          workspaceId,
          dealContext.stage,
          dealContext.amount,
          null, // pipeline_name not yet tracked
          client
        )
      : { signals: [], mode: 'hidden' as CoachingMode, metadata: { won_count: 0, lost_count: 0, pattern_count: 0 } };

    // Step 7: Load skill findings for this deal
    const skillFindings = await loadSkillFindings(conv.deal_id, workspaceId, client);

    // Step 8: Identify contacts absent from this call
    const contactsAbsent = identifyAbsentContacts(
      allDealContacts,
      conv.resolved_participants || [],
      allDealConversations
    );

    return {
      conversation: {
        id: conv.id,
        title: conv.title || 'Untitled conversation',
        call_date: conv.call_date,
        duration_seconds: conv.duration_seconds || 0,
        source: conv.source,
        source_url: sourceUrl,
        summary: conv.summary,
        action_items: conv.action_items || [],
        resolved_participants: conv.resolved_participants || [],
        call_metrics: conv.call_metrics,
      },
      deal_context: dealContext,
      health_impact: healthImpact,
      crm_follow_through: crmFollowThrough,
      conversation_arc: conversationArc,
      coaching_signals: coachingResult.signals,
      coaching_mode: coachingResult.mode,
      coaching_metadata: coachingResult.metadata,
      skill_findings: skillFindings,
      contacts_absent: contactsAbsent,
    };
  } finally {
    client.release();
  }
}

/**
 * Build source URL for Gong or Fireflies
 */
function buildSourceUrl(source: string, sourceId: string, sourceData: any): string | null {
  if (source === 'gong') {
    return sourceData?.url || `https://app.gong.io/call?id=${sourceId}`;
  }
  if (source === 'fireflies') {
    return `https://app.fireflies.ai/view/${sourceId}`;
  }
  return null;
}

/**
 * Load deal context with phase inference
 */
async function loadDealContext(
  dealId: string,
  workspaceId: string,
  client: PoolClient
): Promise<NonNullable<ConversationDossier['deal_context']>> {
  const dealResult = await client.query<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    stage_normalized: string;
    stage_changed_at: string;
    close_date: string;
    forecast_category: string | null;
    owner: string;
    health_score: number | null;
    inferred_phase: string | null;
    phase_confidence: number | null;
    phase_divergence: boolean;
    phase_signals: any;
    created_at: string;
  }>(
    `SELECT id, name, amount, stage, stage_normalized, stage_changed_at,
            close_date, forecast_category, owner, health_score,
            inferred_phase, phase_confidence, phase_divergence, phase_signals, created_at
     FROM deals
     WHERE id = $1 AND workspace_id = $2`,
    [dealId, workspaceId]
  );

  if (dealResult.rows.length === 0) {
    throw new Error(`Deal ${dealId} not found`);
  }

  const deal = dealResult.rows[0];

  // Compute days in stage
  const stageAnchor = deal.stage_changed_at ? new Date(deal.stage_changed_at) : new Date(deal.created_at);
  const daysInStage = Math.floor((Date.now() - stageAnchor.getTime()) / (1000 * 60 * 60 * 24));

  // Get stage benchmark median
  let stageBenchmarkMedian: number | null = null;
  try {
    const benchmarkResult = await client.query<{ median_days: number }>(
      `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_in_previous_stage_ms / 86400000.0) as median_days
       FROM deal_stage_history
       WHERE workspace_id = $1
         AND from_stage_normalized = $2
         AND duration_in_previous_stage_ms IS NOT NULL`,
      [workspaceId, deal.stage_normalized]
    );
    stageBenchmarkMedian = benchmarkResult.rows[0]?.median_days || null;
  } catch (err) {
    // Table or column may not exist yet, gracefully degrade
    console.warn('[ConversationDossier] Could not load stage benchmark:', err instanceof Error ? err.message : String(err));
  }

  // Count close date pushes (from stage history or field changes)
  // Simplified: check if current close_date is later than deal creation + 30 days
  const closeDatePushes = 0; // TODO: implement from field change history

  return {
    deal_id: deal.id,
    deal_name: deal.name,
    amount: deal.amount || 0,
    stage: deal.stage,
    stage_normalized: deal.stage_normalized || deal.stage,
    days_in_stage: daysInStage,
    stage_benchmark_median: stageBenchmarkMedian,
    close_date: deal.close_date,
    original_close_date: null, // TODO: from field change history
    close_date_pushes: closeDatePushes,
    forecast_category: deal.forecast_category,
    owner_name: deal.owner || 'Unknown',
    owner_email: deal.owner || '',
    health_score: deal.health_score,
    inferred_phase: deal.inferred_phase,
    phase_confidence: deal.phase_confidence,
    phase_divergence: deal.phase_divergence || false,
    phase_signals: deal.phase_signals || [],
  };
}

/**
 * Compute health impact factors
 */
function computeHealthImpact(
  conversation: any,
  dealContext: NonNullable<ConversationDossier['deal_context']> | null,
  previousConversation: any,
  allDealContacts: any[],
  allDealConversations: any[]
): ConversationDossier['health_impact'] {
  const healthBefore = conversation.deal_health_before;
  const healthAfter = conversation.deal_health_after;

  const healthDelta = healthBefore !== null && healthAfter !== null
    ? Math.round((healthAfter - healthBefore) * 10) / 10
    : null;

  const factors: HealthFactor[] = [];

  // Factor 1: Multi-threading improvement
  const resolvedParticipants = conversation.resolved_participants || [];
  const externalOnThisCall = resolvedParticipants.filter(
    (p: ResolvedParticipant) => p.role === 'external' && p.confidence >= 0.7
  ).length;

  const prevResolved = previousConversation?.resolved_participants || [];
  const externalOnPrevCall = prevResolved.filter(
    (p: ResolvedParticipant) => p.role === 'external' && p.confidence >= 0.7
  ).length;

  if (externalOnThisCall > externalOnPrevCall) {
    factors.push({
      label: 'Multi-threading improved',
      delta: Math.min((externalOnThisCall - externalOnPrevCall) * 3, 8),
      detail: `${externalOnThisCall} buyer contacts on call (was ${externalOnPrevCall})`,
    });
  }

  // Factor 2: Engagement recency reset
  if (previousConversation) {
    const gapDays = daysBetween(
      new Date(previousConversation.call_date),
      new Date(conversation.call_date)
    );
    if (gapDays > 7) {
      factors.push({
        label: 'Engagement recency reset',
        delta: Math.min(Math.floor(gapDays / 5), 5),
        detail: `Active call after ${gapDays}-day gap`,
      });
    }
  }

  // Factor 3: Talk ratio risk
  const callMetrics = conversation.call_metrics;
  if (callMetrics?.talk_ratio_rep && callMetrics.talk_ratio_rep > 80) {
    factors.push({
      label: 'Talk ratio risk',
      delta: -2,
      detail: `Rep at ${callMetrics.talk_ratio_rep}% talk time — buyer barely spoke`,
    });
  }

  // Factor 4: Phase divergence
  if (dealContext?.phase_divergence) {
    factors.push({
      label: 'Stage may be stale',
      delta: -3,
      detail: `Conversations suggest ${dealContext.inferred_phase} but CRM says ${dealContext.stage}`,
    });
  }

  // Return null only when there is nothing to show at all
  if (healthBefore === null && healthAfter === null && factors.length === 0) {
    return null;
  }

  return {
    health_before: healthBefore,
    health_after: healthAfter,
    health_delta: healthDelta,
    factors,
  };
}

/**
 * Compute CRM follow-through gaps
 */
function computeCrmFollowThrough(
  state: PostCallCrmState | null,
  startedAt: string,
  actionItems: any[]
): ConversationDossier['crm_follow_through'] {
  if (!state) return null;

  const hoursSinceCall = Math.floor(
    (Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60)
  );

  const gaps: CrmGap[] = [];

  // Only flag gaps if enough time has passed (24h+)
  if (hoursSinceCall >= 24) {
    // Gap: No next meeting scheduled
    if (!state.next_meeting_scheduled) {
      const actionItemCount = actionItems?.length || 0;
      gaps.push({
        type: 'missing',
        label: 'No next meeting scheduled',
        severity: actionItemCount > 0 ? 'high' : 'medium',
        detail: actionItemCount > 0
          ? `${actionItemCount} action items created but no follow-up call booked`
          : 'No scheduled follow-up after this conversation',
      });
    }

    // Gap: No CRM activity logged
    if (!state.activity_logged) {
      gaps.push({
        type: 'missing',
        label: 'No CRM activity logged',
        severity: 'medium',
        detail: 'No notes, emails, or tasks logged since this call',
      });
    }

    // Gap: Close date changed
    if (state.close_date_changed) {
      gaps.push({
        type: 'stale',
        label: 'Close date changed',
        severity: 'medium',
        detail: 'Close date moved after this call',
      });
    }
  }

  return {
    stage_changed: state.deal_stage_changed,
    next_step_updated: state.next_step_updated,
    close_date_changed: state.close_date_changed,
    amount_changed: state.amount_changed,
    activity_logged: state.activity_logged,
    next_meeting_scheduled: state.next_meeting_scheduled,
    hours_since_call: hoursSinceCall,
    gaps,
  };
}

/**
 * Build conversation arc timeline
 */
function buildConversationArc(
  allConversations: any[],
  currentConversationId: string,
  dealId: string | null,
  workspaceId: string
): ConversationArcEntry[] {
  if (!dealId || allConversations.length === 0) {
    return [];
  }

  return allConversations.map(c => {
    const healthBefore = c.deal_health_before;
    const healthAfter = c.deal_health_after;
    const healthDelta = healthBefore !== null && healthAfter !== null
      ? Math.round((healthAfter - healthBefore) * 10) / 10
      : null;

    const resolvedParticipants = c.resolved_participants || [];
    const externalCount = resolvedParticipants.filter(
      (p: ResolvedParticipant) => p.role === 'external' && p.confidence >= 0.7
    ).length;

    const summaryOneLiner = c.summary
      ? c.summary.split('.')[0] + (c.summary.includes('.') ? '.' : '')
      : null;

    return {
      id: c.id,
      title: c.title || 'Untitled conversation',
      call_date: c.call_date,
      duration_seconds: c.duration_seconds || 0,
      health_delta: healthDelta,
      is_current: c.id === currentConversationId,
      participant_count_external: externalCount,
      summary_one_liner: summaryOneLiner,
    };
  });
}

// generateCoachingSignals moved to coaching-signals module (pattern-based discovery)

/**
 * Load active skill findings for this deal
 */
async function loadSkillFindings(
  dealId: string | null,
  workspaceId: string,
  client: PoolClient
): Promise<ConversationDossier['skill_findings']> {
  if (!dealId) return [];

  const result = await client.query(
    `SELECT skill_id, severity, message, found_at
     FROM findings
     WHERE workspace_id = $1
       AND deal_id = $2
       AND resolved_at IS NULL
     ORDER BY found_at DESC
     LIMIT 10`,
    [workspaceId, dealId]
  );

  return result.rows;
}

/**
 * Identify contacts absent from this call
 */
function identifyAbsentContacts(
  allContacts: any[],
  resolvedParticipants: ResolvedParticipant[],
  allConversations: any[]
): ConversationDossier['contacts_absent'] {
  const participantEmails = new Set(
    resolvedParticipants
      .filter(p => p.email && p.role === 'external')
      .map(p => p.email!.toLowerCase())
  );

  const absent = allContacts
    .filter(contact => {
      const email = contact.email?.toLowerCase();
      return email && !participantEmails.has(email);
    })
    .map(contact => {
      // Find last conversation this contact was on
      let lastConvDate: string | null = null;
      for (const conv of allConversations) {
        const participants = conv.resolved_participants || [];
        const wasOnCall = participants.some(
          (p: ResolvedParticipant) => p.email?.toLowerCase() === contact.email?.toLowerCase()
        );
        if (wasOnCall) {
          lastConvDate = conv.call_date;
        }
      }

      return {
        name: contact.name,
        title: contact.title || '',
        email: contact.email,
        last_conversation_date: lastConvDate,
        buying_role: contact.buying_role,
      };
    });

  return absent;
}

/**
 * Helper: Compute days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
