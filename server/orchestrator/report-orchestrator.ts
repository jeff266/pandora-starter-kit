import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { DOCUMENT_PLAYBOOKS, WORD_BUDGETS } from './playbooks.js';
import { OrchestratorInput, ReportDocument, ReportSection, SkillSummary, ChartSuggestion, HypothesisUpdate, PriorContext } from './types.js';
import { updateHypotheses } from './hypothesis-updater.js';

/**
 * Loads active hypotheses from standing_hypotheses table
 */
async function loadHypotheses(workspaceId: string): Promise<PriorContext['hypotheses']> {
  try {
    const result = await query(`
      SELECT
        metric_key,
        hypothesis_text,
        confidence,
        current_value,
        threshold,
        unit
      FROM standing_hypotheses
      WHERE workspace_id = $1
        AND status = 'active'
        AND metric_key IS NOT NULL
        AND hypothesis_text IS NOT NULL
        AND confidence IS NOT NULL
      ORDER BY confidence DESC
    `, [workspaceId]);

    return result.rows.map(row => ({
      metric_key: row.metric_key,
      hypothesis_text: row.hypothesis_text,
      confidence: Number(row.confidence),
      current_value: Number(row.current_value || 0),
      threshold: Number(row.threshold || 0),
      unit: row.unit || '$',
      trend: undefined,
    }));
  } catch (err) {
    console.error('[Orchestrator] Failed to load hypotheses:', err);
    return [];
  }
}

function buildIssueTreeStructure(nodes: NonNullable<OrchestratorInput['issue_tree_nodes']>): string {
  const sorted = [...nodes].sort((a, b) => a.position - b.position);
  const lines = sorted.map((node, i) => {
    const skillsHint = node.primary_skill_ids.length > 0
      ? ` (draw primarily from: ${node.primary_skill_ids.join(', ')})`
      : '';
    const question = node.standing_question
      ? `\n   Answer: "${node.standing_question}"`
      : '';
    return `${i + 1}. id: "${node.node_id}" — Title: "${node.title}"${skillsHint}${question}`;
  });
  return `STRUCTURE — produce sections in this exact order:\n\n${lines.join('\n\n')}`;
}

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

  // If issue tree nodes provided, override the STRUCTURE block in the playbook
  const usingIssueTree = input.issue_tree_nodes && input.issue_tree_nodes.length > 0;
  const effectivePlaybook = usingIssueTree
    ? playbook.replace(
        /STRUCTURE[^\n]*\n([\s\S]*?)(?=\nTOTAL TARGET|\nVOICE|\nOMIT|\nDEDUPLICATION|\nCONFLICTS|$)/,
        buildIssueTreeStructure(input.issue_tree_nodes!) + '\n'
      )
    : playbook;

  if (usingIssueTree) {
    console.log(`[Orchestrator] Using issue tree: ${input.issue_tree_nodes!.length} nodes`);
  }

  const systemPrompt = `
${effectivePlaybook}

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
  let chartSuggestions: ChartSuggestion[] = [];
  try {
    chartSuggestions = generateChartSuggestions(sections, activeSkills);
    console.log(`[Orchestrator] Generated ${chartSuggestions.length} chart suggestion(s) for ${chartSuggestions.map(s => s.section_id).join(', ') || 'none'}`);
  } catch (err) {
    console.error('[Orchestrator] Chart suggestion generation failed:', err);
    // Non-fatal — continue without suggestions
  }

  // Update hypothesis confidence scores based on this week's skill data
  let hypothesisUpdates: HypothesisUpdate[] = [];
  try {
    const hypotheses = await loadHypotheses(input.workspace_id);
    if (hypotheses.length > 0) {
      hypothesisUpdates = await updateHypotheses(
        input.workspace_id,
        hypotheses,
        activeSkills
      );
      console.log(`[Orchestrator] Updated ${hypothesisUpdates.length} hypotheses`);
    }
  } catch (err) {
    console.error('[Orchestrator] Hypothesis update failed:', err);
    // Non-fatal — continue without hypothesis updates
  }

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
    hypothesis_updates: hypothesisUpdates,
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

  // Skill lookup — check by section source_skills first, then fall back to any available skill
  const skillMap = new Map(skillSummaries.map(s => [s.skill_id, s]));

  function findSkill(sectionSkills: string[], ...skillIds: string[]): SkillSummary | undefined {
    // Prefer skills that are listed in the section's source_skills
    for (const id of skillIds) {
      if (sectionSkills.includes(id) && skillMap.has(id)) return skillMap.get(id);
    }
    // Fall back to any matching skill in the run (section attribution may be imperfect)
    for (const id of skillIds) {
      if (skillMap.has(id)) return skillMap.get(id);
    }
    return undefined;
  }

  // ── the_number: Forecast Landing Zone (Bear / Base / Bull) ──────────────────
  const numberSection = sections.find(s => s.id === 'the_number');
  const forecastSkill = findSkill(numberSection?.source_skills ?? [], 'forecast-rollup');
  if (forecastSkill) {
    const bear  = Number(forecastSkill.key_metrics.bear)  || 0;
    const base  = Number(forecastSkill.key_metrics.base)  || 0;
    const bull  = Number(forecastSkill.key_metrics.bull)  || 0;
    const closedWon = Number(forecastSkill.key_metrics.closed_won) || 0;

    // Need at least one non-zero scenario value
    if (bear > 0 || bull > 0 || closedWon > 0) {
      const effectiveBear = bear || closedWon;
      const effectiveBase = base || (closedWon > 0 ? Math.round(closedWon * 1.1) : 0);
      const effectiveBull = bull || (closedWon > 0 ? Math.round(closedWon * 1.2) : 0);

      // Convert to $K for display
      const toK = (v: number) => Math.round(v / 1000);
      suggestions.push({
        section_id: 'the_number',
        chart_type: 'bar',
        title: 'Forecast Landing Zone ($K)',
        data_labels: ['Bear', 'Base', 'Bull'],
        data_values: [toK(effectiveBear), toK(effectiveBase), toK(effectiveBull)],
        reasoning: 'Shows forecast range for quarter-end landing zone',
        priority: 'high',
      });
    }
  }

  // ── rep_status: Open Pipeline by Rep ($K) ────────────────────────────────
  const repSection = sections.find(s => s.id === 'rep_status');
  const coverageSkill = findSkill(repSection?.source_skills ?? [], 'pipeline-coverage', 'rep-scorecard');
  if (coverageSkill) {
    try {
      const repJson = String(coverageSkill.key_metrics.rep_pipeline_json || '[]');
      const repData: { name: string; pipeline: number }[] = JSON.parse(repJson);
      const validReps = repData.filter(r => r.pipeline > 0);
      if (validReps.length >= 2) {
        suggestions.push({
          section_id: 'rep_status',
          chart_type: 'horizontalBar',
          title: 'Open Pipeline by Rep ($K)',
          data_labels: validReps.map(r => r.name),
          data_values: validReps.map(r => r.pipeline),
          reasoning: 'Shows pipeline concentration across reps',
          priority: 'high',
        });
      }
    } catch {
      // rep_pipeline_json malformed — skip this suggestion
    }
  }

  // ── the_story: Pipeline Movement This Week ──────────────────────────────
  const storySection = sections.find(s => s.id === 'the_story');
  const waterfallSkill = findSkill(storySection?.source_skills ?? [], 'pipeline-waterfall');
  if (waterfallSkill) {
    const created  = Number(waterfallSkill.key_metrics.created) || 0;
    const advanced = Number(waterfallSkill.key_metrics.advanced) || 0;
    const regressed = Number(waterfallSkill.key_metrics.regressed) || 0;
    const won  = Number(waterfallSkill.key_metrics.closed_won_count) || 0;
    const lost = Number(waterfallSkill.key_metrics.closed_lost_count) || 0;

    if (created + advanced + regressed + won + lost > 0) {
      const allBars = [
        { label: 'Created', value: created },
        { label: 'Advanced', value: advanced },
        { label: 'Regressed', value: regressed },
        { label: 'Won', value: won },
        { label: 'Lost', value: lost },
      ].filter(d => d.value > 0);

      if (allBars.length >= 2) {
        suggestions.push({
          section_id: 'the_story',
          chart_type: 'bar',
          title: 'Pipeline Movement This Week',
          data_labels: allBars.map(d => d.label),
          data_values: allBars.map(d => d.value),
          reasoning: 'Visualizes deal flow and pipeline velocity',
          priority: 'high',
        });
      }
    }
  }

  // ── pipeline_health: Coverage vs Target ──────────────────────────────────
  const healthSection = sections.find(s => s.id === 'pipeline_health');
  const healthCoverageSkill = findSkill(healthSection?.source_skills ?? [], 'pipeline-coverage');
  if (healthCoverageSkill) {
    const coverageRatio = Number(healthCoverageSkill.key_metrics.coverage_ratio) || 0;
    const targetRatio   = Number(healthCoverageSkill.key_metrics.target_ratio) || 3;
    if (coverageRatio > 0) {
      suggestions.push({
        section_id: 'pipeline_health',
        chart_type: 'horizontalBar',
        title: 'Pipeline Coverage vs Target',
        data_labels: ['Current Coverage', 'Target'],
        data_values: [
          Math.round(coverageRatio * 10) / 10,
          targetRatio,
        ],
        reasoning: `${coverageRatio.toFixed(2)}x vs ${targetRatio}x target`,
        priority: coverageRatio < targetRatio ? 'high' : 'medium',
      });
    }
  }

  console.log(`[ChartSuggestions] Evaluated ${sections.length} sections, ${skillSummaries.length} skills → ${suggestions.length} suggestions`);
  return suggestions.slice(0, 6);
}
