import type { MethodologyComparison, StructuredSkillOutput } from '../skills/types.js';

const APPROX_CHARS_PER_TOKEN = 4;

export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...[truncated]';
}

export interface ExtractedSkillContext {
  narrative: string;
  methodologyComparisons: MethodologyComparison[];
}

export function extractSkillContext(skillResult: unknown): ExtractedSkillContext {
  if (!skillResult) {
    return { narrative: '', methodologyComparisons: [] };
  }

  if (typeof skillResult === 'string') {
    return { narrative: skillResult, methodologyComparisons: [] };
  }

  if (typeof skillResult === 'object' && !Array.isArray(skillResult)) {
    const result = skillResult as Record<string, unknown>;

    if ('narrative' in result && typeof result.narrative === 'string') {
      const comparisons = Array.isArray(result.methodologyComparisons)
        ? (result.methodologyComparisons as MethodologyComparison[])
        : [];
      return {
        narrative: result.narrative,
        methodologyComparisons: comparisons,
      };
    }

    if ('summary' in result && typeof result.summary === 'string') {
      return { narrative: result.summary, methodologyComparisons: [] };
    }

    const jsonStr = JSON.stringify(skillResult);
    return { narrative: jsonStr, methodologyComparisons: [] };
  }

  return { narrative: String(skillResult), methodologyComparisons: [] };
}

export interface SkillContextBlock {
  text: string;
  methodologyComparisons: MethodologyComparison[];
}

export function buildSkillContextBlock(
  results: Record<string, unknown>,
  maxTokensPerSkill = 500,
  maxTotalTokens = 3000
): SkillContextBlock {
  const allComparisons: MethodologyComparison[] = [];
  const sections: string[] = [];
  let totalTokensUsed = 0;

  for (const [skillId, rawResult] of Object.entries(results)) {
    if (!rawResult) continue;

    const { narrative, methodologyComparisons } = extractSkillContext(rawResult);

    if (methodologyComparisons.length > 0) {
      allComparisons.push(...methodologyComparisons);
    }

    if (!narrative) continue;

    const remainingBudget = maxTotalTokens - totalTokensUsed;
    if (remainingBudget <= 0) break;

    const tokenBudget = Math.min(maxTokensPerSkill, remainingBudget);
    const truncated = truncateToTokens(narrative, tokenBudget);
    const tokenCount = Math.ceil(truncated.length / APPROX_CHARS_PER_TOKEN);
    totalTokensUsed += tokenCount;

    sections.push(`### ${skillId}\n${truncated}`);
  }

  return {
    text: sections.join('\n\n'),
    methodologyComparisons: allComparisons,
  };
}

export function formatMethodologyComparisons(
  comparisons: MethodologyComparison[],
  mode: 'ask_pandora' | 'slack' = 'ask_pandora'
): string {
  if (comparisons.length === 0) return '';

  const relevant = comparisons.filter(c => c.severity !== 'info');
  if (relevant.length === 0) return '';

  if (mode === 'slack') {
    const alerts = relevant.filter(c => c.severity === 'alert');
    if (alerts.length === 0) return '';
    return alerts
      .map(c => `⟳ _Methodology note (${c.metric}): ${c.gapExplanation}_`)
      .join('\n');
  }

  return relevant
    .map(c => {
      const prefix = c.severity === 'alert' ? '⚠️' : '⟳';
      const p = c.primaryMethod;
      const s = c.secondaryMethod;
      const coverageLine = p && s
        ? ` ${p.value}${p.unit === 'multiplier' ? 'x' : ''} (${p.label}) vs ${s.value}${s.unit === 'multiplier' ? 'x' : ''} (${s.label}).`
        : '';
      return `${prefix} **Methodology note (${c.metric})**:${coverageLine} ${c.gapExplanation}`;
    })
    .join('\n\n');
}
