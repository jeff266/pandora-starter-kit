// Section Content Generator
// Converts ReportSection → SectionContent by pulling from skill evidence

import { query } from '../db.js';
import { ReportSection, SectionContent, VoiceConfig, MetricCard, DealCard, ActionItem } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SectionGenerator');

interface SkillRunRow {
  skill_id: string;
  output: any;
  output_text: string | null;
  created_at: string;
  status: string;
}

interface SkillEvidence {
  skill_id: string;
  output: any;
  narrative: string;
  evidence: any;
  created_at: string;
}

const FRESHNESS_THRESHOLD_HOURS = 72;

async function fetchSkillEvidence(
  workspaceId: string,
  skillIds: string[]
): Promise<Map<string, SkillEvidence>> {
  if (skillIds.length === 0) return new Map();

  const result = await query<SkillRunRow>(
    `SELECT DISTINCT ON (skill_id) skill_id, output, output_text, created_at, status
     FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = ANY($2) AND status = 'completed' AND output IS NOT NULL
     ORDER BY skill_id, created_at DESC`,
    [workspaceId, skillIds]
  );

  const evidenceMap = new Map<string, SkillEvidence>();
  for (const row of result.rows) {
    let output = row.output;
    let narrative = '';
    let evidence: any = {};

    if (typeof output === 'string') {
      narrative = output;
    } else if (output && typeof output === 'object') {
      if (output.narrative) {
        narrative = output.narrative;
      }
      if (output.evidence) {
        evidence = output.evidence;
      }
      if (!output.narrative && !output.evidence) {
        narrative = row.output_text || JSON.stringify(output);
      }
    }

    if (!narrative && row.output_text) {
      narrative = row.output_text;
    }

    evidenceMap.set(row.skill_id, {
      skill_id: row.skill_id,
      output: typeof output === 'string' ? { narrative: output } : output,
      narrative,
      evidence,
      created_at: row.created_at,
    });
  }

  return evidenceMap;
}

function checkFreshness(evidence: SkillEvidence): { fresh: boolean; ageHours: number } {
  const ageMs = Date.now() - new Date(evidence.created_at).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return { fresh: ageHours <= FRESHNESS_THRESHOLD_HOURS, ageHours: Math.round(ageHours) };
}

function extractActionsFromNarrative(narrative: string): ActionItem[] {
  const actions: ActionItem[] = [];
  const actionsMatch = narrative.match(/<actions>\s*([\s\S]*?)\s*<\/actions>/);
  if (actionsMatch) {
    try {
      const parsed = JSON.parse(actionsMatch[1]);
      if (Array.isArray(parsed)) {
        for (const a of parsed.slice(0, 5)) {
          actions.push({
            owner: a.target_rep || a.owner || 'Team',
            action: a.title || a.summary || a.action || '',
            urgency: a.severity === 'critical' ? 'today' : a.severity === 'warning' ? 'this_week' : 'this_month',
            related_deal: a.target_deal_name || undefined,
          });
        }
      }
    } catch {}
  }
  return actions;
}

function stripActionTags(narrative: string): string {
  return narrative.replace(/<actions>[\s\S]*?<\/actions>/g, '').trim();
}

function cleanNarrative(narrative: string): string {
  let cleaned = stripActionTags(narrative);
  cleaned = cleaned.replace(/```json\s*\[[\s\S]*?\]\s*```/g, '').trim();
  if (cleaned.startsWith('[') || cleaned.startsWith('{')) {
    try {
      JSON.parse(cleaned);
      return '';
    } catch {}
  }
  return cleaned;
}

function parseMonteCarloMetrics(narrative: string): MetricCard[] {
  const metrics: MetricCard[] = [];
  const p50Match = narrative.match(/most likely outcome is \*\*\$([\d,.]+[KMB]?)\*\*/i);
  if (p50Match) {
    metrics.push({ label: 'Monte Carlo P50', value: `$${p50Match[1]}`, severity: 'good' });
  }
  const p25Match = narrative.match(/P25[^$]*\$([\d,.]+[KMB]?)/i);
  if (p25Match) {
    metrics.push({ label: 'P25 (Conservative)', value: `$${p25Match[1]}`, severity: 'warning' });
  }
  const p75Match = narrative.match(/P75[^$]*\$([\d,.]+[KMB]?)/i) || narrative.match(/optimistic[^$]*\$([\d,.]+[KMB]?)/i);
  if (p75Match) {
    metrics.push({ label: 'P75 (Optimistic)', value: `$${p75Match[1]}`, severity: 'good' });
  }
  return metrics;
}

function parseForecastMetrics(narrative: string): MetricCard[] {
  const metrics: MetricCard[] = [];
  const closedMatch = narrative.match(/[Cc]losed[- ]won[: ]*\$([\d,.]+[KMB]?)/);
  if (closedMatch) {
    metrics.push({ label: 'Closed Won', value: `$${closedMatch[1]}`, severity: 'good' });
  }
  const pipelineMatch = narrative.match(/[Pp]ipeline[: ]*\$([\d,.]+[KMB]?)/);
  if (pipelineMatch) {
    metrics.push({ label: 'Pipeline', value: `$${pipelineMatch[1]}`, severity: 'good' });
  }
  const attainmentMatch = narrative.match(/(\d+)%\s*attainment/i);
  if (attainmentMatch) {
    const pct = parseInt(attainmentMatch[1]);
    metrics.push({
      label: 'Attainment',
      value: `${pct}%`,
      severity: pct >= 80 ? 'good' : pct >= 50 ? 'warning' : 'critical',
    });
  }
  const weightedMatch = narrative.match(/[Ww]eighted forecast[^$]*\$([\d,.]+[KMB]?)/);
  if (weightedMatch) {
    metrics.push({ label: 'Weighted Forecast', value: `$${weightedMatch[1]}`, severity: 'good' });
  }
  return metrics;
}

function parseDealCards(narrative: string, maxItems: number): DealCard[] {
  const cards: DealCard[] = [];
  const actionsMatch = narrative.match(/<actions>\s*([\s\S]*?)\s*<\/actions>/);
  if (actionsMatch) {
    try {
      const parsed = JSON.parse(actionsMatch[1]);
      if (Array.isArray(parsed)) {
        for (const a of parsed.slice(0, maxItems)) {
          if (a.target_deal_name) {
            cards.push({
              name: a.target_deal_name,
              amount: a.target_deal_amount || '',
              owner: a.target_rep || '',
              stage: a.target_deal_stage || '',
              signal: a.title || '',
              signal_severity: a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info',
              detail: a.summary || '',
              action: Array.isArray(a.recommended_steps) ? a.recommended_steps[0] || '' : a.action || '',
            });
          }
        }
      }
    } catch {}
  }
  return cards;
}

export async function generateSectionContent(
  workspaceId: string,
  section: ReportSection,
  voiceConfig: VoiceConfig
): Promise<SectionContent> {
  logger.info('Generating section content', { section_id: section.id, skills: section.skills });

  const evidenceMap = await fetchSkillEvidence(workspaceId, section.skills);
  const maxItems = section.config.max_items || 10;

  const freshnessNotes: string[] = [];
  for (const [skillId, ev] of evidenceMap) {
    const { fresh, ageHours } = checkFreshness(ev);
    if (!fresh) {
      freshnessNotes.push(`${skillId} data is ${ageHours}h old`);
    }
  }

  const content: SectionContent = {
    section_id: section.id,
    title: section.label,
    narrative: '',
    source_skills: section.skills,
    data_freshness: getBestFreshness(evidenceMap),
    confidence: evidenceMap.size > 0 ? Math.min(0.95, 0.5 + (evidenceMap.size / section.skills.length) * 0.45) : 0.3,
    metrics: [],
    deal_cards: [],
    action_items: [],
  };

  if (freshnessNotes.length > 0) {
    content.confidence = Math.max(0.3, content.confidence - 0.2);
  }

  switch (section.id) {
    case 'the-number':
      buildTheNumber(content, evidenceMap);
      break;
    case 'what-moved':
      buildWhatMoved(content, evidenceMap, maxItems);
      break;
    case 'deals-needing-attention':
      buildDealsNeedingAttention(content, evidenceMap, maxItems);
      break;
    case 'rep-performance':
      buildRepPerformance(content, evidenceMap);
      break;
    case 'pipeline-hygiene':
      buildPipelineHygiene(content, evidenceMap, maxItems);
      break;
    case 'call-intelligence':
      buildCallIntelligence(content, evidenceMap, maxItems);
      break;
    case 'pipeline-coverage':
      buildPipelineCoverage(content, evidenceMap);
      break;
    case 'icp-fit-analysis':
      buildIcpFitAnalysis(content, evidenceMap, maxItems);
      break;
    case 'forecast-waterfall':
      buildForecastWaterfall(content, evidenceMap);
      break;
    case 'actions-summary':
      await buildActionsSummary(content, workspaceId);
      break;
    default:
      content.narrative = `Content for "${section.label}" section — no generator configured.`;
  }

  if (freshnessNotes.length > 0) {
    content.narrative += `\n\n_Note: ${freshnessNotes.join('; ')}._`;
  }

  return content;
}

function getBestFreshness(evidenceMap: Map<string, SkillEvidence>): string {
  let newest = '';
  for (const ev of evidenceMap.values()) {
    if (!newest || ev.created_at > newest) newest = ev.created_at;
  }
  return newest || new Date().toISOString();
}

function buildTheNumber(content: SectionContent, evidenceMap: Map<string, SkillEvidence>): void {
  const forecast = evidenceMap.get('forecast-rollup');
  const monteCarlo = evidenceMap.get('monte-carlo-forecast');

  const narrativeParts: string[] = [];

  if (forecast) {
    content.metrics = parseForecastMetrics(forecast.narrative);
    narrativeParts.push(stripActionTags(forecast.narrative));
    content.action_items = extractActionsFromNarrative(forecast.narrative);
  }

  if (monteCarlo) {
    const mcMetrics = parseMonteCarloMetrics(monteCarlo.narrative);
    content.metrics = [...(content.metrics || []), ...mcMetrics];
    if (!forecast) {
      narrativeParts.push(stripActionTags(monteCarlo.narrative));
    }
  }

  content.narrative = narrativeParts.join('\n\n') || 'No forecast data available. Run forecast-rollup and monte-carlo-forecast skills to populate this section.';
}

function buildWhatMoved(content: SectionContent, evidenceMap: Map<string, SkillEvidence>, maxItems: number): void {
  const forecast = evidenceMap.get('forecast-rollup');
  const waterfall = evidenceMap.get('pipeline-waterfall');

  const narrativeParts: string[] = [];

  if (waterfall) {
    narrativeParts.push(stripActionTags(waterfall.narrative));
    content.deal_cards = parseDealCards(waterfall.narrative, maxItems);
    content.action_items = extractActionsFromNarrative(waterfall.narrative);
  }

  if (forecast) {
    const fMetrics = parseForecastMetrics(forecast.narrative);
    content.metrics = fMetrics;
    if (!waterfall) {
      narrativeParts.push(stripActionTags(forecast.narrative));
    }
  }

  content.narrative = narrativeParts.join('\n\n') || 'No pipeline movement data available. Run pipeline-waterfall skill to populate this section.';
}

function buildDealsNeedingAttention(content: SectionContent, evidenceMap: Map<string, SkillEvidence>, maxItems: number): void {
  const riskReview = evidenceMap.get('deal-risk-review');
  const singleThread = evidenceMap.get('single-thread-alert');

  const allCards: DealCard[] = [];
  const allActions: ActionItem[] = [];
  const narrativeParts: string[] = [];

  if (riskReview) {
    const cards = parseDealCards(riskReview.narrative, maxItems);
    allCards.push(...cards);
    allActions.push(...extractActionsFromNarrative(riskReview.narrative));

    const jsonDeals = parseJsonDeals(riskReview.narrative);
    if (jsonDeals.length > 0) {
      for (const d of jsonDeals) {
        if (!allCards.find(c => c.name === d.name)) {
          allCards.push(d);
        }
      }
      const dealCount = jsonDeals.length;
      const critical = jsonDeals.filter(d => d.signal_severity === 'critical').length;
      narrativeParts.push(`**${dealCount} deals flagged for attention** — ${critical} critical risk, ${dealCount - critical} require monitoring.`);
    } else {
      const cleaned = cleanNarrative(riskReview.narrative);
      if (cleaned) narrativeParts.push(cleaned);
    }
  }

  if (singleThread) {
    const stCards = parseDealCards(singleThread.narrative, maxItems);
    for (const card of stCards) {
      if (!allCards.find(c => c.name === card.name)) {
        allCards.push(card);
      }
    }
    allActions.push(...extractActionsFromNarrative(singleThread.narrative));
    if (!riskReview) {
      const cleaned = cleanNarrative(singleThread.narrative);
      if (cleaned) narrativeParts.push(cleaned);
    }
  }

  content.deal_cards = allCards.slice(0, maxItems);
  content.action_items = allActions.slice(0, maxItems);
  content.narrative = narrativeParts.join('\n\n') || 'No risk-flagged deals found. Run deal-risk-review and single-thread-alert skills to populate this section.';
}

function parseJsonDeals(narrative: string): DealCard[] {
  const deals: DealCard[] = [];
  let jsonStr = narrative;
  const codeBlock = narrative.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlock) jsonStr = codeBlock[1];

  try {
    const parsed = JSON.parse(jsonStr.trim());
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const d of arr) {
      if (d.dealName || d.name) {
        const severity = (d.overallRisk === 'critical' || d.riskLevel === 'critical') ? 'critical' :
                         (d.overallRisk === 'medium' || d.riskLevel === 'medium') ? 'warning' : 'info';
        deals.push({
          name: d.dealName || d.name,
          amount: d.amount ? `$${(d.amount / 1000).toFixed(0)}K` : '',
          stage: d.currentStage || d.stage || '',
          signal: d.topRisk || d.signal || '',
          signal_severity: severity,
          owner: d.owner || '',
          days_in_stage: d.daysInStage || 0,
        });
      }
    }
  } catch {}
  return deals;
}

function buildRepPerformance(content: SectionContent, evidenceMap: Map<string, SkillEvidence>): void {
  const scorecard = evidenceMap.get('rep-scorecard');
  const coverage = evidenceMap.get('pipeline-coverage');

  if (scorecard) {
    content.narrative = stripActionTags(scorecard.narrative);
    content.action_items = extractActionsFromNarrative(scorecard.narrative);

    const repData = scorecard.evidence?.evaluated_records || [];
    if (repData.length > 0) {
      content.table = {
        headers: ['Rep', 'Pipeline', 'Deals', 'Win Rate'],
        rows: repData.slice(0, 10).map((r: any) => ({
          Rep: r.rep_name || r.name || 'Unknown',
          Pipeline: r.pipeline ? `$${(r.pipeline / 1000).toFixed(0)}K` : '-',
          Deals: r.deal_count || r.deals || '-',
          'Win Rate': r.win_rate ? `${Math.round(r.win_rate * 100)}%` : '-',
        })),
      };
    }
  } else if (coverage) {
    content.narrative = stripActionTags(coverage.narrative);
  } else {
    content.narrative = 'No rep performance data available. Run rep-scorecard skill to populate this section.';
  }
}

function buildPipelineHygiene(content: SectionContent, evidenceMap: Map<string, SkillEvidence>, maxItems: number): void {
  const hygiene = evidenceMap.get('pipeline-hygiene');
  const dataQuality = evidenceMap.get('data-quality-audit');
  const singleThread = evidenceMap.get('single-thread-alert');

  const narrativeParts: string[] = [];
  const allCards: DealCard[] = [];
  const allActions: ActionItem[] = [];

  if (hygiene) {
    narrativeParts.push(stripActionTags(hygiene.narrative));
    allCards.push(...parseDealCards(hygiene.narrative, maxItems));
    allActions.push(...extractActionsFromNarrative(hygiene.narrative));
  }

  if (dataQuality) {
    if (!hygiene) narrativeParts.push(stripActionTags(dataQuality.narrative));
    allActions.push(...extractActionsFromNarrative(dataQuality.narrative));
  }

  if (singleThread && !hygiene) {
    narrativeParts.push(stripActionTags(singleThread.narrative));
    allCards.push(...parseDealCards(singleThread.narrative, maxItems));
  }

  content.deal_cards = allCards.slice(0, maxItems);
  content.action_items = allActions.slice(0, maxItems);
  content.narrative = narrativeParts.join('\n\n') || 'No pipeline hygiene data available. Run pipeline-hygiene skill to populate this section.';
}

function buildCallIntelligence(content: SectionContent, evidenceMap: Map<string, SkillEvidence>, maxItems: number): void {
  const recap = evidenceMap.get('weekly-recap');

  if (recap) {
    content.narrative = stripActionTags(recap.narrative);
    content.action_items = extractActionsFromNarrative(recap.narrative);
    content.metrics = [];

    const callCountMatch = recap.narrative.match(/(\d+)\s*calls?/i);
    if (callCountMatch) {
      content.metrics.push({ label: 'Calls Analyzed', value: callCountMatch[1], severity: 'good' });
    }
  } else {
    content.narrative = 'No call intelligence data available. Connect a conversation intelligence source (Gong/Fireflies) and run weekly-recap skill.';
    content.metrics = [];
  }
}

function buildPipelineCoverage(content: SectionContent, evidenceMap: Map<string, SkillEvidence>): void {
  const coverage = evidenceMap.get('pipeline-coverage');
  const forecast = evidenceMap.get('forecast-rollup');

  if (coverage) {
    content.narrative = stripActionTags(coverage.narrative);
    content.action_items = extractActionsFromNarrative(coverage.narrative);
    content.metrics = [];

    const coverageMatch = coverage.narrative.match(/coverage[^0-9]*(\d+\.?\d*)x/i);
    if (coverageMatch) {
      const ratio = parseFloat(coverageMatch[1]);
      content.metrics.push({
        label: 'Coverage Ratio',
        value: `${ratio}x`,
        severity: ratio >= 3.0 ? 'good' : ratio >= 2.0 ? 'warning' : 'critical',
      });
    }

    const gapMatch = coverage.narrative.match(/gap[^$]*\$([\d,.]+[KMB]?)/i) || coverage.narrative.match(/need[^$]*\$([\d,.]+[KMB]?)\s*(?:in\s*)?new/i);
    if (gapMatch) {
      content.metrics.push({ label: 'New Pipeline Needed', value: `$${gapMatch[1]}`, severity: 'warning' });
    }
  } else if (forecast) {
    content.narrative = stripActionTags(forecast.narrative);
    content.metrics = parseForecastMetrics(forecast.narrative);
  } else {
    content.narrative = 'No pipeline coverage data available. Run pipeline-coverage skill to populate this section.';
    content.metrics = [];
  }
}

function buildIcpFitAnalysis(content: SectionContent, evidenceMap: Map<string, SkillEvidence>, maxItems: number): void {
  const icp = evidenceMap.get('icp-discovery');
  const scoring = evidenceMap.get('lead-scoring');

  if (icp) {
    content.narrative = stripActionTags(icp.narrative);
    content.action_items = extractActionsFromNarrative(icp.narrative);
    content.metrics = [];

    const matchMatch = icp.narrative.match(/(\d+)%\s*(?:of\s*)?(?:new\s*)?leads?\s*match/i);
    if (matchMatch) {
      content.metrics.push({ label: 'ICP Match Rate', value: `${matchMatch[1]}%`, severity: 'good' });
    }

    const scoreMatch = icp.narrative.match(/(?:avg|average)\s*fit\s*score\s*(?:of\s*)?(\d+)/i);
    if (scoreMatch) {
      content.metrics.push({ label: 'Avg Fit Score', value: scoreMatch[1], severity: 'good' });
    }
  } else {
    content.narrative = 'No ICP analysis data available. Run icp-discovery skill to populate this section.';
    content.metrics = [];
  }

  if (scoring && !icp) {
    content.narrative = stripActionTags(scoring.narrative);
  }
}

function buildForecastWaterfall(content: SectionContent, evidenceMap: Map<string, SkillEvidence>): void {
  const waterfall = evidenceMap.get('pipeline-waterfall');
  const velocity = evidenceMap.get('stage-velocity-benchmarks');

  if (waterfall) {
    content.narrative = stripActionTags(waterfall.narrative);
    content.action_items = extractActionsFromNarrative(waterfall.narrative);
    content.metrics = [];

    const netMatch = waterfall.narrative.match(/[Nn]et[^$]*\$?([\d,.]+[KMB]?)/);
    if (netMatch) {
      content.metrics.push({ label: 'Net Change', value: `$${netMatch[1]}` });
    }
    const wonMatch = waterfall.narrative.match(/[Cc]losed[- ]?won[^$]*\$([\d,.]+[KMB]?)/);
    if (wonMatch) {
      content.metrics.push({ label: 'Closed Won', value: `$${wonMatch[1]}`, severity: 'good' });
    }
    const lostMatch = waterfall.narrative.match(/[Cc]losed[- ]?lost[^$]*\$([\d,.]+[KMB]?)/);
    if (lostMatch) {
      content.metrics.push({ label: 'Closed Lost', value: `$${lostMatch[1]}`, severity: 'critical' });
    }
    const newMatch = waterfall.narrative.match(/[Nn]ew[^$]*\$([\d,.]+[KMB]?)/);
    if (newMatch) {
      content.metrics.push({ label: 'New Created', value: `$${newMatch[1]}`, severity: 'good' });
    }
  } else {
    content.narrative = 'No pipeline waterfall data available. Run pipeline-waterfall skill to populate this section.';
    content.metrics = [];
  }

  if (velocity && !waterfall) {
    content.narrative = stripActionTags(velocity.narrative);
  }
}

async function buildActionsSummary(content: SectionContent, workspaceId: string): Promise<void> {
  const topSkills = [
    'forecast-rollup', 'deal-risk-review', 'single-thread-alert',
    'pipeline-hygiene', 'pipeline-coverage', 'rep-scorecard',
  ];

  const evidenceMap = await fetchSkillEvidence(workspaceId, topSkills);
  const allActions: ActionItem[] = [];

  for (const ev of evidenceMap.values()) {
    allActions.push(...extractActionsFromNarrative(ev.narrative));
  }

  const deduped = deduplicateActions(allActions);
  const prioritized = deduped
    .sort((a, b) => {
      const urgencyOrder = { today: 0, this_week: 1, this_month: 2 };
      return (urgencyOrder[a.urgency] || 2) - (urgencyOrder[b.urgency] || 2);
    })
    .slice(0, content.title === 'Actions Summary' ? 5 : 10);

  content.action_items = prioritized;
  content.narrative = prioritized.length > 0
    ? `${prioritized.length} priority actions identified across all analysis. ${prioritized.filter(a => a.urgency === 'today').length} require immediate attention today.`
    : 'No actions identified. Run analysis skills to generate recommended actions.';
}

function deduplicateActions(actions: ActionItem[]): ActionItem[] {
  const seen = new Set<string>();
  return actions.filter(a => {
    const key = `${a.related_deal || ''}_${a.action.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
