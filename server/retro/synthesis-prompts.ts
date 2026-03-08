/**
 * Quarterly Retrospective — Synthesis Prompt Templates
 *
 * Builds prompts for Phase 1 hypothesis formation (DeepSeek)
 * and Phase 2 synthesis (Claude). Embeds the 4-layer diagnostic
 * framework as reasoning scaffold.
 */

import type { HarvestedEvidence } from './evidence-harvester.js';
import type { HypothesisResult } from './hypothesis-engine.js';

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

// ─── Phase 1 classifier prompt (DeepSeek input) ───────────────────────────────

export function buildHypothesisPrompt(
  evidence: HarvestedEvidence[],
  userQuestion: string,
  workspaceName: string,
  quarterLabel: string
): string {
  const evidenceBlock = compressEvidence(evidence);
  const freshCount = evidence.filter((e) => e.freshness === 'fresh').length;
  const missingCount = evidence.filter((e) => e.freshness === 'missing').length;

  return `You are a revenue analytics classifier for ${workspaceName}.

QUARTER: ${quarterLabel}
QUESTION: "${userQuestion}"

CACHED EVIDENCE (${evidence.length} skills, ${freshCount} fresh, ${missingCount} missing):
---
${evidenceBlock}
---

${DIAGNOSTIC_FRAMEWORK}

AGENT ROUTES AVAILABLE:
- coverage-agent     → Layer 1: was coverage the root cause?
- conversion-agent   → Layer 1: where did conversion collapse?
- win-loss-agent     → Layer 2: did the right deals win/lose?
- process-luck-agent → Layer 3: was performance earned or circumstantial?
- pipeline-health-agent → Layer 4: are we better or worse positioned now?
- full-retro-agent   → All layers (expensive, use only if confidence < 0.50 or 3+ gaps)

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

// ─── Phase 2 synthesis prompt (Claude) ───────────────────────────────────────

export function buildPhase2SynthesisPrompt(
  hypothesis: HypothesisResult,
  evidence: HarvestedEvidence[],
  skillOutputSummaries: string,
  route: string
): string {
  const evidenceBlock = compressEvidence(evidence);
  const useOptionAB = hypothesis.confidence < 0.80
    || hypothesis.contradicting_signals.length > 0;

  return `You are a senior revenue analyst preparing a quarterly retrospective briefing.

${DIAGNOSTIC_FRAMEWORK}

WORKING HYPOTHESIS (from Phase 1 analysis):
Layer: ${hypothesis.primary_layer}${hypothesis.quadrant ? ` | Quadrant: ${hypothesis.quadrant}` : ''}
Hypothesis: ${hypothesis.hypothesis}
Confidence: ${hypothesis.confidence.toFixed(2)} | Route: ${route}

Supporting signals: ${hypothesis.supporting_signals.join('; ') || 'none'}
Contradicting signals: ${hypothesis.contradicting_signals.join('; ') || 'none'}
Data gaps: ${hypothesis.data_gaps.join('; ') || 'none'}

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
  userQuestion: string
): string {
  const evidenceBlock = compressEvidence(evidence);

  return `You are a senior revenue analyst. The user asked: "${userQuestion}"

${DIAGNOSTIC_FRAMEWORK}

WORKING HYPOTHESIS (high confidence — Phase 2 agent not needed):
Layer: ${hypothesis.primary_layer}${hypothesis.quadrant ? ` | Quadrant: ${hypothesis.quadrant}` : ''}
Hypothesis: ${hypothesis.hypothesis}
Confidence: ${hypothesis.confidence.toFixed(2)}

Supporting: ${hypothesis.supporting_signals.join('; ') || 'none'}
Data gaps: ${hypothesis.data_gaps.join('; ') || 'none'}

EVIDENCE:
${evidenceBlock}

Synthesize a direct, confident answer. You have high-confidence evidence — give a clear verdict.
Cite specific metrics. End with 1-2 forward-looking recommendations.
If data gaps exist, name the skill to run to sharpen the diagnosis.`;
}

// ─── Output format instructions ───────────────────────────────────────────────

const OPTION_AB_INSTRUCTIONS = `
Present findings as Option A / Option B (confidence is below 0.80 or contradicting signals exist):

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

**Data gaps:** [What evidence is missing that would sharpen this diagnosis. Name specific skills to run.]`;

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
