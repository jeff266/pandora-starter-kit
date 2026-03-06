/**
 * Custom Skill Builder
 *
 * Converts a custom_skills DB row into a valid SkillDefinition that the
 * skill registry and runtime can execute. The compute step resolves
 * dynamically at runtime via the fallback path in executeComputeStep —
 * no hardcoded toolRegistry entry required.
 */

import type { SkillDefinition, SkillStep, SkillCategory } from './types.js';

export interface CustomSkillRow {
  id: string;
  workspace_id: string;
  skill_id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  query_source: 'saved_query' | 'inline_sql';
  saved_query_id?: string | null;
  saved_query_name?: string | null;
  inline_sql?: string | null;
  classify_enabled: boolean;
  classify_bad?: string | null;
  classify_good?: string | null;
  synthesize_enabled: boolean;
  synthesize_tone?: string | null;
  synthesize_custom_prompt?: string | null;
  output_slack: boolean;
  output_report: boolean;
  schedule_cron?: string | null;
  replaces_skill_id?: string | null;
  status: string;
  last_run_at?: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

const TONE_PREFIXES: Record<string, string> = {
  'Flag risks': 'You are a revenue analyst. Surface risks and required actions. Be specific — use names and numbers.',
  'Highlight opportunities': 'You are a revenue analyst. Surface opportunities the team should act on this week.',
  'Weekly summary': 'You are a revenue analyst writing the weekly summary. Be concise and scannable.',
};

export function buildCustomSkillDefinition(row: CustomSkillRow): SkillDefinition {
  const computeFn = row.query_source === 'saved_query'
    ? (row.saved_query_name ?? row.skill_id)
    : row.skill_id;

  const steps: SkillStep[] = [];

  steps.push({
    id: 'fetch-data',
    name: 'Fetch Data',
    tier: 'compute',
    computeFn,
    computeArgs: {},
    outputKey: 'raw_data',
  });

  const classifyDepends: string[] = [];

  if (row.classify_enabled && (row.classify_bad || row.classify_good)) {
    classifyDepends.push('classify-rows');
    steps.push({
      id: 'classify-rows',
      name: 'Classify Rows with AI',
      tier: 'deepseek',
      dependsOn: ['fetch-data'],
      deepseekPrompt: `You are a sales operations analyst reviewing the following data.
For each item, classify as 'risk' or 'healthy'.
A 'risk' item: ${row.classify_bad || 'shows signs of problems or underperformance'}
A 'healthy' item: ${row.classify_good || 'is performing well or on track'}
Data: {{{json raw_data.rows}}}
Return ONLY valid JSON: { "classifications": [{ "id": "...", "status": "risk|healthy", "reason": "1 sentence" }] }`,
      outputKey: 'classifications',
    });
  }

  if (row.synthesize_enabled) {
    let claudePrefix: string;
    if (row.synthesize_tone === 'Custom' && row.synthesize_custom_prompt) {
      claudePrefix = row.synthesize_custom_prompt;
    } else {
      claudePrefix = TONE_PREFIXES[row.synthesize_tone ?? 'Flag risks'] ?? TONE_PREFIXES['Flag risks'];
    }

    const claudePrompt = `${claudePrefix}

Question this skill answers: ${row.description}

Data: {{{json raw_data.rows}}}
${classifyDepends.length > 0 ? '\nClassifications: {{{json classifications}}}' : ''}

{{voiceBlock}}`;

    steps.push({
      id: 'synthesize-report',
      name: 'Synthesize Report',
      tier: 'claude',
      dependsOn: ['fetch-data', ...classifyDepends],
      claudePrompt,
      maxTokens: 2000,
      outputKey: 'report',
    });
  }

  const validCategories: SkillCategory[] = [
    'pipeline', 'deals', 'accounts', 'calls', 'forecasting', 'reporting',
    'operations', 'enrichment', 'intelligence', 'scoring', 'config',
    'data_enrichment', 'custom',
  ];
  const category = validCategories.includes(row.category as SkillCategory)
    ? (row.category as SkillCategory)
    : 'custom';

  return {
    id: row.skill_id,
    name: row.name,
    description: row.description,
    version: row.version,
    category,
    tier: 'mixed',
    requiredTools: [],
    requiredContext: [],
    steps,
    schedule: row.schedule_cron
      ? { cron: row.schedule_cron, trigger: 'on_demand' }
      : undefined,
    outputFormat: 'markdown',
    estimatedDuration: '60s',
    isCustom: true,
    ...(row.replaces_skill_id ? { replacesSkillId: row.replaces_skill_id } : {}),
  };
}
