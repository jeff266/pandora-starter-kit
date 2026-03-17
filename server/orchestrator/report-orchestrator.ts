import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { DOCUMENT_PLAYBOOKS, WORD_BUDGETS } from './playbooks.js';
import { OrchestratorInput, ReportDocument, ReportSection, SkillSummary, ChartSuggestion } from './types.js';

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

  // Generate chart suggestions based on skill summaries
  const chartSuggestions = generateChartSuggestions(sections, activeSkills);

  return {
    document_type: input.document_type,
    workspace_id: input.workspace_id,
    agent_run_id: input.agent_run_id,
    generated_at: new Date().toISOString(),
    week_label: input.workspace_context.week_label,
    headline: parsed.headline,
    sections,
    actions: (parsed.actions || []).slice(0, 5),
    recommended_next_steps: parsed.recommended_next_steps || '',
    chart_suggestions: chartSuggestions,
    skills_included: activeSkills.map(s => s.skill_id),
    skills_omitted: [
      ...omittedSkills,
      ...(parsed.skills_omitted || []),
    ],
    total_word_count: totalWords,
    tokens_used: tokensUsed,
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
