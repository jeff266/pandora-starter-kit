import { describe, it, expect } from 'vitest';
import {
  formatSkillName,
  computeWordBudget,
  compressEvidenceForSynthesis,
  buildGoalAwareSynthesisPrompt,
} from '../runtime.js';
import type { SkillOutput } from '../types.js';

// ─── formatSkillName ─────────────────────────────────────────────────────────

describe('formatSkillName', () => {
  it('converts kebab-case skill ID to Title Case', () => {
    expect(formatSkillName('pipeline-hygiene')).toBe('Pipeline Hygiene');
    expect(formatSkillName('deal-risk-review')).toBe('Deal Risk Review');
    expect(formatSkillName('forecast-rollup')).toBe('Forecast Rollup');
  });

  it('handles single-word skill IDs', () => {
    expect(formatSkillName('forecast')).toBe('Forecast');
  });
});

// ─── computeWordBudget ────────────────────────────────────────────────────────

describe('computeWordBudget', () => {
  it('returns 400 for 0 questions', () => {
    expect(computeWordBudget(0)).toBe(400);
  });

  it('returns 640 for 3 questions', () => {
    expect(computeWordBudget(3)).toBe(640);
  });

  it('returns 800 for 5 questions', () => {
    expect(computeWordBudget(5)).toBe(800);
  });

  it('scales linearly: each question adds 80 words', () => {
    const base = computeWordBudget(0);
    for (let i = 1; i <= 6; i++) {
      expect(computeWordBudget(i)).toBe(base + i * 80);
    }
  });
});

// ─── compressEvidenceForSynthesis ─────────────────────────────────────────────

const makeSkillOutput = (
  skillId: string,
  claims: Array<{ claim_text: string; severity: 'critical' | 'warning' | 'info' }>,
  textOutput?: string
): SkillOutput => ({
  skillId,
  output: textOutput ?? '',
  summary: '',
  tokenUsage: null,
  duration: 0,
  evidence: claims.length > 0 ? {
    claims: claims.map((c, i) => ({
      claim_id: `c${i}`,
      claim_text: c.claim_text,
      severity: c.severity,
      entity_type: 'deal' as const,
      entity_ids: [],
      metric_name: '',
      metric_values: [],
      threshold_applied: '',
    })),
    evaluated_records: [],
    data_sources: [],
    parameters: [],
  } : undefined,
});

describe('compressEvidenceForSynthesis', () => {
  it('returns fallback string when skillOutputs is empty', () => {
    const result = compressEvidenceForSynthesis({});
    expect(result).toBe('(No findings from skill runs)');
  });

  it('uses text output as fallback when no claims present', () => {
    const outputs = {
      hygiene: makeSkillOutput('pipeline-hygiene', [], 'Pipeline is healthy with 12 active deals.'),
    };
    const result = compressEvidenceForSynthesis(outputs);
    expect(result).toContain('### Pipeline Hygiene');
    expect(result).toContain('Pipeline is healthy with 12 active deals.');
  });

  it('renders claim lines with severity prefixes', () => {
    const outputs = {
      hygiene: makeSkillOutput('pipeline-hygiene', [
        { claim_text: '5 deals stale >30 days', severity: 'critical' },
        { claim_text: '3 deals single-threaded', severity: 'warning' },
        { claim_text: 'Pipeline coverage is 3.2x', severity: 'info' },
      ]),
    };
    const result = compressEvidenceForSynthesis(outputs);
    expect(result).toContain('⚠ 5 deals stale >30 days');
    expect(result).toContain('• 3 deals single-threaded');
    expect(result).toContain('– Pipeline coverage is 3.2x');
  });

  it('sorts claims critical → warning → info regardless of input order', () => {
    const outputs = {
      hygiene: makeSkillOutput('pipeline-hygiene', [
        { claim_text: 'Info claim', severity: 'info' },
        { claim_text: 'Warning claim', severity: 'warning' },
        { claim_text: 'Critical claim', severity: 'critical' },
      ]),
    };
    const result = compressEvidenceForSynthesis(outputs);
    const critIdx = result.indexOf('⚠ Critical claim');
    const warnIdx = result.indexOf('• Warning claim');
    const infoIdx = result.indexOf('– Info claim');
    expect(critIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(infoIdx);
  });

  it('takes at most 5 claims per skill', () => {
    const manyClaims = Array.from({ length: 10 }, (_, i) => ({
      claim_text: `Claim number ${i + 1}`,
      severity: 'info' as const,
    }));
    const outputs = { hygiene: makeSkillOutput('pipeline-hygiene', manyClaims) };
    const result = compressEvidenceForSynthesis(outputs);
    expect(result).toContain('Claim number 5');
    expect(result).not.toContain('Claim number 6');
  });

  it('hard-caps output at 3000 chars with truncation marker', () => {
    const longText = 'A'.repeat(400);
    const outputs: Record<string, SkillOutput> = {};
    for (let i = 0; i < 20; i++) {
      outputs[`skill-${i}`] = makeSkillOutput(`skill-${i}`, [], longText);
    }
    const result = compressEvidenceForSynthesis(outputs);
    expect(result.length).toBeLessThanOrEqual(3100);
    expect(result).toContain('[additional findings truncated]');
  });
});

// ─── buildGoalAwareSynthesisPrompt ────────────────────────────────────────────

describe('buildGoalAwareSynthesisPrompt', () => {
  const goal = 'Hit $4M ARR by end of Q2 by closing the top 10 deals in commit.';
  const questions = [
    'Which commit deals are most at risk?',
    'What is the coverage ratio?',
    'Which reps are behind?',
  ];
  const skillOutputs = {
    hygiene: makeSkillOutput('pipeline-hygiene', [
      { claim_text: 'AcmeCorp deal has been stale for 21 days', severity: 'critical' },
    ]),
  };

  it('returns systemPrompt and userPrompt strings', () => {
    const { systemPrompt, userPrompt } = buildGoalAwareSynthesisPrompt(goal, questions, skillOutputs);
    expect(typeof systemPrompt).toBe('string');
    expect(typeof userPrompt).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(50);
    expect(userPrompt.length).toBeGreaterThan(100);
  });

  it('embeds the goal mandate in the user prompt', () => {
    const { userPrompt } = buildGoalAwareSynthesisPrompt(goal, questions, skillOutputs);
    expect(userPrompt).toContain(goal);
  });

  it('embeds all standing questions in the user prompt', () => {
    const { userPrompt } = buildGoalAwareSynthesisPrompt(goal, questions, skillOutputs);
    for (const q of questions) {
      expect(userPrompt).toContain(q);
    }
  });

  it('includes the three required section headers', () => {
    const { userPrompt } = buildGoalAwareSynthesisPrompt(goal, questions, skillOutputs);
    expect(userPrompt).toContain('## STATUS AGAINST GOAL');
    expect(userPrompt).toContain('## STANDING QUESTIONS');
    expect(userPrompt).toContain('## THIS WEEK\'S ACTIONS');
  });

  it('embeds the computed word budget in the user prompt', () => {
    const budget = computeWordBudget(questions.length);
    const { userPrompt } = buildGoalAwareSynthesisPrompt(goal, questions, skillOutputs);
    expect(userPrompt).toContain(`${budget} words maximum`);
  });

  it('embeds compressed evidence in the user prompt', () => {
    const { userPrompt } = buildGoalAwareSynthesisPrompt(goal, questions, skillOutputs);
    expect(userPrompt).toContain('AcmeCorp deal has been stale for 21 days');
  });
});
