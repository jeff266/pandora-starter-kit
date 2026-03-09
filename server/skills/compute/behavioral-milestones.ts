/**
 * Behavioral Milestones Compute — v2
 *
 * Data tier probe + milestone extraction for the Behavioral Winning Path skill.
 * Works across four data tiers, degrading gracefully as signal richness drops.
 *
 * Tier 1: Conversation Intelligence (Gong / Fireflies)
 *   v2: DeepSeek discovery pass from transcript sample → scoring pass → lift computation.
 *   Milestones are discovered from data, not assumed from a predefined taxonomy.
 *   Falls back to predefined taxonomy when discovery yields < 3 valid milestones.
 *
 * Tier 2: Email Engagement (activities table) — predefined proxies
 * Tier 3: Contact Role Coverage (deal_contacts + contacts) — predefined proxies
 * Tier 4: Stage History Only — predefined proxies
 */

import { query } from '../../db.js';
import {
  getAverageTimeInStage,
  getStageConversionRates,
  getWonCyclePercentiles,
} from '../../analysis/stage-history-queries.js';
import { callLLM } from '../../utils/llm-router.js';

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
  // v2 discovery fields (Tier 1 only; absent/empty for Tiers 2–4)
  isDiscovered?: boolean;
  description?: string;
  evidence?: string[];
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
  // v2 fields
  isDiscovered?: boolean;
  discoveryNote?: string;
  wonMedianDays?: number;
  meta?: {
    totalWonDeals: number;
    totalLostDeals: number;
    wonMedianDays: number;
    lostMedianDays: number;
    transcriptsSampled: number;
    dealsScored: number;
    analysisPeriodDays: number;
    generatedAt: string;
    pipelineId: string | null;
  };
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
  base: Pick<BehavioralMilestone, 'id' | 'timeWindow' | 'windowStart' | 'windowEnd' | 'title' | 'subtitle' | 'source' | 'tier' | 'signals'>
    & { isDiscovered?: boolean; description?: string; evidence?: string[] },
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

  // Tier 1: need transcripts AND at least 20 deals with linked conversations.
  // We use an absolute count (not a percentage) because the denominator is all deals,
  // which includes open pipeline that won't yet have conversations attached — this
  // would penalise workspaces with healthy Gong coverage but a large top-of-funnel.
  const tier1Ready = conversations.exists && withTranscripts >= 10 && linkedDeals >= 20;
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
  console.log(`[BehavioralWinningPath] conversations=${totalConv} transcripts=${withTranscripts} linkedDeals=${linkedDeals} (linkedPct=${linkedPct.toFixed(2)}) emails=${emailActivities.count} contacts=${contactRoles.dealsWithMultipleContacts}`);

  return { tier, tierLabel: tierLabels[tier], availability: { conversations, emailActivities, contactRoles, stageHistory } };
}

// ============================================================================
// Closed Deal Helpers
// ============================================================================

async function getClosedDeals(
  workspaceId: string,
  periodDays: number,
  pipeline?: string
): Promise<{ wonIds: string[]; lostIds: string[]; avgWonCycleDays: number; avgLostCycleDays: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);

  const params: (string | Date)[] = [workspaceId, cutoff];
  if (pipeline) params.push(pipeline);

  const result = await query(
    `SELECT
       d.id,
       d.stage_normalized,
       COALESCE(
         EXTRACT(DAY FROM d.close_date - d.created_at),
         EXTRACT(DAY FROM d.updated_at - d.created_at),
         30
       )::int AS cycle_days
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won','closed_lost')
       AND d.close_date >= $2
       ${pipeline ? 'AND d.pipeline = $3' : ''}
     LIMIT 300`,
    params
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
// Tier 1: Conversation Intelligence — v2 Discovery-First
// ============================================================================

/**
 * Compute pipeline-relative time windows from the actual won cycle median.
 * Four windows covering the full arc: Open → Develop → Validate → Close.
 */
function computeTimeWindows(wonMedianDays: number) {
  const r5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
  const w1 = r5(wonMedianDays * 0.25);
  const w2 = r5(wonMedianDays * 0.50);
  const w3 = r5(wonMedianDays * 0.75);
  const w4 = r5(wonMedianDays * 1.00);
  return [
    { id: 'open',     label: `Day 0–${w1}`,     sublabel: 'Opening motion', start: 0,  end: w1 },
    { id: 'develop',  label: `Day ${w1}–${w2}`,  sublabel: 'Development',    start: w1, end: w2 },
    { id: 'validate', label: `Day ${w2}–${w3}`,  sublabel: 'Validation',     start: w2, end: w3 },
    { id: 'close',    label: `Day ${w3}–${w4}+`, sublabel: 'Close motion',   start: w3, end: w4 },
  ];
}

interface DiscoveredMilestoneRaw {
  id: string;
  title: string;
  description: string;
  evidence: string[];
  typical_timing: string;
  recurrence: 'high' | 'medium' | 'low';
  signals: string[];
}

/**
 * Predefined Tier 1 taxonomy — used as fallback when discovery yields < 3 valid milestones.
 */
const PREDEFINED_TIER1_TAXONOMY: Omit<DiscoveredMilestoneRaw, 'recurrence'>[] = [
  {
    id: 'discovery_call_held',
    title: 'Discovery call held',
    description: 'First substantive call within the opening quarter of the cycle; ≥2 stakeholders; problem-definition agenda.',
    evidence: [],
    typical_timing: 'early',
    signals: ['≥30 min call', '≥2 participants', 'early in cycle'],
  },
  {
    id: 'champion_multithreaded',
    title: 'Champion multi-threaded on calls',
    description: 'Same champion contact appeared on multiple calls and introduced new stakeholders.',
    evidence: [],
    typical_timing: 'mid',
    signals: ['Repeated contact on calls', 'New stakeholder introductions'],
  },
  {
    id: 'use_case_articulated',
    title: 'Use case articulated by customer',
    description: 'Customer-side speaker named a specific workflow and success metric on a recorded call.',
    evidence: [],
    typical_timing: 'mid',
    signals: ['Customer named workflow', 'Success metric discussed'],
  },
  {
    id: 'technical_stakeholders_joined',
    title: 'Technical stakeholders joined',
    description: 'Engineer, architect, or IT/security persona joined a call.',
    evidence: [],
    typical_timing: 'late',
    signals: ['Technical title in participants'],
  },
  {
    id: 'technical_win_declared',
    title: 'Technical win declared',
    description: 'Technical evaluation complete; buyer verbalized approval on a recorded call.',
    evidence: [],
    typical_timing: 'late',
    signals: ['Approval language in transcript'],
  },
  {
    id: 'executive_sponsor_activated',
    title: 'Executive sponsor activated',
    description: 'VP or C-level joined a call and named decision criteria.',
    evidence: [],
    typical_timing: 'late',
    signals: ['Executive title in participants'],
  },
];

/**
 * Parse JSON from an LLM response that may be wrapped in markdown fences.
 */
function parseJsonFromLLM<T>(content: string): T | null {
  try {
    const cleaned = content.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (match) return JSON.parse(match[1]) as T;
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/**
 * Main Tier 1 extraction function — v2 discovery-first approach.
 *
 * Pass 1: DeepSeek discovery over a sample of won transcripts → recurring behavioral themes.
 * Pass 2: DeepSeek scoring of top 5 milestones against won + lost population → lift computation.
 * Falls back to predefined taxonomy if discovery yields < 3 valid milestones.
 */
async function discoverAndScoreMilestones(
  workspaceId: string,
  wonIds: string[],
  lostIds: string[],
  totalWon: number,
  totalLost: number,
  wonMedianDays: number,
  periodDays: number,
  pipeline?: string
): Promise<{
  milestones: BehavioralMilestone[];
  transcriptsSampled: number;
  dealsScored: number;
  isDiscovered: boolean;
  discoveryNote: string;
}> {
  if (wonIds.length === 0 && lostIds.length === 0) {
    return { milestones: [], transcriptsSampled: 0, dealsScored: 0, isDiscovered: false, discoveryNote: 'No closed deals found in analysis window.' };
  }

  const timeWindows = computeTimeWindows(wonMedianDays);

  // ── Step 1: Sample transcripts from won deals ──────────────────────────────
  // Max 30 won deals, up to 2 calls each, ordered longest first per deal.

  const sampleWonIds = wonIds.slice(0, 30);

  type SampleRow = {
    deal_id: string;
    conv_id: string;
    transcript_text: string;
    summary: string | null;
    call_date: Date | string;
    created_at: Date | string;
    deal_name: string | null;
    duration_seconds: number;
  };

  const sampleResult = await query(
    `SELECT
       c.deal_id,
       c.id          AS conv_id,
       c.transcript_text,
       c.summary,
       c.call_date,
       d.created_at,
       d.name        AS deal_name,
       c.duration_seconds
     FROM conversations c
     JOIN deals d ON d.id = c.deal_id
     WHERE c.workspace_id = $1
       AND c.deal_id = ANY($2)
       AND c.transcript_text IS NOT NULL
       AND LENGTH(c.transcript_text) > 200
     ORDER BY c.deal_id, c.duration_seconds DESC`,
    [workspaceId, sampleWonIds]
  );

  // Two longest transcripts per deal
  const byDealSample = new Map<string, SampleRow[]>();
  for (const row of sampleResult.rows as SampleRow[]) {
    const list = byDealSample.get(row.deal_id) ?? [];
    if (list.length < 2) {
      list.push(row);
      byDealSample.set(row.deal_id, list);
    }
  }

  const samples: { dealId: string; dealName: string; daysFromOpen: number; excerpt: string }[] = [];
  for (const [dealId, convs] of byDealSample) {
    for (const c of convs) {
      const created = typeof c.created_at === 'string' ? new Date(c.created_at) : c.created_at;
      const callDate = typeof c.call_date === 'string' ? new Date(c.call_date) : c.call_date;
      const daysFromOpen = Math.max(0, Math.round((callDate.getTime() - created.getTime()) / 86400000));
      samples.push({
        dealId,
        dealName: c.deal_name ?? dealId.slice(0, 8),
        daysFromOpen,
        excerpt: c.transcript_text.slice(0, 1200),
      });
    }
  }

  const transcriptsSampled = samples.length;
  console.log(`[BehavioralWinningPath] Discovery: ${transcriptsSampled} transcript excerpts from ${byDealSample.size} won deals`);

  let discoveredMilestones: DiscoveredMilestoneRaw[] = [];
  let isDiscovered = false;
  let discoveryNote = '';

  if (transcriptsSampled >= 5) {
    // ── Step 2: Discovery pass via DeepSeek ─────────────────────────────────

    const excerptBlock = samples
      .map(s => `Deal: ${s.dealName} | Day ${s.daysFromOpen} of ${wonMedianDays}d median\n${s.excerpt}`)
      .join('\n---\n');

    const discoveryPrompt = `You are analyzing sales call transcripts from ${transcriptsSampled} won deals (median cycle: ${wonMedianDays} days, analysis period: ${periodDays} days${pipeline ? `, pipeline: ${pipeline}` : ''}).

Your task: identify recurring behavioral milestones that appear across multiple won deals. Focus on what the BUYER does or says, not generic sales process steps.

Transcript excerpts:
---
${excerptBlock}
---

Return a JSON array of 4–8 behavioral milestones. Each milestone must:
- Appear in at least 2 different deals
- Represent a buyer action or moment, not a seller activity
- Have specific transcript evidence

Required JSON shape (no markdown, no explanation — JSON array only):
[
  {
    "id": "snake_case_id",
    "title": "Short behavioral title (max 8 words)",
    "description": "One sentence describing the observable buyer behavior",
    "evidence": ["exact phrase from transcript 1", "exact phrase from transcript 2"],
    "typical_timing": "early|mid|late",
    "recurrence": "high|medium|low",
    "signals": ["observable signal 1", "observable signal 2"]
  }
]

Recurrence guide: high = present in >60% of excerpts shown, medium = 30–60%, low = <30%.
Only include milestones with at least 2 distinct evidence phrases. Return JSON array only.`;

    try {
      const discoveryResponse = await callLLM(workspaceId, 'extract', {
        messages: [{ role: 'user', content: discoveryPrompt }],
        maxTokens: 3000,
        temperature: 0.3,
      });

      const parsed = parseJsonFromLLM<DiscoveredMilestoneRaw[]>(discoveryResponse.content ?? '');

      if (parsed && Array.isArray(parsed)) {
        const valid = parsed.filter(m =>
          m.id && m.title && m.description &&
          Array.isArray(m.evidence) && m.evidence.length >= 2 &&
          m.recurrence !== 'low'
        );
        if (valid.length >= 3) {
          discoveredMilestones = valid;
          isDiscovered = true;
          discoveryNote = `Discovered ${valid.length} milestones from ${transcriptsSampled} transcripts across ${byDealSample.size} won deals.`;
          console.log(`[BehavioralWinningPath] Discovery succeeded: ${valid.length} valid milestones`);
        } else {
          discoveryNote = `Discovery returned ${parsed.length} milestones but only ${valid.length} passed validation (need ≥3). Using predefined taxonomy.`;
          console.log(`[BehavioralWinningPath] Discovery fallback: ${discoveryNote}`);
        }
      } else {
        discoveryNote = 'Discovery LLM response could not be parsed. Using predefined taxonomy.';
        console.log(`[BehavioralWinningPath] Discovery parse failure`);
      }
    } catch (err) {
      discoveryNote = `Discovery LLM call failed: ${err instanceof Error ? err.message : String(err)}. Using predefined taxonomy.`;
      console.error(`[BehavioralWinningPath] Discovery error:`, err);
    }
  } else {
    discoveryNote = `Only ${transcriptsSampled} transcript excerpts available (need ≥5). Using predefined taxonomy.`;
    console.log(`[BehavioralWinningPath] Insufficient transcripts for discovery`);
  }

  // Fallback to predefined taxonomy
  if (!isDiscovered) {
    discoveredMilestones = PREDEFINED_TIER1_TAXONOMY.map(m => ({ ...m, recurrence: 'medium' as const }));
  }

  // ── Step 3: Score top 5 milestones (by recurrence priority) ───────────────

  const recurrenceOrder = { high: 0, medium: 1, low: 2 };
  const top5 = [...discoveredMilestones]
    .sort((a, b) => recurrenceOrder[a.recurrence] - recurrenceOrder[b.recurrence])
    .slice(0, 5);

  // Sample up to 25 won + 25 lost for scoring
  const scoringWonIds  = wonIds.slice(0, 25);
  const scoringLostIds = lostIds.slice(0, 25);
  const scoringAllIds  = [...scoringWonIds, ...scoringLostIds];

  // Fetch transcripts for scoring pool (longest per deal)
  type ScoringRow = { deal_id: string; transcript_text: string; call_date: Date | string; created_at: Date | string };
  const scoringResult = await query(
    `SELECT DISTINCT ON (c.deal_id)
       c.deal_id,
       c.transcript_text,
       c.call_date,
       d.created_at
     FROM conversations c
     JOIN deals d ON d.id = c.deal_id
     WHERE c.workspace_id = $1
       AND c.deal_id = ANY($2)
       AND c.transcript_text IS NOT NULL
       AND LENGTH(c.transcript_text) > 200
     ORDER BY c.deal_id, c.duration_seconds DESC`,
    [workspaceId, scoringAllIds]
  );

  const scoringByDeal = new Map<string, string>();
  for (const row of scoringResult.rows as ScoringRow[]) {
    scoringByDeal.set(row.deal_id, row.transcript_text.slice(0, 900));
  }

  const dealsWithTranscripts = [...scoringByDeal.keys()];
  let dealsScored = 0;

  const milestoneFinalScores = new Map<string, { wonHits: number; lostHits: number; avgDays: number }>();

  for (const milestone of top5) {
    let wonHits = 0;
    let lostHits = 0;

    // For deals WITHOUT transcripts, use evidence keyword matching as fallback
    const wonMissingTranscript = scoringWonIds.filter(id => !scoringByDeal.has(id));
    const lostMissingTranscript = scoringLostIds.filter(id => !scoringByDeal.has(id));
    // We'll score these without LLM (no transcript = absent)
    // Only deals with transcripts go through LLM

    const wonWithTranscript  = scoringWonIds.filter(id => scoringByDeal.has(id));
    const lostWithTranscript = scoringLostIds.filter(id => scoringByDeal.has(id));
    const allWithTranscript  = [...wonWithTranscript, ...lostWithTranscript];

    if (allWithTranscript.length === 0) {
      milestoneFinalScores.set(milestone.id, { wonHits: 0, lostHits: 0, avgDays: wonMedianDays * 0.4 });
      continue;
    }

    // Batch into groups of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < allWithTranscript.length; i += BATCH_SIZE) {
      const batch = allWithTranscript.slice(i, i + BATCH_SIZE);

      const dealBlock = batch
        .map(id => `deal_id: ${id}\n${scoringByDeal.get(id) ?? ''}`)
        .join('\n===\n');

      const scoringPrompt = `Milestone: "${milestone.title}"
Definition: ${milestone.description}
Signals: ${milestone.signals.join('; ')}

For each deal excerpt below, return true if this milestone behavior is clearly present, false if absent or unclear.
Return JSON only — no explanation. Format: {"deal_id_here": true_or_false, ...}

${dealBlock}`;

      try {
        const scoreResponse = await callLLM(workspaceId, 'extract', {
          messages: [{ role: 'user', content: scoringPrompt }],
          maxTokens: 500,
          temperature: 0.1,
        });

        const scoreMap = parseJsonFromLLM<Record<string, boolean>>(scoreResponse.content ?? '');
        if (scoreMap) {
          for (const [dealId, present] of Object.entries(scoreMap)) {
            if (present === true) {
              if (scoringWonIds.includes(dealId))  wonHits++;
              if (scoringLostIds.includes(dealId)) lostHits++;
            }
          }
          dealsScored += batch.length;
        }
      } catch (err) {
        console.error(`[BehavioralWinningPath] Scoring batch error for milestone ${milestone.id}:`, err);
      }
    }

    // Compute avg timing from samples (use transcripts that contain evidence phrases)
    const lowerEvidence = milestone.evidence.map(e => e.toLowerCase());
    let timingSum = 0, timingCount = 0;
    for (const s of samples) {
      if (lowerEvidence.some(e => s.excerpt.toLowerCase().includes(e))) {
        timingSum += s.daysFromOpen;
        timingCount++;
      }
    }
    const avgDays = timingCount > 0 ? Math.round(timingSum / timingCount) : wonMedianDays * 0.4;

    milestoneFinalScores.set(milestone.id, { wonHits, lostHits, avgDays });
  }

  // ── Step 4: Build BehavioralMilestone objects ──────────────────────────────

  const milestones: BehavioralMilestone[] = top5.map(m => {
    const scores = milestoneFinalScores.get(m.id) ?? { wonHits: 0, lostHits: 0, avgDays: wonMedianDays * 0.4 };

    // Assign time window based on avgDays
    const window = timeWindows.find(w => scores.avgDays >= w.start && scores.avgDays <= w.end)
      ?? timeWindows[0];

    // For predefined fallback milestones, map typical_timing to a window
    let assignedWindow = window;
    if (!isDiscovered) {
      const timingMap: Record<string, typeof timeWindows[0]> = {
        early: timeWindows[0],
        mid:   timeWindows[1] ?? timeWindows[0],
        late:  timeWindows[2] ?? timeWindows[0],
      };
      assignedWindow = timingMap[m.typical_timing] ?? timeWindows[0];
    }

    return buildMilestone(
      {
        id:          m.id,
        title:       m.title,
        subtitle:    m.description,
        timeWindow:  assignedWindow.label,
        windowStart: assignedWindow.start,
        windowEnd:   assignedWindow.end,
        source:      'CI',
        tier:        1,
        signals:     m.signals,
        isDiscovered,
        description: m.description,
        evidence:    m.evidence,
      },
      {
        wonDeals:          scores.wonHits,
        totalWonDeals:     scoringWonIds.length > 0 ? scoringWonIds.length : totalWon,
        lostDeals:         scores.lostHits,
        totalLostDeals:    scoringLostIds.length > 0 ? scoringLostIds.length : totalLost,
        avgDaysToMilestone: scores.avgDays,
        earlyCount:        scores.wonHits,
        lateCount:         scores.lostHits,
      }
    );
  });

  return { milestones, transcriptsSampled, dealsScored, isDiscovered, discoveryNote };
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
       d.created_at,
       d.close_date
     FROM activities a
     JOIN deals d ON d.id = a.deal_id
     WHERE a.workspace_id = $1
       AND a.deal_id = ANY($2)
       AND a.activity_type IN ('email_sent','email_opened','email_replied','email','email_received')
     ORDER BY a.deal_id, a.timestamp`,
    [workspaceId, allIds]
  );

  type EmailRow = { deal_id: string; activity_type: string; timestamp: Date | string; created_at: Date | string; close_date: Date | string | null };

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
    const created = acts[0]?.created_at;

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
       d.created_at
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
    created_at: Date | string;
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
    const created = stages[0]?.created_at;

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
  periodDays = 548,
  pipeline?: string
): Promise<MilestoneMatrix> {
  const { wonIds, lostIds, avgWonCycleDays, avgLostCycleDays } = await getClosedDeals(workspaceId, periodDays, pipeline);

  const totalWon = wonIds.length;
  const totalLost = lostIds.length;

  console.log(`[BehavioralWinningPath] Extracting Tier ${tierProbe.tier} milestones: ${totalWon} won, ${totalLost} lost deals`);

  // Compute pipeline-relative won cycle median for time window computation (Tier 1)
  const percentiles = await getWonCyclePercentiles(workspaceId, pipeline);
  const wonMedianDays = percentiles?.p50 ?? avgWonCycleDays ?? 60;

  const confidenceNotes: Record<number, string> = {
    1: 'Behavioral milestones discovered from conversation intelligence (call recordings, transcripts). Highest confidence — signals reflect actual buyer behavior extracted from your transcripts.',
    2: 'Behavioral milestones derived from email engagement patterns. Confidence: medium. Conversation intelligence (Gong or Fireflies) would produce higher-confidence signals based on transcript content and call participation.',
    3: 'Behavioral milestones derived from CRM contact associations. Confidence: low-medium. These indicate stakeholder presence on record, not verified engagement. Email or conversation data would confirm whether those contacts were actually active.',
    4: 'Stage-based milestones only. Confidence: low. These reflect CRM record movement, not verified buyer behavior. Connect Gong, Fireflies, or your email system to unlock behavioral signal analysis.',
  };

  let wonMilestones: BehavioralMilestone[] = [];
  let isDiscovered = false;
  let discoveryNote = '';
  let transcriptsSampled = 0;
  let dealsScored = 0;

  switch (tierProbe.tier) {
    case 1: {
      const result = await discoverAndScoreMilestones(
        workspaceId, wonIds, lostIds, totalWon, totalLost,
        wonMedianDays, periodDays, pipeline
      );
      wonMilestones      = result.milestones;
      isDiscovered       = result.isDiscovered;
      discoveryNote      = result.discoveryNote;
      transcriptsSampled = result.transcriptsSampled;
      dealsScored        = result.dealsScored;
      break;
    }
    case 2:
      wonMilestones = await extractTier2Milestones(workspaceId, wonIds, lostIds, totalWon, totalLost);
      discoveryNote = 'Predefined email engagement proxies — no transcript data available.';
      break;
    case 3:
      wonMilestones = await extractTier3Milestones(workspaceId, wonIds, lostIds, totalWon, totalLost);
      discoveryNote = 'Predefined contact role proxies — no email or transcript data available.';
      break;
    case 4:
    default:
      wonMilestones = await extractTier4Milestones(workspaceId, wonIds, lostIds, totalWon, totalLost);
      discoveryNote = 'Stage history proxies only — no conversation, email, or contact data available.';
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
    // v2 fields
    isDiscovered,
    discoveryNote,
    wonMedianDays,
    meta: {
      totalWonDeals:      totalWon,
      totalLostDeals:     totalLost,
      wonMedianDays,
      lostMedianDays:     avgLostCycleDays,
      transcriptsSampled,
      dealsScored,
      analysisPeriodDays: periodDays,
      generatedAt:        new Date().toISOString(),
      pipelineId:         pipeline ?? null,
    },
  };

  return matrix;
}
