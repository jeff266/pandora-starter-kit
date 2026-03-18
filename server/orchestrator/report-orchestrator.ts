import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { DOCUMENT_PLAYBOOKS, WORD_BUDGETS } from './playbooks.js';
import { OrchestratorInput, ReportDocument, ReportSection, SkillSummary, ChartSuggestion } from './types.js';
import { generateAllReasoningTrees } from './question-tree.js';

export async function runReportOrchestrator(
  input: OrchestratorInput
): Promise<ReportDocument> {
  const runId = randomUUID();
  const playbook = DOCUMENT_PLAYBOOKS[input.document_type];

  // Only pass skills with actual signal
  const activeSkills = input.skill_summaries.filter(s => s.has_signal);
  const omittedSkills = input.skill_summaries
    .filter(s => !s.has_signal)
    .map(s => s.skill_id);

  if (activeSkills.length === 0) {
    throw new Error(
      `Orchestrator: No skills had signal for ${input.document_type}. ` +
      `Cannot produce report. Run ID: ${runId}`
    );
  }

  const summariesBlock = formatSummariesForClaude(activeSkills);

  const staleWarnings = activeSkills
    .filter(s => s.data_age_hours > 48)
    .map(s => `${s.skill_id}: ${s.data_age_hours}h old`);

  const conflicts = activeSkills
    .filter(s => s.conflicts_with?.length)
    .map(s =>
      `${s.skill_id} conflicts with ${s.conflicts_with!.join(', ')}`
    );

  const systemPrompt = `
${playbook}

ADDITIONAL RULES:
- If two skills report conflicting data, use the more recent run
  and note the discrepancy in one sentence only.
- Skills with data older than 48 hours: use past tense only.
- Never fabricate specifics not in the skill summaries.
- recommended_next_steps: consulting voice, "We recommend..." framing,
  no "Owned by: Team", no command language.
- Deduplicate: same deal mentioned once across all sections.
- Omit any section where you have no meaningful data.
  Return fewer sections rather than padding with empty content.

REQUIRED OUTPUT FORMAT — respond with ONLY valid JSON:
{
  "headline": "string",
  "sections": [
    {
      "id": "string",
      "title": "string",
      "content": "string",
      "source_skills": ["skill_id"]
    }
  ],
  "actions": [
    {
      "urgency": "today|this_week|this_month",
      "text": "string",
      "deal_name": "string or null",
      "deal_id": "string or null",
      "source_id": "string or null",
      "rep_name": "string or null",
      "owner_email": "string or null"
    }
  ],
  "recommended_next_steps": "string",
  "skills_omitted": ["skill_id"]
}
`.trim();

  const userMessage = `
COMPANY: ${input.workspace_context.company_name}
PERIOD: ${input.workspace_context.week_label}
QUARTER: ${input.workspace_context.days_remaining_in_quarter} days remaining
${input.workspace_context.has_quota
  ? `ATTAINMENT: ${input.workspace_context.attainment_pct ?? 'unknown'}%`
  : 'QUOTA: Not configured — use absolute metrics only'}
${input.workspace_context.prior_report_headline
  ? `LAST WEEK: ${input.workspace_context.prior_report_headline}`
  : ''}
${conflicts.length
  ? `\nDATA CONFLICTS:\n${conflicts.join('\n')}`
  : ''}
${staleWarnings.length
  ? `\nSTALE DATA (>48h old):\n${staleWarnings.join('\n')}`
  : ''}

SKILL SUMMARIES:
${summariesBlock}

Word budget: ${input.word_budget} words total across all sections.
`.trim();

  const response = await callLLM(input.workspace_id, 'reason', {
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 2500,
    temperature: 0.2,
    _tracking: {
      workspaceId: input.workspace_id,
      skillId: 'report-orchestrator',
      skillRunId: runId,
      phase: 'synthesize',
      stepName: 'orchestrate',
    },
  });

  const tokensUsed =
    (response.usage?.input || 0) +
    (response.usage?.output || 0);

  // Parse response
  let parsed: any;
  try {
    const raw = response.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Orchestrator: JSON parse failed. Run ID: ${runId}. ` +
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!parsed.headline || !Array.isArray(parsed.sections)) {
    throw new Error(
      `Orchestrator: Missing headline or sections. Run ID: ${runId}`
    );
  }

  const sections: ReportSection[] = parsed.sections.map((s: any) => ({
    id: s.id,
    title: s.title,
    content: s.content,
    word_count: s.content
      ? s.content.split(/\s+/).filter(Boolean).length
      : 0,
    source_skills: s.source_skills || [],
    severity: deriveSectionSeverity(s.id, activeSkills),
    flagged_for_client: false,
  }));

  const totalWords = sections.reduce((sum, s) => sum + s.word_count, 0);

  // Generate reasoning trees in parallel (non-fatal)
  let treeMap = new Map<string, any[]>();
  let treeTokens = 0;
  try {
    treeMap = await generateAllReasoningTrees(
      sections,
      activeSkills,
      input.workspace_id,
      {
        company_name: input.workspace_context.company_name,
        days_remaining_in_quarter:
          input.workspace_context.days_remaining_in_quarter,
        has_quota: input.workspace_context.has_quota,
      }
    );
    // Estimate tokens used by question tree (rough calculation)
    treeTokens = treeMap.size * 800;  // ~800 tokens per section
  } catch (err) {
    console.error('[Orchestrator] Question tree failed:', err);
  }

  // Attach trees to sections
  const sectionsWithTrees = sections.map(section => ({
    ...section,
    reasoning_tree: treeMap.get(section.id) || [],
  }));

  // Generate chart suggestions based on skill summaries and reasoning tree hints
  const baseChartSuggestions = generateChartSuggestions(sectionsWithTrees, activeSkills);
  const treeChartSuggestions = extractChartHintsFromTrees(sectionsWithTrees, activeSkills);

  // Merge: tree-derived hints take priority over generic suggestions for same section
  const chartSuggestions = mergeChartSuggestions(baseChartSuggestions, treeChartSuggestions);

  return {
    document_type: input.document_type,
    workspace_id: input.workspace_id,
    agent_run_id: input.agent_run_id,
    generated_at: new Date().toISOString(),
    week_label: input.workspace_context.week_label,
    headline: parsed.headline,
    sections: sectionsWithTrees,
    actions: (parsed.actions || []).slice(0, 5),
    recommended_next_steps: parsed.recommended_next_steps || '',
    chart_suggestions: chartSuggestions,
    skills_included: activeSkills.map(s => s.skill_id),
    skills_omitted: [
      ...omittedSkills,
      ...(parsed.skills_omitted || []),
    ],
    total_word_count: totalWords,
    tokens_used: tokensUsed + treeTokens,
    orchestrator_run_id: runId,
  };
}

function formatSummariesForClaude(summaries: SkillSummary[]): string {
  return summaries.map(s => {
    const metrics = Object.entries(s.key_metrics)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    const findings = s.top_findings
      .map(f => `  • ${f}`)
      .join('\n');

    const actions = s.top_actions
      .map(a =>
        `  [${a.urgency}] ${a.text}` +
        (a.deal_name ? ` (${a.deal_name})` : '') +
        (a.deal_id ? ` [deal_id:${a.deal_id}]` : '')
      )
      .join('\n');

    return [
      `### ${s.skill_id} (${s.data_age_hours}h ago)`,
      `HEADLINE: ${s.headline}`,
      `METRICS:\n${metrics}`,
      `FINDINGS:\n${findings}`,
      `ACTIONS:\n${actions}`,
      s.conflicts_with?.length
        ? `CONFLICTS WITH: ${s.conflicts_with.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }).join('\n\n');
}

function deriveSectionSeverity(
  sectionId: string,
  summaries: SkillSummary[]
): 'critical' | 'warning' | 'info' {
  const sectionSkillMap: Record<string, string[]> = {
    the_number:             ['forecast-rollup'],
    the_story:              ['pipeline-waterfall', 'weekly-recap'],
    deals_requiring_action: ['deal-risk-review', 'pipeline-hygiene'],
    rep_status:             ['rep-scorecard'],
    pipeline_health:        ['pipeline-coverage', 'single-thread-alert'],
  };

  const relevant = summaries.filter(s =>
    (sectionSkillMap[sectionId] || []).includes(s.skill_id)
  );

  const hasZeroSignal = relevant.some(s =>
    s.headline.toLowerCase().includes('zero') ||
    s.headline.toLowerCase().includes('no activity') ||
    s.headline.toLowerCase().includes('stagnation')
  );

  if (hasZeroSignal) return 'critical';
  if (relevant.length > 0) return 'warning';
  return 'info';
}

function generateChartSuggestions(
  sections: ReportSection[],
  skillSummaries: SkillSummary[]
): ChartSuggestion[] {
  const suggestions: ChartSuggestion[] = [];

  // Create a map of skill summaries by skill_id for quick lookup
  const skillMap = new Map(skillSummaries.map(s => [s.skill_id, s]));

  for (const section of sections) {
    const relevantSkills = section.source_skills
      .map(skillId => skillMap.get(skillId))
      .filter(Boolean) as SkillSummary[];

    if (relevantSkills.length === 0) continue;

    // Generate chart suggestions based on section and skill data
    if (section.id === 'the_number') {
      // Forecast rollup: show landing zone bear/base/bull
      const forecastSkill = relevantSkills.find(s => s.skill_id === 'forecast-rollup');
      if (forecastSkill && forecastSkill.key_metrics.bear && forecastSkill.key_metrics.bull) {
        suggestions.push({
          section_id: section.id,
          chart_type: 'bar',
          title: 'Forecast Landing Zone',
          data_labels: ['Bear', 'Base', 'Bull'],
          data_values: [
            Number(forecastSkill.key_metrics.bear) || 0,
            Number(forecastSkill.key_metrics.base) || Number(forecastSkill.key_metrics.closed_won) + Number(forecastSkill.key_metrics.best_case) / 2 || 0,
            Number(forecastSkill.key_metrics.bull) || 0,
          ],
          reasoning: 'Shows forecast range for quarter-end landing zone',
          priority: 'high',
        });
      }
    }

    if (section.id === 'the_story') {
      // Pipeline waterfall: show movement (created, advanced, regressed, won, lost)
      const waterfallSkill = relevantSkills.find(s => s.skill_id === 'pipeline-waterfall');
      if (waterfallSkill) {
        suggestions.push({
          section_id: section.id,
          chart_type: 'bar',
          title: 'Pipeline Movement This Week',
          data_labels: ['Created', 'Advanced', 'Regressed', 'Won', 'Lost'],
          data_values: [
            Number(waterfallSkill.key_metrics.created) || 0,
            Number(waterfallSkill.key_metrics.advanced) || 0,
            Number(waterfallSkill.key_metrics.regressed) || 0,
            Number(waterfallSkill.key_metrics.closed_won_count) || 0,
            Number(waterfallSkill.key_metrics.closed_lost_count) || 0,
          ],
          reasoning: 'Visualizes deal flow and pipeline velocity',
          priority: 'high',
        });
      }
    }

    if (section.id === 'deals_requiring_action') {
      // Deal risk: pie chart of risk types
      const riskSkill = relevantSkills.find(s => s.skill_id === 'deal-risk-review');
      if (riskSkill && Number(riskSkill.key_metrics.deals_at_risk) > 0) {
        suggestions.push({
          section_id: section.id,
          chart_type: 'doughnut',
          title: 'Deals at Risk by Type',
          data_labels: ['At Risk', 'Healthy'],
          data_values: [
            Number(riskSkill.key_metrics.deals_at_risk) || 0,
            Math.max(0, 20 - (Number(riskSkill.key_metrics.deals_at_risk) || 0)), // Assume ~20 total deals
          ],
          reasoning: 'Shows proportion of deals requiring attention',
          priority: 'medium',
        });
      }
    }

    if (section.id === 'pipeline_health') {
      // Pipeline coverage: show coverage ratio vs target
      const coverageSkill = relevantSkills.find(s => s.skill_id === 'pipeline-coverage');
      if (coverageSkill) {
        const coverageRatio = Number(coverageSkill.key_metrics.coverage_ratio) || 0;
        const targetRatio = Number(coverageSkill.key_metrics.target_ratio) || 3;
        suggestions.push({
          section_id: section.id,
          chart_type: 'horizontalBar',
          title: 'Pipeline Coverage vs Target',
          data_labels: ['Current Coverage', 'Target Coverage'],
          data_values: [coverageRatio, targetRatio],
          reasoning: 'Compares current coverage to 3x target',
          priority: coverageRatio < targetRatio ? 'high' : 'medium',
        });
      }
    }
  }

  return suggestions.slice(0, 6); // Max 6 charts per report
}

function extractChartHintsFromTrees(
  sections: ReportSection[],
  skillSummaries: SkillSummary[]
): ChartSuggestion[] {
  const suggestions: ChartSuggestion[] = [];

  for (const section of sections) {
    if (!section.reasoning_tree?.length) continue;

    for (const node of section.reasoning_tree) {
      if (!node.chart_hint || node.data_gap) continue;

      // Try to resolve actual data from skill summaries
      const chartData = resolveChartData(
        node.chart_hint.data_description,
        section.source_skills,
        skillSummaries
      );

      if (chartData && chartData.length >= 2) {
        suggestions.push({
          section_id: section.id,
          chart_type: node.chart_hint.type as any,
          title: node.chart_hint.title,
          data_labels: chartData.map(d => d.label),
          data_values: chartData.map(d => d.value),
          reasoning: node.question,
          priority: 'high',
        });
        break; // One chart per section from tree
      }
    }
  }

  return suggestions;
}

function resolveChartData(
  description: string,
  sourceSkills: string[],
  summaries: SkillSummary[]
): Array<{ label: string; value: number }> | null {
  const desc = description.toLowerCase();

  // Rep comparison
  if (desc.includes('rep') &&
      (desc.includes('pipeline') || desc.includes('closed'))) {
    const coverage = summaries.find(s =>
      s.skill_id === 'pipeline-coverage' ||
      s.skill_id === 'rep-scorecard'
    );
    if (!coverage) return null;

    const repData: { label: string; value: number }[] = [];
    const metrics = coverage.key_metrics;

    for (const [key, val] of Object.entries(metrics)) {
      if ((key.includes('rep') || key.includes('owner'))
          && (key.includes('pipeline') ||
              key.includes('closed'))) {
        const label = key
          .replace(/_pipeline|_closed|_open/g, '')
          .replace(/_/g, ' ')
          .trim();
        const value = Math.round(Number(val) / 1000);
        if (value > 0 && label.length > 0) {
          repData.push({ label, value });
        }
      }
    }
    return repData.length >= 2 ? repData : null;
  }

  // Forecast scenarios
  if (desc.includes('forecast') || desc.includes('bear') ||
      desc.includes('bull') || desc.includes('landing')) {
    const forecast = summaries.find(
      s => s.skill_id === 'forecast-rollup'
    );
    if (!forecast) return null;

    const bear = Math.round(
      Number(forecast.key_metrics['bear'] || 0) / 1000
    );
    const base = Math.round(
      Number(forecast.key_metrics['base'] || 0) / 1000
    );
    const bull = Math.round(
      Number(forecast.key_metrics['bull'] || 0) / 1000
    );

    if (bear + base + bull === 0) return null;
    return [
      { label: 'Bear', value: bear },
      { label: 'Base', value: base },
      { label: 'Bull', value: bull },
    ].filter(d => d.value > 0);
  }

  // Pipeline movement
  if (desc.includes('movement') || desc.includes('created') ||
      desc.includes('advanced') || desc.includes('won')) {
    const waterfall = summaries.find(
      s => s.skill_id === 'pipeline-waterfall'
    );
    if (!waterfall) return null;

    const m = waterfall.key_metrics;
    return [
      { label: 'Created',
        value: Number(m['created'] || 0) },
      { label: 'Advanced',
        value: Number(m['advanced'] || 0) },
      { label: 'Regressed',
        value: Number(m['regressed'] || 0) },
      { label: 'Won',
        value: Number(m['closed_won_count']
          || m['won'] || 0) },
      { label: 'Lost',
        value: Number(m['closed_lost_count']
          || m['lost'] || 0) },
    ].filter(d => d.value > 0);
  }

  return null;
}

function mergeChartSuggestions(
  base: ChartSuggestion[],
  treeHints: ChartSuggestion[]
): ChartSuggestion[] {
  // Tree-derived hints take priority over generic suggestions for the same section
  const merged = new Map<string, ChartSuggestion>();

  // Add base suggestions first
  for (const suggestion of base) {
    merged.set(suggestion.section_id, suggestion);
  }

  // Override with tree hints (higher priority)
  for (const suggestion of treeHints) {
    merged.set(suggestion.section_id, suggestion);
  }

  return Array.from(merged.values()).slice(0, 6);
}
