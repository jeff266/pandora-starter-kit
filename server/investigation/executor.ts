import { query } from '../db.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { getSkillRegistry } from '../skills/registry.js';
import { synthesizeInvestigation } from './synthesizer.js';
import { getOperatorMeta } from './planner.js';
import type { InvestigationPlan, InvestigationStep, InvestigationResult } from '../goals/types.js';

interface StepFinding {
  step: number;
  skill_id: string;
  findings: string[];
  summary: string;
}

function resolveOutputText(row: { output_text?: string | null; result?: any; output?: any }): string {
  if (row.output_text) return row.output_text;
  if (typeof row.output?.narrative === 'string') return row.output.narrative;
  if (typeof row.output === 'string') return row.output;
  if (typeof row.result?.narrative === 'string') return row.result.narrative;
  return '';
}

function extractKeyFindings(skillResult: any): { summary: string; items: string[] } {
  let text = '';

  if (typeof skillResult === 'string') {
    text = skillResult;
  } else if (skillResult?.output_text) {
    text = skillResult.output_text;
  } else if (skillResult?.result?.narrative) {
    text = skillResult.result.narrative;
  } else if (skillResult?.result?.summary) {
    text = skillResult.result.summary;
  } else if (skillResult?.narrative) {
    text = skillResult.narrative;
  } else if (typeof skillResult?.output === 'string') {
    text = skillResult.output;
  } else if (typeof skillResult?.output?.narrative === 'string') {
    text = skillResult.output.narrative;
  } else {
    text = JSON.stringify(skillResult).slice(0, 500);
  }

  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 10 && l.length < 300);

  const items = lines.slice(0, 5);
  const summary = items.join(' ').slice(0, 400) || text.slice(0, 400);

  return { summary, items };
}

function decideFollowUp(
  plan: InvestigationPlan,
  allFindings: StepFinding[],
  currentStepIdx: number,
): { decision: 'investigate_further' | 'satisfied'; skill_id?: string; question?: string; reasoning?: string; finding_type?: string } | null {
  const latest = allFindings[currentStepIdx];
  if (!latest || latest.findings.length === 0) return { decision: 'satisfied' };

  const existingSkillIds = new Set(plan.steps.map((s) => s.skill_id));

  for (const finding of latest.findings) {
    const lower = (typeof finding === 'string' ? finding : JSON.stringify(finding)).toLowerCase();

    if (lower.includes('coverage') && lower.includes('below') && !existingSkillIds.has('pipeline-waterfall')) {
      return {
        decision: 'investigate_further',
        skill_id: 'pipeline-waterfall',
        question: 'Is the coverage gap from weak generation or slow close rates?',
        reasoning: 'Coverage below target — checking pipeline creation vs closure trends',
        finding_type: 'coverage_gap',
      };
    }

    if (
      (lower.includes('behind') || lower.includes('underperform')) &&
      !existingSkillIds.has('rep-scorecard')
    ) {
      return {
        decision: 'investigate_further',
        skill_id: 'rep-scorecard',
        question: 'Which specific reps are behind and why?',
        reasoning: 'Underperformance detected — checking individual rep scorecards',
        finding_type: 'rep_underperformance',
      };
    }

    if (lower.includes('stale') && !existingSkillIds.has('pipeline-hygiene')) {
      return {
        decision: 'investigate_further',
        skill_id: 'pipeline-hygiene',
        question: 'Which stale deals are most at risk and why?',
        reasoning: 'Stale deals flagged — checking pipeline hygiene details',
        finding_type: 'stale_investigation',
      };
    }

    if (
      (lower.includes('over-forecast') || lower.includes('overforecast')) &&
      !existingSkillIds.has('deal-risk-review')
    ) {
      return {
        decision: 'investigate_further',
        skill_id: 'deal-risk-review',
        question: 'Is the over-forecasting from stale deals or optimistic staging?',
        reasoning: 'Over-forecasting detected — checking deal risk details',
        finding_type: 'forecast_accuracy',
      };
    }
  }

  return { decision: 'satisfied' };
}

export async function executeInvestigation(
  plan: InvestigationPlan,
  callbacks: {
    onStepStart?: (step: InvestigationStep) => void;
    onSkillStep?: (step: InvestigationStep, stepId: string, stepName: string) => void;
    onStepComplete?: (step: InvestigationStep, findings: string[]) => void;
    onFollowUpDecided?: (fromStep: number, newStep: InvestigationStep) => void;
    onSynthesisStart?: () => void;
    onSynthesisChunk?: (text: string) => void;
  },
  workspaceContext?: string,
): Promise<InvestigationResult> {
  plan.status = 'executing';
  const allFindings: StepFinding[] = [];
  const skillRuntime = getSkillRuntime();
  const registry = getSkillRegistry();

  for (let i = 0; i < plan.steps.length && i < plan.max_steps; i++) {
    const step = plan.steps[i];
    step.status = 'executing';
    callbacks.onStepStart?.(step);

    try {
      const cacheWindow = plan.prefer_cache ? '2 hours' : '30 minutes';

      const cached = await query<{ id: string; output_text: string; result: any; output: any }>(
        `SELECT id, output_text, result, output FROM skill_runs
         WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
           AND started_at >= NOW() - INTERVAL '${cacheWindow}'
         ORDER BY started_at DESC LIMIT 1`,
        [plan.workspace_id, step.skill_id],
      );

      let skillResult: any;

      if (cached.rows.length > 0) {
        const row = cached.rows[0];
        skillResult = {
          output_text: resolveOutputText(row),
          result: row.result,
          output: row.output,
        };
        step.used_cache = true;
      } else if (plan.prefer_cache) {
        const staleCache = await query<{ output_text: string; result: any; output: any }>(
          `SELECT output_text, result, output FROM skill_runs
           WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
           ORDER BY started_at DESC LIMIT 1`,
          [plan.workspace_id, step.skill_id],
        );
        if (staleCache.rows.length > 0) {
          const srow = staleCache.rows[0];
          skillResult = { output_text: resolveOutputText(srow), result: srow.result, output: srow.output };
          step.used_cache = true;
        } else {
          const skillDef = registry.get(step.skill_id);
          if (skillDef) {
            const result = await skillRuntime.executeSkill(skillDef, plan.workspace_id, {}, undefined,
              callbacks.onSkillStep ? (sId, sName) => callbacks.onSkillStep!(step, sId, sName) : undefined
            );
            skillResult = result;
            step.used_cache = false;
          } else {
            skillResult = { output_text: `No results available for ${step.skill_id}`, result: null };
            step.used_cache = true;
          }
        }
      } else {
        const skillDef = registry.get(step.skill_id);
        if (skillDef) {
          const result = await skillRuntime.executeSkill(skillDef, plan.workspace_id, {}, undefined,
            callbacks.onSkillStep ? (sId, sName) => callbacks.onSkillStep!(step, sId, sName) : undefined
          );
          skillResult = result;
          step.used_cache = false;
        } else {
          const latestRun = await query<{ output_text: string; result: any; output: any }>(
            `SELECT output_text, result, output FROM skill_runs
             WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
             ORDER BY completed_at DESC LIMIT 1`,
            [plan.workspace_id, step.skill_id],
          );
          if (latestRun.rows.length > 0) {
            const lrow = latestRun.rows[0];
            skillResult = { output_text: resolveOutputText(lrow), result: lrow.result, output: lrow.output };
          } else {
            skillResult = { output_text: `No results available for ${step.skill_id}`, result: null, output: null };
          }
          step.used_cache = true;
        }
      }

      const keyFindings = extractKeyFindings(skillResult);
      step.result_summary = keyFindings.summary;
      step.key_findings = keyFindings.items;
      step.status = 'complete';

      allFindings.push({
        step: i,
        skill_id: step.skill_id,
        findings: keyFindings.items,
        summary: keyFindings.summary,
      });

      callbacks.onStepComplete?.(step, keyFindings.items);

      if (i === plan.steps.length - 1 && plan.steps.length < plan.max_steps) {
        const followUp = decideFollowUp(plan, allFindings, i);

        if (followUp?.decision === 'investigate_further' && followUp.skill_id) {
          step.follow_up_decision = 'investigate_further';
          step.follow_up_question = followUp.question;
          step.follow_up_skill = followUp.skill_id;

          const meta = getOperatorMeta(followUp.skill_id);
          const newStep: InvestigationStep = {
            index: plan.steps.length,
            operator_name: meta.name,
            skill_id: followUp.skill_id,
            trigger: 'follow_up',
            triggered_by: {
              step_index: i,
              finding_type: followUp.finding_type || 'detected',
              reasoning: followUp.reasoning || 'Following up on findings',
            },
            status: 'pending',
            used_cache: false,
          };

          plan.steps.push(newStep);
          callbacks.onFollowUpDecided?.(i, newStep);
        } else {
          step.follow_up_decision = 'satisfied';
        }
      }
    } catch (err) {
      console.error(`[InvestigationExecutor] Step ${i} (${step.skill_id}) failed:`, err);
      step.status = 'skipped';
      step.result_summary = `Step failed: ${err instanceof Error ? err.message : 'unknown error'}`;
      allFindings.push({
        step: i,
        skill_id: step.skill_id,
        findings: [],
        summary: step.result_summary,
      });
    }
  }

  plan.status = 'synthesizing';
  callbacks.onSynthesisStart?.();

  const synthesis = await synthesizeInvestigation(plan, allFindings, callbacks.onSynthesisChunk, workspaceContext);

  plan.status = 'complete';

  return {
    plan,
    synthesis: synthesis.text,
    total_tokens: synthesis.tokens,
    steps_executed: allFindings.length,
    cache_hits: plan.steps.filter((s) => s.used_cache).length,
  };
}
