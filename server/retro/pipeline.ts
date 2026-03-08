/**
 * Quarterly Retrospective Intelligence — Main Pipeline
 *
 * Orchestrates three phases:
 *   Phase 0 — Evidence Harvest (SQL reads, 0 tokens)
 *   Phase 1 — Hypothesis Formation (DeepSeek, ~1.5K tokens)
 *   Phase 2 — Targeted Synthesis (Claude, 8-15K tokens, skipped when confidence >= 0.80)
 *
 * Returns a ConversationTurnResult-compatible shape for seamless orchestrator integration.
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { harvestEvidence, inferCurrentQuarter } from './evidence-harvester.js';
import { formHypothesis } from './hypothesis-engine.js';
import {
  compressEvidence,
  buildPhase2SynthesisPrompt,
  buildSkipPhase2Prompt,
  DIAGNOSTIC_FRAMEWORK,
} from './synthesis-prompts.js';
import type { HarvestedEvidence } from './evidence-harvester.js';
import type { HypothesisResult, AgentRoute } from './hypothesis-engine.js';

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface RetroPipelineResult {
  answer: string;
  route: AgentRoute | 'skip_phase_2';
  phase_reached: 0 | 1 | 2;
  hypothesis: HypothesisResult | null;
  tokens_used: number;
  data_gaps: string[];
}

// ─── Phase 2 agent runners ────────────────────────────────────────────────────
// Each runner compiles the relevant cached evidence into a detailed skill summary
// that Phase 2 synthesis can work from.

function getRouteSkills(route: AgentRoute): string[] {
  switch (route) {
    case 'coverage-agent':      return ['pipeline-coverage', 'forecast-rollup'];
    case 'conversion-agent':    return ['pipeline-waterfall', 'stage-velocity-benchmarks'];
    case 'win-loss-agent':      return ['icp-discovery', 'rep-scorecard'];
    case 'process-luck-agent':  return ['rep-scorecard', 'conversation-intelligence'];
    case 'pipeline-health-agent': return ['pipeline-coverage', 'pipeline-hygiene'];
    case 'full-retro-agent':    return ['forecast-rollup', 'pipeline-coverage', 'pipeline-waterfall', 'rep-scorecard', 'icp-discovery', 'conversation-intelligence', 'pipeline-hygiene'];
  }
}

function routeQuestionAnswered(route: AgentRoute): string {
  switch (route) {
    case 'coverage-agent':        return 'Was the miss structural — did the team enter undercovered?';
    case 'conversion-agent':      return 'Where did conversion collapse in the funnel?';
    case 'win-loss-agent':        return 'Did the right deals win? Where did losses cluster?';
    case 'process-luck-agent':    return 'Was performance earned (process) or circumstantial (luck)?';
    case 'pipeline-health-agent': return 'Are we better or worse positioned entering next quarter?';
    case 'full-retro-agent':      return 'Full retrospective across all four diagnostic layers.';
  }
}

function buildSkillSummaries(route: AgentRoute, evidence: HarvestedEvidence[]): string {
  const routeSkills = getRouteSkills(route);
  const relevant = evidence.filter((e) => routeSkills.includes(e.skill_id));

  if (relevant.length === 0) return 'No relevant cached skill runs available for this route.';

  return relevant
    .map((e) => {
      const freshTag = e.freshness === 'missing' ? '⚠️ MISSING' : `✓ ${e.freshness.toUpperCase()}`;
      const signalBlock = e.signals.length
        ? `\n  Key findings:\n${e.signals.map((s) => `  • ${s}`).join('\n')}`
        : '\n  No detailed findings cached.';
      return `${e.skill_id} [${freshTag}]\n  ${e.headline}${signalBlock}`;
    })
    .join('\n\n');
}

// ─── No-data guard ────────────────────────────────────────────────────────────

function buildNoDataResponse(missingSkills: string[]): string {
  const list = missingSkills.map((s) => `• \`${s}\``).join('\n');
  return `I don't have enough cached analysis to diagnose this quarter yet. The following skills haven't run recently and would need to complete first:

${list}

Once these have run (they execute automatically on their weekly schedule, or you can trigger them on demand from the Skills panel), I can provide a full retrospective diagnosis.

Typically, a quarterly retrospective requires at least \`forecast-rollup\`, \`pipeline-coverage\`, and \`pipeline-waterfall\` to have completed within the past 45 days.`;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runRetroPipeline(
  workspaceId: string,
  userQuestion: string,
  workspaceName: string
): Promise<RetroPipelineResult> {
  let tokensUsed = 0;

  // ── Phase 0: Evidence Harvest ──────────────────────────────────────────────
  const quarter = inferCurrentQuarter();
  const evidence = await harvestEvidence(workspaceId, quarter.start, quarter.end);

  const missingCount = evidence.filter((e) => e.freshness === 'missing').length;
  const nonMissing = evidence.filter((e) => e.freshness !== 'missing');

  // If fewer than 3 skills have data, bail out early
  if (nonMissing.length < 3) {
    const missingSkills = evidence
      .filter((e) => e.freshness === 'missing')
      .map((e) => e.skill_id);
    return {
      answer: buildNoDataResponse(missingSkills),
      route: 'full-retro-agent',
      phase_reached: 0,
      hypothesis: null,
      tokens_used: 0,
      data_gaps: missingSkills,
    };
  }

  // ── Phase 1: Hypothesis Formation ─────────────────────────────────────────
  const hypothesis = await formHypothesis(
    workspaceId,
    evidence,
    userQuestion,
    workspaceName,
    quarter.label
  );

  tokensUsed += 2000; // approximate DeepSeek cost

  // Low-confidence abort — tell user we need confirmation before full-retro
  if (hypothesis.confidence < 0.30 || hypothesis.recommended_route === 'full-retro-agent') {
    // We'll still proceed but flag it
    console.log('[retro/pipeline] Low confidence or full-retro route — proceeding with full synthesis');
  }

  // ── Phase 2: Synthesis ─────────────────────────────────────────────────────
  const route = hypothesis.recommended_route;

  let synthesisAnswer: string;
  let phaseReached: 0 | 1 | 2;

  if (hypothesis.skip_phase_2) {
    // Best-case path: synthesize directly from Phase 0 + Phase 1
    const prompt = buildSkipPhase2Prompt(hypothesis, evidence, userQuestion);

    const response = await callLLM(workspaceId, 'reason', {
      messages: [{ role: 'user', content: prompt }],
    });

    synthesisAnswer = response.content || 'Unable to synthesize retrospective analysis.';
    tokensUsed += 3000;
    phaseReached = 1;

    synthesisAnswer = formatAnswer(synthesisAnswer, hypothesis, quarter.label, 'direct', missingCount);
  } else {
    // Full Phase 2: targeted agent synthesis
    const skillSummaries = buildSkillSummaries(route, evidence);
    const prompt = buildPhase2SynthesisPrompt(hypothesis, evidence, skillSummaries, route);

    const response = await callLLM(workspaceId, 'reason', {
      messages: [{ role: 'user', content: prompt }],
    });

    synthesisAnswer = response.content || 'Unable to synthesize retrospective analysis.';
    tokensUsed += 12000; // approximate Phase 2 cost
    phaseReached = 2;

    synthesisAnswer = formatAnswer(synthesisAnswer, hypothesis, quarter.label, route, missingCount);
  }

  return {
    answer: synthesisAnswer,
    route: hypothesis.skip_phase_2 ? 'skip_phase_2' : route,
    phase_reached: phaseReached,
    hypothesis,
    tokens_used: tokensUsed,
    data_gaps: hypothesis.data_gaps,
  };
}

// ─── Answer formatter ─────────────────────────────────────────────────────────

function formatAnswer(
  rawAnswer: string,
  hypothesis: HypothesisResult,
  quarterLabel: string,
  route: string,
  missingCount: number
): string {
  const header = `## ${quarterLabel} Retrospective\n\n`;

  const confidenceTag = hypothesis.confidence >= 0.80
    ? `_High confidence analysis (${Math.round(hypothesis.confidence * 100)}%) · ${route}_`
    : `_Working hypothesis (${Math.round(hypothesis.confidence * 100)}% confidence) · ${route}_`;

  const missingNote = missingCount > 0
    ? `\n\n---\n_⚠️ ${missingCount} diagnostic skill(s) had no recent data. Analysis is based on available evidence only._`
    : '';

  return `${header}${confidenceTag}\n\n${rawAnswer.trim()}${missingNote}`;
}
