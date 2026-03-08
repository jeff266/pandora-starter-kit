/**
 * Quarterly Retrospective — Synthesis Prompt Templates
 *
 * Builds prompts for Phase 1 hypothesis formation (DeepSeek)
 * and Phase 2 synthesis (Claude). Embeds the 4-layer diagnostic
 * framework as reasoning scaffold.
 *
 * EC-01: CONVERSATION-LED CLOSE prompt variant.
 * EC-02: EARLY-STAGE ANALYSIS variant (Tier 1); forced Option A/B for Tier 2.
 */

import type { HarvestedEvidence } from './evidence-harvester.js';
import type { HypothesisResult, ConversationLedCloseResult } from './hypothesis-engine.js';
import type { HistoryAssessment } from './evidence-harvester.js';

// ─── Diagnostic framework (embedded in all prompts) ───────────────────────────

export const DIAGNOSTIC_FRAMEWORK = `
DIAGNOSTIC FRAMEWORK — 4 LAYERS:

Layer 1 — Variance Decomposition
  Was BOQ coverage sufficient (3x benchmark)? How much revenue depended on in-quarter creation?
  At which stage did conversion deviate? How is the delta split: coverage / conversion / slippage / in-quarter dependency?

Layer 2 — Win/Loss Pattern Analysis
  Did wins concentrate inside or outside ICP? Did losses cluster by stage, rep, segment, competitor, or deal size?
  Common reason, timing, or owner signature in pushed deals?

Layer 3 — Process vs. Luck
  Quadrants: REPLICABLE (strong inputs + good results) | UNLUCKY (strong inputs + poor results)
             LUCKY (weak inputs + good results) | STRUCTURAL (weak inputs + poor results)
  Inputs measured: activity volume, multithreading rate, stage velocity vs. benchmark, conversation quality.

Layer 4 — Forward Pipeline Health
  Is coverage entering next quarter higher or lower than at the equivalent point last quarter?
  Did this quarter consume more pipeline than it created? Same systemic issues in current open pipeline?
`.trim();

// ─── Evidence compression ─────────────────────────────────────────────────────

export function compressEvidence(evidence: HarvestedEvidence[]): string {
  return evidence
    .map((e) => {
      if (e.freshness === 'missing') {
        return `${e.skill_id} [MISSING]: No recent run. Data gap for Layer(s) ${e.diagnostic_layers.join(', ')}.`;
      }
      const sigBlock = e.signals.length
        ? `\n  Signals: ${e.signals.join('; ')}`
        : '';
      return `${e.skill_id} [${e.freshness.toUpperCase()}]: ${e.headline}${sigBlock}`;
    })
    .join('\n\n');
}

// ─── EC-02: History tier context block ───────────────────────────────────────

function buildHistoryContextBlock(history?: HistoryAssessment): string {
  if (!history || history.tier === 3) return '';

  if (history.tier === 1) {
    return `\nHISTORY_TIER: 1
DATA CONTEXT: ${history.closed_deals} closed deals across ~${Math.round(history.days_of_data / 30)} months.
INSTRUCTION: Layer 1 (Variance Decomposition) and Layer 3 (Process vs. Luck) are unavailable — insufficient history for benchmarks.
Only classify into Layer 2 (Win/Loss Pattern) or Layer 4 (Forward Pipeline Health).
Do not attempt quadrant classification. Do not use anomaly language.`;
  }

  // Tier 2
  return `\nHISTORY_TIER: 2
CLOSED_DEALS: ${history.closed_deals}
QUARTERS_OF_DATA: ${history.quarters_with_closes}
BENCHMARK_SOURCE: proxy
INSTRUCTION: All layers available, but benchmarks are proxy values (not workspace-specific).
Reduce confidence by 0.15 for any classification dependent on benchmark comparison.
Cite "proxy benchmark" explicitly in supporting_signals when benchmark data is used.`;
}

// ─── Phase 1 classifier prompt (DeepSeek input) ───────────────────────────────

export function buildHypothesisPrompt(
  evidence: HarvestedEvidence[],
  userQuestion: string,
  workspaceName: string,
  quarterLabel: string,
  history?: HistoryAssessment
): string {
  const evidenceBlock = compressEvidence(evidence);
  const freshCount = evidence.filter((e) => e.freshness === 'fresh').length;
  const missingCount = evidence.filter((e) => e.freshness === 'missing').length;
  const historyBlock = buildHistoryContextBlock(history);

  // Tier 1: restrict available routes
  const routeBlock = history?.tier === 1
    ? `AGENT ROUTES AVAILABLE (Tier 1 — limited history):
- win-loss-agent      → Layer 2: did the right deals win/lose?
- pipeline-health-agent → Layer 4: are we better or worse positioned now?`
    : `AGENT ROUTES AVAILABLE:
- coverage-agent      → Layer 1: was coverage the root cause?
- conversion-agent    → Layer 1: where did conversion collapse?
- win-loss-agent      → Layer 2: did the right deals win/lose?
- process-luck-agent  → Layer 3: was performance earned or circumstantial?
- pipeline-health-agent → Layer 4: are we better or worse positioned now?
- full-retro-agent    → All layers (expensive, use only if confidence < 0.50 or 3+ gaps)`;

  return `You are a revenue analytics classifier for ${workspaceName}.

QUARTER: ${quarterLabel}
QUESTION: "${userQuestion}"
${historyBlock}

CACHED EVIDENCE (${evidence.length} skills, ${freshCount} fresh, ${missingCount} missing):
---
${evidenceBlock}
---

${DIAGNOSTIC_FRAMEWORK}

${routeBlock}

Based on the available evidence, respond with ONLY valid JSON (no markdown, no code fences):
{
  "primary_layer": "variance_decomposition" | "win_loss_pattern" | "process_vs_luck" | "forward_pipeline_health",
  "quadrant": "REPLICABLE" | "UNLUCKY" | "LUCKY" | "STRUCTURAL" | null,
  "hypothesis": "1-2 sentence working hypothesis citing specific evidence",
  "confidence": 0.0-1.0,
  "supporting_signals": ["evidence that supports this hypothesis"],
  "contradicting_signals": ["evidence that cuts against it"],
  "data_gaps": ["skills that are missing or stale that would sharpen diagnosis"],
  "recommended_route": "coverage-agent" | "conversion-agent" | "win-loss-agent" | "process-luck-agent" | "pipeline-health-agent" | "full-retro-agent",
  "skip_phase_2": true | false
}

skip_phase_2 = true only if: confidence >= 0.80 AND all supporting evidence is fresh AND no critical data gaps.`;
}

// ─── EC-01: Conversation-Led Close synthesis block ────────────────────────────

function buildCLCBlock(clc: ConversationLedCloseResult): string {
  if (!clc.detected) return '';

  const ciLine = clc.ci_confirmed
    ? `Conversation intelligence corroborates early deal progress.`
    : `Conversation intelligence data was unavailable — CI confirmation pending.`;

  const label = clc.ci_confirmed
    ? 'CONVERSATION-LED CLOSE — forecast visibility gap, not process failure'
    : 'PROBABLE CONVERSATION-LED CLOSE — CI data missing, flag for review';

  return `
⚠️ EC-01 OVERRIDE: ${label}

The quarter's outcome was materially influenced by a Conversation-Led Close.
${clc.deals?.join(', ') ?? 'One or more deals'} advanced rapidly in the final 30 days before close and were not captured in the forecast at the 30-day mark.

${ciLine}

This is a FORECAST VISIBILITY PROBLEM, not a process problem.
Prescription: improve CRM update discipline and review whether conversation signals should feed forecast category adjustments automatically.
Do NOT frame this as LUCKY or prescribe a process overhaul.
`.trim();
}

// ─── EC-02: Tier 1 early-stage banner ────────────────────────────────────────

export function buildEarlyStageBanner(history: HistoryAssessment): string {
  const months = Math.round(history.days_of_data / 30);
  const dealsNeeded = Math.max(0, 20 - history.closed_deals);
  const milestone = dealsNeeded > 0
    ? `~${dealsNeeded} more closed deals`
    : `~${Math.round((90 - history.days_of_data) / 30)} more months of data`;

  return `📊 Early-Stage Analysis

This workspace has ${history.closed_deals} closed deals across ~${months} month${months !== 1 ? 's' : ''}. Some diagnostic layers require more history to run reliably. This analysis covers win/loss patterns and forward pipeline health only.

Variance decomposition and process benchmarking will unlock after ${milestone}.

---
`;
}

// ─── Phase 2 synthesis prompt (Claude) ───────────────────────────────────────

export function buildPhase2SynthesisPrompt(
  hypothesis: HypothesisResult,
  evidence: HarvestedEvidence[],
  skillOutputSummaries: string,
  route: string,
  historyTier?: 1 | 2 | 3
): string {
  const evidenceBlock = compressEvidence(evidence);
  const tier = historyTier ?? hypothesis.history_tier ?? 3;

  // EC-02: Force Option A/B for Tier 2; EC-01: CLC overrides format
  const clc = hypothesis.conversation_led_close;
  const useOptionAB = tier === 2 || hypothesis.confidence < 0.80 || hypothesis.contradicting_signals.length > 0;

  const clcBlock = clc?.detected ? buildCLCBlock(clc) : '';

  const historyInstruction = tier === 1
    ? `\nDATA CONTEXT: This workspace has limited operating history. Do not use anomaly language ("unusually high", "below benchmark"). Frame all findings as observations of current state. Do not classify into process vs. luck quadrant. Answer: What patterns exist in wins/losses so far? What does current pipeline suggest about next quarter?\n`
    : tier === 2
    ? `\nDATA CONTEXT: Limited history — benchmarks are proxy values, not workspace-specific. Flag proxy benchmarks explicitly. Default to Option A / Option B framing. Name what additional data would resolve ambiguity.\n`
    : '';

  return `You are a senior revenue analyst preparing a quarterly retrospective briefing.

${DIAGNOSTIC_FRAMEWORK}
${historyInstruction}
WORKING HYPOTHESIS (from Phase 1 analysis):
Layer: ${hypothesis.primary_layer}${hypothesis.quadrant ? ` | Quadrant: ${hypothesis.quadrant}` : ''}
Hypothesis: ${hypothesis.hypothesis}
Confidence: ${hypothesis.confidence.toFixed(2)} | Route: ${route}

Supporting signals: ${hypothesis.supporting_signals.join('; ') || 'none'}
Contradicting signals: ${hypothesis.contradicting_signals.join('; ') || 'none'}
Data gaps: ${hypothesis.data_gaps.join('; ') || 'none'}
${clcBlock ? `\n${clcBlock}\n` : ''}
CACHED SKILL EVIDENCE:
${evidenceBlock}

DETAILED SKILL ANALYSIS:
${skillOutputSummaries}

${useOptionAB ? OPTION_AB_INSTRUCTIONS : SINGLE_VERDICT_INSTRUCTIONS}

Be specific — cite metrics and dollar amounts where available. Do not hedge unnecessarily.`;
}

// ─── Phase 2 (skip) prompt — synthesize directly from Phase 0+1 ───────────────

export function buildSkipPhase2Prompt(
  hypothesis: HypothesisResult,
  evidence: HarvestedEvidence[],
  userQuestion: string,
  historyTier?: 1 | 2 | 3
): string {
  const evidenceBlock = compressEvidence(evidence);
  const tier = historyTier ?? hypothesis.history_tier ?? 3;
  const clc = hypothesis.conversation_led_close;
  const clcBlock = clc?.detected ? buildCLCBlock(clc) : '';

  const historyInstruction = tier === 1
    ? `\nDATA CONTEXT: Limited operating history. Do not use anomaly language. Frame findings as observations. Do not classify quadrant or attempt variance decomposition.\n`
    : tier === 2
    ? `\nDATA CONTEXT: Limited history — use proxy benchmarks. Default to Option A / Option B framing even if confidence is high.\n`
    : '';

  // Tier 2 overrides skip_phase_2 → always show Option A/B
  const useOptionAB = tier === 2;

  return `You are a senior revenue analyst. The user asked: "${userQuestion}"

${DIAGNOSTIC_FRAMEWORK}
${historyInstruction}
WORKING HYPOTHESIS (high confidence — Phase 2 agent not needed):
Layer: ${hypothesis.primary_layer}${hypothesis.quadrant ? ` | Quadrant: ${hypothesis.quadrant}` : ''}
Hypothesis: ${hypothesis.hypothesis}
Confidence: ${hypothesis.confidence.toFixed(2)}

Supporting: ${hypothesis.supporting_signals.join('; ') || 'none'}
Data gaps: ${hypothesis.data_gaps.join('; ') || 'none'}
${clcBlock ? `\n${clcBlock}\n` : ''}
EVIDENCE:
${evidenceBlock}

${useOptionAB ? OPTION_AB_INSTRUCTIONS : `Synthesize a direct, confident answer. You have high-confidence evidence — give a clear verdict.
Cite specific metrics. End with 1-2 forward-looking recommendations.
If data gaps exist, name the skill to run to sharpen the diagnosis.`}`;
}

// ─── EC-02: Tier 1 early-stage synthesis prompt ───────────────────────────────

export function buildTier1EarlyStagePrompt(
  evidence: HarvestedEvidence[],
  userQuestion: string,
  history: HistoryAssessment
): string {
  const evidenceBlock = compressEvidence(evidence);

  return `You are a senior revenue analyst. The user asked: "${userQuestion}"

DATA CONTEXT: This workspace has limited operating history (${history.closed_deals} closed deals, ~${Math.round(history.days_of_data / 30)} months of data).
Historical benchmarks are not available. Layer 1 (Variance Decomposition) and Layer 3 (Process vs. Luck) cannot run reliably.

INSTRUCTION: Do not use anomaly language ("unusually high", "below benchmark", "worse than typical").
Frame all findings as observations of current state.
Do not classify the quarter into the process vs. luck quadrant.
Do not attempt variance decomposition.

Instead, answer:
1. What patterns exist in the wins and losses so far?
2. What does the current pipeline suggest about next quarter?
3. What would need to be true for early signals to be meaningful?

AVAILABLE EVIDENCE (Layers 2 & 4 only):
${evidenceBlock}

Present findings clearly. Name any skills that haven't run yet and would provide useful early signals.`;
}

// ─── Output format instructions ───────────────────────────────────────────────

const OPTION_AB_INSTRUCTIONS = `
Present findings as Option A / Option B (confidence is below 0.80, Tier 2 history, or contradicting signals exist):

**Option A: [Descriptive Label]**
What the evidence suggests: [1-2 sentences with specific metrics]
Key signals:
- [bullet]
- [bullet]
Implication: [what to change or investigate]

**Option B: [Alternative Label]**
Alternatively: [1-2 sentences citing contradicting evidence]
Key signals:
- [bullet]
Implication: [different prescription]

**My read:** [Which interpretation the data favors, and what context only the user has that would resolve the ambiguity.]

**Data gaps:** [What evidence is missing that would sharpen this diagnosis. Name specific skills to run. If Tier 2, name what additional history would resolve the ambiguity.]`;

const SINGLE_VERDICT_INSTRUCTIONS = `
Give a single, direct verdict (confidence >= 0.80, evidence is clear):

**Verdict: [Descriptive Label]**
[2-3 sentences explaining the diagnosis with specific metrics]

Key evidence:
- [bullet with metric]
- [bullet with metric]
- [bullet with metric]

**Diagnosis:** [1-sentence plain English summary]

**Recommendations:**
1. [Specific action]
2. [Specific action]

**Data gaps:** [Any missing evidence — name specific skills to run if needed, otherwise "None — diagnosis is well-supported."]`;
