/**
 * Stage Progression Compute — v1
 *
 * Discovers what buyer behaviors distinguish deals that PROGRESSED through
 * a stage from deals that STALLED in it.
 *
 * Unit of analysis: stage transition (progressor vs. staller), not deal outcome.
 * A progressor: had a call in stage X and moved forward within 2× the won median.
 * A staller: had a call in stage X and did not advance within that window.
 */

import { query } from '../../db.js';
import { callLLM } from '../../utils/llm-router.js';
import {
  getStageTranscriptCoverage,
  getWonStageMedianDays,
} from '../../analysis/stage-history-queries.js';

// ============================================================================
// Types
// ============================================================================

export interface StageSignal {
  id: string;
  title: string;
  description: string;
  evidence: string[];
  absentInStallers: string;
  type: 'progression' | 'warning';
  progressorPct: number;
  stallerPct: number;
  progressionLift: number;
  insufficientData: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export interface StageProgressionResult {
  stageName: string;
  stageNormalized: string;
  stageOrder: number;
  wonMedianDays: number;
  stallThresholdDays: number;
  progressorCount: number;
  stallerCount: number;
  transcriptCoveragePct: number;
  signalGapMultiplier: number;
  progressionSignals: StageSignal[];
  warningSignals: StageSignal[];
  insufficientSignal: boolean;
  coverageTooLow: boolean;
}

export interface StageProgressionMatrix {
  pipelineId: string | null;
  pipelineName: string;
  stages: StageProgressionResult[];
  summary: string;
  meta: {
    totalStages: number;
    usableStages: number;
    totalProgressors: number;
    totalStallers: number;
    analysisPeriodDays: number;
    generatedAt: string;
  };
}

interface DealInStage {
  dealId: string;
  dealName: string;
  classification: 'progressor' | 'staller';
  enteredAt: Date;
  daysInStage: number;
  transcriptExcerpt: string;
}

interface StagePool {
  progressors: DealInStage[];
  stallers: DealInStage[];
}

// ============================================================================
// Helpers
// ============================================================================

function extractCustomerExcerpt(transcript: string, maxChars = 300): string {
  if (!transcript) return '';
  const lines = transcript.split('\n');
  const customerLines: string[] = [];
  const customerPrefixes = /^(customer|buyer|client|prospect|contact|interviewer|them|their|he|she|they)[\s:]/i;
  const repPrefixes = /^(rep|sales|account exec|ae|csm|demo|host|presenter|me|my)[\s:]/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (customerPrefixes.test(trimmed) || (!repPrefixes.test(trimmed) && customerLines.length < 5)) {
      customerLines.push(trimmed);
    }
    if (customerLines.join(' ').length >= maxChars) break;
  }

  const combined = customerLines.join(' ').slice(0, maxChars);
  return combined.length > 50 ? combined : transcript.slice(0, maxChars);
}

// ============================================================================
// Stage pool: classify progressors vs. stallers and fetch their transcripts
// ============================================================================

async function buildStagePool(
  workspaceId: string,
  stageNormalized: string,
  stageName: string,
  stallThresholdDays: number,
  pipeline: string | null
): Promise<StagePool> {
  const params: (string | number)[] = [workspaceId, stageNormalized, stageName];
  if (pipeline) params.push(pipeline);
  const pipelineClause = pipeline ? `AND d.pipeline = $${params.length}` : '';

  const thresholdParam = params.length + 1;
  params.push(stallThresholdDays);

  const poolQuery = `
    WITH stage_transitions AS (
      SELECT
        dsh.deal_id,
        d.name AS deal_name,
        dsh.changed_at AS entered_at,
        LEAD(dsh.changed_at) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.changed_at) AS exited_at,
        dsh.to_stage AS current_stage,
        LEAD(dsh.to_stage) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.changed_at) AS next_stage,
        LEAD(COALESCE(dsh.to_stage_normalized, dsh.to_stage)) OVER (
          PARTITION BY dsh.deal_id ORDER BY dsh.changed_at
        ) AS next_stage_normalized
      FROM deal_stage_history dsh
      JOIN deals d ON d.id = dsh.deal_id
      WHERE dsh.workspace_id = $1
        AND COALESCE(dsh.to_stage_normalized, dsh.to_stage) = $2
        ${pipelineClause}
    ),
    stage_entries AS (
      SELECT
        st.deal_id,
        st.deal_name,
        st.entered_at,
        st.exited_at,
        st.next_stage,
        st.next_stage_normalized,
        COALESCE(sc_next.display_order, 999) - COALESCE(sc_curr.display_order, 998) AS order_delta,
        EXTRACT(DAY FROM COALESCE(st.exited_at, NOW()) - st.entered_at)::int AS days_in_stage
      FROM stage_transitions st
      LEFT JOIN stage_configs sc_curr
        ON sc_curr.workspace_id = $1
        AND sc_curr.stage_name = $3
      LEFT JOIN stage_configs sc_next
        ON sc_next.workspace_id = $1
        AND sc_next.stage_name = st.next_stage
    ),
    classified AS (
      SELECT
        se.deal_id,
        se.deal_name,
        se.entered_at,
        se.exited_at,
        se.days_in_stage,
        CASE
          WHEN se.next_stage IS NOT NULL
            AND se.next_stage_normalized NOT IN ('closed_lost')
            AND se.next_stage NOT ILIKE '%lost%'
            AND se.order_delta > 0
            AND se.exited_at IS NOT NULL
            AND EXTRACT(DAY FROM se.exited_at - se.entered_at) <= $${thresholdParam}
          THEN 'progressor'
          ELSE 'staller'
        END AS classification
      FROM stage_entries se
    ),
    with_convos AS (
      SELECT
        cl.deal_id,
        cl.deal_name,
        cl.entered_at,
        cl.exited_at,
        cl.days_in_stage,
        cl.classification,
        c.transcript_text,
        c.duration_seconds,
        ROW_NUMBER() OVER (
          PARTITION BY cl.deal_id
          ORDER BY COALESCE(c.duration_seconds, 0) DESC
        ) AS rn
      FROM classified cl
      JOIN conversations c
        ON c.deal_id = cl.deal_id
        AND c.call_date >= cl.entered_at
        AND (cl.exited_at IS NULL OR c.call_date < cl.exited_at)
        AND (c.is_internal = false OR c.is_internal IS NULL)
        AND c.deal_id IS NOT NULL
        AND c.transcript_text IS NOT NULL
        AND LENGTH(c.transcript_text) > 100
    )
    SELECT deal_id, deal_name, entered_at, days_in_stage, classification, transcript_text
    FROM with_convos
    WHERE rn = 1
    ORDER BY entered_at DESC
  `;

  const result = await query<{
    deal_id: string;
    deal_name: string;
    entered_at: string;
    days_in_stage: string;
    classification: string;
    transcript_text: string;
  }>(poolQuery, params);

  const progressors: DealInStage[] = [];
  const stallers: DealInStage[] = [];

  for (const row of result.rows) {
    const entry: DealInStage = {
      dealId: row.deal_id,
      dealName: row.deal_name ?? 'Unnamed Deal',
      classification: row.classification === 'progressor' ? 'progressor' : 'staller',
      enteredAt: new Date(row.entered_at),
      daysInStage: parseInt(row.days_in_stage, 10) || 0,
      transcriptExcerpt: extractCustomerExcerpt(row.transcript_text, 300),
    };
    if (entry.classification === 'progressor') {
      progressors.push(entry);
    } else {
      stallers.push(entry);
    }
  }

  return {
    progressors: progressors.slice(0, 20),
    stallers,
  };
}

// ============================================================================
// Signal gap multiplier: won median vs. lost median time in stage
// ============================================================================

async function getSignalGapMultiplier(
  workspaceId: string,
  stageNormalized: string,
  stageName: string,
  pipeline: string | null
): Promise<number> {
  const params: string[] = [workspaceId];
  const stageParam = 2;
  params.push(stageNormalized);
  const pipelineClause = pipeline ? `AND d.pipeline = $${params.length + 1}` : '';
  if (pipeline) params.push(pipeline);

  const result = await query<{
    won_median_ms: string | null;
    lost_median_ms: string | null;
  }>(`
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY CASE WHEN d.stage_normalized = 'closed_won'
          THEN dsh.duration_in_previous_stage_ms END
      ) AS won_median_ms,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY CASE WHEN d.stage_normalized = 'closed_lost'
          THEN dsh.duration_in_previous_stage_ms END
      ) AS lost_median_ms
    FROM deal_stage_history dsh
    JOIN deals d ON d.id = dsh.deal_id
    WHERE dsh.workspace_id = $1
      AND COALESCE(dsh.to_stage_normalized, dsh.to_stage) = $${stageParam}
      AND dsh.duration_in_previous_stage_ms IS NOT NULL
      AND dsh.duration_in_previous_stage_ms > 0
      ${pipelineClause}
  `, params);

  const row = result.rows[0];
  if (!row || !row.won_median_ms || !row.lost_median_ms) return 1.0;

  const wonMs  = parseFloat(row.won_median_ms);
  const lostMs = parseFloat(row.lost_median_ms);
  if (!wonMs || wonMs <= 0) return 1.0;

  const raw = lostMs / wonMs;
  return Math.min(50, Math.max(1, parseFloat(raw.toFixed(1))));
}

// ============================================================================
// DeepSeek discovery: identify signals from progressor vs. staller excerpts
// ============================================================================

interface DiscoveredRawSignal {
  id: string;
  title: string;
  description: string;
  evidence: string[];
  absent_in_stallers: string;
  confidence: 'high' | 'medium' | 'low';
}

async function discoverStageSignals(
  workspaceId: string,
  pool: StagePool,
  stageName: string,
  pipelineName: string,
  wonMedianDays: number,
  stallThresholdDays: number
): Promise<{ progressionSignals: DiscoveredRawSignal[]; warningSignals: DiscoveredRawSignal[] }> {
  const progressorBlock = pool.progressors.map((d, i) =>
    `Deal ${i + 1}: ${d.transcriptExcerpt}`
  ).join('\n\n');

  const stallerBlock = pool.stallers.slice(0, 20).map((d, i) =>
    `Deal ${i + 1}: ${d.transcriptExcerpt}`
  ).join('\n\n');

  const prompt = `You are analyzing sales call transcripts to discover what buyer behaviors distinguish deals that PROGRESSED through ${stageName} from deals that STALLED in ${stageName}.

Pipeline: ${pipelineName}
Stage: ${stageName}
Median days to progress (won deals): ${wonMedianDays} days
Stall threshold: ${stallThresholdDays} days

PROGRESSOR transcripts (${pool.progressors.length} deals that advanced):
${progressorBlock}

STALLER transcripts (${pool.stallers.slice(0, 20).length} deals that did not advance):
${stallerBlock}

YOUR TASK:
Identify 2–4 buyer behaviors that appear notably more often in PROGRESSOR transcripts than STALLER transcripts.

These should be:
- Specific things the buyer said or did (not rep behaviors)
- Observable in a transcript (not inferred from outcome)
- Contrastive — clearly more present in progressors than stallers

For each behavior, return:
{
  "id": "snake_case_id",
  "title": "Short buyer-centric label (3–6 words)",
  "description": "One sentence. What specifically did the buyer say or do?",
  "evidence": ["1–2 phrases from the progressor transcripts above"],
  "absent_in_stallers": "One sentence describing what stallers did instead, or what was missing",
  "confidence": "high | medium | low"
}

Also identify 1–2 WARNING behaviors — things that appear in STALLER transcripts but not progressors:
{
  "id": "snake_case_id",
  "title": "Short buyer-centric label",
  "description": "One sentence. What did stalling buyers say or do?",
  "evidence": ["1–2 phrases from staller transcripts"],
  "absent_in_stallers": "",
  "confidence": "high | medium | low"
}

Return JSON only: { "progression_signals": [...], "warning_signals": [...] }
No preamble. No explanation. JSON only.`;

  const response = await callLLM(workspaceId, 'extract', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
    temperature: 0.2,
  });

  try {
    const text = typeof response === 'string' ? response : (response as any)?.content?.[0]?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { progressionSignals: [], warningSignals: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      progressionSignals: (parsed.progression_signals ?? []) as DiscoveredRawSignal[],
      warningSignals: (parsed.warning_signals ?? []) as DiscoveredRawSignal[],
    };
  } catch {
    return { progressionSignals: [], warningSignals: [] };
  }
}

// ============================================================================
// Lift scoring: score each signal against the full pool
// ============================================================================

async function scoreSignalsForStage(
  workspaceId: string,
  signals: DiscoveredRawSignal[],
  warningRaw: DiscoveredRawSignal[],
  pool: StagePool,
  stageName: string
): Promise<{ progressionSignals: StageSignal[]; warningSignals: StageSignal[] }> {
  const allDeals = [...pool.progressors, ...pool.stallers];
  const progressorIds = new Set(pool.progressors.map(d => d.dealId));
  const stallerIds    = new Set(pool.stallers.map(d => d.dealId));

  const dealExcerpts = new Map<string, string>();
  for (const d of allDeals) {
    dealExcerpts.set(d.dealId, d.transcriptExcerpt);
  }

  const BATCH_SIZE = 10;

  async function scoreOneSignal(
    signal: DiscoveredRawSignal,
    type: 'progression' | 'warning'
  ): Promise<StageSignal> {
    const progressorMatches = new Set<string>();
    const stallerMatches    = new Set<string>();

    const dealIds = Array.from(dealExcerpts.keys());

    for (let i = 0; i < dealIds.length; i += BATCH_SIZE) {
      const batch = dealIds.slice(i, i + BATCH_SIZE);
      const dealBlock = batch
        .map(id => `deal_id: ${id}\n${dealExcerpts.get(id) ?? ''}`)
        .join('\n===\n');

      const scorePrompt = `You are checking whether a specific buyer behavior is present in sales call transcripts.

Behavior: "${signal.title}"
Description: "${signal.description}"
Evidence examples: ${signal.evidence.join('; ')}

For each deal below, return true if the behavior is clearly present, false if absent or unclear.

${dealBlock}

Return JSON only: {"results": {"<deal_id>": true/false, ...}}`;

      try {
        const resp = await callLLM(workspaceId, 'extract', {
          messages: [{ role: 'user', content: scorePrompt }],
          maxTokens: 300,
          temperature: 0.0,
        });

        const text = typeof resp === 'string' ? resp : (resp as any)?.content?.[0]?.text ?? '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;
        const parsed = JSON.parse(jsonMatch[0]);
        const results: Record<string, boolean> = parsed.results ?? {};

        for (const [dealId, present] of Object.entries(results)) {
          if (present === true) {
            if (progressorIds.has(dealId)) progressorMatches.add(dealId);
            if (stallerIds.has(dealId))    stallerMatches.add(dealId);
          }
        }
      } catch {
        continue;
      }
    }

    const pCount = pool.progressors.length;
    const sCount = pool.stallers.length;

    const progressorPct = pCount > 0 ? Math.round((progressorMatches.size / pCount) * 100) : 0;
    const stallerPct    = sCount > 0 ? Math.round((stallerMatches.size    / sCount) * 100) : 0;
    const liftDenom = stallerPct > 0 ? stallerPct : 5;
    const progressionLift = parseFloat((progressorPct / liftDenom).toFixed(1));

    return {
      id:               signal.id,
      title:            signal.title,
      description:      signal.description,
      evidence:         signal.evidence,
      absentInStallers: signal.absent_in_stallers ?? '',
      type,
      progressorPct,
      stallerPct,
      progressionLift,
      insufficientData: pCount === 0 && sCount === 0,
      confidence:       signal.confidence ?? 'medium',
    };
  }

  const validProgression = signals.filter(
    s => s.confidence !== 'low' || (s.evidence && s.evidence.length > 0)
  );
  const validWarning = warningRaw.filter(
    s => s.confidence !== 'low' || (s.evidence && s.evidence.length > 0)
  );

  const progressionScored = await Promise.all(
    validProgression.map(s => scoreOneSignal(s, 'progression'))
  );
  const warningScored = await Promise.all(
    validWarning.map(s => scoreOneSignal(s, 'warning'))
  );

  return {
    progressionSignals: progressionScored,
    warningSignals:     warningScored,
  };
}

// ============================================================================
// Main: computeStageProgression
// ============================================================================

export async function computeStageProgression(
  workspaceId: string,
  pipeline: string | null
): Promise<StageProgressionMatrix> {
  const pipelineName = pipeline ?? 'All Pipelines';

  console.log(`[StageProgression] Starting for workspace ${workspaceId}, pipeline: ${pipelineName}`);

  const coverage = await getStageTranscriptCoverage(workspaceId, pipeline ?? undefined);

  console.log(`[StageProgression] Coverage probe: ${coverage.stages.length} stages, ${coverage.usableStages} usable`);

  const wonMedianMap = await getWonStageMedianDays(workspaceId, pipeline ?? undefined);

  const stageResults: StageProgressionResult[] = [];

  for (const stage of coverage.stages) {
    const coverageTooLow = stage.transcriptCoveragePct < 0.15 || stage.dealsWithTranscripts < 5;

    if (coverageTooLow) {
      console.log(`[StageProgression] Stage "${stage.stageName}": coverage too low (${Math.round(stage.transcriptCoveragePct * 100)}%)`);
      const gapMult = await getSignalGapMultiplier(workspaceId, stage.stageNormalized, stage.stageName, pipeline);
      stageResults.push({
        stageName:             stage.stageName,
        stageNormalized:       stage.stageNormalized,
        stageOrder:            stage.stageOrder,
        wonMedianDays:         stage.wonMedianDays,
        stallThresholdDays:    stage.stallThresholdDays,
        progressorCount:       0,
        stallerCount:          0,
        transcriptCoveragePct: stage.transcriptCoveragePct,
        signalGapMultiplier:   gapMult,
        progressionSignals:    [],
        warningSignals:        [],
        insufficientSignal:    false,
        coverageTooLow:        true,
      });
      continue;
    }

    console.log(`[StageProgression] Stage "${stage.stageName}": building pool (threshold ${stage.stallThresholdDays}d)`);

    const pool = await buildStagePool(
      workspaceId,
      stage.stageNormalized,
      stage.stageName,
      stage.stallThresholdDays,
      pipeline
    );

    console.log(`[StageProgression] Stage "${stage.stageName}": ${pool.progressors.length} progressors, ${pool.stallers.length} stallers`);

    const gapMult = await getSignalGapMultiplier(workspaceId, stage.stageNormalized, stage.stageName, pipeline);

    if (pool.progressors.length === 0 || pool.stallers.length === 0) {
      stageResults.push({
        stageName:             stage.stageName,
        stageNormalized:       stage.stageNormalized,
        stageOrder:            stage.stageOrder,
        wonMedianDays:         stage.wonMedianDays,
        stallThresholdDays:    stage.stallThresholdDays,
        progressorCount:       pool.progressors.length,
        stallerCount:          pool.stallers.length,
        transcriptCoveragePct: stage.transcriptCoveragePct,
        signalGapMultiplier:   gapMult,
        progressionSignals:    [],
        warningSignals:        [],
        insufficientSignal:    true,
        coverageTooLow:        false,
      });
      continue;
    }

    console.log(`[StageProgression] Stage "${stage.stageName}": running DeepSeek discovery`);

    const { progressionSignals: rawProgression, warningSignals: rawWarning } =
      await discoverStageSignals(workspaceId, pool, stage.stageName, pipelineName, stage.wonMedianDays, stage.stallThresholdDays);

    console.log(`[StageProgression] Stage "${stage.stageName}": discovered ${rawProgression.length} progression + ${rawWarning.length} warning signals`);

    if (rawProgression.length < 2) {
      stageResults.push({
        stageName:             stage.stageName,
        stageNormalized:       stage.stageNormalized,
        stageOrder:            stage.stageOrder,
        wonMedianDays:         stage.wonMedianDays,
        stallThresholdDays:    stage.stallThresholdDays,
        progressorCount:       pool.progressors.length,
        stallerCount:          pool.stallers.length,
        transcriptCoveragePct: stage.transcriptCoveragePct,
        signalGapMultiplier:   gapMult,
        progressionSignals:    [],
        warningSignals:        [],
        insufficientSignal:    true,
        coverageTooLow:        false,
      });
      continue;
    }

    console.log(`[StageProgression] Stage "${stage.stageName}": scoring signals`);

    const { progressionSignals, warningSignals } = await scoreSignalsForStage(
      workspaceId, rawProgression, rawWarning, pool, stage.stageName
    );

    stageResults.push({
      stageName:             stage.stageName,
      stageNormalized:       stage.stageNormalized,
      stageOrder:            stage.stageOrder,
      wonMedianDays:         stage.wonMedianDays,
      stallThresholdDays:    stage.stallThresholdDays,
      progressorCount:       pool.progressors.length,
      stallerCount:          pool.stallers.length,
      transcriptCoveragePct: stage.transcriptCoveragePct,
      signalGapMultiplier:   gapMult,
      progressionSignals,
      warningSignals,
      insufficientSignal:    false,
      coverageTooLow:        false,
    });
  }

  stageResults.sort((a, b) => a.stageOrder - b.stageOrder);

  const totalProgressors = stageResults.reduce((s, r) => s + r.progressorCount, 0);
  const totalStallers    = stageResults.reduce((s, r) => s + r.stallerCount, 0);
  const usableStages     = stageResults.filter(r => !r.coverageTooLow && !r.insufficientSignal).length;

  console.log(`[StageProgression] Complete: ${usableStages}/${stageResults.length} usable stages`);

  return {
    pipelineId:   pipeline,
    pipelineName,
    stages:       stageResults,
    summary:      '',
    meta: {
      totalStages:       stageResults.length,
      usableStages,
      totalProgressors,
      totalStallers,
      analysisPeriodDays: 548,
      generatedAt:        new Date().toISOString(),
    },
  };
}
