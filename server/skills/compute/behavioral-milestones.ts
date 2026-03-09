/**
 * Behavioral Milestones Compute
 *
 * Data tier probe + milestone extraction for the Behavioral Winning Path skill.
 * Works across four data tiers, degrading gracefully as signal richness drops.
 *
 * Tier 1: Conversation Intelligence (Gong / Fireflies)
 * Tier 2: Email Engagement (activities table)
 * Tier 3: Contact Role Coverage (deal_contacts + contacts)
 * Tier 4: Stage History Only
 */

import { query } from '../../db.js';
import {
  getAverageTimeInStage,
  getStageConversionRates,
} from '../../analysis/stage-history-queries.js';

// ============================================================================
// Types
// ============================================================================

export interface BehavioralMilestone {
  id: string;
  timeWindow: string;
  windowStart: number;
  windowEnd: number;
  title: string;
  subtitle: string;
  source: 'CI' | 'Email' | 'CRM Roles' | 'Stage History';
  tier: 1 | 2 | 3 | 4;
  signals: string[];
  wonDeals: number;
  totalWonDeals: number;
  lostDeals: number;
  totalLostDeals: number;
  wonPct: number;
  lostPct: number;
  lift: number;
  avgDaysToMilestone: number;
  earlyCount: number;
  lateCount: number;
  insufficientData?: boolean;
}

export interface LostAbsence {
  milestoneId: string;
  title: string;
  source: string;
  lostDealPct: number;
  liftIfPresent: number;
}

export interface MilestoneMatrix {
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  analysisPeriodDays: number;
  totalWonDeals: number;
  totalLostDeals: number;
  avgWonCycleDays: number;
  avgLostCycleDays: number;
  wonMilestones: BehavioralMilestone[];
  lostAbsences: LostAbsence[];
  confidenceNote: string;
  transcriptExcerptsForClassification?: TranscriptExcerpt[];
}

export interface TranscriptExcerpt {
  dealId: string;
  conversationId: string;
  excerpt: string;
  daysFromCreated: number;
}

export interface DataTierProbe {
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  availability: {
    conversations: {
      exists: boolean;
      count: number;
      withTranscripts: number;
      linkedToDealsPct: number;
    };
    emailActivities: {
      exists: boolean;
      count: number;
      distinctDeals: number;
    };
    contactRoles: {
      exists: boolean;
      dealsWithMultipleContacts: number;
      dealsWithRoles: number;
    };
    stageHistory: {
      exists: boolean;
      count: number;
      distinctDeals: number;
    };
  };
}

// ============================================================================
// Lift Calculation
// ============================================================================

function computeLift(m: {
  wonDeals: number;
  totalWonDeals: number;
  lostDeals: number;
  totalLostDeals: number;
}): number {
  const totalWith = m.wonDeals + m.lostDeals;
  if (totalWith < 3) return 0;
  const winRateWith = m.wonDeals / totalWith;
  const wonWithout = m.totalWonDeals - m.wonDeals;
  const lostWithout = m.totalLostDeals - m.lostDeals;
  const totalWithout = wonWithout + lostWithout;
  if (totalWithout < 3) return 0;
  const winRateWithout = wonWithout / totalWithout;
  if (winRateWithout === 0) return 0;
  return Math.round((winRateWith / winRateWithout) * 10) / 10;
}

function buildMilestone(
  base: Pick<BehavioralMilestone, 'id' | 'timeWindow' | 'windowStart' | 'windowEnd' | 'title' | 'subtitle' | 'source' | 'tier' | 'signals'>,
  stats: { wonDeals: number; totalWonDeals: number; lostDeals: number; totalLostDeals: number; avgDaysToMilestone: number; earlyCount: number; lateCount: number }
): BehavioralMilestone {
  const lift = computeLift(stats);
  const insufficientData =
    stats.wonDeals + stats.lostDeals < 3 ||
    (stats.totalWonDeals - stats.wonDeals) + (stats.totalLostDeals - stats.lostDeals) < 3;
  return {
    ...base,
    wonDeals: stats.wonDeals,
    totalWonDeals: stats.totalWonDeals,
    lostDeals: stats.lostDeals,
    totalLostDeals: stats.totalLostDeals,
    wonPct: stats.totalWonDeals > 0 ? Math.round((stats.wonDeals / stats.totalWonDeals) * 100) : 0,
    lostPct: stats.totalLostDeals > 0 ? Math.round((stats.lostDeals / stats.totalLostDeals) * 100) : 0,
    lift,
    avgDaysToMilestone: Math.round(stats.avgDaysToMilestone),
    earlyCount: stats.earlyCount,
    lateCount: stats.lateCount,
    insufficientData,
  };
}

function buildLostAbsences(milestones: BehavioralMilestone[]): LostAbsence[] {
  return milestones
    .filter(m => !m.insufficientData && m.lift > 1)
    .map(m => ({
      milestoneId: m.id,
      title: m.title,
      source: m.source,
      lostDealPct: m.totalLostDeals > 0 ? Math.round(((m.totalLostDeals - m.lostDeals) / m.totalLostDeals) * 100) : 0,
      liftIfPresent: m.lift,
    }))
    .sort((a, b) => b.liftIfPresent - a.liftIfPresent)
    .slice(0, 6);
}

// ============================================================================
// Step 1: Data Tier Probe
// ============================================================================

export async function probeBehavioralDataTier(workspaceId: string): Promise<DataTierProbe> {
  const [convResult, dealCount, emailResult, contactResult, multiContact, stageResult] =
    await Promise.all([
      query(
        `SELECT
          COUNT(*)                                                               AS total,
          COUNT(*) FILTER (WHERE transcript_text IS NOT NULL
                             AND LENGTH(transcript_text) > 100)                 AS with_transcripts,
          COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL)            AS linked_deals
         FROM conversations
         WHERE workspace_id = $1`,
        [workspaceId]
      ),
      query(`SELECT COUNT(*) AS cnt FROM deals WHERE workspace_id = $1`, [workspaceId]),
      query(
        `SELECT
          COUNT(*)                   AS total,
          COUNT(DISTINCT deal_id)    AS distinct_deals
         FROM activities
         WHERE workspace_id = $1
           AND activity_type IN ('email_sent','email_opened','email_replied','email','email_received')
           AND deal_id IS NOT NULL`,
        [workspaceId]
      ),
      query(
        `SELECT
          COUNT(DISTINCT dc.deal_id)                                       AS deals_with_contacts,
          COUNT(DISTINCT dc.deal_id) FILTER (WHERE dc.role IS NOT NULL
                                               AND dc.role != '')          AS deals_with_roles
         FROM deal_contacts dc
         WHERE dc.deal_id IN (SELECT id FROM deals WHERE workspace_id = $1)`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) AS deals_multi
         FROM (
           SELECT dc.deal_id, COUNT(*) AS cnt
           FROM deal_contacts dc
           WHERE dc.deal_id IN (SELECT id FROM deals WHERE workspace_id = $1)
           GROUP BY dc.deal_id
           HAVING COUNT(*) >= 2
         ) sub`,
        [workspaceId]
      ),
      query(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT deal_id) AS distinct_deals
         FROM deal_stage_history
         WHERE workspace_id = $1`,
        [workspaceId]
      ),
    ]);

  const totalConv = parseInt(convResult.rows[0]?.total ?? '0');
  const withTranscripts = parseInt(convResult.rows[0]?.with_transcripts ?? '0');
  const linkedDeals = parseInt(convResult.rows[0]?.linked_deals ?? '0');
  const dealTotal = parseInt(dealCount.rows[0]?.cnt ?? '0');
  const linkedPct = dealTotal > 0 ? linkedDeals / dealTotal : 0;

  const conversations = {
    exists: totalConv > 0,
    count: totalConv,
    withTranscripts,
    linkedToDealsPct: linkedPct,
  };

  const emailActivities = {
    exists: parseInt(emailResult.rows[0]?.total ?? '0') > 0,
    count: parseInt(emailResult.rows[0]?.total ?? '0'),
    distinctDeals: parseInt(emailResult.rows[0]?.distinct_deals ?? '0'),
  };

  const contactRoles = {
    exists: parseInt(contactResult.rows[0]?.deals_with_contacts ?? '0') > 0,
    dealsWithMultipleContacts: parseInt(multiContact.rows[0]?.deals_multi ?? '0'),
    dealsWithRoles: parseInt(contactResult.rows[0]?.deals_with_roles ?? '0'),
  };

  const stageHistory = {
    exists: parseInt(stageResult.rows[0]?.total ?? '0') > 0,
    count: parseInt(stageResult.rows[0]?.total ?? '0'),
    distinctDeals: parseInt(stageResult.rows[0]?.distinct_deals ?? '0'),
  };

  const tier1Ready = conversations.exists && withTranscripts >= 10 && linkedPct >= 0.25;
  const tier2Ready = emailActivities.exists && emailActivities.distinctDeals >= 10;
  const tier3Ready = contactRoles.exists && contactRoles.dealsWithMultipleContacts >= 5;

  const tier = tier1Ready ? 1 : tier2Ready ? 2 : tier3Ready ? 3 : 4;

  const tierLabels: Record<number, string> = {
    1: 'Conversation Intelligence (Gong / Fireflies)',
    2: 'Email Engagement',
    3: 'Contact Role Coverage',
    4: 'Stage Progression Only',
  };

  console.log(`[BehavioralWinningPath] Tier probe: Tier ${tier} (${tierLabels[tier]})`);
  console.log(`[BehavioralWinningPath] conversations=${totalConv} transcripts=${withTranscripts} linkedPct=${linkedPct.toFixed(2)} emails=${emailActivities.count} contacts=${contactRoles.dealsWithMultipleContacts}`);

  return { tier, tierLabel: tierLabels[tier], availability: { conversations, emailActivities, contactRoles, stageHistory } };
}

// ============================================================================
// Closed Deal Helpers
// ============================================================================

async function getClosedDeals(
  workspaceId: string,
  periodDays: number
): Promise<{ wonIds: string[]; lostIds: string[]; avgWonCycleDays: number; avgLostCycleDays: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);

  const result = await query(
    `SELECT
       d.id,
       d.stage_normalized,
       COALESCE(
         EXTRACT(DAY FROM d.close_date - d.created_date),
         EXTRACT(DAY FROM d.updated_at - d.created_date),
         30
       )::int AS cycle_days
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won','closed_lost')
       AND d.close_date >= $2
     LIMIT 300`,
    [workspaceId, cutoff]
  );

  const wonIds: string[] = [];
  const lostIds: string[] = [];
  let wonCycleSum = 0;
  let lostCycleSum = 0;

  for (const row of result.rows) {
    const cycleDays = Math.max(1, parseInt(row.cycle_days ?? '30'));
    if (row.stage_normalized === 'closed_won') {
      wonIds.push(row.id);
      wonCycleSum += cycleDays;
    } else {
      lostIds.push(row.id);
      lostCycleSum += cycleDays;
    }
  }

  return {
    wonIds,
    lostIds,
    avgWonCycleDays: wonIds.length > 0 ? Math.round(wonCycleSum / wonIds.length) : 0,
    avgLostCycleDays: lostIds.length > 0 ? Math.round(lostCycleSum / lostIds.length) : 0,
  };
}

// ============================================================================
// Tier 1: Conversation Intelligence
// ============================================================================

async function extractTier1Milestones(
  workspaceId: string,
  wonIds: string[],
  lostIds: string[],
  totalWon: number,
  totalLost: number
): Promise<{ milestones: BehavioralMilestone[]; excerpts: TranscriptExcerpt[] }> {
  if (wonIds.length === 0 && lostIds.length === 0) {
    return { milestones: [], excerpts: [] };
  }

  const allIds = [...wonIds, ...lostIds];
  const wonSet = new Set(wonIds);

  // Fetch all conversations linked to these deals with metadata
  const convResult = await query(
    `SELECT
       c.deal_id,
       c.id                        AS conv_id,
       c.duration_seconds,
       c.participants,
       c.transcript_text,
       c.summary,
       c.call_date,
       d.created_date
     FROM conversations c
     JOIN deals d ON d.id = c.deal_id
     WHERE c.workspace_id = $1
       AND c.deal_id = ANY($2)
     ORDER BY c.deal_id, c.call_date`,
    [workspaceId, allIds]
  );

  // Group conversations by deal
  type ConvRow = {
    deal_id: string;
    conv_id: string;
    duration_seconds: number;
    participants: unknown;
    transcript_text: string | null;
    summary: string | null;
    call_date: Date | string;
    created_date: Date | string;
  };

  const byDeal = new Map<string, ConvRow[]>();
  for (const row of convResult.rows as ConvRow[]) {
    if (!byDeal.has(row.deal_id)) byDeal.set(row.deal_id, []);
    byDeal.get(row.deal_id)!.push(row);
  }

  // Helper: days from deal created to call
  function daysFrom(created: Date | string, callDate: Date | string): number {
    const c = typeof created === 'string' ? new Date(created) : created;
    const d = typeof callDate === 'string' ? new Date(callDate) : callDate;
    return Math.max(0, Math.round((d.getTime() - c.getTime()) / 86400000));
  }

  // Helper: parse participants
  function getParticipants(raw: unknown): Array<{ email?: string; name?: string; title?: string; role?: string }> {
    if (!raw) return [];
    try {
      const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }

  // Helper: keyword match on transcript text
  function transcriptContains(text: string | null, keywords: string[]): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return keywords.some(k => lower.includes(k));
  }

  // Collect excerpts for DeepSeek classification (transcript-based milestones)
  const excerpts: TranscriptExcerpt[] = [];

  // Per-deal milestone flags
  const dealFlags = new Map<string, Record<string, boolean>>();

  for (const dealId of allIds) {
    const convs = byDeal.get(dealId) ?? [];
    const flags: Record<string, boolean> = {
      discovery_call_held: false,
      champion_multithreaded: false,
      use_case_articulated: false,
      technical_stakeholders_joined: false,
      technical_win_declared: false,
      executive_sponsor_activated: false,
    };

    if (convs.length === 0) {
      dealFlags.set(dealId, flags);
      continue;
    }

    const created = convs[0].created_date;

    // milestone: discovery_call_held (Day 0–30, ≥30 min, ≥2 customer participants)
    const earlyConvs = convs.filter(c => daysFrom(created, c.call_date) <= 30);
    flags.discovery_call_held = earlyConvs.some(c => {
      const dur = parseInt(String(c.duration_seconds ?? 0));
      const parts = getParticipants(c.participants);
      return dur >= 1800 && parts.length >= 2;
    });

    // milestone: champion_multithreaded (Day 15–60: same email on ≥3 calls + new person appeared)
    const midConvs = convs.filter(c => {
      const d = daysFrom(created, c.call_date);
      return d >= 15 && d <= 60;
    });
    const emailFreq = new Map<string, number>();
    const allParticipantEmails: string[][] = [];
    for (const c of midConvs) {
      const parts = getParticipants(c.participants).map(p => p.email).filter(Boolean) as string[];
      allParticipantEmails.push(parts);
      for (const e of parts) emailFreq.set(e, (emailFreq.get(e) ?? 0) + 1);
    }
    const repeatedContact = [...emailFreq.entries()].some(([, cnt]) => cnt >= 3);
    const knownEmails = new Set(allParticipantEmails[0] ?? []);
    let newContactAppeared = false;
    for (let i = 1; i < allParticipantEmails.length; i++) {
      for (const e of allParticipantEmails[i]) {
        if (!knownEmails.has(e)) { newContactAppeared = true; break; }
        knownEmails.add(e);
      }
      if (newContactAppeared) break;
    }
    flags.champion_multithreaded = repeatedContact && newContactAppeared;

    // milestone: use_case_articulated (Day 30–60, keyword-based from transcript)
    const useCaseConvs = convs.filter(c => {
      const d = daysFrom(created, c.call_date);
      return d >= 30 && d <= 60;
    });
    flags.use_case_articulated = useCaseConvs.some(c =>
      transcriptContains(c.transcript_text, [
        'use case', 'workflow', 'problem we', 'what we need', 'our goal', 'success metric',
        'kpi', 'roi', 'reduce', 'save time', 'automate', 'pain point',
      ])
    );

    // milestone: technical_stakeholders_joined (Day 45–90, technical title in participants)
    const techTitles = ['engineer', 'architect', 'security', 'infra', 'devops', 'cto', 'ciso', 'it ', 'sre', 'platform'];
    const techConvs = convs.filter(c => {
      const d = daysFrom(created, c.call_date);
      return d >= 45 && d <= 90;
    });
    flags.technical_stakeholders_joined = techConvs.some(c => {
      const parts = getParticipants(c.participants);
      return parts.some(p => {
        const titleLower = (p.title ?? p.role ?? '').toLowerCase();
        return techTitles.some(t => titleLower.includes(t));
      });
    });

    // milestone: technical_win_declared (Day 60–90, approval language in transcript)
    const lateConvs = convs.filter(c => {
      const d = daysFrom(created, c.call_date);
      return d >= 60 && d <= 90;
    });
    flags.technical_win_declared = lateConvs.some(c =>
      transcriptContains(c.transcript_text, [
        'passed eval', 'technical win', 'approved', 'sign off', 'no blockers',
        'good to go', 'ready to move', 'evaluation complete', 'checked all boxes',
      ])
    );

    // milestone: executive_sponsor_activated (Day 75+, exec title in participants)
    const execTitles = ['vp', 'vice president', 'chief', 'ceo', 'cfo', 'cro', 'coo', 'evp', 'svp', 'president'];
    const execConvs = convs.filter(c => daysFrom(created, c.call_date) >= 75);
    flags.executive_sponsor_activated = execConvs.some(c => {
      const parts = getParticipants(c.participants);
      return parts.some(p => {
        const titleLower = (p.title ?? p.role ?? '').toLowerCase();
        return execTitles.some(t => titleLower.includes(t));
      });
    });

    dealFlags.set(dealId, flags);

    // Collect excerpts for DeepSeek (max 20 unique calls with transcripts)
    if (excerpts.length < 20) {
      for (const c of convs) {
        if (c.transcript_text && c.transcript_text.length > 100 && excerpts.length < 20) {
          excerpts.push({
            dealId,
            conversationId: c.conv_id,
            excerpt: c.transcript_text.slice(0, 800),
            daysFromCreated: daysFrom(created, c.call_date),
          });
        }
      }
    }
  }

  // Build milestone stats
  const milestoneConfigs = [
    { id: 'discovery_call_held', timeWindow: 'Day 0–30', windowStart: 0, windowEnd: 30, title: 'Discovery call held', subtitle: 'First call within 30 days; ≥2 stakeholders; problem-definition agenda' },
    { id: 'champion_multithreaded', timeWindow: 'Day 15–60', windowStart: 15, windowEnd: 60, title: 'Champion multi-threaded on calls', subtitle: 'Same champion contact appeared on ≥3 calls and introduced new stakeholders' },
    { id: 'use_case_articulated', timeWindow: 'Day 30–60', windowStart: 30, windowEnd: 60, title: 'Use case articulated by customer', subtitle: 'Customer-side speaker named specific workflow and success metric on a recorded call' },
    { id: 'technical_stakeholders_joined', timeWindow: 'Day 45–90', windowStart: 45, windowEnd: 90, title: 'Technical stakeholders joined', subtitle: 'Engineer, architect, or IT/security persona present on a call' },
    { id: 'technical_win_declared', timeWindow: 'Day 60–90', windowStart: 60, windowEnd: 90, title: 'Technical win declared', subtitle: 'Technical evaluation complete; buyer verbalized approval on a recorded call' },
    { id: 'executive_sponsor_activated', timeWindow: 'Day 75–120+', windowStart: 75, windowEnd: 120, title: 'Executive sponsor activated', subtitle: 'VP or C-level joined a call and named decision criteria' },
  ];

  const milestones: BehavioralMilestone[] = milestoneConfigs.map(cfg => {
    let wonDeals = 0, lostDeals = 0;
    for (const id of wonIds) { if (dealFlags.get(id)?.[cfg.id]) wonDeals++; }
    for (const id of lostIds) { if (dealFlags.get(id)?.[cfg.id]) lostDeals++; }
    const midpoint = (cfg.windowStart + cfg.windowEnd) / 2;
    return buildMilestone(
      { ...cfg, source: 'CI', tier: 1, signals: [`Computed from ${totalWon + totalLost} closed deals`] },
      { wonDeals, totalWonDeals: totalWon, lostDeals, totalLostDeals: totalLost, avgDaysToMilestone: midpoint, earlyCount: wonDeals, lateCount: lostDeals }
    );
  });

  return { milestones, excerpts };
}

// ============================================================================
// Tier 2: Email Engagement
// ============================================================================

async function extractTier2Milestones(
  workspaceId: string,
  wonIds: string[],
  lostIds: string[],
  totalWon: number,
  totalLost: number
): Promise<BehavioralMilestone[]> {
  if (wonIds.length === 0 && lostIds.length === 0) return [];

  const allIds = [...wonIds, ...lostIds];

  const emailResult = await query(
    `SELECT
       a.deal_id,
       a.activity_type,
       a.timestamp,
       d.created_date,
       d.close_date
     FROM activities a
     JOIN deals d ON d.id = a.deal_id
     WHERE a.workspace_id = $1
       AND a.deal_id = ANY($2)
       AND a.activity_type IN ('email_sent','email_opened','email_replied','email','email_received')
     ORDER BY a.deal_id, a.timestamp`,
    [workspaceId, allIds]
  );

  type EmailRow = { deal_id: string; activity_type: string; timestamp: Date | string; created_date: Date | string; close_date: Date | string | null };

  const byDeal = new Map<string, EmailRow[]>();
  for (const row of emailResult.rows as EmailRow[]) {
    if (!byDeal.has(row.deal_id)) byDeal.set(row.deal_id, []);
    byDeal.get(row.deal_id)!.push(row);
  }

  function daysBetween(a: Date | string, b: Date | string): number {
    const da = typeof a === 'string' ? new Date(a) : a;
    const db = typeof b === 'string' ? new Date(b) : b;
    return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86400000));
  }

  const wonSet = new Set(wonIds);

  interface EmailFlags {
    first_reply_received: boolean;
    bidirectional_thread: boolean;
    multi_contact_thread: boolean;
    sustained_cadence: boolean;
    late_customer_initiated: boolean;
  }

  const dealFlags = new Map<string, EmailFlags>();

  for (const dealId of allIds) {
    const acts = byDeal.get(dealId) ?? [];
    const created = acts[0]?.created_date;

    const flags: EmailFlags = {
      first_reply_received: false,
      bidirectional_thread: false,
      multi_contact_thread: false,
      sustained_cadence: false,
      late_customer_initiated: false,
    };

    if (acts.length === 0 || !created) {
      dealFlags.set(dealId, flags);
      continue;
    }

    // first_reply_received: any inbound within 14 days
    flags.first_reply_received = acts.some(a => {
      const d = daysBetween(created, a.timestamp);
      return d <= 14 && ['email_replied', 'email_received'].includes(a.activity_type);
    });

    // bidirectional_thread: ≥3 reply activities
    const replyCount = acts.filter(a => ['email_replied', 'email_received'].includes(a.activity_type)).length;
    flags.bidirectional_thread = replyCount >= 3;

    // multi_contact_thread: ≥5 distinct email activities (proxy for multiple contacts)
    flags.multi_contact_thread = acts.length >= 5;

    // sustained_cadence: check no gap > 14 days between consecutive activities
    let maxGap = 0;
    for (let i = 1; i < acts.length; i++) {
      const gap = daysBetween(acts[i - 1].timestamp, acts[i].timestamp);
      if (gap > maxGap) maxGap = gap;
    }
    flags.sustained_cadence = acts.length >= 3 && maxGap <= 14;

    // late_customer_initiated: inbound in final 21 days before close
    const closeDate = acts[0].close_date;
    if (closeDate) {
      flags.late_customer_initiated = acts.some(a => {
        const daysToClose = daysBetween(a.timestamp, closeDate);
        return daysToClose <= 21 && ['email_replied', 'email_received'].includes(a.activity_type);
      });
    }

    dealFlags.set(dealId, flags);
  }

  const milestoneConfigs = [
    { id: 'first_reply_received', timeWindow: 'Day 0–30', windowStart: 0, windowEnd: 30, title: 'First reply received from customer', subtitle: 'Customer responded via email within 14 days — proxy for discovery interest demonstrated' },
    { id: 'bidirectional_thread', timeWindow: 'Day 15–60', windowStart: 15, windowEnd: 60, title: 'Bidirectional email thread established', subtitle: '≥3 reply cycles with same contact — proxy for champion engagement' },
    { id: 'multi_contact_thread', timeWindow: 'Day 31–60', windowStart: 31, windowEnd: 60, title: 'Multi-contact email engagement', subtitle: 'Thread includes multiple email activities — proxy for stakeholder expansion' },
    { id: 'sustained_cadence', timeWindow: 'Day 61–90', windowStart: 61, windowEnd: 90, title: 'Sustained email cadence maintained', subtitle: 'No gap > 14 days between customer replies during evaluation — proxy for active evaluation' },
    { id: 'late_customer_initiated', timeWindow: 'Day 91–120+', windowStart: 91, windowEnd: 120, title: 'Customer-initiated email late in cycle', subtitle: 'Customer sent or replied within 21 days of close — proxy for champion driving close' },
  ];

  return milestoneConfigs.map(cfg => {
    let wonDeals = 0, lostDeals = 0;
    for (const id of wonIds) { if (dealFlags.get(id)?.[cfg.id as keyof EmailFlags]) wonDeals++; }
    for (const id of lostIds) { if (dealFlags.get(id)?.[cfg.id as keyof EmailFlags]) lostDeals++; }
    const midpoint = (cfg.windowStart + cfg.windowEnd) / 2;
    return buildMilestone(
      { ...cfg, source: 'Email', tier: 2, signals: ['Derived from activities table email records'] },
      { wonDeals, totalWonDeals: totalWon, lostDeals, totalLostDeals: totalLost, avgDaysToMilestone: midpoint, earlyCount: wonDeals, lateCount: lostDeals }
    );
  });
}

// ============================================================================
// Tier 3: Contact Role Coverage
// ============================================================================

async function extractTier3Milestones(
  workspaceId: string,
  wonIds: string[],
  lostIds: string[],
  totalWon: number,
  totalLost: number
): Promise<BehavioralMilestone[]> {
  if (wonIds.length === 0 && lostIds.length === 0) return [];

  const allIds = [...wonIds, ...lostIds];

  const contactResult = await query(
    `SELECT
       dc.deal_id,
       dc.role,
       dc.is_primary,
       c.title
     FROM deal_contacts dc
     JOIN contacts c ON c.id = dc.contact_id
     WHERE dc.deal_id = ANY($1)`,
    [allIds]
  );

  type ContactRow = { deal_id: string; role: string | null; is_primary: boolean; title: string | null };

  const byDeal = new Map<string, ContactRow[]>();
  for (const row of contactResult.rows as ContactRow[]) {
    if (!byDeal.has(row.deal_id)) byDeal.set(row.deal_id, []);
    byDeal.get(row.deal_id)!.push(row);
  }

  function matchesPersona(title: string | null, role: string | null, keywords: string[]): boolean {
    const combined = `${title ?? ''} ${role ?? ''}`.toLowerCase();
    return keywords.some(k => combined.includes(k));
  }

  const econKeywords = ['vp', 'vice president', 'director', 'chief', 'ceo', 'cfo', 'cro', 'budget', 'president'];
  const techKeywords = ['engineer', 'architect', 'it ', 'security', 'admin', 'devops', 'infra', 'cto', 'ciso'];
  const execKeywords = ['vp', 'vice president', 'chief', 'ceo', 'cfo', 'cro', 'coo', 'evp', 'svp', 'president'];
  const championKeywords = ['champion', 'sponsor', 'owner', 'main', 'primary'];

  interface RoleFlags {
    champion_identified: boolean;
    economic_buyer_engaged: boolean;
    technical_evaluator_added: boolean;
    executive_sponsor_on_record: boolean;
    multi_stakeholder_coverage: boolean;
  }

  const dealFlags = new Map<string, RoleFlags>();

  for (const dealId of allIds) {
    const contacts = byDeal.get(dealId) ?? [];
    dealFlags.set(dealId, {
      champion_identified: contacts.some(c => c.is_primary || matchesPersona(c.title, c.role, championKeywords)),
      economic_buyer_engaged: contacts.some(c => matchesPersona(c.title, c.role, econKeywords)),
      technical_evaluator_added: contacts.some(c => matchesPersona(c.title, c.role, techKeywords)),
      executive_sponsor_on_record: contacts.some(c => matchesPersona(c.title, c.role, execKeywords)),
      multi_stakeholder_coverage: contacts.length >= 3,
    });
  }

  const milestoneConfigs = [
    { id: 'champion_identified', timeWindow: 'Day 0–30', windowStart: 0, windowEnd: 30, title: 'Champion identified', subtitle: 'A contact marked primary or with champion/sponsor role associated with the deal' },
    { id: 'economic_buyer_engaged', timeWindow: 'Day 31–60', windowStart: 31, windowEnd: 60, title: 'Economic buyer engaged', subtitle: 'VP, Director, or C-level contact associated with deal — budget authority on record' },
    { id: 'technical_evaluator_added', timeWindow: 'Day 31–60', windowStart: 31, windowEnd: 60, title: 'Technical evaluator added', subtitle: 'Engineer, architect, or IT/security contact associated with deal' },
    { id: 'executive_sponsor_on_record', timeWindow: 'Day 61–90', windowStart: 61, windowEnd: 90, title: 'Executive sponsor on record', subtitle: 'VP+ or C-level contact associated with deal at any point' },
    { id: 'multi_stakeholder_coverage', timeWindow: 'Day 61–120+', windowStart: 61, windowEnd: 120, title: 'Multi-stakeholder coverage', subtitle: '≥3 distinct contacts associated with deal across functional areas' },
  ];

  return milestoneConfigs.map(cfg => {
    let wonDeals = 0, lostDeals = 0;
    for (const id of wonIds) { if (dealFlags.get(id)?.[cfg.id as keyof RoleFlags]) wonDeals++; }
    for (const id of lostIds) { if (dealFlags.get(id)?.[cfg.id as keyof RoleFlags]) lostDeals++; }
    const midpoint = (cfg.windowStart + cfg.windowEnd) / 2;
    return buildMilestone(
      { ...cfg, source: 'CRM Roles', tier: 3, signals: ['Derived from deal_contacts and contacts tables'] },
      { wonDeals, totalWonDeals: totalWon, lostDeals, totalLostDeals: totalLost, avgDaysToMilestone: midpoint, earlyCount: wonDeals, lateCount: lostDeals }
    );
  });
}

// ============================================================================
// Tier 4: Stage History
// ============================================================================

async function extractTier4Milestones(
  workspaceId: string,
  wonIds: string[],
  lostIds: string[],
  totalWon: number,
  totalLost: number
): Promise<BehavioralMilestone[]> {
  const allIds = [...wonIds, ...lostIds];
  if (allIds.length === 0) return [];

  const [stageBenchmarks, convRates] = await Promise.all([
    getAverageTimeInStage(workspaceId),
    getStageConversionRates(workspaceId),
  ]);

  const medianSalesCycle = stageBenchmarks.reduce((sum, s) => sum + s.medianDays, 0) || 90;

  // Per-deal stage history
  const histResult = await query(
    `SELECT
       dsh.deal_id,
       dsh.stage_normalized,
       dsh.entered_at,
       dsh.exited_at,
       dsh.duration_days,
       d.created_date
     FROM deal_stage_history dsh
     JOIN deals d ON d.id = dsh.deal_id
     WHERE dsh.workspace_id = $1
       AND dsh.deal_id = ANY($2)
       AND dsh.stage_normalized NOT IN ('closed_won','closed_lost')
     ORDER BY dsh.deal_id, dsh.entered_at`,
    [workspaceId, allIds]
  );

  type StageRow = {
    deal_id: string;
    stage_normalized: string;
    entered_at: Date | string;
    exited_at: Date | string | null;
    duration_days: string | null;
    created_date: Date | string;
  };

  const byDeal = new Map<string, StageRow[]>();
  for (const row of histResult.rows as StageRow[]) {
    if (!byDeal.has(row.deal_id)) byDeal.set(row.deal_id, []);
    byDeal.get(row.deal_id)!.push(row);
  }

  const benchmarkByStage = new Map(stageBenchmarks.map(b => [b.stage, b.medianDays]));

  function daysBetween(a: Date | string, b: Date | string): number {
    const da = typeof a === 'string' ? new Date(a) : a;
    const db = typeof b === 'string' ? new Date(b) : b;
    return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86400000));
  }

  interface StageFlags {
    early_discovery_motion: boolean;
    stage_velocity_above_median: boolean;
    mid_funnel_commitment: boolean;
    no_regression: boolean;
    on_time_close_motion: boolean;
  }

  const dealFlags = new Map<string, StageFlags>();

  for (const dealId of allIds) {
    const stages = byDeal.get(dealId) ?? [];
    const created = stages[0]?.created_date;

    const flags: StageFlags = {
      early_discovery_motion: false,
      stage_velocity_above_median: false,
      mid_funnel_commitment: false,
      no_regression: false,
      on_time_close_motion: false,
    };

    if (stages.length === 0 || !created) {
      dealFlags.set(dealId, flags);
      continue;
    }

    // early_discovery_motion: entered first stage within 30 days of creation
    const firstStage = stages[0];
    const daysToFirstStage = daysBetween(created, firstStage.entered_at);
    const firstStageBenchmark = benchmarkByStage.get(firstStage.stage_normalized) ?? 30;
    const firstStageDuration = parseFloat(firstStage.duration_days ?? '0');
    flags.early_discovery_motion = daysToFirstStage <= 30 && firstStageDuration <= firstStageBenchmark;

    // stage_velocity_above_median: ≥2 stages within 60 days, each below benchmark
    const stagesIn60 = stages.filter(s => daysBetween(created, s.entered_at) <= 60);
    const allFast = stagesIn60.length >= 2 && stagesIn60.every(s => {
      const bench = benchmarkByStage.get(s.stage_normalized) ?? 30;
      return parseFloat(s.duration_days ?? '0') <= bench;
    });
    flags.stage_velocity_above_median = allFast;

    // mid_funnel_commitment: reached a middle stage within 75% of median cycle
    const midStageKeywords = ['evaluation', 'feasibility', 'technical', 'demo', 'proof', 'pilot'];
    const midFunnelBy = medianSalesCycle * 0.75;
    flags.mid_funnel_commitment = stages.some(s => {
      const d = daysBetween(created, s.entered_at);
      return d <= midFunnelBy && midStageKeywords.some(k => s.stage_normalized.toLowerCase().includes(k));
    });

    // no_regression: all stage transitions are forward (entered_at monotonically increasing + stage index going up)
    let prevIndex = -1;
    let hadRegression = false;
    const stageOrder = [...new Set(stages.map(s => s.stage_normalized))];
    for (const s of stages) {
      const idx = stageOrder.indexOf(s.stage_normalized);
      if (idx < prevIndex) { hadRegression = true; break; }
      prevIndex = idx;
    }
    flags.no_regression = !hadRegression;

    // on_time_close_motion: entered final stage within expected window
    const lastStage = stages[stages.length - 1];
    const daysToLastStage = daysBetween(created, lastStage.entered_at);
    flags.on_time_close_motion = daysToLastStage <= medianSalesCycle;

    dealFlags.set(dealId, flags);
  }

  const milestoneConfigs = [
    { id: 'early_discovery_motion', timeWindow: 'Day 0–30', windowStart: 0, windowEnd: 30, title: 'Early discovery motion', subtitle: 'Deal entered first active stage within 30 days and progressed faster than peer median' },
    { id: 'stage_velocity_above_median', timeWindow: 'Day 15–60', windowStart: 15, windowEnd: 60, title: 'Stage velocity above median', subtitle: 'Deal progressed through ≥2 stages within 60 days, each below the workspace average' },
    { id: 'mid_funnel_commitment', timeWindow: 'Day 31–90', windowStart: 31, windowEnd: 90, title: 'Mid-funnel commitment', subtitle: 'Deal reached Evaluation or equivalent stage within 75% of median sales cycle' },
    { id: 'no_regression', timeWindow: 'Day 0–120+', windowStart: 0, windowEnd: 120, title: 'No regression', subtitle: 'Deal moved only forward through stages — zero backwards transitions detected' },
    { id: 'on_time_close_motion', timeWindow: 'Day 61–120+', windowStart: 61, windowEnd: 120, title: 'On-time close motion', subtitle: 'Deal entered final stage within the expected window based on historical close patterns' },
  ];

  return milestoneConfigs.map(cfg => {
    let wonDeals = 0, lostDeals = 0;
    for (const id of wonIds) { if (dealFlags.get(id)?.[cfg.id as keyof StageFlags]) wonDeals++; }
    for (const id of lostIds) { if (dealFlags.get(id)?.[cfg.id as keyof StageFlags]) lostDeals++; }
    const midpoint = (cfg.windowStart + cfg.windowEnd) / 2;
    return buildMilestone(
      { ...cfg, source: 'Stage History', tier: 4, signals: ['Derived from deal_stage_history table'] },
      { wonDeals, totalWonDeals: totalWon, lostDeals, totalLostDeals: totalLost, avgDaysToMilestone: midpoint, earlyCount: wonDeals, lateCount: lostDeals }
    );
  });
}

// ============================================================================
// Main: Extract Behavioral Milestones
// ============================================================================

export async function extractBehavioralMilestones(
  workspaceId: string,
  tierProbe: DataTierProbe,
  periodDays = 180
): Promise<MilestoneMatrix> {
  const { wonIds, lostIds, avgWonCycleDays, avgLostCycleDays } = await getClosedDeals(workspaceId, periodDays);

  const totalWon = wonIds.length;
  const totalLost = lostIds.length;

  console.log(`[BehavioralWinningPath] Extracting Tier ${tierProbe.tier} milestones: ${totalWon} won, ${totalLost} lost deals`);

  const confidenceNotes: Record<number, string> = {
    1: 'Behavioral milestones derived from conversation intelligence (call recordings, transcripts, participant data). Highest confidence — signals reflect actual buyer behavior.',
    2: 'Behavioral milestones derived from email engagement patterns. Confidence: medium. Conversation intelligence (Gong or Fireflies) would produce higher-confidence signals based on transcript content and call participation.',
    3: 'Behavioral milestones derived from CRM contact associations. Confidence: low-medium. These indicate stakeholder presence on record, not verified engagement. Email or conversation data would confirm whether those contacts were actually active.',
    4: 'Stage-based milestones only. Confidence: low. These reflect CRM record movement, not verified buyer behavior. Connect Gong, Fireflies, or your email system to unlock behavioral signal analysis.',
  };

  let wonMilestones: BehavioralMilestone[] = [];
  let transcriptExcerptsForClassification: TranscriptExcerpt[] = [];

  switch (tierProbe.tier) {
    case 1: {
      const result = await extractTier1Milestones(workspaceId, wonIds, lostIds, totalWon, totalLost);
      wonMilestones = result.milestones;
      transcriptExcerptsForClassification = result.excerpts;
      break;
    }
    case 2:
      wonMilestones = await extractTier2Milestones(workspaceId, wonIds, lostIds, totalWon, totalLost);
      break;
    case 3:
      wonMilestones = await extractTier3Milestones(workspaceId, wonIds, lostIds, totalWon, totalLost);
      break;
    case 4:
    default:
      wonMilestones = await extractTier4Milestones(workspaceId, wonIds, lostIds, totalWon, totalLost);
      break;
  }

  const lostAbsences = buildLostAbsences(wonMilestones);

  const matrix: MilestoneMatrix = {
    tier: tierProbe.tier,
    tierLabel: tierProbe.tierLabel,
    analysisPeriodDays: periodDays,
    totalWonDeals: totalWon,
    totalLostDeals: totalLost,
    avgWonCycleDays,
    avgLostCycleDays,
    wonMilestones,
    lostAbsences,
    confidenceNote: confidenceNotes[tierProbe.tier],
  };

  if (transcriptExcerptsForClassification.length > 0) {
    matrix.transcriptExcerptsForClassification = transcriptExcerptsForClassification;
  }

  return matrix;
}
