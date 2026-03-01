import { query } from '../db.js';
import { scanCRM } from './crm-scanner.js';
import { researchCompany } from './company-research.js';
import { inferWorkspaceConfig } from '../config/inference-engine.js';
import { getAllQuestions, getQuestion, getNextQuestion, getTier0Questions } from './questions/index.js';
import {
  generateMotionsHypothesis,
  generateCalendarHypothesis,
  generateStagesHypothesis,
  generateTeamHypothesis,
  generateStaleHypothesis,
  generateForecastHypothesis,
  generateWinRateHypothesis,
  generateCoverageHypothesis,
  generateRequiredFieldsHypothesis,
  generateDeliveryHypothesis,
} from './hypotheses/index.js';
import { parseResponse } from './response-parser.js';
import { writeConfigPatch } from './config-writer.js';
import type {
  CRMScanResult, CompanyResearch, InferenceResult, OnboardingState, QuestionState,
  Hypothesis, ConfigArtifact,
} from './types.js';
import type { OnboardingQuestion } from './types.js';

async function getContextValue<T>(workspaceId: string, key: string): Promise<T | null> {
  const r = await query(
    `SELECT definitions->($2::text) AS val FROM context_layer WHERE workspace_id = $1::uuid LIMIT 1`,
    [workspaceId, key]
  );
  if (!r.rows[0] || r.rows[0].val === null || r.rows[0].val === undefined) return null;
  return r.rows[0].val as T;
}

async function setContextValue(workspaceId: string, key: string, value: unknown): Promise<void> {
  const patch = JSON.stringify({ [key]: value });
  const existing = await query(
    `SELECT id FROM context_layer WHERE workspace_id = $1::uuid LIMIT 1`,
    [workspaceId]
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE context_layer SET definitions = COALESCE(definitions, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [patch, existing.rows[0].id]
    );
  } else {
    await query(
      `INSERT INTO context_layer (workspace_id, definitions, updated_at) VALUES ($1::uuid, $2::jsonb, NOW())`,
      [workspaceId, patch]
    );
  }
}

async function getWorkspaceName(workspaceId: string): Promise<string> {
  const r = await query(`SELECT name FROM workspaces WHERE id = $1 LIMIT 1`, [workspaceId]);
  return r.rows[0]?.name ?? 'Your Company';
}

function buildInferenceResult(engineResult: Awaited<ReturnType<typeof inferWorkspaceConfig>>): InferenceResult {
  const config = engineResult.config as {
    cadence?: { fiscal_year_start_month?: number; quota_period?: string };
    pipelines?: Array<{ stage_0_stages?: string[]; parking_lot_stages?: string[] }>;
  };
  const pipeline0 = config?.pipelines?.[0] as { stage_0_stages?: string[]; parking_lot_stages?: string[] } | undefined;

  const repSignals = engineResult.signals?.['rep_patterns'];
  const repSignal = Array.isArray(repSignals) && repSignals.length > 0 ? repSignals[0] : null;
  const repValue = repSignal?.value as { excluded_owners?: string[]; active_reps?: string[] } | undefined;

  return {
    fiscal_year_start_month: config?.cadence?.fiscal_year_start_month,
    quota_period: config?.cadence?.quota_period,
    stage_0_stages: pipeline0?.stage_0_stages ?? [],
    parking_lot_stages: pipeline0?.parking_lot_stages ?? [],
    rep_patterns: repValue ? {
      excluded_owners: repValue.excluded_owners ?? [],
      active_reps: repValue.active_reps ?? [],
    } : undefined,
  };
}

function generateHypothesis(
  questionId: string,
  scan: CRMScanResult,
  research: CompanyResearch,
  inference: InferenceResult,
): Hypothesis {
  switch (questionId) {
    case 'Q1_motions': return generateMotionsHypothesis(scan, research, inference);
    case 'Q2_calendar': return generateCalendarHypothesis(scan, inference);
    case 'Q3_stages': return generateStagesHypothesis(scan, inference);
    case 'Q4_team': return generateTeamHypothesis(scan, inference);
    case 'Q5_stale': return generateStaleHypothesis(scan);
    case 'Q6_forecast': return generateForecastHypothesis(scan);
    case 'Q7_winrate': return generateWinRateHypothesis(scan, inference);
    case 'Q8_coverage': return generateCoverageHypothesis(scan);
    case 'Q9_fields': return generateRequiredFieldsHypothesis(scan);
    case 'Q10_delivery': return generateDeliveryHypothesis();
    default: return {
      summary: `Pandora needs a few details about ${questionId}. What can you tell me?`,
      confidence: 0.3,
      evidence: 'No automated analysis available for this setting',
      suggested_value: null,
    };
  }
}

function buildProgress(state: OnboardingState): { tier: number; answered: number; total: number; pct: number; tier0_complete: boolean; tier1_complete: boolean } {
  const tier0 = getTier0Questions();
  const tier0Answered = tier0.filter(q => {
    const qs = state.questions[q.id];
    return qs?.status === 'answered' || qs?.status === 'skipped';
  }).length;
  const tier0Complete = tier0Answered >= tier0.length;

  const allQ = getAllQuestions().filter(q => q.tier <= 1);
  const allAnswered = allQ.filter(q => {
    const qs = state.questions[q.id];
    return qs?.status === 'answered' || qs?.status === 'skipped';
  }).length;
  const tier1Complete = allAnswered >= allQ.length;

  return {
    tier: tier0Complete ? 1 : 0,
    answered: tier0Answered,
    total: tier0.length,
    pct: Math.round((tier0Answered / tier0.length) * 100),
    tier0_complete: tier0Complete,
    tier1_complete: tier1Complete,
  };
}

export async function startOnboarding(
  workspaceId: string,
  role: OnboardingState['role'],
  force = false,
): Promise<{ state: OnboardingState; current_question: OnboardingQuestion; hypothesis: Hypothesis; progress: ReturnType<typeof buildProgress> }> {
  const existing = await getContextValue<OnboardingState>(workspaceId, 'onboarding_state');
  if (existing && !force) {
    return resumeOnboarding(workspaceId);
  }

  const [scanResult, engineResult, companyName] = await Promise.all([
    scanCRM(workspaceId).catch(() => ({ pipelines: [], deal_types: [], record_types: [], stages: [], won_lost: [], owners: [], close_date_clusters: [], amount_distribution: null, custom_field_fill_rates: [], contacts_per_deal: null, new_owners: [], unused_stages: [] }) as CRMScanResult),
    inferWorkspaceConfig(workspaceId, { skipDocMining: true, skipReportMining: true, skipToolRoster: true }).catch(() => ({ config: {}, signals: {}, user_review_items: [], detection_summary: {} })),
    getWorkspaceName(workspaceId),
  ]);

  const researchResult = await researchCompany(companyName).catch(() => ({
    company_size_estimate: 'unknown', industry: 'unknown', likely_gtm_motion: 'unknown',
    pricing_model: 'unknown', competitors: [], funding_stage: 'unknown', confidence: 0, evidence_urls: [],
  })) as CompanyResearch;

  const inference = buildInferenceResult(engineResult as Awaited<ReturnType<typeof inferWorkspaceConfig>>);

  await setContextValue(workspaceId, 'onboarding_crm_scan', scanResult);
  await setContextValue(workspaceId, 'onboarding_research', researchResult);
  await setContextValue(workspaceId, 'onboarding_inference', inference);

  const allQ = getAllQuestions();
  const initialQuestions: Record<string, QuestionState> = {};
  for (const q of allQ) {
    initialQuestions[q.id] = {
      status: 'pending',
      config_patches_applied: [],
      hypothesis_confidence: 0,
      user_changed_hypothesis: false,
    };
  }

  const state: OnboardingState = {
    workspace_id: workspaceId,
    started_at: new Date().toISOString(),
    completed_at: null,
    role,
    questions: initialQuestions,
    tier0_complete: false,
    tier1_complete: false,
    first_brief_generated: false,
    can_resume: true,
    resume_from: 'Q1_motions',
  };

  await setContextValue(workspaceId, 'onboarding_state', state);

  const q1 = getQuestion('Q1_motions')!;
  const hypothesis = generateHypothesis('Q1_motions', scanResult, researchResult, inference);

  return { state, current_question: q1, hypothesis, progress: buildProgress(state) };
}

export async function getOnboardingState(workspaceId: string): Promise<{ state: OnboardingState | null; not_started: boolean; current_question: OnboardingQuestion | null; hypothesis: Hypothesis | null; progress: ReturnType<typeof buildProgress> | null }> {
  const state = await getContextValue<OnboardingState>(workspaceId, 'onboarding_state');
  if (!state) return { state: null, not_started: true, current_question: null, hypothesis: null, progress: null };

  const currentId = state.resume_from || 'Q1_motions';
  const currentQuestion = getQuestion(currentId) ?? null;

  let hypothesis: Hypothesis | null = null;
  if (currentQuestion) {
    const scan = await getContextValue<CRMScanResult>(workspaceId, 'onboarding_crm_scan') ?? { pipelines: [], deal_types: [], record_types: [], stages: [], won_lost: [], owners: [], close_date_clusters: [], amount_distribution: null, custom_field_fill_rates: [], contacts_per_deal: null, new_owners: [], unused_stages: [] };
    const research = await getContextValue<CompanyResearch>(workspaceId, 'onboarding_research') ?? { company_size_estimate: 'unknown', industry: 'unknown', likely_gtm_motion: 'unknown', pricing_model: 'unknown', competitors: [], funding_stage: 'unknown', confidence: 0, evidence_urls: [] };
    const inference = await getContextValue<InferenceResult>(workspaceId, 'onboarding_inference') ?? {};
    hypothesis = generateHypothesis(currentQuestion.id, scan as CRMScanResult, research as CompanyResearch, inference as InferenceResult);
  }

  return { state, not_started: false, current_question: currentQuestion, hypothesis, progress: buildProgress(state) };
}

export async function answerQuestion(
  workspaceId: string,
  questionId: string,
  response: string,
): Promise<{ ok: boolean; needs_clarification?: boolean; clarification_message?: string; artifacts: ConfigArtifact[]; next_question: OnboardingQuestion | null; next_hypothesis: Hypothesis | null; progress: ReturnType<typeof buildProgress> }> {
  const state = await getContextValue<OnboardingState>(workspaceId, 'onboarding_state');
  if (!state) throw new Error('Onboarding not started');

  const question = getQuestion(questionId);
  if (!question) throw new Error(`Unknown question: ${questionId}`);

  const scan = await getContextValue<CRMScanResult>(workspaceId, 'onboarding_crm_scan') ?? { pipelines: [], deal_types: [], record_types: [], stages: [], won_lost: [], owners: [], close_date_clusters: [], amount_distribution: null, custom_field_fill_rates: [], contacts_per_deal: null, new_owners: [], unused_stages: [] };
  const research = await getContextValue<CompanyResearch>(workspaceId, 'onboarding_research') ?? { company_size_estimate: 'unknown', industry: 'unknown', likely_gtm_motion: 'unknown', pricing_model: 'unknown', competitors: [], funding_stage: 'unknown', confidence: 0, evidence_urls: [] };
  const inference = await getContextValue<InferenceResult>(workspaceId, 'onboarding_inference') ?? {};
  const hypothesis = generateHypothesis(questionId, scan as CRMScanResult, research as CompanyResearch, inference as InferenceResult);

  const patch = await parseResponse(question, hypothesis, response);

  if (patch.parse_error) {
    return {
      ok: false,
      needs_clarification: true,
      clarification_message: patch._interpretation_notes as string ?? 'Could not interpret your response — could you rephrase?',
      artifacts: [],
      next_question: null,
      next_hypothesis: null,
      progress: buildProgress(state),
    };
  }

  const artifacts = await writeConfigPatch(workspaceId, questionId, patch, 'confirmed', hypothesis.confidence);

  const answeredIds = new Set(Object.entries(state.questions).filter(([, qs]) => qs.status === 'answered' || qs.status === 'skipped').map(([id]) => id));
  answeredIds.add(questionId);

  state.questions[questionId] = {
    status: 'answered',
    answered_at: new Date().toISOString(),
    response_source: 'text',
    config_patches_applied: artifacts.map(a => a.type),
    hypothesis_confidence: hypothesis.confidence,
    user_changed_hypothesis: JSON.stringify(patch) !== JSON.stringify(hypothesis.suggested_value),
  };

  const tier0 = getTier0Questions();
  state.tier0_complete = tier0.every(q => {
    const qs = state.questions[q.id];
    return qs?.status === 'answered' || qs?.status === 'skipped';
  });

  const nextQ = getNextQuestion(questionId, answeredIds);
  state.resume_from = nextQ?.id ?? '';
  if (!nextQ) state.completed_at = new Date().toISOString();

  await setContextValue(workspaceId, 'onboarding_state', state);

  let nextHypothesis: Hypothesis | null = null;
  if (nextQ) {
    nextHypothesis = generateHypothesis(nextQ.id, scan as CRMScanResult, research as CompanyResearch, inference as InferenceResult);
  }

  return { ok: true, artifacts, next_question: nextQ, next_hypothesis: nextHypothesis, progress: buildProgress(state) };
}

export async function skipQuestion(
  workspaceId: string,
  questionId: string,
): Promise<{ artifacts: ConfigArtifact[]; next_question: OnboardingQuestion | null; next_hypothesis: Hypothesis | null; progress: ReturnType<typeof buildProgress> }> {
  const state = await getContextValue<OnboardingState>(workspaceId, 'onboarding_state');
  if (!state) throw new Error('Onboarding not started');

  const question = getQuestion(questionId);
  if (!question) throw new Error(`Unknown question: ${questionId}`);

  const artifacts = await writeConfigPatch(workspaceId, questionId, question.skip_default as Record<string, unknown>, 'default', 0.3);

  const answeredIds = new Set(Object.entries(state.questions).filter(([, qs]) => qs.status === 'answered' || qs.status === 'skipped').map(([id]) => id));
  answeredIds.add(questionId);

  state.questions[questionId] = {
    status: 'skipped',
    skipped_at: new Date().toISOString(),
    config_patches_applied: artifacts.map(a => a.type),
    hypothesis_confidence: 0,
    user_changed_hypothesis: false,
  };

  const tier0 = getTier0Questions();
  state.tier0_complete = tier0.every(q => {
    const qs = state.questions[q.id];
    return qs?.status === 'answered' || qs?.status === 'skipped';
  });

  const nextQ = getNextQuestion(questionId, answeredIds);
  state.resume_from = nextQ?.id ?? '';

  await setContextValue(workspaceId, 'onboarding_state', state);

  const scan = await getContextValue<CRMScanResult>(workspaceId, 'onboarding_crm_scan') ?? { pipelines: [], deal_types: [], record_types: [], stages: [], won_lost: [], owners: [], close_date_clusters: [], amount_distribution: null, custom_field_fill_rates: [], contacts_per_deal: null, new_owners: [], unused_stages: [] };
  const research = await getContextValue<CompanyResearch>(workspaceId, 'onboarding_research') ?? { company_size_estimate: 'unknown', industry: 'unknown', likely_gtm_motion: 'unknown', pricing_model: 'unknown', competitors: [], funding_stage: 'unknown', confidence: 0, evidence_urls: [] };
  const inference = await getContextValue<InferenceResult>(workspaceId, 'onboarding_inference') ?? {};

  let nextHypothesis: Hypothesis | null = null;
  if (nextQ) {
    nextHypothesis = generateHypothesis(nextQ.id, scan as CRMScanResult, research as CompanyResearch, inference as InferenceResult);
  }

  return { artifacts, next_question: nextQ, next_hypothesis: nextHypothesis, progress: buildProgress(state) };
}

export async function resumeOnboarding(workspaceId: string): Promise<{ state: OnboardingState; current_question: OnboardingQuestion; hypothesis: Hypothesis; progress: ReturnType<typeof buildProgress> }> {
  const result = await getOnboardingState(workspaceId);
  if (!result.state || !result.current_question || !result.hypothesis) {
    throw new Error('No onboarding session to resume');
  }
  return { state: result.state, current_question: result.current_question, hypothesis: result.hypothesis, progress: result.progress! };
}

export async function getCompletionSummary(workspaceId: string): Promise<{ tier0_complete: boolean; tier1_complete: boolean; completion_pct: number; artifacts_summary: string[] }> {
  const state = await getContextValue<OnboardingState>(workspaceId, 'onboarding_state');
  if (!state) return { tier0_complete: false, tier1_complete: false, completion_pct: 0, artifacts_summary: [] };

  const progress = buildProgress(state);
  const answered = Object.entries(state.questions).filter(([, qs]) => qs.status === 'answered' || qs.status === 'skipped');
  const artifacts_summary = answered.map(([id, qs]) => `${id}: ${qs.status} (${qs.config_patches_applied.join(', ')})`);

  return {
    tier0_complete: progress.tier0_complete,
    tier1_complete: progress.tier1_complete,
    completion_pct: progress.pct,
    artifacts_summary,
  };
}
