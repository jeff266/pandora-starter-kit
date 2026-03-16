/**
 * pandora-tools-extended.ts
 *
 * Implementations for the 10 new Ask Pandora tools.
 * All functions follow the three-layer filter architecture:
 *   Layer 1: workspace_id — always $1, always from session (never from Claude)
 *   Layer 2: recency defaults with capped overrides
 *   Layer 3: Claude-controlled scope filters, validated server-side
 *
 * Tool 9 (getWorkspaceContext) is already implemented as `get_workspace_context`
 * in data-tools.ts and is not repeated here.
 */

import { query } from '../db.js';
import { getSkillRegistry } from '../skills/registry.js';

// ─── Tool 1: query_prior_deals ────────────────────────────────────────────────

export async function queryPriorDeals(workspaceId: string, params: Record<string, any>): Promise<any> {
  const accountName = String(params.account_name || '').slice(0, 200);
  if (!accountName) return { error: 'account_name is required', deals: [], totalPriorAttempts: 0, lastOutcome: null };

  const monthsBack = Math.min(Math.max(Number(params.months_back) || 24, 1), 36);
  const excludeDealId = params.exclude_deal_id || null;
  const includeWon = params.include_closed_won !== false;
  const includeLost = params.include_closed_lost !== false;

  const stageFilter = [
    includeWon ? "'closed_won'" : null,
    includeLost ? "'closed_lost'" : null,
  ].filter(Boolean).join(', ');

  if (!stageFilter) return { deals: [], accountName, totalPriorAttempts: 0, lastOutcome: null };

  const conditions: string[] = [
    `workspace_id = $1`,
    `(name ILIKE $2 OR account_name ILIKE $2)`,
    `stage_normalized IN (${stageFilter})`,
    `close_date > NOW() - ($3 || ' months')::INTERVAL`,
    `close_date IS NOT NULL`,
  ];
  const queryParams: any[] = [workspaceId, `%${accountName}%`, monthsBack.toString()];

  if (excludeDealId) {
    conditions.push(`id != $${queryParams.length + 1}`);
    queryParams.push(excludeDealId);
  }

  const rows = await query<{
    id: string; name: string; amount: string; stage_normalized: string;
    close_date: string; owner_name: string; close_reason: string | null;
  }>(
    `SELECT id, name, COALESCE(amount, 0)::text AS amount,
            stage_normalized, close_date::text,
            COALESCE(owner_name, owner_email, 'Unknown') AS owner_name,
            COALESCE(
              source_data->'properties'->>'closed_lost_reason',
              custom_fields->>'close_reason',
              custom_fields->>'closed_lost_reason'
            ) AS close_reason
     FROM deals
     WHERE ${conditions.join(' AND ')}
     ORDER BY close_date DESC
     LIMIT 10`,
    queryParams
  );

  const deals = rows.rows.map(r => ({
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    outcome: r.stage_normalized as 'closed_won' | 'closed_lost',
    closeDate: r.close_date,
    daysSinceClose: Math.floor((Date.now() - new Date(r.close_date).getTime()) / 86400000),
    ownerName: r.owner_name,
    lossReason: r.close_reason || null,
  }));

  return {
    deals,
    accountName,
    totalPriorAttempts: deals.length,
    lastOutcome: deals.length > 0 ? deals[0].outcome : null,
  };
}

// ─── Tool 2: query_rep_performance ───────────────────────────────────────────

export async function queryRepPerformance(
  workspaceId: string,
  params: Record<string, any>,
  userRole?: string,
  userEmail?: string
): Promise<any> {
  const ownerEmail = String(params.owner_email || '').toLowerCase().trim();
  if (!ownerEmail) return { error: 'owner_email is required' };

  // Layer 1 rep restriction
  if (userRole === 'rep' && userEmail && ownerEmail !== userEmail.toLowerCase()) {
    return { error: 'Reps can only view their own performance metrics.', forbidden: true };
  }

  const windowMonths = Math.min(Math.max(Number(params.window_months) || 12, 1), 24);
  const windowParams: any[] = [workspaceId, ownerEmail, windowMonths.toString()];

  const closedRows = await query<{
    stage_normalized: string; amount: string; close_date: string;
    created_at: string; owner_name: string; owner_email: string;
  }>(
    `SELECT stage_normalized, COALESCE(amount, 0)::text AS amount,
            close_date::text, created_at::text,
            COALESCE(owner_name, owner_email) AS owner_name,
            owner_email
     FROM deals
     WHERE workspace_id = $1
       AND LOWER(owner_email) = $2
       AND stage_normalized IN ('closed_won', 'closed_lost')
       AND close_date > NOW() - ($3 || ' months')::INTERVAL
       AND close_date IS NOT NULL`,
    windowParams
  );

  const wins = closedRows.rows.filter(r => r.stage_normalized === 'closed_won');
  const losses = closedRows.rows.filter(r => r.stage_normalized === 'closed_lost');
  const total = wins.length + losses.length;
  const closeRate = total > 0 ? Math.round((wins.length / total) * 1000) / 10 : 0;

  const avgCycleLength = wins.length > 0
    ? Math.round(wins.reduce((sum, r) => {
        const cycle = (new Date(r.close_date).getTime() - new Date(r.created_at).getTime()) / 86400000;
        return sum + cycle;
      }, 0) / wins.length)
    : 0;

  const avgDealSize = wins.length > 0
    ? Math.round(wins.reduce((s, r) => s + Number(r.amount), 0) / wins.length)
    : 0;

  const pipelineRows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM deals
     WHERE workspace_id = $1
       AND LOWER(owner_email) = $2
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND created_at > NOW() - INTERVAL '90 days'`,
    [workspaceId, ownerEmail]
  );

  const repName = closedRows.rows[0]?.owner_name || ownerEmail;

  return {
    repName,
    ownerEmail,
    closeRate,
    avgCycleLength,
    pipelineCreatedLast90d: Number(pipelineRows.rows[0]?.total || 0),
    pipelineTarget90d: null,
    pipelineAttainmentPct: null,
    dealsClosedWon: wins.length,
    dealsClosedLost: losses.length,
    avgDealSize,
    windowMonths,
  };
}

// ─── Tool 3: query_deal_velocity ─────────────────────────────────────────────

export async function queryDealVelocity(workspaceId: string, params: Record<string, any>): Promise<any> {
  const dealId = String(params.deal_id || '');
  if (!dealId) return { error: 'deal_id is required' };

  const dealRow = await query<{ id: string; name: string; stage: string; created_at: string }>(
    `SELECT id, name, stage, created_at::text
     FROM deals
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, dealId]
  );
  if (!dealRow.rows.length) return { error: 'Deal not found', dealId };

  const deal = dealRow.rows[0];

  const historyRows = await query<{
    stage_name: string; entered_at: string; exited_at: string | null; duration_days: number | null;
  }>(
    `SELECT stage_name,
            entered_at::text,
            exited_at::text,
            EXTRACT(EPOCH FROM COALESCE(exited_at, NOW()) - entered_at)::int / 86400 AS duration_days
     FROM deal_stage_history
     WHERE workspace_id = $1 AND deal_id = $2
     ORDER BY entered_at ASC`,
    [workspaceId, dealId]
  );

  // Compute workspace medians per stage
  const medianRows = await query<{ stage_name: string; median_days: number; sample_size: number }>(
    `SELECT
       stage_name,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_days) AS median_days,
       COUNT(*)::int AS sample_size
     FROM (
       SELECT stage_name,
              EXTRACT(EPOCH FROM (exited_at - entered_at))::int / 86400 AS duration_days
       FROM deal_stage_history dsh
       JOIN deals d ON d.id = dsh.deal_id
       WHERE dsh.workspace_id = $1
         AND dsh.exited_at IS NOT NULL
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
         AND d.close_date > NOW() - INTERVAL '18 months'
     ) sub
     WHERE duration_days > 0
     GROUP BY stage_name
     HAVING COUNT(*) >= 5`,
    [workspaceId]
  );

  const medianMap = new Map(medianRows.rows.map(r => [r.stage_name, r.median_days]));
  const hasSufficientHistory = medianRows.rows.length > 0;

  function velocityRating(days: number, median: number | undefined): 'fast' | 'normal' | 'slow' | 'stalled' | 'unknown' {
    if (!median) return 'unknown';
    const ratio = days / median;
    if (ratio < 0.5) return 'fast';
    if (ratio <= 1.5) return 'normal';
    if (ratio <= 3.0) return 'slow';
    return 'stalled';
  }

  const stageHistory = historyRows.rows.map(r => ({
    stage: r.stage_name,
    enteredAt: r.entered_at,
    exitedAt: r.exited_at || null,
    daysInStage: r.duration_days || 0,
    medianForStage: medianMap.get(r.stage_name) ?? null,
    velocityRating: velocityRating(r.duration_days || 0, medianMap.get(r.stage_name)),
  }));

  const currentStage = deal.stage;
  const currentHistory = historyRows.rows.find(r => !r.exited_at);
  const daysInCurrent = currentHistory?.duration_days || 0;
  const medianCurrent = medianMap.get(currentStage) ?? null;

  const totalDaysInPipeline = Math.floor(
    (Date.now() - new Date(deal.created_at).getTime()) / 86400000
  );

  return {
    dealId: deal.id,
    dealName: deal.name,
    currentStage,
    daysInCurrentStage: daysInCurrent,
    medianDaysInStage: medianCurrent,
    velocityRating: velocityRating(daysInCurrent, medianCurrent ?? undefined),
    stageHistory,
    totalDaysInPipeline,
    projectedCloseDate: null,
    hasSufficientHistory,
  };
}

// ─── Tool 4: query_icp_fit ────────────────────────────────────────────────────

export async function queryIcpFit(workspaceId: string, params: Record<string, any>): Promise<any> {
  const dealId = String(params.deal_id || '');
  if (!dealId) return { error: 'deal_id is required' };

  const dealRow = await query<{
    id: string; name: string; amount: string; account_name: string;
    custom_fields: any; source_data: any;
  }>(
    `SELECT id, name, COALESCE(amount, 0)::text AS amount,
            COALESCE(account_name, '') AS account_name,
            custom_fields, source_data
     FROM deals
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, dealId]
  );
  if (!dealRow.rows.length) return { error: 'Deal not found', dealId };
  const deal = dealRow.rows[0];

  // Check for ICP skill run result
  const skillRow = await query<{ result_data: any; created_at: string }>(
    `SELECT result_data, created_at::text
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id IN ('icp-discovery', 'icp-taxonomy-builder', 'lead-scoring')
       AND status = 'completed'
       AND result_data IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId]
  );

  const hasIcpProfile = skillRow.rows.length > 0;

  if (!hasIcpProfile) {
    // Graceful degradation: derive basic signals from workspace median deal size
    const medianRow = await query<{ median_amount: string }>(
      `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::text AS median_amount
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized = 'closed_won'
         AND amount > 0
         AND close_date > NOW() - INTERVAL '12 months'`,
      [workspaceId]
    );
    const median = Number(medianRow.rows[0]?.median_amount || 0);
    const dealAmount = Number(deal.amount);
    const dealAmountVsMedian = median > 0
      ? dealAmount > median * 1.2 ? 'above' : dealAmount < median * 0.8 ? 'below' : 'at'
      : 'unknown';

    return {
      dealId: deal.id,
      dealName: deal.name,
      icpScore: null,
      icpTier: 'unscored' as const,
      matchSignals: [
        {
          signal: 'Deal size vs. workspace median',
          matches: dealAmountVsMedian !== 'below',
          detail: median > 0
            ? `$${Number(deal.amount).toLocaleString()} vs. workspace median $${Math.round(median).toLocaleString()}`
            : 'Insufficient closed-won data for comparison',
        },
      ],
      dealAmountVsMedian,
      medianDealSize: median > 0 ? Math.round(median) : null,
      icpLastComputedAt: null,
      hasIcpProfile: false,
    };
  }

  // ICP profile exists — look for deal-level scoring
  const dealScore = await query<{ result_data: any }>(
    `SELECT result_data
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = 'lead-scoring'
       AND status = 'completed'
       AND result_data->'scores' IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId]
  );

  const scores = dealScore.rows[0]?.result_data?.scores || [];
  const thisScore = scores.find((s: any) => s.deal_id === dealId);
  const icpScore = thisScore?.icp_fit_score ?? null;
  const tier = icpScore !== null
    ? icpScore >= 70 ? 'A' : icpScore >= 40 ? 'B' : 'C'
    : 'unscored';

  return {
    dealId: deal.id,
    dealName: deal.name,
    icpScore,
    icpTier: tier as 'A' | 'B' | 'C' | 'unscored',
    matchSignals: [],
    dealAmountVsMedian: 'unknown' as const,
    medianDealSize: null,
    icpLastComputedAt: dealScore.rows[0] ? null : null,
    hasIcpProfile: true,
  };
}

// ─── Tool 5: query_competitor_signals ────────────────────────────────────────

export async function queryCompetitorSignals(workspaceId: string, params: Record<string, any>): Promise<any> {
  const daysBack = Math.min(Math.max(Number(params.days_back) || 180, 30), 365);
  const dealId = params.deal_id || null;
  const competitorFilter: string[] = params.competitors || [];

  // Get workspace competitor list from conversation signals
  const wsCfgRow = await query<{ config: any }>(
    `SELECT config FROM workspace_config WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );
  const configCompetitors: string[] = wsCfgRow.rows[0]?.config?.competitors || [];

  // Also pull from detected competitor signals if config list is empty
  let derivedCompetitors: string[] = [];
  if (configCompetitors.length === 0) {
    const sigRow = await query<{ signal_value: string }>(
      `SELECT DISTINCT signal_value FROM conversation_signals
       WHERE workspace_id = $1 AND signal_type = 'competitor_mention'
       ORDER BY signal_value LIMIT 20`,
      [workspaceId]
    );
    derivedCompetitors = sigRow.rows.map(r => r.signal_value);
  }
  const workspaceCompetitors = configCompetitors.length > 0 ? configCompetitors : derivedCompetitors;
  const targetCompetitors = competitorFilter.length > 0 ? competitorFilter : workspaceCompetitors;

  if (targetCompetitors.length === 0) {
    return {
      mentions: [],
      competitorsDetected: [],
      mostRecentMention: null,
      hasCompetitiveRisk: false,
      workspaceCompetitors: [],
      note: 'No competitors configured for this workspace. Add competitors in workspace settings.',
    };
  }

  // Build competitor pattern for SQL ILIKE
  const competitorPatterns = targetCompetitors.map(c => `%${c}%`);

  const conditions: string[] = [`cs.workspace_id = $1`, `cs.created_at > NOW() - ($2 || ' days')::INTERVAL`];
  const queryParams: any[] = [workspaceId, daysBack.toString()];

  if (dealId) {
    conditions.push(`cs.deal_id = $${queryParams.length + 1}`);
    queryParams.push(dealId);
  }

  // Build OR pattern for competitor matching
  const competitorConditionParts = competitorPatterns.map((_, i) => {
    queryParams.push(competitorPatterns[i]);
    return `cs.signal_text ILIKE $${queryParams.length}`;
  });
  conditions.push(`(${competitorConditionParts.join(' OR ')})`);

  const signalRows = await query<{
    signal_text: string; created_at: string; deal_id: string | null; deal_name: string | null;
    signal_type: string;
  }>(
    `SELECT cs.signal_text, cs.created_at::text, cs.deal_id,
            d.name AS deal_name, cs.signal_type
     FROM conversation_signals cs
     LEFT JOIN deals d ON d.id = cs.deal_id AND d.workspace_id = cs.workspace_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY cs.created_at DESC
     LIMIT 50`,
    queryParams
  );

  const mentions = signalRows.rows.map(r => {
    const matchedCompetitor = targetCompetitors.find(c =>
      (r.signal_text || '').toLowerCase().includes(c.toLowerCase())
    ) || 'unknown';

    const context = (r.signal_text || '').slice(0, 150);
    const sentiment = (r.signal_text || '').toLowerCase().includes('lost') ? 'lost_to'
      : (r.signal_text || '').toLowerCase().includes('replac') ? 'replacing'
      : 'evaluating';

    return {
      source: 'conversation' as const,
      competitor: matchedCompetitor,
      mentionDate: r.created_at,
      context,
      dealId: r.deal_id || '',
      dealName: r.deal_name || '',
      sentiment: sentiment as 'evaluating' | 'replacing' | 'lost_to' | 'mentioned' | 'unknown',
    };
  });

  const detected = [...new Set(mentions.map(m => m.competitor))];

  return {
    mentions,
    competitorsDetected: detected,
    mostRecentMention: mentions[0]?.mentionDate || null,
    hasCompetitiveRisk: detected.length > 0,
    workspaceCompetitors,
  };
}

// ─── Tool 6: search_deals ─────────────────────────────────────────────────────

export async function searchDeals(
  workspaceId: string,
  params: Record<string, any>,
  userRole?: string,
  userEmail?: string
): Promise<any> {
  const searchQuery = String(params.query || '').slice(0, 100).trim();
  if (searchQuery.length < 2) return { error: 'query must be at least 2 characters', deals: [], totalMatches: 0 };

  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 10);
  const includeClosedDeals = params.include_closed_deals === true;

  const conditions: string[] = [
    `workspace_id = $1`,
    `(name ILIKE $2 OR account_name ILIKE $2)`,
  ];
  const queryParams: any[] = [workspaceId, `%${searchQuery}%`];

  if (!includeClosedDeals) {
    conditions.push(`stage_normalized NOT IN ('closed_won', 'closed_lost')`);
  }

  // Layer 1: rep sees only their own deals
  if (userRole === 'rep' && userEmail) {
    conditions.push(`LOWER(owner_email) = $${queryParams.length + 1}`);
    queryParams.push(userEmail.toLowerCase());
  }

  if (params.owner_email) {
    conditions.push(`LOWER(owner_email) = $${queryParams.length + 1}`);
    queryParams.push(String(params.owner_email).toLowerCase());
  }

  if (params.min_amount) {
    conditions.push(`amount >= $${queryParams.length + 1}`);
    queryParams.push(Number(params.min_amount));
  }

  if (params.stage_filter) {
    conditions.push(`stage ILIKE $${queryParams.length + 1}`);
    queryParams.push(`%${params.stage_filter}%`);
  }

  const rows = await query<{
    id: string; name: string; amount: string; stage: string;
    owner_name: string; close_date: string | null;
    last_activity_at: string | null;
  }>(
    `SELECT id, name, COALESCE(amount, 0)::text AS amount, stage,
            COALESCE(owner_name, owner_email, 'Unknown') AS owner_name,
            close_date::text,
            last_activity_at::text
     FROM deals
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE WHEN LOWER(name) = LOWER($2) THEN 0
            WHEN LOWER(name) LIKE LOWER($2) THEN 1
            ELSE 2 END,
       amount DESC NULLS LAST
     LIMIT $${queryParams.length + 1}`,
    [...queryParams, limit]
  );

  const deals = rows.rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    stage: r.stage,
    ownerName: r.owner_name,
    closeDate: r.close_date || null,
    daysSinceActivity: r.last_activity_at
      ? Math.floor((Date.now() - new Date(r.last_activity_at).getTime()) / 86400000)
      : null,
    matchScore: Math.max(0.4, 1 - i * 0.1),
  }));

  return { deals, totalMatches: deals.length, query: searchQuery };
}

// ─── Tool 7: query_calendar_context ──────────────────────────────────────────

export async function queryCalendarContext(workspaceId: string, params: Record<string, any>): Promise<any> {
  const pastDays = Math.min(Math.max(Number(params.past_days) || 30, 0), 90);
  const futureDays = Math.min(Math.max(Number(params.future_days) || 60, 0), 90);
  const dealId = params.deal_id || null;
  const contactEmails: string[] = params.contact_emails || [];

  // Check if calendar is connected
  const calendarCheck = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM calendar_events
     WHERE workspace_id = $1
     LIMIT 1`,
    [workspaceId]
  );

  const hasCalendarData = Number(calendarCheck.rows[0]?.count || 0) > 0;

  if (!hasCalendarData) {
    return {
      events: [],
      nextMeeting: null,
      lastMeeting: null,
      hasUpcomingMeeting: false,
      contactsWithNoMeetings: [],
      calendarNotConnected: true,
    };
  }

  let dealContactEmails: string[] = [...contactEmails];

  // If deal_id provided, resolve contact emails from deal_contacts
  if (dealId) {
    const contactRows = await query<{ email: string; name: string | null }>(
      `SELECT c.email, c.name
       FROM contacts c
       JOIN deal_contacts dc ON dc.contact_id = c.id
       WHERE dc.workspace_id = $1
         AND dc.deal_id = $2
         AND c.email IS NOT NULL`,
      [workspaceId, dealId]
    );
    const emailsFromDeal = contactRows.rows.map(r => r.email.toLowerCase());
    dealContactEmails = [...new Set([...dealContactEmails, ...emailsFromDeal])];
  }

  // Build event query
  const conditions: string[] = [
    `ce.workspace_id = $1`,
    `ce.start_time >= NOW() - ($2 || ' days')::INTERVAL`,
    `ce.start_time <= NOW() + ($3 || ' days')::INTERVAL`,
    `ce.status != 'cancelled'`,
  ];
  const qParams: any[] = [workspaceId, pastDays.toString(), futureDays.toString()];

  if (dealId) {
    conditions.push(`$${qParams.length + 1}::uuid = ANY(ce.resolved_deal_ids)`);
    qParams.push(dealId);
  } else if (dealContactEmails.length > 0) {
    const emailConditions = dealContactEmails.map((_, i) => {
      qParams.push(dealContactEmails[i]);
      return `ce.attendees @> jsonb_build_array(jsonb_build_object('email', $${qParams.length}))`;
    });
    conditions.push(`(${emailConditions.join(' OR ')})`);
  }

  const eventRows = await query<{
    id: string; title: string; start_time: string; end_time: string;
    attendees: any; is_all_day: boolean;
  }>(
    `SELECT ce.id, ce.title, ce.start_time::text, ce.end_time::text,
            ce.attendees, ce.is_all_day
     FROM calendar_events ce
     WHERE ${conditions.join(' AND ')}
     ORDER BY ce.start_time ASC
     LIMIT 50`,
    qParams
  );

  const now = new Date();
  const events = eventRows.rows.map(r => {
    const start = new Date(r.start_time);
    const isUpcoming = start > now;
    const durationMs = new Date(r.end_time).getTime() - start.getTime();
    const rawAttendees: any[] = Array.isArray(r.attendees) ? r.attendees : [];
    const attendees = rawAttendees.map((a: any) => ({
      email: a.email || '',
      name: a.displayName || null,
      isContact: dealContactEmails.includes((a.email || '').toLowerCase()),
    }));
    return {
      id: r.id,
      title: r.title || '(No title)',
      startTime: r.start_time,
      durationMinutes: Math.round(durationMs / 60000),
      attendees,
      isUpcoming,
      isPast: !isUpcoming,
      source: 'google_calendar' as const,
    };
  });

  const upcoming = events.filter(e => e.isUpcoming);
  const past = events.filter(e => e.isPast);

  const nextMeeting = upcoming[0]
    ? {
        title: upcoming[0].title,
        startTime: upcoming[0].startTime,
        daysUntil: Math.ceil((new Date(upcoming[0].startTime).getTime() - now.getTime()) / 86400000),
      }
    : null;

  const lastMeeting = past[past.length - 1]
    ? {
        title: past[past.length - 1].title,
        startTime: past[past.length - 1].startTime,
        daysAgo: Math.floor((now.getTime() - new Date(past[past.length - 1].startTime).getTime()) / 86400000),
      }
    : null;

  // Find deal contacts with no calendar meetings
  const contactsWithNoMeetings: string[] = dealContactEmails.filter(email => {
    const meetingAttendees = events.flatMap(e => e.attendees.map(a => a.email.toLowerCase()));
    return !meetingAttendees.includes(email.toLowerCase());
  });

  return {
    events,
    nextMeeting,
    lastMeeting,
    hasUpcomingMeeting: upcoming.length > 0,
    contactsWithNoMeetings,
    calendarNotConnected: false,
  };
}

// ─── Tool 8: query_hypothesis_history ────────────────────────────────────────

export async function queryHypothesisHistory(workspaceId: string, params: Record<string, any>): Promise<any> {
  const metric = String(params.metric || '').trim();
  if (!metric) return { error: 'metric is required' };

  const weeksBack = Math.min(Math.max(Number(params.weeks_back) || 12, 4), 24);

  const hypRow = await query<{
    id: string; hypothesis: string; metric: string;
    current_value: number | null; alert_threshold: number;
    alert_direction: string; weekly_values: any;
    status: string;
  }>(
    `SELECT id, hypothesis, metric, current_value, alert_threshold,
            alert_direction, weekly_values, status
     FROM standing_hypotheses
     WHERE workspace_id = $1
       AND LOWER(metric) = LOWER($2)
       AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, metric]
  );

  if (!hypRow.rows.length) {
    return {
      error: `No active hypothesis found for metric: ${metric}`,
      availableMetrics: await getAvailableHypothesisMetrics(workspaceId),
    };
  }

  const hyp = hypRow.rows[0];
  const rawWeeklyValues: any[] = Array.isArray(hyp.weekly_values) ? hyp.weekly_values : [];
  const recentWeeks = rawWeeklyValues.slice(-weeksBack);

  const isBreached = hyp.current_value !== null && hyp.alert_threshold !== null
    ? hyp.alert_direction === 'below'
      ? hyp.current_value < hyp.alert_threshold
      : hyp.current_value > hyp.alert_threshold
    : false;

  const weeklyValues = recentWeeks.map((w: any) => ({
    weekOf: w.week_of || w.weekOf,
    value: Number(w.value),
    wasBreached: hyp.alert_direction === 'below'
      ? Number(w.value) < hyp.alert_threshold
      : Number(w.value) > hyp.alert_threshold,
  }));

  const weeksAboveThreshold = weeklyValues.filter(w =>
    hyp.alert_direction === 'below' ? w.value >= hyp.alert_threshold : w.value <= hyp.alert_threshold
  ).length;
  const weeksBelowThreshold = weeklyValues.filter(w =>
    hyp.alert_direction === 'below' ? w.value < hyp.alert_threshold : w.value > hyp.alert_threshold
  ).length;

  // Compute longest breach streak
  let longestBreachStreak = 0;
  let currentStreak = 0;
  for (const w of weeklyValues) {
    if (w.wasBreached) { currentStreak++; longestBreachStreak = Math.max(longestBreachStreak, currentStreak); }
    else { currentStreak = 0; }
  }

  // Compute trend
  let trend: 'improving' | 'declining' | 'stable' | 'volatile' | 'insufficient_data' = 'insufficient_data';
  let trendDescription = 'Insufficient data for trend analysis';

  if (recentWeeks.length >= 4) {
    const vals = recentWeeks.map((w: any) => Number(w.value));
    const firstHalf = vals.slice(0, Math.floor(vals.length / 2));
    const secondHalf = vals.slice(Math.floor(vals.length / 2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const delta = avgSecond - avgFirst;
    const relDelta = avgFirst !== 0 ? delta / Math.abs(avgFirst) : 0;

    if (Math.abs(relDelta) < 0.03) trend = 'stable';
    else if (hyp.alert_direction === 'below') {
      trend = delta > 0 ? 'improving' : 'declining';
    } else {
      trend = delta < 0 ? 'improving' : 'declining';
    }

    const earliest = vals[0];
    const latest = vals[vals.length - 1];
    const dirWord = trend === 'improving' ? 'improving' : trend === 'declining' ? 'declining' : 'stable';
    const format = (v: number) => v % 1 === 0 ? v.toString() : v.toFixed(1);
    trendDescription = recentWeeks[0]?.week_of
      ? `${dirWord.charAt(0).toUpperCase() + dirWord.slice(1)} from ${format(earliest)} in ${recentWeeks[0].week_of} to ${format(latest)} today`
      : `${dirWord.charAt(0).toUpperCase() + dirWord.slice(1)} over ${recentWeeks.length} weeks`;
  }

  return {
    metric: hyp.metric,
    hypothesis: hyp.hypothesis,
    currentValue: hyp.current_value,
    alertThreshold: hyp.alert_threshold,
    alertDirection: hyp.alert_direction,
    isBreached,
    weeklyValues,
    trend,
    trendDescription,
    weeksAboveThreshold,
    weeksBelowThreshold,
    longestBreachStreak,
  };
}

async function getAvailableHypothesisMetrics(workspaceId: string): Promise<string[]> {
  const rows = await query<{ metric: string }>(
    `SELECT DISTINCT metric FROM standing_hypotheses WHERE workspace_id = $1 AND status = 'active' ORDER BY metric`,
    [workspaceId]
  );
  return rows.rows.map(r => r.metric);
}

// ─── Tool 9: get_pandora_capabilities ────────────────────────────────────────

export async function getPandoraCapabilities(
  workspaceId: string,
  params: Record<string, any>,
  userRole?: string
): Promise<any> {
  const category = params.category || null;
  const isAdmin = !userRole || userRole === 'admin' || userRole === 'manager' || userRole === 'analyst';

  // Load skill registry
  const registry = getSkillRegistry();
  const allSkills = registry.getAll();

  // Load most recent skill runs for each skill
  const skillRunRows = await query<{ skill_id: string; status: string; started_at: string; run_count: string }>(
    `SELECT skill_id, status, MAX(started_at)::text AS started_at, COUNT(*)::text AS run_count
     FROM skill_runs
     WHERE workspace_id = $1
       AND status = 'completed'
     GROUP BY skill_id, status
     ORDER BY MAX(started_at) DESC`,
    [workspaceId]
  );
  const skillRunMap = new Map(skillRunRows.rows.map(r => [r.skill_id, r]));

  const skillSummaries = allSkills
    .filter(s => isAdmin || !['workspace-config-audit', 'data-quality-audit'].includes(s.id))
    .filter(s => !category || s.category === category)
    .map(s => {
      const lastRun = skillRunMap.get(s.id);
      const hasCron = !!(s.schedule?.cron);
      const cronLabel = hasCron ? formatCron(s.schedule!.cron!) : null;
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        lastRunAt: lastRun?.started_at || null,
        isScheduled: hasCron,
        schedule: cronLabel,
        relevantFor: getRelevantFor(s.id),
      };
    });

  // Load data connections
  const connectionRows = await query<{
    connector_type: string; status: string; last_synced_at: string | null;
  }>(
    `SELECT connector_type, status, last_synced_at::text
     FROM connections
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const dataConnected = connectionRows.rows.map(r => ({
    connector: r.connector_type,
    status: r.status === 'synced' ? 'connected' as const : r.status === 'error' ? 'error' as const : 'syncing' as const,
    lastSyncAt: r.last_synced_at || null,
    recordCount: null,
  }));

  // Load recent notable insights
  const insightRows = await query<{ skill_id: string; synthesis: string; started_at: string }>(
    `SELECT skill_id,
            result_data->>'synthesis' AS synthesis,
            started_at::text
     FROM skill_runs
     WHERE workspace_id = $1
       AND status = 'completed'
       AND result_data->>'synthesis' IS NOT NULL
     ORDER BY started_at DESC
     LIMIT 3`,
    [workspaceId]
  );

  const recentInsights = insightRows.rows.map(r => ({
    surface: r.skill_id,
    summary: (r.synthesis || '').slice(0, 200),
    createdAt: r.started_at,
  }));

  // Load sprint actions and hypotheses counts
  const [sprintRow, hypRow] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM actions
       WHERE workspace_id = $1 AND status = 'pending'
         AND sprint_week >= DATE_TRUNC('week', NOW())::date
         AND sprint_week < (DATE_TRUNC('week', NOW()) + INTERVAL '7 days')::date`,
      [workspaceId]
    ).catch(() => ({ rows: [{ count: '0' }] })),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM standing_hypotheses
       WHERE workspace_id = $1 AND status = 'active'`,
      [workspaceId]
    ).catch(() => ({ rows: [{ count: '0' }] })),
  ]);

  // Dynamic quick-start suggestions
  const quickStartSuggestions = await buildQuickStartSuggestions(workspaceId, userRole);

  // Capabilities catalog
  const allCapabilities = [
    {
      category: 'Deal Analysis',
      capability: 'Detailed analysis of any deal in your pipeline',
      howToAccess: "Click 'Ask →' on any deal card, or ask me directly",
      example: 'Tell me about the Action Behavior Centers deal',
    },
    {
      category: 'Risk Assessment',
      capability: 'Bull/Bear case deliberation on whether a deal will close',
      howToAccess: 'Ask with a deal in scope',
      example: 'Will this deal close by quarter end?',
    },
    {
      category: 'Forecasting',
      capability: 'Triangulated forecast using 5 methods with accuracy weighting',
      howToAccess: 'Navigate to GTM → Forecast, or ask directly',
      example: 'Where will we land this quarter?',
    },
    {
      category: 'Sprint Planning',
      capability: 'Ranked weekly actions with expected value from Monte Carlo',
      howToAccess: 'Navigate to Actions → This Week',
      example: 'What should we focus on this week?',
    },
    {
      category: 'Hypothesis Monitoring',
      capability: 'Standing alerts when key metrics cross thresholds',
      howToAccess: 'Navigate to Actions → Hypotheses',
      example: 'Is our conversion rate still above threshold?',
    },
    {
      category: 'Pipeline Health',
      capability: 'Identify stale deals, data quality issues, stage mismatches',
      howToAccess: 'Navigate to GTM, or ask directly',
      example: 'What deals need attention this week?',
    },
    {
      category: 'Rep Performance',
      capability: 'Scorecard, pipeline pace, and activity analysis per rep',
      howToAccess: 'Ask with a rep name',
      example: 'How is the team performing this quarter?',
    },
    {
      category: 'Competitive Intelligence',
      capability: 'Competitor mentions from calls, notes, and CRM — win/loss patterns',
      howToAccess: 'Ask directly',
      example: 'What competitive dynamics are we seeing?',
    },
    {
      category: 'Skills & Automation',
      capability: '39 scheduled intelligence skills that run analysis automatically',
      howToAccess: 'Navigate to Skills, or ask about any skill by name',
      example: 'When did the Pipeline Coverage skill last run?',
    },
  ];

  const repCapabilities = allCapabilities.filter(c =>
    ['Deal Analysis', 'Risk Assessment', 'Sprint Planning', 'Rep Performance'].includes(c.category)
  );

  const capabilities = (isAdmin ? allCapabilities : repCapabilities)
    .filter(c => !category || c.category.toLowerCase().includes(category));

  return {
    skills: skillSummaries,
    dataConnected,
    capabilities,
    quickStartSuggestions,
    activeHypotheses: Number(hypRow.rows[0]?.count || 0),
    sprintActionsThisWeek: Number(sprintRow.rows[0]?.count || 0),
    recentInsights,
  };
}

function formatCron(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, month, dow] = parts;
  if (dom === '*' && month === '*') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dow === '*' ? 'daily' : `every ${dow.split(',').map(d => dayNames[Number(d)] || d).join('/')}`;
    return `${dayName} at ${hour}:${min.padStart(2, '0')} UTC`;
  }
  return cron;
}

function getRelevantFor(skillId: string): string[] {
  const map: Record<string, string[]> = {
    'pipeline-coverage': ['pipeline review', 'forecasting', 'Monday briefing'],
    'pipeline-conversion-rate': ['forecasting', 'win rate analysis', 'coverage planning'],
    'pipeline-progression': ['pipeline review', 'Q+1 planning', 'early warning'],
    'gtm-health-diagnostic': ['pipeline review', 'forecasting', 'root cause analysis'],
    'forecast-rollup': ['forecasting', 'Monday briefing', 'QBR prep'],
    'deal-risk-review': ['deal review', 'pipeline hygiene', 'coaching'],
    'rep-scorecard': ['coaching', 'performance review', 'QBR prep'],
    'weekly-recap': ['Monday briefing', 'team standup'],
    'competitive-intelligence': ['deal review', 'win/loss analysis', 'coaching'],
    'pipeline-hygiene': ['pipeline review', 'data quality', 'Monday briefing'],
  };
  return map[skillId] || [skillId.replace(/-/g, ' ')];
}

async function buildQuickStartSuggestions(workspaceId: string, userRole?: string): Promise<string[]> {
  const suggestions: string[] = [];

  try {
    const breachedHyp = await query<{ metric: string; hypothesis: string }>(
      `SELECT metric, hypothesis
       FROM standing_hypotheses
       WHERE workspace_id = $1
         AND status = 'active'
         AND current_value IS NOT NULL
         AND (
           (alert_direction = 'below' AND current_value < alert_threshold) OR
           (alert_direction = 'above' AND current_value > alert_threshold)
         )
       LIMIT 1`,
      [workspaceId]
    );
    if (breachedHyp.rows.length > 0) {
      suggestions.push(
        `Your ${breachedHyp.rows[0].metric} metric has crossed its alert threshold — ask me: "Tell me about our ${breachedHyp.rows[0].metric} trend"`
      );
    }

    const staleDeal = await query<{ name: string; days_silent: number }>(
      `SELECT name,
              EXTRACT(EPOCH FROM NOW() - last_activity_at)::int / 86400 AS days_silent
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND last_activity_at < NOW() - INTERVAL '21 days'
         AND amount > 0
       ORDER BY amount DESC
       LIMIT 1`,
      [workspaceId]
    );
    if (staleDeal.rows.length > 0) {
      suggestions.push(
        `${staleDeal.rows[0].name} has been silent for ${staleDeal.rows[0].days_silent} days — ask me: "What should we do with the ${staleDeal.rows[0].name} deal?"`
      );
    }

    const dayOfWeek = new Date().getDay();
    if (dayOfWeek === 1) {
      suggestions.push("It's Monday — ask me: \"What are my sprint priorities this week?\"");
    } else if (dayOfWeek === 5) {
      suggestions.push("It's Friday — ask me: \"How did we do this week?\"");
    }

    if (suggestions.length < 2) {
      suggestions.push('Ask me: "What deals need attention this week?"');
      suggestions.push('Ask me: "Where will we land this quarter?"');
    }
  } catch {
    suggestions.push('Ask me: "What deals need attention this week?"');
    suggestions.push('Ask me: "Where will we land this quarter?"');
    suggestions.push('Ask me: "What skills are available?"');
  }

  return suggestions.slice(0, 3);
}
